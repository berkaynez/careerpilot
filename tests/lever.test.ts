import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { leverUrls, canInspectLeverRequest, inspectLeverForm, planLeverDraft, rehearseLeverDraft } from '../src/lever/form.js';
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
