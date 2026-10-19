import type { SourceSearch } from '../discovery/search-provider.js';
import { careerLevel } from '../discovery/level.js';
import { sourceSearchQueries, sourcesFromSearchURLs } from '../discovery/source-search.js';
import { openDiscovery } from '../discovery/service.js';
import type { SourceReader } from '../discovery/sources.js';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { Browser } from 'playwright';
import { jobLink } from '../jobs/links.js';
import { openAssistSession } from '../applications/session.js';
import type { AssistSession } from '../applications/session.js';
import { assistAnswersSchema } from '../applications/fields.js';
import type { AssistAnswers } from '../applications/fields.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { postingSchema } from '../preparation/posting.js';
import type { Posting } from '../preparation/posting.js';
import { buildMatchAnalysis, jobSchema, profileSchema, selectCV, validatePlan } from '../preparation/core.js';
import type { Profile, Job, Plan } from '../preparation/core.js';
import { openHubStore, stateSchema } from './store.js';
import type { HubRecord } from './store.js';

export type HubAnalyzer = (posting: Posting, signal: AbortSignal) => Promise<{ job: Job; plan: Plan; costMicroUsd: number }>;
const assistantCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start'), contactApproved: z.boolean(), firstName: assistAnswersSchema.shape.firstName, lastName: assistAnswersSchema.shape.lastName }),
  z.strictObject({ action: z.literal('fill') }), z.strictObject({ action: z.literal('continue') }),
  z.strictObject({ action: z.literal('handoff') }), z.strictObject({ action: z.literal('close') }),
  z.strictObject({ action: z.literal('select'), tabId: z.uuid() }),
  z.strictObject({ action: z.literal('approve'), origin: z.string().max(500), contactApproved: z.boolean() }),
]);
const inputSchema = postingSchema.omit({ version: true, id: true, checkedOn: true });
const safeCode = (error: unknown) => error instanceof Error && /^(HUB|PREP|CONFIG|BUDGET|PROVIDER|ASSIST|JOB|DISCOVERY)_[A-Z_]+$/.test(error.message) ? error.message : 'HUB_REQUEST_FAILED';
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('HUB_JSON_REQUIRED');
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > 200_000) throw new Error('HUB_BODY_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('HUB_JSON_INVALID'); }
}

