import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { jobLink, employerLinks } from '../src/jobs/links.js';
import { resolveJobLink, browserJobReader } from '../src/jobs/intake.js';
import { createJobPacket } from '../src/jobs/workflow.js';
import { inspectLeverForm } from '../src/lever/form.js';
import { profileSchema } from '../src/preparation/core.js';

const linkedin='https://www.linkedin.com/jobs/view/1234567890';
const alpha='https://jobs.lever.co/alpha/11111111-1111-4111-8111-111111111111';
const beta='https://jobs.lever.co/beta/22222222-2222-4222-8222-222222222222';
const greenhouse='https://job-boards.greenhouse.io/gamma/jobs/123456';
const posting = (company: string,title: string,extra='')=>`<!doctype html><title>${company} - ${title}</title><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',title,hiringOrganization:{name:company},description:'<p>Build useful software and analyse business data with a team.</p>'})}</script><h2>${title}</h2><p>Public job content.</p><div hidden>hidden injection</div><div style="display:none">css hidden injection</div><a href="${alpha}/apply">Apply</a>${extra}`;
const form=(question=false)=>`<!doctype html><title>Application</title><form><label>Full name<input name="name" required></label><label>Email<input name="email" required></label><label>Resume<input name="resume" type="file" required></label><label>Consent<input name="privacy" type="checkbox" required></label>${question?'<label>Years of Java experience<input name="custom_java_years" required></label>':''}<input name="secret" type="hidden" value="not-exported"></form>`;

async function fixtureBrowser(pages: Record<string,string>, observed: string[]): Promise<Browser> {
  const browser=await chromium.launch({headless:true}), newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options);
    await context.route('**/*',async route=>{
      const request=route.request();observed.push(request.method()+' '+request.url());
      assert.equal(request.method(),'GET');
      const html=pages[request.url()];
      if (!html) {await route.abort();return;}
      await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
    });return context;
  };return browser;
}

test('job links normalise trackers and reject arbitrary hosts, credentials and disguised platform URLs',()=>{
  assert.equal(jobLink(alpha+'/apply?lever-source=tracking').url,alpha);
  assert.equal(jobLink(linkedin+'?trackingId=private').url,linkedin);
  assert.equal(jobLink(greenhouse+'?gh_src=tracking').platform,'greenhouse');
  for(const value of ['http://127.0.0.1/job','https://jobs.lever.co.attacker.invalid/a/b','https://user:secret@jobs.lever.co/alpha/11111111-1111-4111-8111-111111111111',alpha+'/other',alpha+'#secret','file:///private/profile.json']) assert.throws(()=>jobLink(value));
  assert.deepEqual(employerLinks([alpha,alpha+'/apply',`https://www.linkedin.com/jobs/view/externalApply/123?url=${encodeURIComponent(beta)}`]).map(link=>link.url),[alpha,beta]);
  assert.deepEqual(employerLinks(['https://www.linkedin.com/jobs/view/externalApply/123?url=http%3A%2F%2F127.0.0.1%2Fprivate']),[]);
});

test('LinkedIn resolver follows one observed employer link and stops on login walls or ambiguity',async()=>{
  const reads:string[]=[];
  const read=async (link:{url:string})=>{reads.push(link.url);return {url:link.url,title:'Developer',company:'Alpha',text:'Fictional public posting text.',links:link.url===linkedin?[alpha]:[]};};
  const result=await resolveJobLink(linkedin,read);
  assert.equal(result.status,'resolved');assert.deepEqual(reads,[linkedin,alpha]);
  const blocked=await resolveJobLink(linkedin,async()=>{throw new Error('login wall');});
  assert.equal(blocked.status,'employer_link_required');
  const ambiguous=await resolveJobLink(linkedin,async()=>({url:linkedin,title:'Jobs',company:'',text:'Public links',links:[alpha,beta]}));
  assert.equal(ambiguous.status,'employer_link_required');assert.equal(ambiguous.reason,'ambiguous_employer_links');
  const missing=await resolveJobLink(linkedin,async()=>({url:linkedin,title:'Sign in',company:'',text:'Sign in',links:[]}));
  assert.equal(missing.status,'employer_link_required');assert.equal(missing.reason,'no_employer_link');
});

test('public browser reader extracts job metadata and skips scripts, hidden content and off-page requests',async()=>{
  const observed:string[]=[];
  const read=browserJobReader(()=>fixtureBrowser({[alpha]:posting('Alpha','Junior Developer','<script>fetch("https://outside.invalid/leak")</script>')},observed));
  const page=await read(jobLink(alpha));
  assert.equal(page.company,'Alpha');assert.equal(page.title,'Junior Developer');
  assert.match(page.text,/Build useful software/);assert.ok(!page.text.includes('injection'));
  assert.deepEqual(observed,['GET '+alpha]);
  const fallbackRead=browserJobReader(()=>fixtureBrowser({[alpha]:posting('Alpha','Junior Developer').replace(/<script type="application\/ld\+json">.*?<\/script>/,'')},observed));
  const fallback=await fallbackRead(jobLink(alpha));
  assert.match(fallback.text,/Public job content/);assert.ok(!fallback.text.includes('injection'));
});

