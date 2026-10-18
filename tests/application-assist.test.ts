import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { profileSchema } from '../src/preparation/core.js';
import { fillKnownApplicationFields } from '../src/applications/fields.js';
import { assistTransport, recognisedAssistOrigin } from '../src/applications/transport.js';
import { jobLink } from '../src/jobs/links.js';
import { resolveJobLink } from '../src/jobs/intake.js';

const profile=profileSchema.parse({version:1,contact:{name:'Fictional Applicant',email:'fictional@example.invalid',phone:'+90 555 000 0000',location:'Fictional City'},
  preferences:{countries:['TR'],roles:['Software'],authorizedCountries:['TR'],sponsorshipRequiredElsewhere:true},
  facts:[{id:'education',text:{tr:'Kurgusal mezun.',en:'Fictional graduate.'},source:'fixture'}],
  cvs:[{id:'en',language:'en',photo:true,path:'/not-opened/fictional.pdf'}]});
const origin='https://fixture.invalid';
const english=`<!doctype html><meta charset="utf-8"><form><label>First name<input id="first"></label><label>Last name<input id="last"></label><label>Email address *<input id="email" type="email" required></label><input hidden aria-label="Phone" id="hidden"><div style="opacity:0"><label>Email address<input id="honeypot"></label></div><button type="button" id="next">Next</button></form>
<script>document.querySelector('#next').onclick=async()=>{await fetch('/save-step',{method:'POST'});document.body.innerHTML='<form><label>Phone number<input id="phone" type="tel"></label><label>LinkedIn URL<input id="linkedin"></label><label>Years of Java experience<input id="years" required></label><label>Accept terms<input id="terms" type="checkbox" required></label><input type="file" id="cv"><button type="submit">Submit application</button></form>';};</script>`;
const turkish=`<!doctype html><meta charset="utf-8"><form><label>Adınız Soyadınız<input id="name"></label><label>E-posta adresi<input id="email" required></label><label>Cep telefonu<input id="phone"></label><label>Üniversite<select id="university"><option value="">Seçiniz</option><option value="example">Example University</option></select></label><label>Maaş beklentiniz<input id="salary" required></label><label>Çalışma izni<input id="work-permit" required></label></form>`;

async function fixture(html:string){
  const browser=await chromium.launch({headless:true}), context=await browser.newContext({serviceWorkers:'block'});
  let writes=0, requests=0;
  await context.route('**/*',async route=>{
    requests++;
    if(route.request().method()!=='GET'){writes++;await route.fulfill({status:200,body:'fictional only'});return;}
    await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:route.request().frame().parentFrame()?'<body>Fictional sign-in frame</body>':html});
  });
  const transport=await assistTransport(context), page=await context.newPage();
  await page.goto(origin+'/apply');
  return {browser,page,transport,writes:()=>writes,requests:()=>requests};
}
const input={profile,answers:{firstName:'Fictional',lastName:'Applicant',university:'Example University',linkedin:'https://www.linkedin.com/in/example'},origin,contactApproved:true};

test('shared engine handles English steps after human navigation, without clicking next, attaching a CV or deciding consent',async t=>{
  const app=await fixture(english);t.after(()=>app.browser.close());
  await app.transport.protect(app.page);
  const first=await fillKnownApplicationFields(app.page,input);
  assert.equal(first.filled,3);assert.equal(await app.page.locator('#first').inputValue(),'Fictional');
  assert.equal(await app.page.locator('#hidden').inputValue(),'');assert.equal(await app.page.locator('#honeypot').inputValue(),'');assert.equal(await app.page.locator('#next').count(),1);
  await app.page.locator('#next').click();assert.equal(app.writes(),0);assert.equal(await app.page.locator('#next').count(),1);
  await app.transport.allowManual();
  await app.page.locator('#next').click();await app.page.locator('#phone').waitFor();
  assert.equal(app.writes(),1);
  await app.transport.protect(app.page);
  const second=await fillKnownApplicationFields(app.page,input);
  assert.equal(second.filled,2);assert.equal(second.status,'needs_information');
  assert.equal(await app.page.locator('#years').inputValue(),'');assert.equal(await app.page.locator('#terms').isChecked(),false);
  assert.equal(await app.page.locator('#cv').evaluate((element:HTMLInputElement)=>element.files?.length),0);
  assert.equal(second.agentSubmitted,false);assert.equal(second.cvUploadedByAgent,false);
  assert.ok(second.remaining.some(field=>field.reason==='manual_file_selection_required'));
  assert.ok(!JSON.stringify(second).includes(profile.contact.email));
});

test('same engine fills Turkish labels and university, leaving salary and work authorisation unanswered',async t=>{
  const app=await fixture(turkish);t.after(()=>app.browser.close());await app.transport.protect(app.page);
  const result=await fillKnownApplicationFields(app.page,input);
  assert.equal(result.filled,4);assert.equal(await app.page.locator('#university').inputValue(),'example');
  assert.equal(await app.page.locator('#salary').inputValue(),'');assert.equal(await app.page.locator('#work-permit').inputValue(),'');
  assert.equal(app.writes(),0);assert.equal(result.remaining.length,2);
});

