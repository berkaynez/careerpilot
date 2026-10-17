import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readLocalJSON } from '../preparation/files.js';
import { profileSchema, jobSchema } from '../preparation/core.js';
import { leverAnswersSchema } from './form.js';
import { requirePreviewConsent, createLeverPreview } from './preview.js';

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, job: { type: 'string' }, answers: { type: 'string' },
    'approve-contact-sharing': { type: 'boolean' }, 'approve-cv-selection': { type: 'boolean' } }, strict: true });
  const consent = { contactApproved: values['approve-contact-sharing'] === true,
    cvSelectionApproved: values['approve-cv-selection'] === true };
  requirePreviewConsent(consent);
  if (!values.profile || !values.job) throw new Error('LEVER_ARGUMENTS_INVALID');
  const profile = profileSchema.parse(await readLocalJSON(resolve(values.profile)));
  const job = jobSchema.parse(await readLocalJSON(resolve(values.job)));
  const answers = leverAnswersSchema.parse(values.answers ? await readLocalJSON(resolve(values.answers)) : {});
  const directory = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot', 'form-previews', randomUUID());
  console.log(JSON.stringify(await createLeverPreview({ profile, job, answers, directory, consent }), null, 2));
}
void main().catch(error => {
  console.error(JSON.stringify({ code: error instanceof Error && /^LEVER_[A-Z_]+$/.test(error.message) ? error.message : 'LEVER_PREVIEW_FAILED' }));
  process.exitCode = 1;
});
