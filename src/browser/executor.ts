import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { ActionResult, AgentDecision, BrowserAction, BrowserExecutor, BrowserObservation, EventSink } from '../contracts.js';
import type { ApplicationPolicy } from '../policy.js';
import type { CandidateProfile, PersonalData, FactValue } from '../profile.js';
import { validateDecision, validateLocalOrigin } from '../validation.js';
import { inspectPage } from './inspector.js';

export interface BrowserSessionOptions {
  runId: string;
  applicationUrl: string;
  candidate: CandidateProfile;
  personal: PersonalData;
  policy: ApplicationPolicy;
  events?: EventSink;
  headless?: boolean;
}

const renderFact = (value: FactValue): string => Array.isArray(value) ? value.join(', ') : String(value);

/** Fresh, non-persistent Chromium context. No decisions, selectors, or routes per form. */
export class PlaywrightBrowserExecutor implements BrowserExecutor {
  private observation: BrowserObservation | null = null;
  private count = 0;
  private readonly started = Date.now();
  private permit: { url: string; used: boolean } | null = null;
  private busy = false;
  private blocked = 0;
  private deadline: ReturnType<typeof setTimeout>;

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly options: BrowserSessionOptions,
  ) {
    this.deadline = setTimeout(() => { void this.close(); }, options.policy.maxRunMs);
    this.deadline.unref();
  }

  static async create(options: BrowserSessionOptions): Promise<PlaywrightBrowserExecutor> {
    // Snapshot policies/profile so callers cannot change safety inputs mid-run.
    const { events, ...inputs } = options;
    const snapshot = structuredClone(inputs);
    const settings: BrowserSessionOptions = { ...snapshot, ...(events ? { events } : {}) };
    const origin = settings.policy.allowedOrigin;
    const target = new URL(settings.applicationUrl);
    if (!origin || !validateLocalOrigin(target.origin, origin).ok || target.username || target.password
      || !/^[a-zA-Z0-9_-]{1,80}$/.test(settings.runId)
      || !Number.isSafeInteger(settings.policy.maxRunMs) || settings.policy.maxRunMs <= 0) throw new Error('Invalid local session configuration');
    const browser = await chromium.launch({ headless: settings.headless ?? true,
      args: ['--disable-background-networking', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      context.setDefaultTimeout(3_000);
      context.setDefaultNavigationTimeout(5_000);
      let session: PlaywrightBrowserExecutor | undefined;
      let mainPage: Page | undefined;
      context.on('page', page => {
        if (mainPage) void page.close().catch(() => {}); // Popups are never action targets.
      });
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const local = validateLocalOrigin(url.origin, origin).ok && !url.username && !url.password;
        const read = ['GET', 'HEAD'].includes(request.method());
        const permit = session?.permit;
        const submit = local && request.method() === 'POST' && permit && !permit.used && permit.url === request.url()
          && new URLSearchParams(request.postData() ?? '').get('runId') === settings.runId;
        if (!local || (!read && !submit)) {
          if (session) session.blocked++;
          return route.abort('blockedbyclient');
        }
        if (submit) permit.used = true;
        try {
          // Inspect the response before the browser sees it. Never follow redirects
          // in the HTTP client; redirect chains could otherwise escape routing.
          const response = await route.fetch({ maxRedirects: 0, timeout: 5_000 });
          if (response.status() >= 300 && response.status() < 400) {
            if (session) session.blocked++;
            return await route.abort('blockedbyclient');
          }
          await route.fulfill({ response });
        } catch { await route.abort('failed').catch(() => {}); }
      });
      mainPage = await context.newPage();
      session = new PlaywrightBrowserExecutor(browser, context, mainPage, settings);
      mainPage.on('framenavigated', frame => {
        if (frame === mainPage?.mainFrame() && frame.url() !== 'about:blank') {
          try {
            if (!validateLocalOrigin(new URL(frame.url()).origin, origin).ok) void mainPage.close().catch(() => {});
          } catch { void mainPage?.close().catch(() => {}); }
        }
      });
      target.searchParams.set('runId', settings.runId);
      await mainPage.goto(target.href, { waitUntil: 'domcontentloaded' });
      return session;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  private assertActive(signal: AbortSignal): void {
    signal.throwIfAborted();
    if (this.page.isClosed() || Date.now() - this.started >= this.options.policy.maxRunMs) throw new Error('Session closed or run time limit reached');
    if (!validateLocalOrigin(new URL(this.page.url()).origin, this.options.policy.allowedOrigin).ok) throw new Error('Disallowed page origin');
  }

  async observe(signal: AbortSignal): Promise<BrowserObservation> {
    this.assertActive(signal);
    if (this.busy) throw new Error('Action in progress');
    // Keep IDs alphabetic so the existing phone-number redactor cannot mistake
    // random numeric UUID segments for personal data.
    const id = randomUUID().replace(/[0-9]/g, digit => String.fromCharCode(103 + Number(digit)));
    this.observation = await inspectPage(this.page, `obs-${id}`);
    return structuredClone(this.observation);
  }

  async execute(decision: Exclude<AgentDecision, { kind: 'stop' }>, signal: AbortSignal): Promise<readonly ActionResult[]> {
    if (this.busy) return [{ observationId: decision.observationId, status: 'rejected', code: 'ACTION_IN_PROGRESS' }];
    this.busy = true;
    const results: ActionResult[] = [];
    const result = (status: ActionResult['status'], code: string): ActionResult => ({ observationId: decision.observationId, status, code });
    const abort = () => { void this.close(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      this.assertActive(signal);
      const observation = this.observation;
      if (!observation || !validateDecision(decision, observation, this.options.candidate, this.options.personal, this.options.policy, this.count).ok) {
        results.push(result('rejected', 'INVALID_DECISION'));
        return results;
      }
      const current = await inspectPage(this.page, observation.id, false);
      if (JSON.stringify(current) !== JSON.stringify(observation)) {
        results.push(result('rejected', 'PAGE_CHANGED'));
        return results;
      }
      this.observation = null; // Each decision consumes its observation, even if it fails.
      const actions = decision.kind === 'batch' ? decision.actions : [decision.action];
      for (const action of actions) {
        this.assertActive(signal);
        this.count++;
        const blockedBefore = this.blocked;
        await this.perform(action);
        this.assertActive(signal);
        results.push(result(this.blocked === blockedBefore ? 'executed' : 'rejected', this.blocked === blockedBefore ? 'ACTION_EXECUTED' : 'TRAFFIC_BLOCKED'));
        if (decision.kind === 'batch') {
          const after = await inspectPage(this.page, observation.id, false);
          if (JSON.stringify(after) !== JSON.stringify(observation) || this.blocked !== blockedBefore) {
            results[results.length - 1] = this.blocked === blockedBefore
              ? result('executed', 'BATCH_REINSPECT_REQUIRED') : result('rejected', 'TRAFFIC_BLOCKED');
            break;
          }
        }
      }
      return results;
    } catch {
      results.push(result('failed', signal.aborted ? 'ABORTED' : 'ACTION_FAILED'));
      return results;
    } finally {
      this.permit = null;
      this.busy = false;
      signal.removeEventListener('abort', abort);
      for (const item of results) await this.options.events?.write({
        runId: this.options.runId, at: new Date().toISOString(), type: 'action', code: item.code,
        factIds: [], usage: null, costMicroUsd: null,
      });
    }
  }

  private async perform(action: BrowserAction): Promise<void> {
    if (action.kind === 'wait') { await this.page.waitForTimeout(350); return; }
    const target = this.page.locator(`[data-careerpilot-id="${action.elementId}"]`);
    if (await target.count() !== 1 || !await target.isVisible() || !await target.isEnabled()) throw new Error('Target changed');
    switch (action.kind) {
      case 'fill': {
        const value = action.answer.kind === 'personal-reference'
          ? this.options.personal.references[action.answer.referenceId]! : renderFact(action.answer.claim.value);
        await target.fill(value);
        break;
      }
      case 'select': {
        // Resolve option index locally; model arguments contain no DOM selector/value.
        const match = /-option-(\d+)$/.exec(action.optionId);
        if (!match) throw new Error('Invalid option');
        const index = Number(match[1]);
        const option = await target.locator('option').nth(index).evaluate(element => ({ value: (element as HTMLOptionElement).value, label: (element as HTMLOptionElement).label, disabled: (element as HTMLOptionElement).disabled }));
        if (option.disabled || ![option.value, option.label].includes(renderFact(action.claim.value))) throw new Error('Option does not match verified fact');
        await target.selectOption({ index });
        break;
      }
      case 'check': await target.setChecked(action.checked); break;
      case 'click': await target.click(); break;
      case 'submit': {
        const destination = await target.evaluate(element => {
          const button = element as HTMLButtonElement | HTMLInputElement;
          const form = button.form;
          if (!form || button.type !== 'submit') throw new Error('Not a submit control');
          return { url: new URL(button.getAttribute('formaction') ?? form.action, location.href).href,
            method: button.getAttribute('formmethod') ?? form.method };
        });
        const url = new URL(destination.url);
        if (!validateLocalOrigin(url.origin, this.options.policy.allowedOrigin).ok || url.username || url.password || destination.method.toLowerCase() !== 'post') throw new Error('Unsafe submission');
        this.permit = { url: url.href, used: false };
        await target.click();
        break;
      }
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.deadline);
    this.permit = null;
    await this.context.close().catch(() => {});
    await this.browser.close();
  }
}