test('existing answers and duplicate identities are preserved; autocomplete widgets require manual selection',async t=>{
  const app=await fixture('<label>Full name<input id="name" value="Existing User"></label><label>Email<input id="one"></label><label>Email<input id="two"></label><label>University<input id="combo" role="combobox"></label>');
  t.after(()=>app.browser.close());await app.transport.protect(app.page);
  const result=await fillKnownApplicationFields(app.page,input);
  assert.equal(result.filled,0);assert.equal(await app.page.locator('#name').inputValue(),'Existing User');
  assert.equal(await app.page.locator('#one').inputValue(),'');assert.equal(await app.page.locator('#two').inputValue(),'');
  assert.equal(result.remaining.filter(field=>field.reason==='ambiguous_field').length,2);
  assert.ok(result.remaining.some(field=>field.reason==='interactive_widget_requires_human'));
});

test('login forms, absent sharing approval, different origins and inconsistent name parts stop before personal input',async t=>{
  const app=await fixture('<label>Email<input id="email"></label><label>Password<input type="password" id="password"></label>');
  t.after(()=>app.browser.close());await app.transport.protect(app.page);
  await assert.rejects(fillKnownApplicationFields(app.page,{...input,contactApproved:false}),/ASSIST_CONTACT_CONSENT_REQUIRED/);
  await assert.rejects(fillKnownApplicationFields(app.page,{...input,origin:'https://other.invalid'}),/ASSIST_ORIGIN_NOT_APPROVED/);
  await assert.rejects(fillKnownApplicationFields(app.page,{...input,answers:{firstName:'Invented',lastName:'Person'}}),/ASSIST_NAME_PARTS_NOT_VERIFIED/);
  assert.equal((await fillKnownApplicationFields(app.page,input)).status,'login_required');
  assert.equal(await app.page.locator('#email').inputValue(),'');assert.equal(await app.page.locator('#password').inputValue(),'');
});

test('site writes and GET beacons triggered by typing are blocked; later parser changes fail final verification',async t=>{
  const app=await fixture(`<label>Email<input id="email"></label><label>Phone<input id="phone"></label><script>
 document.querySelector('#email').oninput=()=>{fetch('/unexpected-submit',{method:'POST'}).catch(()=>{});const img=new Image();img.src='/beacon?email='+encodeURIComponent(document.querySelector('#email').value);};
 document.querySelector('#phone').oninput=()=>document.querySelector('#email').value='parser-overwrite';
 </script>`);t.after(()=>app.browser.close());await app.transport.protect(app.page);
  await assert.rejects(fillKnownApplicationFields(app.page,input),/ASSIST_FINAL_VALUES_NOT_VERIFIED/);
  assert.equal(app.writes(),0);assert.equal(app.requests(),1);assert.ok(app.transport.blockedRequests>=2);
});

test('Indeed keeps its posting key and Kariyer.net links enter the common intake; unapproved origins remain rejected',async()=>{
  const indeed='https://tr.indeed.com/viewjob?jk=0123456789abcdef';
  const kariyer='https://www.kariyer.net/is-ilani/example-junior-developer-1234567';
  assert.equal(jobLink(indeed+'&tracking=private').url,indeed);
  assert.equal(jobLink(kariyer+'?tracking=private').platform,'kariyer');
  for(const url of [indeed+'&jk=ffffffffffffffff','https://tr.indeed.com.attacker.invalid/viewjob?jk=0123456789abcdef','https://www.kariyer.net/is-ilanlari/yazilim'])assert.throws(()=>jobLink(url));
  assert.equal(recognisedAssistOrigin('https://smartapply.indeed.com'),true);
  for(const url of ['https://indeed.com.attacker.invalid','http://127.0.0.1','https://www.kariyer.net/private','https://user:secret@tr.indeed.com'])assert.equal(recognisedAssistOrigin(url),false);
  for(const url of [indeed,kariyer]){
    const result=await resolveJobLink(url,async(link)=>({url:link.url,title:'Fictional analyst',company:'Example',text:'Analyse fictional data and write reports with a team.',links:[]}));
    assert.equal(result.status,'resolved');assert.equal(result.employer.url,url);
  }
});

test('email-only sign-in headings and visible login iframes stop without filling contact details',async t=>{
  for(const html of [
    '<h1>Sign in</h1><label>Email<input id="email" type="email"></label><button>Continue</button>',
    '<h2>Hesap oluştur veya giriş yap</h2><label>E-posta<input id="email"></label>',
    '<h1>GİRİŞ YAP</h1><label>E-posta<input id="email"></label>',
    '<label>Email<input id="email"></label><iframe title="Login window" src="https://secure.indeed.com/auth?branding=fixture"></iframe>',
  ]){
    const app=await fixture(html);t.after(()=>app.browser.close());await app.transport.protect(app.page);
    const result=await fillKnownApplicationFields(app.page,input);
    assert.equal(result.status,'login_required');assert.equal(result.filled,0);
    assert.equal(await app.page.locator('#email').inputValue(),'');assert.equal(app.writes(),0);
  }
});
test('ordinary sign-in header links and hidden auth iframes do not block the actual application form',async t=>{
  const app=await fixture(english+'<a href="/login">Sign in</a><iframe hidden title="Login window" src="about:blank"></iframe>');
  t.after(()=>app.browser.close());await app.transport.protect(app.page);
  const result=await fillKnownApplicationFields(app.page,input);
  assert.equal(result.filled,3);assert.notEqual(result.status,'login_required');
});
