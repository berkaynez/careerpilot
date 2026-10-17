import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { leverUrls, canInspectLeverRequest, inspectLeverForm, planLeverDraft, rehearseLeverDraft, fillLeverFields, verifyLeverFields } from '../src/lever/form.js';
import { fillPreviewPage, createLeverPreview, readPreviewCV } from '../src/lever/preview.js';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Profile } from '../src/preparation/core.js';

const source = 'https://jobs.lever.co/example/11111111-1111-4111-8111-111111111111';
const html = `<!doctype html><title>Fictional application</title><form method="post" action="/submit">
<label>Resume/CV ✱<input name="resume" type="file"></label>
<label>Full name ✱<input name="name" required></label>
<label>Email ✱<input name="email" type="email" required></label>
<label>Phone<input name="phone"></label><label>Current location<input name="location"></label>
<label>Current company<input name="org"></label><label>GitHub URL<input name="urls[GitHub]"></label>
<div><div>University:✱</div><div><select name="cards[university][field0]" required style="display:none">
<option value="">Choose</option><option value="fictional-university">Example University</option></select></div></div>
<label>Privacy consent<input name="cards[privacy][field0]" type="checkbox" required></label>
<input name="secret" type="hidden" value="never-export-this-value"><button type="submit">Submit application</button></form>`;
const profile: Profile = { version: 1,
  contact: { name: 'Fictional Applicant', email: 'fictional@example.invalid', phone: '+90 555 000 0000', location: 'Fictional City' },
  preferences: { countries: ['TR'], roles: ['Software'], authorizedCountries: ['TR'], sponsorshipRequiredElsewhere: true },
  facts: [{ id: 'education', text: { tr: 'Kurgusal mezun.', en: 'Fictional graduate.' }, source: 'fictional fixture' }],
  cvs: [{ id: 'en', language: 'en', photo: true, path: '/fictional/resume.pdf' }],
};

test('Lever inspection confines navigation to one posting and rejects writes, scripts and external resources', () => {
  assert.equal(leverUrls(source+'/apply').apply, source+'/apply');
  for (const url of [source.replace('https:', 'http:'), source.replace('jobs.lever.co', 'jobs.lever.co.attacker.invalid'), source+'?secret=value', source+'/apply/other']) {
    assert.throws(() => leverUrls(url), /LEVER_URL_INVALID/);
  }
  assert.equal(canInspectLeverRequest(source, 'GET', 'document', source), true);
  assert.equal(canInspectLeverRequest(source+'/apply', 'GET', 'document', source), true);
  assert.equal(canInspectLeverRequest('https://jobs.lever.co/style.css', 'GET', 'stylesheet', source), true);
  for (const [url, method, kind] of [[source+'/apply','POST','document'],[source+'/upload','POST','xhr'],
    ['https://outside.invalid/image','GET','image'], ['https://jobs.lever.co/other','GET','document'],
    ['https://jobs.lever.co/script.js','GET','script'], [source+'?name=secret','GET','xhr']]) {
    assert.equal(canInspectLeverRequest(url!, method!, kind!, source), false);
  }
});

