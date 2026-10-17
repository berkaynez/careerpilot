import type { Page } from 'playwright';
import { z } from 'zod';
import type { Profile } from '../preparation/core.js';

export function leverUrls(source: string) {
  const url = new URL(source);
  if (url.protocol !== 'https:' || url.hostname !== 'jobs.lever.co' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/[a-zA-Z0-9_-]+\/[a-f0-9-]{36}(?:\/apply)?$/.test(url.pathname)) throw new Error('LEVER_URL_INVALID');
  const description = url.href.replace(/\/apply$/, '');
  return { description, apply: description + '/apply' };
}
export function canInspectLeverRequest(url: string, method: string, resourceType: string, source: string): boolean {
  const urls = leverUrls(source), target = new URL(url);
  return method === 'GET' && target.origin === 'https://jobs.lever.co'
    && (resourceType === 'document' ? [urls.description, urls.apply].includes(target.href)
      : ['stylesheet', 'image', 'font'].includes(resourceType));
}
export interface LeverField {
  name: string; kind: 'text' | 'select' | 'file' | 'checkbox' | 'radio'; label: string; required: boolean;
  options: { value: string; label: string }[];
}
export interface LeverForm { url: string; title: string; fields: LeverField[] }

/** Public markup only. Current values, hidden inputs, cookies and LinkedIn sessions are never read. */
export async function inspectLeverForm(page: Page, expectedUrl: string): Promise<LeverForm> {
  if (page.url() !== expectedUrl) throw new Error('LEVER_UNEXPECTED_PAGE');
  return page.evaluate(() => {
    const helpers = {
      clean(value: string | null) { return (value ?? '').replace(/\s+/g, ' ').trim(); },
      labelText(element: Element): string {
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll('input,select,textarea,script,style,[hidden],[aria-hidden="true"]').forEach(child => child.remove());
      return helpers.clean(clone.textContent);
      },
    };
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea'))
      .filter(element => element.name && !element.disabled
        && !(element instanceof HTMLInputElement && ['hidden','password','submit','button','reset','image'].includes(element.type)))
      .filter(element => element.getClientRects().length > 0 || element instanceof HTMLSelectElement
        || (element instanceof HTMLInputElement && element.type === 'file'))
      .map(element => {
        let label = element.getAttribute('aria-label') || Array.from(element.labels ?? []).map(helpers.labelText).join(' ');
        for (let parent = element.parentElement, depth = 0; !label && parent && depth < 4; parent = parent.parentElement, depth++) label = helpers.labelText(parent);
        const kind = element instanceof HTMLSelectElement ? 'select' as const
          : element instanceof HTMLInputElement && element.type === 'file' ? 'file' as const
          : element instanceof HTMLInputElement && element.type === 'checkbox' ? 'checkbox' as const
          : element instanceof HTMLInputElement && element.type === 'radio' ? 'radio' as const : 'text' as const;
        return { name: element.name, kind, label: helpers.clean(label), required: element.required || /[✱*]/.test(label),
          options: element instanceof HTMLSelectElement ? Array.from(element.options).filter(option => !option.disabled)
            .map(option => ({ value: option.value, label: helpers.clean(option.label) })) : [] };
      });
    return { url: location.href, title: document.title, fields };
  });
}
const line = z.string().trim().min(1).max(250).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const web = z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; });
export const leverAnswersSchema = z.strictObject({ university: line.optional(),
  linkedin: web.optional(), github: web.optional(), portfolio: web.optional() });
export type LeverAnswers = z.infer<typeof leverAnswersSchema>;
export interface LeverDraft {
  status: 'review_required'; url: string;
  fields: { name: string; kind: 'text' | 'select'; value: string; source: string }[];
  blockers: { name: string; reason: string }[];
  resumeField: string | null;
}

/** Deterministic field mapping: job text cannot invent values or grant legal consent. */
export function planLeverDraft(profile: Profile, form: LeverForm, answers: LeverAnswers): LeverDraft {
  const supplied: Record<string, { value: string | undefined; source: string }> = {
    name: { value: profile.contact.name, source: 'contact.name' },
    email: { value: profile.contact.email, source: 'contact.email' },
    phone: { value: profile.contact.phone, source: 'contact.phone' },
    location: { value: profile.contact.location, source: 'contact.location' },
    'urls[LinkedIn]': { value: answers.linkedin, source: 'application.linkedin' },
    'urls[GitHub]': { value: answers.github, source: 'application.github' },
    'urls[Portfolio]': { value: answers.portfolio, source: 'application.portfolio' },
  };
  const fields: LeverDraft['fields'] = [], blockers: LeverDraft['blockers'] = [];
  const counts = new Map<string, number>();
  form.fields.forEach(field => counts.set(field.name, (counts.get(field.name) ?? 0) + 1));
  let resumeField: string | null = null;
  for (const field of form.fields) {
    if (counts.get(field.name)! > 1) { blockers.push({ name: field.name, reason: 'ambiguous_field' }); continue; }
    if (field.kind === 'file') {
      if (field.name === 'resume') { resumeField = field.name; blockers.push({ name: field.name, reason: 'cv_upload_requires_separate_approval' }); }
      else if (field.required) blockers.push({ name: field.name, reason: 'unknown_required_file' });
      continue;
    }
    if (field.kind === 'checkbox' || field.kind === 'radio') {
      if (field.required) blockers.push({ name: field.name, reason: 'user_decision_required' });
      continue;
    }
    if (field.kind === 'select') {
      if (/university|üniversite/i.test(field.label) && answers.university) {
        const matches = field.options.filter(option => option.value && option.label === answers.university);
        if (matches.length === 1) fields.push({ name: field.name, kind: 'select', value: matches[0]!.value, source: 'application.university' });
        else blockers.push({ name: field.name, reason: 'university_option_not_unique' });
      } else if (field.required) blockers.push({ name: field.name, reason: 'missing_required_answer' });
      continue;
    }
    const answer = supplied[field.name];
    if (answer?.value) fields.push({ name: field.name, kind: 'text', value: answer.value, source: answer.source });
    else if (field.required) blockers.push({ name: field.name, reason: 'missing_required_answer' });
  }
  if (!resumeField) blockers.push({ name: 'resume', reason: 'expected_resume_field_missing' });
  return { status: 'review_required', url: form.url, fields, blockers, resumeField };
}

/** Rehearsal only, on authored loopback pages. This is not a live-site fill/submit function. */
export async function rehearseLeverDraft(page: Page, draft: LeverDraft) {
  const url = new URL(page.url());
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || page.url() !== draft.url) throw new Error('LEVER_REHEARSAL_LOCAL_ONLY');
  const current = await inspectLeverForm(page, draft.url);
  // Validate the entire plan before entering even the first value.
  for (const field of draft.fields) {
    const matches = current.fields.filter(candidate => candidate.name === field.name && candidate.kind === field.kind);
    if (matches.length !== 1 || (field.kind === 'select' && !matches[0]!.options.some(option => option.value === field.value))) throw new Error('LEVER_STALE_FORM');
  }
  for (const field of draft.fields) {
    const exact = page.locator(`[name=${JSON.stringify(field.name)}]`);
    if (await exact.count() !== 1) throw new Error('LEVER_STALE_FORM');
    if (field.kind === 'select') await exact.selectOption(field.value, { force: true });
    else await exact.fill(field.value);
  }
  return { status: 'rehearsed' as const, filledCount: draft.fields.length, submitted: false as const };
}
