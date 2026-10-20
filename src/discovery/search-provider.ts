import { searchHitSchema, searchHits, rejectionReasonsSchema } from './job-results.js';
import type { SearchHit } from './job-results.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { sourceSchema } from './sources.js';
import { sourceSearchQueries, jobSearchQueries, sourcesFromSearchURLs } from './source-search.js';

const cacheSchema = z.strictObject({ key: z.string(), at: z.iso.datetime(), sources: z.array(sourceSchema).max(20), hits: z.array(searchHitSchema).max(40).default([]), examined: z.number().int().nonnegative().default(0), rejected: z.number().int().nonnegative().default(0), rejectionReasons: rejectionReasonsSchema.default(() => rejectionReasonsSchema.parse({})), partial: z.boolean().default(false), failureCode: z.string().nullable().default(null) });
const stateSchema = z.strictObject({ version: z.literal(1), attempts: z.array(z.iso.datetime()).max(1000), cache: cacheSchema.nullable() });
const accountSchema = z.object({ account_status: z.literal('Active'), plan_monthly_price: z.literal(0),
  total_searches_left: z.number().int().nonnegative(), account_rate_limit_per_hour: z.number().int().positive(), this_hour_searches: z.number().int().nonnegative() });
type Criteria = Parameters<typeof sourceSearchQueries>[0] & { mode?: 'jobs'; earlyCareer?: boolean };
const queriesFor = (criteria: Criteria) => criteria.mode === 'jobs' ? jobSearchQueries(criteria) : sourceSearchQueries({roles:criteria.roles,locations:criteria.locations});
const queryKey = (criteria: Criteria, queries: string[]) => createHash('sha256').update(JSON.stringify(criteria.mode === 'jobs' ? ['jobs-recent-v2',queries] : queries)).digest('hex');
const evidence = (cache: z.infer<typeof cacheSchema>) => ({ hits: cache.hits, examined: cache.examined, rejected: cache.rejected, rejectionReasons: cache.rejectionReasons });
export type SourceSearch = Awaited<ReturnType<typeof openSourceSearch>>;