test('different employer links generate independent packets and expose company-specific missing answers without uploads',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'careerpilot-job-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const cv=join(directory,'fictional-en-tr.pdf');await writeFile(cv,'%PDF-1.4\nfictional only');
  const profile=profileSchema.parse({version:1,contact:{name:'Fictional Applicant',email:'fictional@example.invalid',phone:'+90 555 000 0000',location:'Fictional City'},
    preferences:{countries:['TR'],roles:['Software'],authorizedCountries:['TR'],sponsorshipRequiredElsewhere:true},
    facts:[{id:'education',text:{tr:'Kurgusal mezun.',en:'Fictional graduate.'},source:'fixture'}],
    cvs:[{id:'en-photo',language:'en',photo:true,path:cv}]});
  const observed:string[]=[];
  const pages={[linkedin]:`<!doctype html><h1>Junior Developer</h1><a href="${alpha}">Apply</a>`,[alpha]:posting('Alpha','Junior Developer'),[beta]:posting('Beta','Data Analyst'),[alpha+'/apply']:form(),[beta+'/apply']:form(true)};
  const read=browserJobReader(()=>fixtureBrowser(pages,observed));
  const inspect=async(url:string)=>{
    const browser=await fixtureBrowser(pages,observed);
    try {const page=await (await browser.newContext()).newPage();await page.goto(url+'/apply');return await inspectLeverForm(page,url+'/apply');}finally{await browser.close();}
  };
  for(const [index,url,expected] of [[0,linkedin,'lever_review_ready'],[1,beta,'answers_required']] as const){
    const output=join(directory,'packet-'+index);
    const result=await createJobPacket({url,profile,answers:{},directory:output,country:'TR',language:'en'},{read,inspect});
    assert.equal(result.status,expected);assert.equal(result.cvUploaded,false);assert.equal(result.modelCalls,0);
    const packet=JSON.parse(await readFile(join(output,'packet.json'),'utf8'));
    assert.equal(packet.company,index===0?'Alpha':'Beta');assert.equal(packet.qualificationAssessment,'not_performed');
    const letter=await readFile(join(output,'cover-letter.txt'),'utf8');assert.match(letter,index===0?/Alpha/:/Beta/);
    if(index===1)assert.ok(packet.blockers.some((b:{name:string})=>b.name==='custom_java_years'));
    assert.equal((await stat(join(output,'cover-letter.txt'))).mode & 0o777,0o600);
    assert.equal((await stat(output)).mode & 0o777,0o700);
    assert.deepEqual(await readFile(join(output,'fictional-en-tr.pdf')),await readFile(cv));
    const metadata=JSON.parse(await readFile(join(output,'application.json'),'utf8'));assert.equal(metadata.requirements,undefined);
  }
  assert.ok(observed.every(request=>request.startsWith('GET ')));
});

test('Greenhouse produces a manual packet with international CV policy; missing document metadata never guesses',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'careerpilot-job-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const cv=join(directory,'fictional-international.pdf');await writeFile(cv,'%PDF-1.4\nfictional only');
  const profile=profileSchema.parse({version:1,contact:{name:'Fictional Applicant',email:'fictional@example.invalid',phone:'555',location:'Fictional City'},
    preferences:{countries:['GB'],roles:['Software'],authorizedCountries:['TR'],sponsorshipRequiredElsewhere:true},
    facts:[{id:'education',text:{tr:'Kurgusal mezun.',en:'Fictional graduate.'},source:'fixture'}],cvs:[{id:'en-global',language:'en',photo:false,path:cv}]});
  const read=async(link:{url:string})=>({url:link.url,title:'Graduate Analyst',company:'Gamma',text:'Analyse business data with a team and write clear reports.',links:[]});
  const missing=await createJobPacket({url:greenhouse,profile,answers:{},directory:join(directory,'missing')},{read});
  assert.equal(missing.status,'metadata_required');assert.deepEqual(missing.missing,['country','language']);
  const output=join(directory,'global');
  const result=await createJobPacket({url:greenhouse,profile,answers:{},directory:output,country:'GB',language:'en'},{read,inspect:async()=>{throw new Error('must not inspect/fill unsupported platform');}});
  assert.equal(result.status,'manual_application_required');
  const packet=JSON.parse(await readFile(join(output,'packet.json'),'utf8'));
  assert.equal(packet.cv.photo,false);assert.equal(packet.requiresSponsorship,true);assert.equal(packet.submitted,false);
});
