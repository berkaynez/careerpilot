import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResumeUploadGate, resumeEndpoint, createLeverUploadDraft } from '../src/lever/upload.js';
import { canBootstrapUpload, canSearchLeverLocation } from '../src/lever/upload-probe.js';
import { profileSchema, jobSchema } from '../src/preparation/core.js';

const pdf = { name: 'fictional.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfictional upload test') };
async function multipart(extra = false, account = 'fixture-account', content = pdf.buffer) {
  const form = new FormData(); form.append('resume', new Blob([new Uint8Array(content)], { type: 'application/pdf' }), pdf.name);
  form.append('accountId', account); if (extra) form.append('email', 'fictional@example.invalid');
  const response = new Response(form);
  return { type: response.headers.get('content-type')!, body: Buffer.from(await response.arrayBuffer()) };
}
const source = 'https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111';

test('upload gate allows exactly the approved PDF once, with no extra fields or alternative destinations', async () => {
  const valid = await multipart();
  const gate = new ResumeUploadGate(pdf, 'fixture-account');
  assert.equal(await gate.allow(resumeEndpoint, 'POST', valid.type, valid.body), false);
  gate.armed = true;
  assert.equal(await gate.allow(source+'/apply','POST',valid.type,valid.body),false);
  assert.equal(await gate.allow(resumeEndpoint+'?redirect=1','POST',valid.type,valid.body),false);
  assert.equal(await gate.allow(resumeEndpoint,'POST',valid.type,valid.body),true);
  assert.equal(await gate.allow(resumeEndpoint,'POST',valid.type,valid.body),false);
  for (const invalid of [await multipart(true), await multipart(false,'another-account'), await multipart(false,'fixture-account',Buffer.from('%PDF-different'))]) {
    const rejected = new ResumeUploadGate(pdf,'fixture-account'); rejected.armed = true;
    assert.equal(await rejected.allow(resumeEndpoint,'POST',invalid.type,invalid.body),false);
    assert.equal(await rejected.allow(resumeEndpoint,'POST',valid.type,valid.body),false);
  }
  assert.equal(canBootstrapUpload('https://jobs.lever.co/js/parseResume.js','GET','script',source),true);
  assert.equal(canBootstrapUpload('https://www.linkedin.com/widget','GET','script',source),false);
  assert.equal(canBootstrapUpload(source+'/apply','POST','document',source),false);
});

test('real upload approval is distinct from file-selection approval and checked before browser launch', async () => {
  for (const consent of [{contactApproved:false,cvUploadApproved:true},{contactApproved:true,cvUploadApproved:false}]) {
    let launched = false;
    await assert.rejects(createLeverUploadDraft({ profile: {} as never, job: {} as never, answers: {}, directory:'/not-created', consent },
      async () => { launched = true; throw new Error('should not launch'); }), /LEVER_UPLOAD_CONSENT_REQUIRED/);
    assert.equal(launched,false);
  }
});

const fixture = `<!doctype html><meta charset="utf-8"><title>Fictional Lever upload</title>
<form method="post"><label>Resume ✱<a class="visible-resume-upload"><span class="filename"></span><input type="file" name="resume"></a></label>
<label>Name<input name="name" required></label><label>Email<input name="email" required></label>
<label>Current company<input name="org"></label><label>Phone<input name="phone"></label><label>Location<input name="location"></label>
<input type="hidden" name="selectedLocation"><div class="dropdown-location" hidden>Fictional City, TUR</div>
<label>LinkedIn URL<input name="urls[LinkedIn]"></label><label>GitHub URL<input name="urls[GitHub]"></label>
<label>University<select name="university" required><option value="">Choose</option><option value="Example University">Example University</option></select></label>
<label>Privacy consent<input type="checkbox" name="privacy" required></label>
<input type="hidden" name="accountId" value="fixture-account"><input type="hidden" name="resumeStorageId" value="">
<button type="button" id="btn-submit">Submit</button></form>
<script>
const city=document.querySelector('[name="location"]'), selected=document.querySelector('[name="selectedLocation"]'), option=document.querySelector('.dropdown-location');
city.addEventListener('keyup', async function(){if(city.value==='Fictional City'){
 const response=await fetch('/searchLocations?text='+encodeURIComponent(city.value));
 if(response.ok) option.hidden=false;
}});
option.addEventListener('click', function(){city.value=option.textContent;selected.value='fictional-city-id';option.hidden=true;});
city.addEventListener('blur', function(){if(!selected.value)city.value='';});
document.querySelector('[name="resume"]').addEventListener('change', function(event) {
 const file=event.target.files[0], form=new FormData(); form.append('resume',file); form.append('accountId','fixture-account');
 const xhr=new XMLHttpRequest(); xhr.open('POST','/parseResume');
 xhr.onload=function(){ if(xhr.status===200){ document.querySelector('[name="resumeStorageId"]').value=JSON.parse(xhr.responseText).id;
 document.querySelector('.filename').textContent=file.name; document.querySelector('[name="name"]').value='parser-overwrite'; document.querySelector('[name="org"]').value='Fictional previous internship'; }};
 xhr.send(form);
});
</script>`;