test('Lever-shaped authored form produces a truthful plan and rehearses fields without upload, consent or submission', async t => {
  let posts = 0;
  const server = createServer((request, response) => { if (request.method === 'POST') posts++; response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/apply`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const page = await browser.newPage(); await page.goto(url);
  const snapshot = await inspectLeverForm(page, url);
  assert.ok(!JSON.stringify(snapshot).includes('never-export-this-value'));
  assert.ok(!snapshot.fields.some(field => field.name === 'secret'));
  assert.equal(snapshot.fields.find(field => field.name === 'resume')?.required, true);
  const draft = planLeverDraft(profile, snapshot, { university: 'Example University', github: 'https://github.com/example' });
  assert.ok(!draft.fields.some(field => field.name === 'org' || /privacy/.test(field.name)));
  assert.equal(draft.blockers.find(field => /privacy/.test(field.name))?.reason, 'user_decision_required');
  assert.equal(draft.blockers.find(field => field.name === 'resume')?.reason, 'cv_upload_requires_separate_approval');
  const result = await rehearseLeverDraft(page, draft);
  assert.equal(result.filledCount, 6); assert.equal(result.submitted, false);
  assert.equal(await page.locator('[name="email"]').inputValue(), profile.contact.email);
  assert.equal(await page.locator('select').inputValue(), 'fictional-university');
  assert.equal(await page.locator('[type="checkbox"]').isChecked(), false);
  assert.equal(await page.locator('[type="file"]').inputValue(), '');
  assert.equal(posts, 0);
});

test('unknown required fields, missing university answers and duplicate names stay unresolved', () => {
  const fields = [
    { name: 'essay', kind: 'text' as const, label: 'Tell us more', required: true, options: [] },
    { name: 'university', kind: 'select' as const, label: 'University', required: true, options: [] },
    { name: 'name', kind: 'text' as const, label: 'Name', required: true, options: [] },
  ];
  const draft = planLeverDraft(profile, { url: source+'/apply', title: 'Fictional', fields: [...fields, fields[2]!] }, {});
  assert.equal(draft.fields.length, 0);
  assert.ok(draft.blockers.some(item => item.name === 'essay' && item.reason === 'missing_required_answer'));
  assert.ok(draft.blockers.some(item => item.name === 'university' && item.reason === 'missing_required_answer'));
  assert.ok(draft.blockers.some(item => item.reason === 'ambiguous_field'));
  assert.ok(draft.blockers.some(item => item.reason === 'expected_resume_field_missing'));
});

test('rehearsal rejects live pages before entering candidate data', async () => {
  const page = { url: () => source+'/apply' };
  await assert.rejects(rehearseLeverDraft(page as Parameters<typeof rehearseLeverDraft>[0], {
    status: 'review_required', url: source+'/apply', fields: [], blockers: [], resumeField: 'resume',
  }), /LEVER_REHEARSAL_LOCAL_ONLY/);
});


test('real-form preview requires both approvals before browser launch or personal input', async () => {
  for (const consent of [{ contactApproved: false, cvSelectionApproved: true }, { contactApproved: true, cvSelectionApproved: false }]) {
    await assert.rejects(createLeverPreview({ profile, job: {} as Parameters<typeof createLeverPreview>[0]['job'],
      answers: {}, directory: '/not-created', consent }), /LEVER_PREVIEW_CONSENT_REQUIRED/);
  }
});

test('script-disabled preview verifies field values and local PDF selection while consent and POST handlers stay inactive', async t => {
  let posts = 0;
  const fixture = html.replace('<form ', '<script>document.documentElement.dataset.scriptRan="yes"</script><form oninput="fetch(\'/submit\', {method: \'POST\'})" ');
  const server = createServer((request, response) => { if (request.method === 'POST') posts++; response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(fixture); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/preview`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  const page = await context.newPage(); await page.goto(url);
  const form = await inspectLeverForm(page, url);
  const pdf = { name: 'fictional.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfictional fixture') };
  const consent = { contactApproved: true, cvSelectionApproved: true };
  await assert.rejects(fillPreviewPage(page, form, profile, {}, pdf, consent), /LEVER_MISSING_ANSWERS/);
  assert.equal(await page.locator('[name="email"]').inputValue(), '');
  const result = await fillPreviewPage(page, form, profile, { university: 'Example University' }, pdf, consent);
  assert.equal(result.status, 'filled_preview_only');
  assert.equal(result.filledCount, 5);
  assert.equal(result.cvState, 'selected_in_browser_only');
  assert.equal(result.cvUploaded, false); assert.equal(result.submitted, false);
  assert.equal(await page.locator('[name="email"]').inputValue(), profile.contact.email);
  assert.equal(await page.locator('select').inputValue(), 'fictional-university');
  assert.equal(await page.locator('[type="checkbox"]').isChecked(), false);
  assert.equal(await page.locator('[type="file"]').evaluate(element => (element as HTMLInputElement).files?.[0]?.name), 'fictional.pdf');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.scriptRan), undefined);
  assert.equal(posts, 0);
});

test('preview reads only bounded regular PDF files and refuses symlinks or invalid content', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-preview-cv-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const pdf = join(dir,'fictional.pdf');
  await writeFile(pdf,'%PDF-1.4\nfictional fixture');
  assert.equal((await readPreviewCV(pdf)).name,'fictional.pdf');
  const linked = join(dir,'linked.pdf'); await symlink(pdf, linked);
  await assert.rejects(readPreviewCV(linked));
  await writeFile(pdf,'not a PDF'); await assert.rejects(readPreviewCV(pdf),/LEVER_CV_INVALID/);
});


test('final verification catches location cleared on blur and removes unsourced parser employers', async t => {
  const server = createServer((_request,response) => { response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(html); });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/regression`;
  const browser = await chromium.launch({headless:true});
  t.after(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const page = await browser.newPage(); await page.goto(url);
  const form = await inspectLeverForm(page,url);
  const draft = planLeverDraft(profile,form,{university:'Example University',github:'https://github.com/example'});
  await page.locator('[name="org"]').fill('Fictional previous internship');
  await fillLeverFields(page,draft);
  assert.equal(await page.locator('[name="org"]').inputValue(),'');
  await page.locator('[name="location"]').evaluate(element => element.addEventListener('blur',()=>{(element as HTMLInputElement).value='';}));
  await assert.rejects(fillLeverFields(page,draft),/LEVER_FINAL_FIELDS_NOT_VERIFIED/);
  await assert.rejects(verifyLeverFields(page,draft),/LEVER_FINAL_FIELDS_NOT_VERIFIED/);
});