export async function startHub(options: { directory: string; profile: Profile; demo?: boolean;
  seed?: HubRecord[]; sourceSearch?: SourceSearch; discoveryReader?: SourceReader; analyze?: HubAnalyzer; answers?: AssistAnswers; demoFormUrl?: string; launchAssistantBrowser?: () => Promise<Browser>; modelInfo?: { name: string; destination: string; monthlyLimitUsd: number; perRunLimitUsd: number }; port?: number }) {
  const profile = profileSchema.parse(options.profile), store = await openHubStore(options.directory, profile);
  if (options.seed && !store.list().length) for (const record of options.seed) await store.add(record);
  const discovery = await openDiscovery(dirname(options.directory), store, options.discoveryReader);
  const token = randomBytes(32).toString('hex'), busy = new Set<string>();
  const controller = new AbortController();
  let origin = '';
  const answers = assistAnswersSchema.parse(options.answers ?? {});
  let assistant: { jobId: string; session: AssistSession } | null = null;
  let opening: Promise<AssistSession> | null = null;
  let openingJobId: string | null = null;
  const assistantInfo = (record: HubRecord) => {
    let available = Boolean(options.demo && options.demoFormUrl), recipientOrigin: string | null = null;
    try { recipientOrigin = new URL(available ? options.demoFormUrl! : jobLink(record.posting.sourceUrl).url).origin; available = true; } catch { /* User can still open the unsupported site manually. */ }
    if (record.discovery && !record.discovery.routingConfirmed) available = false;
    const snapshot = assistant?.session.snapshot();
    return { available, recipientOrigin, opening: Boolean(opening), demo: options.demo === true,
      occupiedByOther: Boolean(assistant && assistant.jobId !== record.id && snapshot?.status !== 'closed'),
      session: assistant?.jobId === record.id ? snapshot : null };
  };
  const summaries = (record: HubRecord) => ({ id: record.id, company: record.posting.company, title: record.posting.title,
    country: record.posting.country, state: record.state, updatedAt: record.updatedAt, analyzing: busy.has(record.id),
    discovery: record.discovery ? { ...record.discovery, careerLevel: careerLevel(record.posting).level, levelReason: careerLevel(record.posting).reason } : null,
    score: record.analysis ? buildMatchAnalysis(profile, record.analysis.job, record.analysis.plan).score : null,
    analysisOrigin: record.analysis?.origin ?? null, lastError: record.lastError,
    assistantActive: openingJobId === record.id || assistant?.jobId === record.id && assistant.session.snapshot().status !== 'closed' });
  const detail = (record: HubRecord) => {
    const analysis = record.analysis;
    let cv: { id: string; language: string; photo: boolean } | null = null;
    let cvError: string | null = null;
    try { if (record.discovery && !record.discovery.routingConfirmed) throw new Error('HUB_ROUTING_REQUIRED'); const asset = selectCV(profile, record.posting); cv = { id: asset.id, language: asset.language, photo: asset.photo }; }
    catch { cvError = record.discovery && !record.discovery.routingConfirmed ? 'CV seçimi için ilanın ülkesini ve dilini doğrula.' : 'Uygun CV seçimi profilinde netleşmeli.'; }
    return { ...summaries(record), posting: record.posting, cv, cvError, assistant: assistantInfo(record),
      analysis: analysis ? { origin: analysis.origin, at: analysis.at, costMicroUsd: analysis.costMicroUsd, job: analysis.job,
        match: buildMatchAnalysis(profile, analysis.job, analysis.plan),
        facts: profile.facts.map(fact => ({ id: fact.id, text: fact.text[record.posting.documentLanguage ?? record.posting.language] })) } : null };
  };
  const assets = new Map<string, { type: string; data: Buffer }>();
  for (const [path, file, type] of [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']])
    assets.set(path!, { type: type!, data: await readFile(new URL('./public/' + file!, import.meta.url)) });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin
        || request.headers['sec-fetch-site'] === 'cross-site') { json(403, { code: 'HUB_ORIGIN_REJECTED' }); return; }
      const url = new URL(request.url ?? '/', origin), path = url.pathname;
      const asset = assets.get(path);
      if (asset && request.method === 'GET') { response.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' }); response.end(asset.data); return; }
      if (path === '/api/session' && request.method === 'GET') {
        json(200, { token, demo: options.demo === true, modelEnabled: Boolean(options.analyze), model: options.modelInfo ?? null,
          assistantDefaults: { firstName: answers.firstName ?? '', lastName: answers.lastName ?? '' },
          profile: { facts: profile.facts.length, cvs: profile.cvs.length } }); return;
      }
      if (request.headers['x-hub-token'] !== token) { json(403, { code: 'HUB_SESSION_REQUIRED' }); return; }
      if (request.method !== 'GET' && request.headers.origin !== origin) { json(403, { code: 'HUB_ORIGIN_REJECTED' }); return; }
      if (path === '/api/discovery/search-plan' && request.method === 'GET') {
        const config = discovery.snapshot().config;
        json(200, { automaticSearchEnabled: Boolean(options.sourceSearch), availability: options.sourceSearch ? await options.sourceSearch.status({ roles: config.roles, locations: config.locations.length ? config.locations : ['Turkey','United Kingdom','Remote'] }) : null, queries: sourceSearchQueries({ roles: config.roles, locations: config.locations.length ? config.locations : ['Turkey','United Kingdom','Remote'] }),
          note: options.sourceSearch ? 'Kaydedilmiş kriterler. SerpAPI hazır; arama en çok 4 sorgu tüketir. Profil/CV gönderilmez.' : 'Kaydedilmiş kriterlerden sorgu taslağı. Arama servisine istek yapılmadı; API erişimi henüz yapılandırılmadı.' }); return;
      }
      if (path === '/api/discovery/source-search' && request.method === 'POST') {
        const { approved } = z.strictObject({ approved: z.boolean() }).parse(await body(request));
        if (!approved) throw new Error('DISCOVERY_SEARCH_APPROVAL_REQUIRED');
        if (!options.sourceSearch) throw new Error('DISCOVERY_SEARCH_NOT_ENABLED');
        const config = discovery.snapshot().config;
        json(200, await options.sourceSearch.run({ roles: config.roles, locations: config.locations.length ? config.locations : ['Turkey','United Kingdom','Remote'] }, controller.signal)); return;
      }
      if (path === '/api/discovery/source-candidates' && request.method === 'POST') {
        const { urls } = z.strictObject({ urls: z.array(z.string().max(2000)).max(100) }).parse(await body(request));
        json(200, { sources: sourcesFromSearchURLs(urls), modelCalls: 0, networkCalls: 0 }); return;
      }
      if (path === '/api/discovery' && request.method === 'GET') { json(200, discovery.snapshot()); return; }
      if (path === '/api/discovery/config' && request.method === 'POST') {
        await discovery.configure(await body(request)); json(200, discovery.snapshot()); return;
      }
      if (path === '/api/discovery/run' && request.method === 'POST') {
        z.strictObject({}).parse(await body(request));
        if (options.demo && !options.discoveryReader) { json(409, { code: 'DISCOVERY_DEMO_OFFLINE' }); return; }
        json(200, await discovery.run(controller.signal)); return;
      }
      if (path === '/api/jobs' && request.method === 'GET') { json(200, store.list().map(summaries)); return; }
      if (path === '/api/jobs' && request.method === 'POST') {
        const input = inputSchema.parse(await body(request)), now = new Date().toISOString(), id = randomUUID();
        const posting = postingSchema.parse({ ...input, version: 1, id, checkedOn: now.slice(0, 10) });
        const record = await store.add({ version: 1, id, posting, state: 'saved', createdAt: now, updatedAt: now, analysis: null, lastError: null });
        json(201, detail(record)); return;
      }
      if (path === '/api/import' && request.method === 'POST') {
        const data = z.strictObject({ job: jobSchema, plan: z.unknown() }).parse(await body(request));
        const plan = validatePlan(data.plan, profile, data.job), id = randomUUID(), now = new Date().toISOString();
        const job = { ...data.job, id }, { requirements, ...metadata } = job;
        const posting = postingSchema.parse({ ...metadata, text: 'İçe aktarılan gereksinimler:\n' + requirements.map(item => item.text).join('\n') });
        const record = await store.add({ version: 1, id, posting, state: 'ready', createdAt: now, updatedAt: now,
          analysis: { job, plan, origin: 'imported_review', at: now, costMicroUsd: null }, lastError: null });
        json(201, detail(record)); return;
      }
      const match = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/(status|analyze|assistant|routing))?$/.exec(path);
      if (!match) { json(404, { code: 'HUB_NOT_FOUND' }); return; }
      const id = z.uuid().parse(match[1]), action = match[2], record = store.get(id);
      if (!action && request.method === 'GET') { json(200, detail(record)); return; }
      if (action === 'routing' && request.method === 'POST') {
        const routing = z.strictObject({ country: z.enum(['TR','GB','IE','DE','FR','NL','BE','CH','BA','US','CA']), language: z.enum(['tr','en']) }).parse(await body(request));
        if (!record.discovery || record.discovery.routingConfirmed || record.analysis) throw new Error('HUB_ROUTING_ALREADY_CONFIRMED');
        const saved = await store.update(id, current => {
          if (!current.discovery || current.discovery.routingConfirmed || current.analysis) throw new Error('HUB_ROUTING_ALREADY_CONFIRMED');
          return { ...current, posting: { ...current.posting, ...routing }, discovery: { ...current.discovery, routingConfirmed: true } };
        });
        json(200, detail(saved)); return;
      }
      if (action === 'assistant' && request.method === 'POST') {
        const command = assistantCommand.parse(await body(request));
        if (command.action === 'start') {
          if (!command.contactApproved) { json(403, { code: 'ASSIST_CONTACT_CONSENT_REQUIRED' }); return; }
          if (opening || assistant && assistant.session.snapshot().status !== 'closed') { json(409, { code: 'ASSIST_SESSION_BUSY' }); return; }
          const info = assistantInfo(record);
          if (!info.available) { json(409, { code: 'JOB_PLATFORM_UNSUPPORTED' }); return; }
          openingJobId = id;
          opening = openAssistSession({ url: record.posting.sourceUrl, profile,
            answers: { ...answers, ...(command.firstName ? { firstName: command.firstName } : {}), ...(command.lastName ? { lastName: command.lastName } : {}) },
            directory: join(dirname(options.directory), 'assist-reviews', randomUUID()), contactApproved: true,
            ...(options.demo && options.demoFormUrl ? { demoUrl: options.demoFormUrl } : {}),
          }, options.launchAssistantBrowser);
          try {
            const session = await opening;
            assistant = { jobId: id, session };
            if (controller.signal.aborted) { await session.shutdown(); throw new Error('HUB_SHUTTING_DOWN'); }
            await store.update(id, current => ({ ...current, state: ['saved', 'ready'].includes(current.state) ? 'review' : current.state }));
          } finally { opening = null; openingJobId = null; }
        } else {
          if (!assistant || assistant.jobId !== id) { json(409, { code: 'ASSIST_SESSION_CLOSED' }); return; }
          const session = assistant.session;
          if (command.action === 'fill') await session.fill();
          else if (command.action === 'continue') await session.continueManually();
          else if (command.action === 'handoff') await session.handoff();
          else if (command.action === 'close') await session.close();
          else if (command.action === 'select') await session.selectTab(command.tabId);
          else await session.approveOrigin(command.origin, command.contactApproved);
        }
        json(200, detail(store.get(id))); return;
      }
      if (action === 'status' && request.method === 'POST') {
        const { state } = z.strictObject({ state: stateSchema }).parse(await body(request));
        if (state === 'ready' && !record.analysis) throw new Error('HUB_ANALYSIS_REQUIRED');
        const saved = await store.update(id, current => ({ ...current, state }));
        json(200, detail(saved)); return;
      }
      if (action === 'analyze' && request.method === 'POST') {
        if (record.discovery && !record.discovery.routingConfirmed) { json(409, { code: 'HUB_ROUTING_REQUIRED' }); return; }
        const consent = z.strictObject({ paidCallApproved: z.literal(true), cloudProfileApproved: z.literal(true) }).safeParse(await body(request));
        if (!consent.success) { json(403, { code: 'HUB_ANALYSIS_CONSENT_REQUIRED' }); return; }
        if (!options.analyze) { json(409, { code: 'HUB_MODEL_NOT_ENABLED' }); return; }
        // One model operation per local hub; repeated clicks cannot reserve or bill twice.
        if (busy.size) { json(409, { code: 'HUB_ANALYSIS_BUSY' }); return; }
        busy.add(id);
        try {
          const result = await options.analyze(record.posting, controller.signal);
          const job = jobSchema.parse(result.job), plan = validatePlan(result.plan, profile, job);
          const saved = await store.update(id, current => ({ ...current,
            state: ['saved', 'ready', 'review'].includes(current.state) ? 'ready' : current.state,
            analysis: { job, plan, origin: 'model', at: new Date().toISOString(), costMicroUsd: result.costMicroUsd }, lastError: null }));
          busy.delete(id); json(200, detail(saved));
        } catch (error) {
          await store.update(id, current => ({ ...current, lastError: safeCode(error) }));
          throw error;
        } finally { busy.delete(id); }
        return;
      }
      json(405, { code: 'HUB_METHOD_NOT_ALLOWED' });
    } catch (error) {
      const code = error instanceof z.ZodError ? 'HUB_INPUT_INVALID' : safeCode(error);
      json(code === 'HUB_NOT_FOUND' ? 404 : code.startsWith('HUB_') || code.startsWith('ASSIST_') || code.startsWith('JOB_') || code.startsWith('DISCOVERY_') || code === 'PREP_PLAN_INVALID' ? 400 : 502, { code });
    }
  });
  server.requestTimeout = 180_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('HUB_BIND_FAILED');
  origin = 'http://127.0.0.1:' + address.port;
  return { origin, async close() { controller.abort();
    if (opening) await opening.catch(() => {});
    if (assistant) await assistant.session.shutdown();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
