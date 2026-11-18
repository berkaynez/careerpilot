import { applicationDraft } from '../preparation/application-draft.js';
import { quickRoutes } from '../quick/routes.js';
import {runDiscoverySearch} from '../discovery/search-run.js';
import { createPostingChecker } from '../discovery/check-posting.js';
import { searchFilterReason } from '../discovery/job-results.js';
import { jobQuality } from '../discovery/quality.js';
import { readCVPDF } from '../preparation/files.js';
import { renderCoverLetter } from '../preparation/letters.js';
import { basename } from 'node:path';
import { relatedJobs } from './related.js';
import { createFreehireSearch, importFreehireJobs } from '../discovery/freehire.js';
import { roleProfiles, discoveryCategories } from '../discovery/role-profiles.js';
import type { SourceSearch } from '../discovery/search-provider.js';
import { careerLevel } from '../discovery/level.js';
import { sourceSearchQueries, jobSearchQueries, sourcesFromSearchURLs } from '../discovery/source-search.js';
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
import { openHubStore, stateSchema, trackingSchema } from './store.js';
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
  seed?: HubRecord[]; freehireSearch?: ReturnType<typeof createFreehireSearch>; sourceSearch?: SourceSearch; discoveryReader?: SourceReader; analyze?: HubAnalyzer; answers?: AssistAnswers; demoFormUrl?: string; launchAssistantBrowser?: () => Promise<Browser>; modelInfo?: { name: string; destination: string; monthlyLimitUsd: number; perRunLimitUsd: number }; port?: number }) {
  const profile = profileSchema.parse(options.profile), store = await openHubStore(options.directory, profile);
  if (options.seed && !store.list({includeTrashed:true}).length) for (const record of options.seed) await store.add(record);
  const discovery = await openDiscovery(dirname(options.directory), store, options.discoveryReader);
  const token = randomBytes(32).toString('hex'), busy = new Set<string>();
  const controller = new AbortController();
  let origin = '', jobSearchBusy = false;let searchController:AbortController|null=null;
  const qualityFor=(record:HubRecord)=>{
    const config=record.discovery?.criteria,result=jobQuality(record,config?.earlyCareer??true);
    // The authoritative title/body can differ from an aggregator's rewrite. Apply saved filters again.
    if(config && record.discovery?.search && !record.discovery.search.verified && result.bucket==='review'){
      const reason=searchFilterReason(record.posting.title,record.posting.text,config);
      if(reason)return {...result,bucket:'excluded' as const,label:'Arama kriterlerini karşılamıyor',reasons:[...result.reasons,'Resmî kaynak metni kayıtlı rol/kelime/deneyim filtresini karşılamıyor.']};
    }
    return result;
  };
  const checkPosting=createPostingChecker(options.discoveryReader);
  const checkRecord=async(id:string,signal:AbortSignal=controller.signal)=>{
    const old=store.get(id);if(!old.discovery)throw new Error('DISCOVERY_CHECK_UNSUPPORTED');
    if(old.discovery.sourceCheck && Date.now()>=Date.parse(old.discovery.sourceCheck.at) && Date.now()-Date.parse(old.discovery.sourceCheck.at)<120_000)return old;
    const result=await checkPosting(old,signal);
    return store.update(id,current=>({...current,discovery:{...current.discovery!,sourceCheck:result.check},
      ...(!current.analysis && current.state==='review' && !current.discovery?.search?.verified && result.job?{posting:{...current.posting,title:result.job.title,text:result.job.text}}:{})}));
  };
  const freehireSearch = options.freehireSearch ?? createFreehireSearch();
  const quick = quickRoutes(freehireSearch);
  const jobCriteria = (scope: 'turkey' | 'remote') => { const config = discovery.snapshot().config; return { roles: config.roles, locations: scope === 'turkey' ? ['Türkiye','Turkey','Istanbul'] : ['Remote'], mode: 'jobs' as const, earlyCareer: config.earlyCareer }; };
  const answers = assistAnswersSchema.parse(options.answers ?? {});
  let assistant: { jobId: string; session: AssistSession } | null = null;
  let opening: Promise<AssistSession> | null = null;
  let openingJobId: string | null = null;
  const assistantURL=(record:HubRecord)=>jobLink(record.discovery?.routingConfirmed && record.discovery.search?.verified && record.discovery.search.originalURL?record.discovery.search.originalURL:record.posting.sourceUrl).url;
  const assistantInfo = (record: HubRecord) => {
    let available = Boolean(options.demo && options.demoFormUrl), recipientOrigin: string | null = null;
    try { recipientOrigin = new URL(available ? options.demoFormUrl! : assistantURL(record)).origin; available = Boolean(options.demo && options.demoFormUrl) || jobLink(assistantURL(record)).platform !== 'freehire'; } catch { /* User can still open the unsupported site manually. */ }
    if (record.discovery && (!record.discovery.routingConfirmed || record.discovery.search && !record.discovery.search.verified)) available = false;
    const snapshot = assistant?.session.snapshot();
    return { available, recipientOrigin, opening: Boolean(opening), demo: options.demo === true,
      occupiedByOther: Boolean(assistant && assistant.jobId !== record.id && snapshot?.status !== 'closed'),
      session: assistant?.jobId === record.id ? snapshot : null };
  };
  const summaries = (record: HubRecord) => ({ documentFocus:record.documentFocus??'general', quality:qualityFor(record), relatedJobs:relatedJobs(record,store.list()), possibleDuplicate:relatedJobs(record,store.list())[0] ?? null, id: record.id, company: record.posting.company, title: record.posting.title, tracking:record.tracking,
    country: record.posting.country, sourceUrl: record.posting.sourceUrl, state: record.state, updatedAt: record.updatedAt, analyzing: busy.has(record.id),
    discovery: record.discovery ? { ...record.discovery, careerLevel: careerLevel(record.posting).level, levelReason: careerLevel(record.posting).reason } : null,
    score: record.analysis ? buildMatchAnalysis(profile, record.analysis.job, record.analysis.plan).score : null,
    analysisOrigin: record.analysis?.origin ?? null, lastError: record.lastError,
    assistantActive: openingJobId === record.id || assistant?.jobId === record.id && assistant.session.snapshot().status !== 'closed' });
  const detail = (record: HubRecord) => {
    const analysis = record.analysis;
    let cv: { id: string; language: string; photo: boolean } | null = null;
    let cvError: string | null = null;
    try { if (record.discovery && (!record.discovery.routingConfirmed || record.discovery.search && !record.discovery.search.verified)) throw new Error('HUB_ROUTING_REQUIRED'); const asset = selectCV(profile, record.posting,record.documentFocus??'general'); cv = { id: asset.id, language: asset.language, photo: asset.photo }; }
    catch { cvError = record.discovery && !record.discovery.routingConfirmed ? 'CV seçimi için ilanın ülkesini ve dilini doğrula.' : 'Uygun CV seçimi profilinde netleşmeli.'; }
    return { ...summaries(record), documentFocus:record.documentFocus??'general', availableDocumentFocus:[...new Set(profile.cvs.map(cv=>cv.focus??'general'))], posting: record.posting, cv, cvError, assistant: assistantInfo(record),
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
      if (!options.demo && await quick(request,response,origin)) return;
      const asset = assets.get(path);
      if (asset && request.method === 'GET') { response.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' }); response.end(asset.data); return; }
      if (path === '/api/session' && request.method === 'GET') {
        json(200, { token, applicationDrafts:true, demo: options.demo === true, modelEnabled: Boolean(options.analyze), model: options.modelInfo ?? null,
          assistantDefaults: { firstName: answers.firstName ?? '', lastName: answers.lastName ?? '' },
          profile: { facts: profile.facts.length, cvs: profile.cvs.length, documentFocus:[...new Set(profile.cvs.map(cv=>cv.focus??'general'))] } }); return;
      }
      if (request.headers['x-hub-token'] !== token) { json(403, { code: 'HUB_SESSION_REQUIRED' }); return; }
      if (request.method !== 'GET' && request.headers.origin !== origin) { json(403, { code: 'HUB_ORIGIN_REJECTED' }); return; }
      if (path === '/api/discovery/search-plan' && request.method === 'GET') {
        const config = discovery.snapshot().config;
        json(200, { automaticSearchEnabled: Boolean(options.sourceSearch), availability: options.sourceSearch ? await options.sourceSearch.status({ roles: config.roles, locations: config.locations.length ? config.locations : ['Turkey','United Kingdom','Remote'] }) : null, queries: sourceSearchQueries({ roles: config.roles, locations: config.locations.length ? config.locations : ['Turkey','United Kingdom','Remote'] }),
          note: options.sourceSearch ? 'Kaydedilmiş kriterler. SerpAPI hazır; arama en çok 4 sorgu tüketir. Profil/CV gönderilmez.' : 'Kaydedilmiş kriterlerden sorgu taslağı. Arama servisine istek yapılmadı; API erişimi henüz yapılandırılmadı.' }); return;
      }
      if (path === '/api/discovery/job-search-plan' && request.method === 'GET') {
        const scope = z.enum(['turkey','remote']).parse(url.searchParams.get('scope') ?? 'turkey');
        const criteria = jobCriteria(scope), previewRoles = url.searchParams.get('roles'), previewLevel = url.searchParams.get('earlyCareer');
        if (previewRoles !== null) criteria.roles = z.array(z.string().trim().min(1).max(80)).min(1).max(20).parse(previewRoles.split(','));
        if (previewLevel !== null) criteria.earlyCareer = z.enum(['true','false']).parse(previewLevel) === 'true';
        json(200, { automaticSearchEnabled: Boolean(options.sourceSearch), queries: jobSearchQueries(criteria), roleProfiles, freehireEnabled: !options.demo,
          availability: options.sourceSearch ? await options.sourceSearch.status(criteria) : null }); return;
      }
      if(path==='/api/discovery/search/stop' && request.method==='POST'){
        z.strictObject({}).parse(await body(request));searchController?.abort();json(200,{stopping:Boolean(searchController)});return;
      }
      if(path==='/api/discovery/search' && request.method==='POST'){
        const input=z.strictObject({approved:z.literal(true),scope:z.enum(['turkey','remote']),includeUnlabelled:z.boolean().default(true),documentFocus:z.enum(['general','finance']).default('general')}).parse(await body(request));
        if(options.demo)throw new Error('DISCOVERY_DEMO_OFFLINE');
        if(jobSearchBusy || busy.size || opening || assistant && assistant.session.snapshot().status!=='closed')throw new Error('DISCOVERY_BUSY');
        if(input.documentFocus==='finance'&&!profile.cvs.some(cv=>cv.focus==='finance'))throw new Error('HUB_CV_FOCUS_UNAVAILABLE');
        jobSearchBusy=true;searchController=new AbortController();
        try{
          const report=await runDiscoverySearch({store,config:discovery.snapshot().config,scope:input.scope,documentFocus:input.documentFocus,includeUnlabelled:input.includeUnlabelled,
            freehire:freehireSearch,...(options.sourceSearch?{web:options.sourceSearch}:{}),feeds:signal=>discovery.run(signal,{...discovery.snapshot().config,locations:input.scope==='turkey'?['Türkiye','Turkey','Istanbul','İstanbul','Ankara','Izmir','İzmir']:['Remote']}),check:checkRecord,save:report=>discovery.saveSearch(report),
            signal:AbortSignal.any([controller.signal,searchController.signal,AbortSignal.timeout(180_000)])});
          json(200,report);
        }finally{searchController=null;jobSearchBusy=false;}
        return;
      }
      if (path === '/api/discovery/freehire' && request.method === 'POST') {
        const input=z.strictObject({approved:z.boolean(),scope:z.enum(['turkey','remote']),page:z.number().int().min(1).max(10).default(1),includeUnlabelled:z.boolean().default(false)}).parse(await body(request));
        if(!input.approved) throw new Error('DISCOVERY_SEARCH_APPROVAL_REQUIRED');
        if(options.demo) throw new Error('DISCOVERY_SEARCH_NOT_ENABLED');
        if(jobSearchBusy) throw new Error('DISCOVERY_BUSY'); jobSearchBusy=true;
        try {
          const config=discovery.snapshot().config;
          const result=await freehireSearch({scope:input.scope,earlyCareer:config.earlyCareer,page:input.page,includeUnlabelled:input.includeUnlabelled,categories:discoveryCategories(config.roles)},controller.signal);
          const imported=await importFreehireJobs(store,result.rows,config,input.scope);
          // At most five employer boards/records per search. Unsupported destinations stay explicitly unchecked.
          let checked=0;
          for(const id of imported.newIds){if(checked>=5)break;const record=store.get(id);if(jobQuality(record).canCheck){await checkRecord(id);checked++;}}
          const addedRecords=imported.newIds.map(id=>store.get(id));
          const ready=addedRecords.filter(record=>qualityFor(record).bucket==='review').length;
          const {newIds,...counts}=imported;
          json(200,{...counts,ready,needsCheck:imported.added-ready,checked,total:result.total,examined:result.examined,rejected:result.rejected,cached:result.cached,page:input.page,hasMore:input.page<10 && input.page*30<result.total});
        } finally {jobSearchBusy=false;}
        return;
      }
      if (path === '/api/discovery/job-search' && request.method === 'POST') {
        const input = z.strictObject({ approved: z.boolean(), scope: z.enum(['turkey','remote']) }).parse(await body(request));
        if (!input.approved) throw new Error('DISCOVERY_SEARCH_APPROVAL_REQUIRED');
        if (!options.sourceSearch) throw new Error('DISCOVERY_SEARCH_NOT_ENABLED');
        if (jobSearchBusy) throw new Error('DISCOVERY_SEARCH_BUSY'); jobSearchBusy = true;
        try {
          const result = await options.sourceSearch.run(jobCriteria(input.scope), controller.signal);
          const imported = await discovery.importSearch(result.hits);
          json(200, { ...imported, searchRejected: result.rejected, rejectionReasons: result.rejectionReasons, examined: result.examined, requests: result.requests,
            cached: result.cached, partial: result.partial, failureCode: result.failureCode });
        } finally { jobSearchBusy = false; }
        return;
      }
      if (path === '/api/discovery/source-search' && request.method === 'POST') {
        if(jobSearchBusy)throw new Error('DISCOVERY_BUSY');
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
        if(jobSearchBusy)throw new Error('DISCOVERY_BUSY');
        await discovery.configure(await body(request)); json(200, discovery.snapshot()); return;
      }
      if (path === '/api/discovery/run' && request.method === 'POST') {
        if(jobSearchBusy)throw new Error('DISCOVERY_BUSY');
        z.strictObject({}).parse(await body(request));
        if (options.demo && !options.discoveryReader) { json(409, { code: 'DISCOVERY_DEMO_OFFLINE' }); return; }
        json(200, await discovery.run(controller.signal)); return;
      }
      if(path==='/api/trash' && request.method==='GET') {json(200,{count:store.list({includeTrashed:true}).filter(row=>row.trashedAt).length});return;}
      if((path==='/api/jobs/clear-archived' || path==='/api/trash/restore') && request.method==='POST') {
        z.strictObject({}).parse(await body(request));
        if(busy.size || jobSearchBusy || opening || assistant && assistant.session.snapshot().status!=='closed') throw new Error('HUB_RECORD_BUSY');
        json(200,path==='/api/jobs/clear-archived'?await store.trashArchived():await store.restoreTrash());return;
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
      const match = /^\/api\/jobs\/([a-f0-9-]{36})(?:\/(status|analyze|assistant|routing|verify-posting|tracking|remove|restore|documents|application-draft|cv|check-source|document-focus))?$/.exec(path);
      if (!match) { json(404, { code: 'HUB_NOT_FOUND' }); return; }
      const id = z.uuid().parse(match[1]), action = match[2];
      if(action==='restore' && request.method==='POST') {
        z.strictObject({}).parse(await body(request));
        if(busy.size || jobSearchBusy || opening || assistant && assistant.session.snapshot().status!=='closed')throw new Error('HUB_RECORD_BUSY');
        json(200,detail(await store.restore(id)));return;
      }
      if(jobSearchBusy && ['status','remove','restore','routing','verify-posting','document-focus','check-source','assistant','analyze'].includes(action??''))throw new Error('HUB_RECORD_BUSY');
      const record = store.get(id);
      if(action==='document-focus' && request.method==='POST'){
        const {focus}=z.strictObject({focus:z.enum(['general','finance'])}).parse(await body(request));
        if(busy.size || jobSearchBusy || opening || assistant && assistant.session.snapshot().status!=='closed')throw new Error('HUB_RECORD_BUSY');
        if(!profile.cvs.some(cv=>(cv.focus??'general')===focus))throw new Error('HUB_CV_FOCUS_UNAVAILABLE');
        json(200,detail(await store.update(id,current=>({...current,documentFocus:focus}))));return;
      }
      if(action==='check-source' && request.method==='POST'){
        z.strictObject({}).parse(await body(request));
        if(options.demo)throw new Error('DISCOVERY_DEMO_OFFLINE');
        if(busy.size || jobSearchBusy || opening || assistant && assistant.session.snapshot().status!=='closed')throw new Error('HUB_RECORD_BUSY');
        busy.add(id);try{json(200,detail(await checkRecord(id)));}finally{busy.delete(id);}return;
      }
      if(action==='remove' && request.method==='POST') {
        z.strictObject({}).parse(await body(request));
        if(busy.size || jobSearchBusy || opening || assistant && assistant.session.snapshot().status!=='closed')throw new Error('HUB_RECORD_BUSY');
        json(200,await store.trash(id));return;
      }
      if (action==='application-draft' && ['GET','POST'].includes(request.method??'')) {
        if (record.discovery && (!record.discovery.routingConfirmed || record.discovery.search && !record.discovery.search.verified)) {
          json(409,{code:'HUB_ROUTING_REQUIRED'});return;
        }
        if (request.method==='GET') {
          const analysis=record.analysis, selected=new Set<string>();
          if (analysis) {
            const weights={essential:3,preferred:1,responsibility:0};
            const priorities=new Map(analysis.job.requirements.map(item=>[item.id,weights[item.priority]]));
            const scores=new Map(profile.facts.map(fact=>[fact.id,0]));
            for (const item of analysis.plan.assessments) for (const id of item.factIds) {
              scores.set(id,scores.get(id)!+(priorities.get(item.requirementId)??0)*(item.evidenceLevel==='documented'?2:1));
            }
            for (const [id,score] of [...scores].sort((a,b)=>b[1]-a[1])) {
              if (score>0 && selected.size<10) selected.add(id);
            }
          }
          const language=record.posting.documentLanguage??record.posting.language;
          const facts=profile.facts.map(fact=>({id:fact.id,text:fact.text[language],selected:selected.has(fact.id)}));
          json(200,{facts});return;
        }
        const {ids}=z.strictObject({ids:z.array(z.string()).min(1).max(20)}).parse(await body(request));
        json(200,applicationDraft(profile,record.posting,ids));return;
      }
      if((action==='documents' || action==='cv') && request.method==='GET') {
        if(record.discovery && (!record.discovery.routingConfirmed || record.discovery.search && !record.discovery.search.verified)) {json(409,{code:'HUB_ROUTING_REQUIRED'});return;}
        const cv=selectCV(profile,record.posting,record.documentFocus??'general');
        if(action==='cv') {
          const pdf=await readCVPDF(cv.path);response.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(basename(cv.path))});response.end(pdf);return;
        }
        if(!(record.documentFocus==='finance'?profile.financeLetterFactIds?.length:profile.coverLetter) && !record.analysis?.plan.coverLetterFactIds.length)throw new Error('HUB_LETTER_EVIDENCE_REQUIRED');
        const letter=renderCoverLetter(profile,record.posting,{coverLetterFactIds:record.analysis?.plan.coverLetterFactIds ?? []},record.documentFocus??'general');
        json(200,{cv:{filename:basename(cv.path),language:cv.language,photo:cv.photo},letter:letter.content,evidence:letter.evidence,modelCalls:0});return;
      }
      if (!action && request.method === 'GET') { json(200, detail(record)); return; }
      if (action === 'verify-posting' && request.method === 'POST') {
        const verified = z.strictObject({ company: postingSchema.shape.company, title: postingSchema.shape.title,
          text: postingSchema.shape.text, country: z.enum(['TR','GB','IE','DE','FR','NL','BE','CH','BA','US','CA']), language: z.enum(['tr','en']) }).parse(await body(request));
        if (!record.discovery?.search || record.discovery.search.verified || record.analysis) throw new Error('HUB_POSTING_ALREADY_VERIFIED');
        const saved = await store.update(id, current => {
          if (!current.discovery?.search || current.discovery.search.verified || current.analysis) throw new Error('HUB_POSTING_ALREADY_VERIFIED');
          return { ...current, posting: { ...current.posting, ...verified }, discovery: { ...current.discovery, routingConfirmed: true,
            careerLevel: careerLevel(verified).level, search: { ...current.discovery.search, verified: true } } };
        });
        json(200, detail(saved)); return;
      }
      if (action === 'routing' && request.method === 'POST') {
        const routing = z.strictObject({ country: z.enum(['TR','GB','IE','DE','FR','NL','BE','CH','BA','US','CA']), language: z.enum(['tr','en']) }).parse(await body(request));
        if (!record.discovery || record.discovery.search || record.discovery.routingConfirmed || record.analysis) throw new Error('HUB_ROUTING_ALREADY_CONFIRMED');
        const saved = await store.update(id, current => {
          if (!current.discovery || current.discovery.search || current.discovery.routingConfirmed || current.analysis) throw new Error('HUB_ROUTING_ALREADY_CONFIRMED');
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
          opening = openAssistSession({ url: options.demo?record.posting.sourceUrl:assistantURL(record), profile,
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
      if(action==='tracking' && request.method==='POST') {
        const tracking=trackingSchema.parse(await body(request));
        const saved=await store.update(id,current=>{if(current.state!=='submitted')throw new Error('HUB_TRACKING_SUBMITTED_REQUIRED');return {...current,tracking};});
        json(200,detail(saved));return;
      }
      if (action === 'status' && request.method === 'POST') {
        const { state } = z.strictObject({ state: stateSchema }).parse(await body(request));
        if (state === 'ready' && !record.analysis) throw new Error('HUB_ANALYSIS_REQUIRED');
        const saved = await store.update(id, current => ({ ...current, state }));
        json(200, detail(saved)); return;
      }
      if (action === 'analyze' && request.method === 'POST') {
        if(record.discovery && qualityFor(record).bucket==='excluded'){json(409,{code:'HUB_JOB_QUALITY_REQUIRED'});return;}
        if (record.discovery && (!record.discovery.routingConfirmed || record.discovery.search && !record.discovery.search.verified)) { json(409, { code: 'HUB_ROUTING_REQUIRED' }); return; }
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
