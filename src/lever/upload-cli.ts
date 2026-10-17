import { applicationTargetSchema } from '../jobs/target.js';
import { terminalReview } from './review.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readLocalJSON } from '../preparation/files.js';
import { profileSchema } from '../preparation/core.js';
import { leverAnswersSchema } from './form.js';
import { requireUploadConsent, createLeverUploadDraft } from './upload.js';

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, job: { type: 'string' }, answers: { type: 'string' },
    'keep-open': { type: 'boolean' }, 'approve-contact-sharing': { type: 'boolean' }, 'approve-cv-upload': { type: 'boolean' } }, strict: true });
  const consent = { contactApproved: values['approve-contact-sharing'] === true, cvUploadApproved: values['approve-cv-upload'] === true };
  requireUploadConsent(consent);
  if (values['keep-open'] && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('LEVER_INTERACTIVE_TERMINAL_REQUIRED');
  if (!values.profile || !values.job) throw new Error('LEVER_ARGUMENTS_INVALID');
  const profile = profileSchema.parse(await readLocalJSON(resolve(values.profile)));
  const job = applicationTargetSchema.parse(await readLocalJSON(resolve(values.job)));
  const answers = leverAnswersSchema.parse(values.answers ? await readLocalJSON(resolve(values.answers)) : {});
  const directory = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot', 'upload-reviews', randomUUID());
  try { console.log(JSON.stringify(await createLeverUploadDraft({ profile, job, answers, directory, consent, ...(values['keep-open'] ? {review: terminalReview} : {}) }), null, 2)); }
  catch (error) {
    const code = error instanceof Error && /^LEVER_[A-Z_]+$/.test(error.message) ? error.message : 'LEVER_UPLOAD_FAILED';
    console.error(JSON.stringify({ code, directory, note: 'No automatic retry; inspect the checkpoint before any new upload.' }));
    process.exitCode = 1;
  }
}
void main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof Error && /^LEVER_[A-Z_]+$/.test(error.message) ? error.message : 'LEVER_UPLOAD_FAILED' }));
  process.exitCode = 1;
});
