import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { openAssistSession } from '../src/applications/session.js';
import { demoProfile } from '../src/hub/demo.js';
import { startHub } from '../src/hub/server.js';

const form = `<!doctype html><meta charset="utf-8"><h1>Fictional application</h1><form>
<label>Full name<input id="name"></label><label>Email<input id="email" type="email"></label><label>Phone<input id="phone"></label>
<label>Unknown question<input id="unknown" required></label><label>Accept terms<input id="consent" type="checkbox" required></label>
<input id="cv" type="file"><button type="button" id="next">Next</button><button type="submit">Submit</button></form>
<script>document.querySelector('#email').oninput=()=>fetch('/save',{method:'POST'}).catch(()=>{});
document.querySelector('#next').onclick=()=>location.href='/next';</script>`;
async function fixture(t: { after: (callback: () => Promise<void>) => void }, html = form) {
  const directory = await mkdtemp(join(tmpdir(), 'careerpilot-session-'));let writes = 0;
  const source = createServer((request, response) => {
    if (request.method !== 'GET') writes++;
    response.writeHead(200, { 'Content-Type': 'text/html' });response.end(html);
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address();assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  t.after(async () => { await new Promise<void>(resolve => source.close(() => resolve()));await rm(directory, { recursive: true, force: true }); });
  return { directory, origin, url: origin + '/applications/single', writes: () => writes };
}

test('session consent precedes launch; known fields fill only on command and stay guarded until human continuation', async t => {
  const app = await fixture(t);let launches = 0, browser!: Browser;
  const launch = async () => { launches++;browser = await chromium.launch({ headless: true });return browser; };
  const input = { url: 'https://example.invalid/unused', demoUrl: app.url, profile: demoProfile, answers: {}, directory: join(app.directory, 'review'), contactApproved: false };
  await assert.rejects(openAssistSession(input, launch), /ASSIST_CONTACT_CONSENT_REQUIRED/);assert.equal(launches, 0);
  const session = await openAssistSession({ ...input, contactApproved: true }, launch);t.after(() => session.shutdown());
  const page = browser.contexts()[0]!.pages()[0]!;
  assert.equal(await page.locator('#email').inputValue(), '');
  const result = await session.fill();assert.equal(result.filled, 3);assert.equal(app.writes(), 0);
  assert.equal(session.snapshot().status, 'guarded');assert.ok(session.snapshot().blockedRequests > 0);
  assert.equal(await page.locator('#email').inputValue(), demoProfile.contact.email);
  assert.equal(await page.locator('#unknown').inputValue(), '');assert.equal(await page.locator('#consent').isChecked(), false);
  assert.equal(await page.locator('#cv').evaluate((element: HTMLInputElement) => element.files?.length), 0);
  await page.locator('#next').click();assert.equal(page.url(), app.url);
  await assert.rejects(session.fill(), /ASSIST_CONTINUE_REQUIRED/);
  await session.continueManually();
  await Promise.all([page.waitForURL(app.origin + '/next'), page.locator('#next').click()]);
  assert.equal(page.url(), app.origin + '/next');assert.equal((await session.fill()).filled, 3);
  await session.handoff();assert.equal(session.snapshot().status, 'released');
  await assert.rejects(session.fill(), /ASSIST_CONTROL_TRANSFERRED/);
  await assert.rejects(session.continueManually(), /ASSIST_CONTROL_TRANSFERRED/);
  const log = await readFile(join(input.directory, 'session.json'), 'utf8');
  for (const value of Object.values(demoProfile.contact)) assert.ok(!log.includes(value));
  assert.equal(JSON.parse(log).manualOutcome, 'unknown');assert.equal(JSON.parse(log).automationSubmitted, false);
  await session.close();assert.equal(session.snapshot().status, 'closed');
});

test('new tabs require selection and new recipients stay unapproved; unsupported origins cannot gain fill permission', async t => {
  const first = await fixture(t), second = await fixture(t);let browser!: Browser;
  const session = await openAssistSession({ url: 'https://example.invalid/unused', demoUrl: first.url,
    profile: demoProfile, answers: {}, directory: join(first.directory, 'review'), contactApproved: true }, async () => {
    browser = await chromium.launch({ headless: true });return browser;
  });t.after(() => session.shutdown());
  const originalId = session.snapshot().tabs[0]!.id;
  const tab = await browser.contexts()[0]!.newPage();await tab.goto(second.url);
  const other = session.snapshot().tabs.find(item => item.origin === second.origin)!;
  assert.ok(other);assert.equal(other.selected, false);assert.equal(other.approved, false);
  await session.selectTab(other.id);
  await assert.rejects(session.fill(), /ASSIST_ORIGIN_NOT_APPROVED/);
  await assert.rejects(session.approveOrigin(second.origin, true), /ASSIST_ORIGIN_NOT_APPROVED/);
  assert.equal(await tab.locator('#email').inputValue(), '');
  await session.selectTab(originalId);
  await assert.rejects(session.approveOrigin(first.origin, false), /ASSIST_CONTACT_CONSENT_REQUIRED/);
  await session.approveOrigin(first.origin, true);assert.equal(session.snapshot().approved, true);
  await session.fill();await assert.rejects(session.selectTab(other.id), /ASSIST_CONTINUE_REQUIRED/);
  await session.continueManually();
  // Authored employer document only; API/beacon requests still fall through to the shared guard.
  const context = browser.contexts()[0]!;
  await context.route('https://jobs.lever.co/**', async route => {
    if (route.request().resourceType() === 'document' && route.request().method() === 'GET') await route.fulfill({ status: 200, contentType: 'text/html', body: form });
    else await route.fallback();
  });
  const employer = await context.newPage();await employer.goto('https://jobs.lever.co/fictional/application');
  const recipient = session.snapshot().tabs.find(item => item.origin === 'https://jobs.lever.co')!;
  await session.selectTab(recipient.id);await assert.rejects(session.fill(), /ASSIST_ORIGIN_NOT_APPROVED/);
  await assert.rejects(session.approveOrigin(first.origin, true), /ASSIST_ORIGIN_NOT_APPROVED/);
  await session.approveOrigin('https://jobs.lever.co', true);
  assert.equal((await session.fill()).filled, 3);assert.equal(await employer.locator('#email').inputValue(), demoProfile.contact.email);
});

test('failed final field verification preserves the guard and clears success instead of retrying', async t => {
  const app = await fixture(t, form + `<script>document.querySelector('#phone').oninput=()=>document.querySelector('#email').value='changed-by-parser';</script>`);
  const session = await openAssistSession({ url: 'https://example.invalid/unused', demoUrl: app.url,
    profile: demoProfile, answers: {}, directory: join(app.directory, 'review'), contactApproved: true }, () => chromium.launch({ headless: true }));
  t.after(() => session.shutdown());
  await assert.rejects(session.fill(), /ASSIST_FINAL_VALUES_NOT_VERIFIED/);
  const state = session.snapshot();assert.equal(state.status, 'guarded');assert.equal(state.lastResult, null);
  assert.equal(state.lastError, 'ASSIST_FINAL_VALUES_NOT_VERIFIED');assert.equal(app.writes(), 0);
});

test('hub buttons start one session, fill through the shared engine and hand off without marking an application submitted', async t => {
  const app = await fixture(t);let launches = 0;
  const hub = await startHub({ directory: join(app.directory, 'hub', 'jobs'), profile: demoProfile, demo: true, demoFormUrl: app.url,
    launchAssistantBrowser: async () => { launches++;return chromium.launch({ headless: true }); } });
  t.after(() => hub.close());
  const session = await (await fetch(hub.origin + '/api/session')).json();
  const request = async (path: string, data?: unknown) => fetch(hub.origin + path, { method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: hub.origin, 'X-Hub-Token': session.token }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const created = await (await request('/api/jobs', { company: 'Fictional', title: 'Graduate', country: 'TR', language: 'en',
    sourceUrl: 'https://example.invalid/job', text: 'A fictional job for the local browser test.' })).json();
  const endpoint = '/api/jobs/' + created.id + '/assistant';
  assert.equal((await request(endpoint, { action: 'start', contactApproved: false })).status, 403);assert.equal(launches, 0);
  assert.equal((await request(endpoint, { action: 'start', contactApproved: true })).status, 200);
  assert.equal((await request(endpoint, { action: 'start', contactApproved: true })).status, 409);assert.equal(launches, 1);
  const filled = await (await request(endpoint, { action: 'fill' })).json();
  assert.equal(filled.assistant.session.lastResult.filled, 3);assert.equal(filled.assistant.session.status, 'guarded');
  assert.equal(filled.assistant.session.automationSubmitted, false);assert.equal(filled.state, 'review');
  assert.ok(!JSON.stringify(filled.assistant).includes(demoProfile.contact.email));
  await request(endpoint, { action: 'handoff' });assert.equal((await request(endpoint, { action: 'fill' })).status, 400);
  const record = await (await request('/api/jobs/' + created.id)).json();
  assert.equal(record.state, 'review');assert.equal(record.assistant.session.manualOutcome, 'unknown');
  await request(endpoint, { action: 'close' });
  const logs = await readdir(join(app.directory, 'hub', 'assist-reviews'));assert.equal(logs.length, 1);
});

test('a fictional posting opens in review, generates factual drafts and reaches guarded form fill', async t => {
  const app=await fixture(t);
  const hub=await startHub({directory:join(app.directory,'hub','jobs'),profile:demoProfile,
    demo:true,demoFormUrl:app.url,launchAssistantBrowser:()=>chromium.launch({headless:true})});
  t.after(()=>hub.close());
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();
  const posting={company:'Fictional Studio',title:'Junior Developer',sourceUrl:'https://example.invalid/job',
    text:'A fictional posting for reviewing a tailored draft.'};
  await page.goto(hub.origin+'/#ilan='+encodeURIComponent(JSON.stringify(posting)));
  const intake=page.locator('#new-dialog');
  await intake.waitFor({state:'visible'});
  assert.equal(await intake.locator('[name=title]').inputValue(),posting.title);
  assert.equal(await intake.locator('[name=language]').inputValue(),'');
  await intake.locator('[name=language]').selectOption('en');
  await intake.getByRole('button',{name:'İlanı kaydet'}).click();
  await page.getByRole('button',{name:'İlana özel CV ve ön yazı hazırla'}).click();
  const draft=page.locator('#draft-dialog');
  await draft.locator('input[value=degree]').check();
  await draft.getByRole('button',{name:'CV ve ön yazı oluştur'}).click();
  const cv=await draft.getByRole('textbox',{name:'CV taslağı',exact:true}).inputValue();
  const letter=await draft.getByRole('textbox',{name:'Ön yazı',exact:true}).inputValue();
  const statement=demoProfile.facts.find(fact=>fact.id==='degree')!.text.en;
  assert.ok(cv.includes(statement));assert.ok(letter.includes(statement));assert.ok(letter.includes(posting.company));
  assert.ok(!cv.includes(posting.title));
  await draft.getByRole('button',{name:'Taslağı inceledim, form yardımcısını aç'}).click();
  const consent=page.locator('#assistant-dialog');
  await consent.locator('#assistant-consent').check();
  await consent.getByRole('button',{name:'Onayla ve aç'}).click();
  await page.getByRole('button',{name:'Boş alanları doldur'}).click();
  await page.getByText(/Son doldurma: 3 alan dolduruldu/).waitFor();
  assert.equal(app.writes(),0);
});