/** Only fixed SerpAPI URLs; raw account responses and credentials never leave this module. Sanitized search evidence is returned. */
export async function openSourceSearch(directory: string, apiKey: string, request: typeof fetch = fetch, now = () => new Date()) {
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error('DISCOVERY_SEARCH_KEY_REQUIRED');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'source-search.json'), lock = join(directory, 'source-search.lock');
  const read = async () => {
    try { return stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return stateSchema.parse({ version: 1, attempts: [], cache: null }); throw new Error('DISCOVERY_SEARCH_STATE_INVALID'); }
  };
  const save = async (state: z.infer<typeof stateSchema>) => {
    const temp = join(directory, randomUUID() + '.tmp');
    try { await writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
  };
  const get = async (path: '/account.json' | '/search.json', params: Record<string, string>, signal: AbortSignal): Promise<unknown> => {
    const url = new URL(path, 'https://serpapi.com');
    url.search = new URLSearchParams({ ...params, api_key: apiKey }).toString();
    let response: Response;
    try { response = await request(url, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(path === '/search.json' ? 60_000 : 15_000)]) }); }
    catch (error) { throw new Error(error instanceof Error && error.name === 'TimeoutError' ? 'DISCOVERY_SEARCH_TIMEOUT' : 'DISCOVERY_SEARCH_NETWORK'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 429 ? 'DISCOVERY_SEARCH_RATE_LIMITED' : 'DISCOVERY_SEARCH_HTTP'); }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) { await response.body?.cancel(); throw new Error('DISCOVERY_SEARCH_FORMAT'); }
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 2_000_000) throw new Error('DISCOVERY_SEARCH_RESPONSE_TOO_LARGE'); chunks.push(next.value); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('DISCOVERY_SEARCH_FORMAT'); }
    } catch (error) {
      if (error instanceof Error && /^DISCOVERY_SEARCH_[A-Z_]+$/.test(error.message)) throw error;
      throw new Error('DISCOVERY_SEARCH_NETWORK');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  return {
    async status(criteria: Criteria) {
      const queries = queriesFor(criteria), key = queryKey(criteria, queries);
      const state = await read(), stamp = now().toISOString(), time = Date.parse(stamp);
      const cached = state.cache?.key === key && time >= Date.parse(state.cache.at) && time - Date.parse(state.cache.at) < 24 * 3600_000;
      const remainingToday = Math.max(0, 8 - state.attempts.filter(at => at.slice(0,10) === stamp.slice(0,10)).length);
      const remainingMonth = Math.max(0, 200 - state.attempts.filter(at => at.slice(0,7) === stamp.slice(0,7)).length);
      const last = Math.max(0, ...state.attempts.map(Date.parse));
      const waitSeconds = Math.max(0, Math.ceil((last + 15 * 60_000 - time) / 1000));
      // Read the existing durable cache only: viewing this report cannot reserve or consume a query.
      const previous = state.cache?.key === key ? state.cache : null;
      const lastResult = previous ? { at: previous.at, examined: previous.examined,
        uniqueLinks: previous.hits.length, repeatedLinks: Math.max(0, previous.examined - previous.rejected - previous.hits.length),
        rejected: previous.rejected, rejectionReasons: previous.rejectionReasons,
        partial: previous.partial, failureCode: previous.failureCode } : null;
      return { requestsPerRun: queries.length, remainingToday, remainingMonth, waitSeconds, cached,
        partial: cached && state.cache!.partial, clockValid: last <= time, lastResult };
    },
    async run(criteria: Criteria, signal: AbortSignal) {
      const queries = queriesFor(criteria), key = queryKey(criteria, queries);
      try { await mkdir(lock, { mode: 0o700 }); } catch { throw new Error('DISCOVERY_SEARCH_BUSY'); }
      try {
        const state = await read(), timestamp = now().toISOString(), time = Date.parse(timestamp);
        if (state.cache?.key === key && time >= Date.parse(state.cache.at) && time - Date.parse(state.cache.at) < 24 * 3600_000)
          return { ...evidence(state.cache), sources: state.cache.sources, requests: 0, cached: true, modelCalls: 0, partial: state.cache.partial, failureCode: state.cache.failureCode };
        if (state.attempts.some(at => Date.parse(at) > time)) throw new Error('DISCOVERY_SEARCH_CLOCK_INVALID');
        const monthly = state.attempts.filter(at => at.slice(0, 7) === timestamp.slice(0, 7)).length;
        const daily = state.attempts.filter(at => at.slice(0, 10) === timestamp.slice(0, 10)).length;
        if (monthly + queries.length > 200 || daily + queries.length > 8) throw new Error('DISCOVERY_SEARCH_QUOTA_STOP');
        if (state.attempts.some(at => time - Date.parse(at) < 15 * 60_000)) throw new Error('DISCOVERY_SEARCH_COOLDOWN');
        signal.throwIfAborted();
        // Fail closed on paid, unknown or inactive accounts. This free endpoint does not consume search credits.
        const account = accountSchema.safeParse(await get('/account.json', {}, signal));
        if (!account.success) throw new Error('DISCOVERY_SEARCH_FREE_PLAN_REQUIRED');
        if (account.data.total_searches_left < queries.length || account.data.account_rate_limit_per_hour - account.data.this_hour_searches < queries.length)
          throw new Error('DISCOVERY_SEARCH_QUOTA_STOP');
        const rejectionReasons = rejectionReasonsSchema.parse({});
        const urls: string[] = [], hits = new Map<string, SearchHit>(); let attempted = 0, examined = 0, rejected = 0;
        for (const q of queries) {
          signal.throwIfAborted();
          // Reserve before every search. Errors, process crashes and uncertain billing are never refunded locally.
          state.attempts = state.attempts.filter(at => at.slice(0, 7) === timestamp.slice(0, 7));
          state.attempts.push(timestamp); await save(state); attempted++;
          try {
            const result = z.object({ error: z.string().optional(), search_metadata: z.object({ status: z.literal('Success') }),
              organic_results: z.array(z.object({ link: z.string().max(2000), title: z.string().max(1200).optional(), snippet: z.string().max(3000).optional(), date: z.string().max(160).optional() })).max(100).default([]) }).safeParse(await get('/search.json', { engine: 'google', q, ...(criteria.mode==='jobs'?{tbs:'qdr:m'}:{}) }, signal));
            if (!result.success || result.data.error) throw new Error('DISCOVERY_SEARCH_FORMAT');
            const rows = result.data.organic_results.slice(0, 10), parsed = searchHits(rows, q);
            examined += rows.length; rejected += parsed.rejected;
            for (const key of Object.keys(rejectionReasons) as (keyof typeof rejectionReasons)[]) rejectionReasons[key] += parsed.rejectionReasons[key];
            for (const hit of parsed.hits) if (!hits.has(hit.url)) hits.set(hit.url, hit);
            urls.push(...rows.map(item => item.link));
            // Keep completed sources even if a later query fails or this process exits.
            state.cache = { key, at: timestamp, sources: sourcesFromSearchURLs(urls), hits: [...hits.values()], examined, rejected, rejectionReasons, partial: true, failureCode: null }; await save(state);
          } catch (error) {
            if (!state.cache || state.cache.key !== key) throw error;
            const failureCode = error instanceof Error && /^DISCOVERY_SEARCH_[A-Z_]+$/.test(error.message) ? error.message : 'DISCOVERY_SEARCH_NETWORK';
            state.cache = { ...state.cache, partial: true, failureCode }; await save(state);
            return { ...evidence(state.cache), sources: state.cache.sources, requests: attempted, cached: false, modelCalls: 0, partial: true, failureCode };
          }
        }
        const sources = sourcesFromSearchURLs(urls);
        state.cache = { key, at: timestamp, sources, hits: [...hits.values()], examined, rejected, rejectionReasons, partial: false, failureCode: null }; await save(state);
        return { ...evidence(state.cache), sources, requests: queries.length, cached: false, modelCalls: 0, partial: false, failureCode: null };
      } finally { await rm(lock, { recursive: true }); }
    },
  };
}
