import { constants } from 'node:fs';
import { open, mkdir, chmod, writeFile } from 'node:fs/promises';
import { basename, join, dirname } from 'node:path';
import type { Page } from 'playwright';
import { profileSchema, jobSchema, selectCV } from '../preparation/core.js';
import type { Profile, Job } from '../preparation/core.js';
import { leverAnswersSchema, planLeverDraft, fillLeverFields } from './form.js';
import type { LeverAnswers, LeverForm } from './form.js';
import { openLeverSession } from './session.js';

export interface PreviewConsent { contactApproved: boolean; cvSelectionApproved: boolean }
export function requirePreviewConsent(consent: PreviewConsent) {
  if (!consent.contactApproved || !consent.cvSelectionApproved) throw new Error('LEVER_PREVIEW_CONSENT_REQUIRED');
}
export async function readPreviewCV(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 5_000_000) throw new Error('LEVER_CV_INVALID');
    const buffer = await handle.readFile();
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('LEVER_CV_INVALID');
    return { name: basename(path), mimeType: 'application/pdf', buffer };
  } finally { await handle.close(); }
}

/** Script-disabled session only: file selection is not a server upload. No consent/submission action exists. */
export async function fillPreviewPage(page: Page, form: LeverForm, profile: Profile, answers: LeverAnswers,
  cv: Awaited<ReturnType<typeof readPreviewCV>>, consent: PreviewConsent) {
  requirePreviewConsent(consent);
  const draft = planLeverDraft(profile, form, answers);
  if (draft.blockers.some(item => !['cv_upload_requires_separate_approval', 'user_decision_required'].includes(item.reason))) throw new Error('LEVER_MISSING_ANSWERS');
  if (!draft.resumeField) throw new Error('LEVER_FORM_UNRECOGNISED');
  const file = page.locator(`[name=${JSON.stringify(draft.resumeField)}]`);
  if (await file.count() !== 1 || await file.getAttribute('type') !== 'file') throw new Error('LEVER_STALE_FORM');
  if (await page.locator('input[type="checkbox"]:checked,input[type="radio"]:checked').count()) throw new Error('LEVER_PREEXISTING_CONSENT');
  const filledCount = await fillLeverFields(page, draft);
  await file.setInputFiles(cv);
  const selected = await file.evaluate(element => {
    const files = (element as HTMLInputElement).files;
    return files?.length === 1 ? { name: files[0]!.name, size: files[0]!.size } : null;
  });
  if (!selected || selected.name !== cv.name || selected.size !== cv.buffer.length) throw new Error('LEVER_CV_SELECTION_NOT_VERIFIED');
  if (await page.locator('input[type="checkbox"]:checked,input[type="radio"]:checked').count()) throw new Error('LEVER_UNEXPECTED_CONSENT');
  return { status: 'filled_preview_only' as const, filledCount, cvState: 'selected_in_browser_only' as const,
    cvUploaded: false as const, submitted: false as const, modelCalls: 0, draft };
}

export async function createLeverPreview(input: { profile: Profile; job: Job; answers: LeverAnswers;
  directory: string; consent: PreviewConsent }) {
  // Consent is checked before browser launch, personal input or reading the CV.
  requirePreviewConsent(input.consent);
  const profile = profileSchema.parse(input.profile), job = jobSchema.parse(input.job);
  const answers = leverAnswersSchema.parse(input.answers);
  const cvAsset = selectCV(profile, job), cv = await readPreviewCV(cvAsset.path);
  const { browser, page, form } = await openLeverSession(job.sourceUrl);
  try {
    const result = await fillPreviewPage(page, form, profile, answers, cv, input.consent);
    await mkdir(dirname(input.directory), { recursive: true, mode: 0o700 });
    await mkdir(input.directory, { mode: 0o700 });
    await chmod(input.directory, 0o700);
    await page.screenshot({ path: join(input.directory, 'filled-form.png'), fullPage: true });
    await chmod(join(input.directory, 'filled-form.png'), 0o600);
    await writeFile(join(input.directory, 'preview.json'), JSON.stringify({ ...result,
      cv: { id: cvAsset.id, file: cv.name, language: cvAsset.language, photo: cvAsset.photo },
      note: 'Isolated script-disabled preview. File was selected locally, not uploaded. Browser closes after capture; this is not a resumable or submitted application.' }, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
    return { directory: input.directory, status: result.status, filledCount: result.filledCount,
      cvState: result.cvState, cvUploaded: false, submitted: false, modelCalls: 0 };
  } finally { await browser.close(); }
}
