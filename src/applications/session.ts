import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { leverUrls } from '../lever/form.js';
import { jobLink } from '../jobs/links.js';
import { profileSchema } from '../preparation/core.js';
import type { Profile } from '../preparation/core.js';
import { assistAnswersSchema, fillKnownApplicationFields } from './fields.js';
import type { AssistAnswers, AssistPassResult } from './fields.js';
import { assistTransport, recognisedAssistOrigin } from './transport.js';

const safeCode = (error: unknown) => error instanceof Error && /^ASSIST_[A-Z_]+$/.test(error.message) ? error.message : 'ASSIST_OPERATION_FAILED';
/** Demo URLs are supplied only by the owning local server, never by an HTTP request. */
export function localDemoURL(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password
    || url.search || url.hash || url.pathname !== '/applications/single') throw new Error('ASSIST_DEMO_URL_INVALID');
  return url.href;
}

/** Trusted buttons/terminal commands control this session; page content cannot issue commands. */
export async function openAssistSession(input: { url: string; profile: Profile; answers: AssistAnswers;
  directory: string; contactApproved: boolean; demoUrl?: string },
  launch: () => Promise<Browser> = () => chromium.launch({ headless: false })) {
  if (!input.contactApproved) throw new Error('ASSIST_CONTACT_CONSENT_REQUIRED');
  const profile = profileSchema.parse(input.profile), answers = assistAnswersSchema.parse(input.answers);
  const link = input.demoUrl ? null : jobLink(input.url);
  const target = link ? (link.platform==='lever' ? leverUrls(link.url).apply : link.url) : localDemoURL(input.demoUrl!);
  const initialOrigin = new URL(target).origin;
  await mkdir(input.directory, { recursive: true, mode: 0o700 }); await chmod(input.directory, 0o700);
  const browser = await launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const transport = await assistTransport(context);
    let page = await context.newPage(); page.setDefaultTimeout(10_000);
    const id = randomUUID(), allowed = new Set([initialOrigin]);
    const pageIds = new WeakMap<object, string>();
    let released = false, busy = false, lastResult: AssistPassResult | null = null, lastError: string | null = null;
    const events: unknown[] = [];
    let writes: Promise<unknown> = Promise.resolve();
    const supported = (origin: string) => recognisedAssistOrigin(origin) || Boolean(input.demoUrl && origin === initialOrigin);
    const snapshot = () => {
      const tabs = context.pages().filter(tab => !tab.isClosed()).map(tab => {
        if (!pageIds.has(tab)) pageIds.set(tab, randomUUID());
        let origin = 'null'; try { origin = new URL(tab.url()).origin; } catch { /* New/closed tabs have no recipient. */ }
        return { id: pageIds.get(tab)!, origin, selected: tab === page, approved: allowed.has(origin), supported: supported(origin) };
      });
      const selected = tabs.find(tab => tab.selected);
      return { id, status: !browser.isConnected() ? 'closed' as const : released ? 'released' as const : transport.guarded ? 'guarded' as const : 'manual' as const,
        busy, initialOrigin, currentOrigin: selected?.origin ?? null, approved: selected?.approved ?? false,
        supported: selected?.supported ?? false, tabs, lastResult, lastError,
        blockedRequests: transport.blockedRequests, modelCalls: 0, automationSubmitted: false, cvUploadedByAgent: false, manualOutcome: 'unknown' as const };
    };
    const save = () => {
      const data = JSON.stringify({ version: 1, sessionId: id, status: snapshot().status, events,
        modelCalls: 0, automationSubmitted: false, cvUploadedByAgent: false, manualOutcome: 'unknown' }, null, 2) + '\n';
      const next = writes.then(() => writeFile(join(input.directory, 'session.json'), data, { mode: 0o600 }));
      writes = next.catch(() => {}); return next;
    };
    browser.on('disconnected', () => { void save().catch(() => {}); });
    const perform = async <T>(action: () => Promise<T>) => {
      if (busy) throw new Error('ASSIST_SESSION_BUSY');
      if (!browser.isConnected()) throw new Error('ASSIST_SESSION_CLOSED');
      if (released) throw new Error('ASSIST_CONTROL_TRANSFERRED');
      busy = true;
      try { return await action(); } finally { busy = false; }
    };
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await save();
    return {
      snapshot,
      async fill() { return perform(async () => {
        if (page.isClosed()) throw new Error('ASSIST_TAB_CLOSED');
        const origin = new URL(page.url()).origin;
        if (!supported(origin) || !allowed.has(origin)) throw new Error('ASSIST_ORIGIN_NOT_APPROVED');
        if (transport.guarded) throw new Error('ASSIST_CONTINUE_REQUIRED');
        await transport.protect(page); lastError = null; lastResult = null;
        try {
          lastResult = await fillKnownApplicationFields(page, { profile, answers, origin, contactApproved: true });
          events.push({ at: new Date().toISOString(), origin, ...lastResult, blockedRequests: transport.blockedRequests });
          await save(); return { ...lastResult, blockedRequests: transport.blockedRequests };
        } catch (error) {
          lastResult = null; lastError = safeCode(error);
          events.push({ at: new Date().toISOString(), origin, code: lastError, blockedRequests: transport.blockedRequests });
          await save(); throw error;
        }
      }); },
      async continueManually() { return perform(async () => {
        await transport.allowManual(); events.push({ at: new Date().toISOString(), action: 'continue' }); await save();
      }); },
      async selectTab(tabId: string) { return perform(async () => {
        if (transport.guarded) throw new Error('ASSIST_CONTINUE_REQUIRED');
        const tab = context.pages().find(candidate => !candidate.isClosed() && pageIds.get(candidate) === tabId);
        if (!tab) throw new Error('ASSIST_TAB_CLOSED');
        page = tab; page.setDefaultTimeout(10_000); await page.bringToFront();
      }); },
      async approveOrigin(origin: string, approved: boolean) { return perform(async () => {
        if (!approved) throw new Error('ASSIST_CONTACT_CONSENT_REQUIRED');
        if (transport.guarded) throw new Error('ASSIST_CONTINUE_REQUIRED');
        if (page.isClosed() || new URL(page.url()).origin !== origin || !supported(origin)) throw new Error('ASSIST_ORIGIN_NOT_APPROVED');
        allowed.add(origin); events.push({ at: new Date().toISOString(), action: 'approve_origin', origin }); await save();
      }); },
      async handoff() { return perform(async () => {
        await transport.allowManual(); released = true;
        events.push({ at: new Date().toISOString(), action: 'handoff' }); await save();
      }); },
      async close() {
        if (busy) throw new Error('ASSIST_SESSION_BUSY');
        events.push({ at: new Date().toISOString(), action: 'close' });
        await browser.close(); await save();
      },
      async shutdown() { await browser.close(); await writes; },
    };
  } catch (error) { await browser.close(); throw error; }
}
export type AssistSession = Awaited<ReturnType<typeof openAssistSession>>;
