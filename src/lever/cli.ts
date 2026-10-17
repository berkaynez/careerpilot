import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { profileSchema, jobSchema, selectCV } from '../preparation/core.js';
import { readLocalJSON } from '../preparation/files.js';
import { leverUrls, canInspectLeverRequest, inspectLeverForm, planLeverDraft, leverAnswersSchema } from './form.js';

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, job: { type: 'string' }, answers: { type: 'string' } }, strict: true });
  if (!values.profile || !values.job) throw new Error('LEVER_ARGUMENTS_INVALID');
  const profile = profileSchema.parse(await readLocalJSON(resolve(values.profile)));
  const job = jobSchema.parse(await readLocalJSON(resolve(values.job)));
  const answers = leverAnswersSchema.parse(values.answers ? await readLocalJSON(resolve(values.answers)) : {});
  const urls = leverUrls(job.sourceUrl);
  const cv = selectCV(profile, job);
  const browser = await chromium.launch({ headless: true });
  try {
    // Inspection never enters personal data. Disable scripts, workers and all write requests.
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => {
      const request = route.request();
      const allowed = canInspectLeverRequest(request.url(), request.method(), request.resourceType(), job.sourceUrl);
      return allowed ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000);
    await page.goto(urls.description, { waitUntil: 'domcontentloaded' });
    if (page.url() !== urls.description) throw new Error('LEVER_UNEXPECTED_PAGE');
    const links = await page.locator('a[href]').evaluateAll(elements => elements.map(el => ({
      text: el.textContent?.trim() ?? '', href: (el as HTMLAnchorElement).href,
    })));
    const applyLinks = links.filter(link => /apply/i.test(link.text) && link.href === urls.apply);
    if (!applyLinks.length) throw new Error('LEVER_APPLY_LINK_MISSING');
    // Follow only the exact observed application URL for this posting.
    await page.goto(applyLinks[0]!.href, { waitUntil: 'domcontentloaded' });
    const form = await inspectLeverForm(page, urls.apply);
    if (!form.fields.some(field => field.name === 'name') || !form.fields.some(field => field.name === 'email')) throw new Error('LEVER_FORM_UNRECOGNISED');
    const draft = planLeverDraft(profile, form, answers);
    const directory = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot', 'form-reviews', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [name, value] of Object.entries({ 'form.json': form, 'draft.json': draft,
      'cv.json': { id: cv.id, language: cv.language, photo: cv.photo, path: cv.path } })) {
      await writeFile(join(directory, name), JSON.stringify(value, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    }
    console.log(JSON.stringify({ directory, fieldsToFill: draft.fields.length, unresolved: draft.blockers.length,
      status: draft.status, personalDataEntered: false, cvUploaded: false, submitted: false, modelCalls: 0 }, null, 2));
  } finally { await browser.close(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof Error && /^LEVER_[A-Z_]+$/.test(error.message) ? error.message : 'LEVER_INSPECTION_FAILED' }));
  process.exitCode = 1;
});
