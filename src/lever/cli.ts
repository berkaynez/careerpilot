import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { profileSchema, jobSchema, selectCV } from '../preparation/core.js';
import { readLocalJSON } from '../preparation/files.js';
import { planLeverDraft, leverAnswersSchema } from './form.js';
import { openLeverSession } from './session.js';

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, job: { type: 'string' }, answers: { type: 'string' } }, strict: true });
  if (!values.profile || !values.job) throw new Error('LEVER_ARGUMENTS_INVALID');
  const profile = profileSchema.parse(await readLocalJSON(resolve(values.profile)));
  const job = jobSchema.parse(await readLocalJSON(resolve(values.job)));
  const answers = leverAnswersSchema.parse(values.answers ? await readLocalJSON(resolve(values.answers)) : {});
  const cv = selectCV(profile, job);
  const { browser, page, form } = await openLeverSession(job.sourceUrl);
  try {
    const draft = planLeverDraft(profile, form, answers);
    const directory = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot', 'form-reviews', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [name, value] of Object.entries({ 'form.json': form, 'draft.json': draft,
      'cv.json': { id: cv.id, language: cv.language, photo: cv.photo, path: cv.path } })) {
      await writeFile(join(directory, name), JSON.stringify(value, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    }
    await page.screenshot({ path: join(directory, 'empty-form.png'), fullPage: true });
    await chmod(join(directory, 'empty-form.png'), 0o600);
    console.log(JSON.stringify({ directory, fieldsToFill: draft.fields.length, unresolved: draft.blockers.length,
      status: draft.status, personalDataEntered: false, cvUploaded: false, submitted: false, modelCalls: 0 }, null, 2));
  } finally { await browser.close(); }
}
void main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof Error && /^LEVER_[A-Z_]+$/.test(error.message) ? error.message : 'LEVER_INSPECTION_FAILED' }));
  process.exitCode = 1;
});
