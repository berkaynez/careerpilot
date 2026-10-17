import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { profileSchema, jobSchema, selectCV } from '../preparation/core.js';
import type { Profile, Job } from '../preparation/core.js';
import { leverUrls, inspectLeverForm, planLeverDraft, fillLeverFields, leverAnswersSchema } from './form.js';
import type { LeverAnswers } from './form.js';
import { readPreviewCV } from './preview.js';
import { canBootstrapUpload } from './upload-probe.js';

export interface UploadConsent { contactApproved: boolean; cvUploadApproved: boolean }
export function requireUploadConsent(consent: UploadConsent) {
  if (!consent.contactApproved || !consent.cvUploadApproved) throw new Error('LEVER_UPLOAD_CONSENT_REQUIRED');
}
export const resumeEndpoint = 'https://jobs.lever.co/parseResume';
type CV = Awaited<ReturnType<typeof readPreviewCV>>;

/** Only the first matching upload may pass. Unknown/failed attempts are never retried. */
export class ResumeUploadGate {
  armed = false;
  attempted = false;
  allowed = false;
  constructor(private readonly cv: CV, private readonly accountId: string) {}
  async allow(url: string, method: string, contentType: string, body: Buffer | null): Promise<boolean> {
    if (!this.armed || this.attempted || url !== resumeEndpoint || method !== 'POST') return false;
    this.attempted = true;
    if (!this.accountId || !body || body.length > this.cv.buffer.length+16_384 || !contentType.startsWith('multipart/form-data;')) return false;
    try {
      const form = await new Response(new Uint8Array(body), { headers: { 'Content-Type': contentType } }).formData();
      const keys = [...form.keys()];
      if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes('resume') || !keys.includes('accountId')
        || form.get('accountId') !== this.accountId) return false;
      const file = form.get('resume');
      if (!file || typeof file === 'string' || file.name !== this.cv.name || file.type !== 'application/pdf'
        || file.size !== this.cv.buffer.length || !Buffer.from(await file.arrayBuffer()).equals(this.cv.buffer)) return false;
      this.allowed = true; return true;
    } catch { return false; }
  }
}

export async function createLeverUploadDraft(input: { profile: Profile; job: Job; answers: LeverAnswers;
  directory: string; consent: UploadConsent }, launchBrowser: () => Promise<Browser> = () => chromium.launch({ headless: true })) {
  requireUploadConsent(input.consent);
  const profile = profileSchema.parse(input.profile), job = jobSchema.parse(input.job), answers = leverAnswersSchema.parse(input.answers);
  const urls = leverUrls(job.sourceUrl), asset = selectCV(profile, job), cv = await readPreviewCV(asset.path);
  await mkdir(dirname(input.directory), { recursive: true, mode: 0o700 });
  await mkdir(input.directory, { mode: 0o700 });
  const browser = await launchBrowser();
  let gate: ResumeUploadGate | undefined;
  let uploadVerified = false, fieldsVerified = false, blockedWrites = 0;
  const checkpoint = async (status: string) => writeFile(join(input.directory, 'upload-review.json'), JSON.stringify({
    status, cv: { id: asset.id, file: cv.name, language: asset.language, photo: asset.photo },
    uploadRequestAllowed: gate?.allowed ?? false, uploadVerified, fieldsVerified, blockedWrites,
    cvState: uploadVerified ? 'server_upload_verified' : gate?.allowed ? 'upload_outcome_uncertain' : 'not_uploaded',
    submitted: false, consentAccepted: false, modelCalls: 0,
    note: 'Browser closes after capture. This is not a resumable or submitted application. A permitted upload may be retained by Lever even without a submitted application.'
  }, null, 2)+'\n', { mode: 0o600 });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(() => {
      window.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
      window.addEventListener('click', event => {
        const target = event.target;
        if (target instanceof Element && target.closest('button[type="submit"],input[type="submit"],#btn-submit,#hcaptchaSubmitBtn')) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      }, true);
    });
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.method() !== 'GET') {
        const allowed = request.resourceType() === 'xhr' && gate
          && await gate.allow(request.url(), request.method(), request.headers()['content-type'] ?? '', request.postDataBuffer());
        if (allowed) await route.fallback();
        else { blockedWrites++; await route.abort(); }
        return;
      }
      if (canBootstrapUpload(request.url(), request.method(), request.resourceType(), job.sourceUrl)) await route.fallback();
      else await route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(urls.apply, { waitUntil: 'load', timeout: 30_000 });
    const form = await inspectLeverForm(page, urls.apply), draft = planLeverDraft(profile, form, answers);
    if (draft.blockers.some(item => !['cv_upload_requires_separate_approval','user_decision_required'].includes(item.reason))) throw new Error('LEVER_MISSING_ANSWERS');
    if (await page.locator('input[type="checkbox"]:checked,input[type="radio"]:checked').count()) throw new Error('LEVER_PREEXISTING_CONSENT');
    const account = page.locator('input[type="hidden"][name="accountId"]');
    const storage = page.locator('input[type="hidden"][name="resumeStorageId"]');
    const file = page.locator('input[type="file"][name="resume"]');
    if (await account.count() !== 1 || await storage.count() !== 1 || await file.count() !== 1 || await storage.inputValue()) throw new Error('LEVER_UPLOAD_CONTROL_UNRECOGNISED');
    const accountId = await account.inputValue();
    if (!accountId || accountId.length > 100) throw new Error('LEVER_UPLOAD_CONTROL_UNRECOGNISED');
    gate = new ResumeUploadGate(cv, accountId);
    await fillLeverFields(page, draft);
    if (blockedWrites) throw new Error('LEVER_UNEXPECTED_SIDE_EFFECT');
    gate.armed = true;
    const uploaded = page.waitForResponse(response => response.url() === resumeEndpoint && response.request().method() === 'POST', { timeout: 30_000 });
    const [response] = await Promise.all([uploaded, file.setInputFiles(cv)]);
    gate.armed = false;
    if (!gate.allowed || !response.ok()) throw new Error('LEVER_UPLOAD_NOT_CONFIRMED');
    await page.waitForFunction(name => {
      const id = document.querySelector<HTMLInputElement>('input[name="resumeStorageId"]')?.value;
      const label = document.querySelector('.visible-resume-upload .filename')?.textContent?.trim();
      return Boolean(id) && label === name;
    }, cv.name, { timeout: 15_000 });
    uploadVerified = true;
    // Resume parsing may overwrite fields; reapply and verify the sourced values afterwards.
    await fillLeverFields(page, draft); fieldsVerified = true;
    if (blockedWrites || await page.locator('input[type="checkbox"]:checked,input[type="radio"]:checked').count()) throw new Error('LEVER_UNEXPECTED_SIDE_EFFECT');
    await page.screenshot({ path: join(input.directory, 'uploaded-form.png'), fullPage: true });
    await chmod(join(input.directory, 'uploaded-form.png'), 0o600);
    await checkpoint('uploaded_draft_requires_review');
    return { directory: input.directory, status: 'uploaded_draft_requires_review', fieldsFilled: draft.fields.length,
      cvUploaded: true, submitted: false, consentAccepted: false, modelCalls: 0 };
  } catch (error) {
    await checkpoint('stopped_requires_review');
    throw error;
  } finally { await browser.close(); }
}