async function runFixture(t: TestContext, fail: boolean) {
  const dir = await mkdtemp(join(tmpdir(),'careerpilot-upload-')); t.after(() => rm(dir,{recursive:true,force:true}));
  const cv = join(dir,pdf.name); await writeFile(cv,pdf.buffer);
  const profile = profileSchema.parse({version:1, contact:{name:'Fictional Applicant',email:'fictional@example.invalid',phone:'+90 555 000 0000',location:'Fictional City'},
    preferences:{countries:['TR'],roles:['Software'],authorizedCountries:['TR'],sponsorshipRequiredElsewhere:true},
    facts:[{id:'education',text:{tr:'Kurgusal mezun.',en:'Fictional graduate.'},source:'fixture'}],
    cvs:[{id:'en-photo',language:'en',photo:true,path:cv}]});
  const job = jobSchema.parse({version:1,id:'fictional',company:'Example',title:'Graduate',country:'TR',language:'en',documentLanguage:null,
    photoPolicy:'unspecified',sponsorship:'not_stated',sourceUrl:source,checkedOn:'2026-10-17',requirements:[{id:'one',text:'Relevant degree',priority:'essential'}]});
  let uploads=0, submissions=0, locationSearches=0;
  const launch = async () => {
    const browser = await chromium.launch({headless:true});
    const createContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await createContext(options);
      // Production guard is registered later and must validate each request before this fixture receives it.
      await context.route('https://jobs.lever.co/**', async route => {
        const request = route.request();
        if (request.url()===resumeEndpoint && request.method()==='POST') {
          uploads++;
          assert.ok(request.postDataBuffer()?.includes(pdf.buffer));
          await route.fulfill({status:fail?500:200,contentType:'application/json',body:JSON.stringify({id:'fictional-storage-id'})}); return;
        }
        if (request.url().startsWith('https://jobs.lever.co/searchLocations?')) { locationSearches++; await route.fulfill({status:200,contentType:'application/json',body:'[]'}); return; }
        if(request.method()!=='GET'){submissions++;await route.abort();return;}
        await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture});
      });
      return context;
    };
    return browser;
  };
  const directory=join(dir,'review');
  const input={profile,job,answers:{university:'Example University',linkedin:'https://www.linkedin.com/in/example',github:'https://github.com/example',locationSelection:{query:'Fictional City',label:'Fictional City, TUR'}},
    directory,consent:{contactApproved:true,cvUploadApproved:true}};
  if(fail) await assert.rejects(createLeverUploadDraft(input,launch),/LEVER_UPLOAD_NOT_CONFIRMED/);
  else {
    const result=await createLeverUploadDraft(input,launch);
    assert.equal(result.cvUploaded,true);assert.equal(result.fieldsFilled,7);assert.equal(result.submitted,false);
    assert.equal((await stat(join(directory,'uploaded-form.png'))).mode & 0o777,0o600);
  }
  const checkpoint=JSON.parse(await readFile(join(directory,'upload-review.json'),'utf8'));
  assert.equal(checkpoint.uploadRequestAllowed,true);
  assert.equal(checkpoint.uploadVerified,!fail);
  assert.equal(checkpoint.fieldsVerified,!fail);
  assert.equal(checkpoint.consentAccepted,false);assert.equal(checkpoint.submitted,false);
  assert.equal(checkpoint.cvState,fail?'upload_outcome_uncertain':'server_upload_verified');
  assert.equal(uploads,1);assert.equal(submissions,0);assert.equal(locationSearches,1);
  assert.ok(!JSON.stringify(checkpoint).includes(profile.contact.email));
}

test('mocked upload draft verifies server and UI evidence, refills parser changes and includes both profile links', async t => {
  await runFixture(t,false);
});
test('failed upload records uncertainty and stops without retry or application submission', async t => {
  await runFixture(t,true);
});

test('city lookup allows only the reviewed GET query on the exact Lever endpoint', () => {
  const url='https://jobs.lever.co/searchLocations?text=Fictional%20City';
  assert.equal(canSearchLeverLocation(url,'GET','fetch','Fictional City'),true);
  for (const candidate of [url+'&email=private',url+'&text=other',url.replace('jobs.lever.co','example.invalid'),url.replace('searchLocations','other'),url+'#fragment']) {
    assert.equal(canSearchLeverLocation(candidate,'GET','fetch','Fictional City'),false);
  }
  assert.equal(canSearchLeverLocation(url,'POST','fetch','Fictional City'),false);
  assert.equal(canSearchLeverLocation(url,'GET','document','Fictional City'),false);
  assert.equal(canSearchLeverLocation(url,'GET','fetch'),false);
});
