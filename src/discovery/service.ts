import {searchRunSchema} from './search-run.js';
import type {SearchRun} from './search-run.js';
import { importSearchJobs } from './job-results.js';
import type { SearchHit } from './job-results.js';
import { careerLevel } from './level.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { postingSchema } from '../preparation/posting.js';
import { jobLink } from '../jobs/links.js';
import type { openHubStore } from '../hub/store.js';
import { createSourceReader, sourceKey } from './sources.js';
import type { SourceReader } from './sources.js';
import type {DiscoveryConfig} from './core.js';
import { defaultDiscoveryConfig, discoveryConfigSchema, discoveryReasons } from './core.js';

type Store = Awaited<ReturnType<typeof openHubStore>>;
const sourceReportSchema = z.strictObject({ source: z.string(), added: z.number(), duplicates: z.number(), filtered: z.number(), rejected: z.number(),
  code: z.string().nullable() });
const reportSchema = z.strictObject({ at: z.iso.datetime(), added: z.number(), modelCalls: z.literal(0), sources: z.array(sourceReportSchema) });
const diskSchema = z.strictObject({ version: z.literal(1), config: discoveryConfigSchema,
  lastSearch:searchRunSchema.nullable().optional(), attemptedAt: z.record(z.string(), z.iso.datetime()), lastReport: reportSchema.nullable() });
export async function openDiscovery(directory: string, store: Store, reader: SourceReader = createSourceReader(), now: () => Date = () => new Date()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let disk: z.infer<typeof diskSchema>;
  try { disk = diskSchema.parse(JSON.parse(await readFile(join(directory, 'discovery.json'), 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('DISCOVERY_STATE_INVALID');
    disk = { version: 1, config: structuredClone(defaultDiscoveryConfig), attemptedAt: {}, lastReport: null }; }
  let busy = false, searchRunning=false;
  const save = async () => {
    const temp = join(directory, randomUUID() + '.tmp');
    try { await writeFile(temp, JSON.stringify(disk, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temp, join(directory, 'discovery.json')); }
    finally { await rm(temp, { force: true }); }
  };
  return {
    snapshot: () => ({ config: structuredClone(disk.config), busy, lastReport: structuredClone(disk.lastReport),lastSearch:disk.lastSearch?{...structuredClone(disk.lastSearch),state:disk.lastSearch.state==='running'&&!searchRunning?'interrupted' as const:disk.lastSearch.state}:null }),
    async saveSearch(report:SearchRun){disk.lastSearch=searchRunSchema.parse(report);searchRunning=report.state==='running';await save();},
    async importSearch(hits: SearchHit[]) {
      if (busy) throw new Error('DISCOVERY_BUSY'); busy = true;
      try { return await importSearchJobs(store, hits, disk.config, now); } finally { busy = false; }
    },
    async configure(value: unknown) {
      if (busy) throw new Error('DISCOVERY_BUSY');
      const config = discoveryConfigSchema.parse(value); busy = true;
      try { const previous = disk; disk = { ...disk, config }; try { await save(); } catch (error) { disk = previous; throw error; } }
      finally { busy = false; }
    },
    async run(signal: AbortSignal, configOverride?:DiscoveryConfig) {
      if (busy) throw new Error('DISCOVERY_BUSY');
      if (!disk.config.sources.length) throw new Error('DISCOVERY_SOURCES_REQUIRED');
      busy = true;
      try {
        const config = discoveryConfigSchema.parse(configOverride??structuredClone(disk.config)), report: z.infer<typeof reportSchema> = { at: now().toISOString(), added: 0, modelCalls: 0, sources: [] };
        const known = new Set(store.list({includeTrashed:true}).map(record => { try { return jobLink(record.posting.sourceUrl).url; } catch { return record.posting.sourceUrl; } }));
        const knownIds = new Set(store.list({includeTrashed:true}).filter(record => record.discovery).map(record => record.discovery!.sourceKey + ':' + record.discovery!.externalId));
        const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
        for (const source of config.sources) {
          bounded.throwIfAborted();
          const key = sourceKey(source), row = { source: key, added: 0, duplicates: 0, filtered: 0, rejected: 0, code: null as string | null };
          report.sources.push(row);
          if (report.added >= 100) { row.code = 'DISCOVERY_IMPORT_LIMIT'; continue; }
          const previous = disk.attemptedAt[key];
          // Persist before networking; even failed/429 requests cannot be repeatedly clicked after restart.
          if (previous && now().getTime() - Date.parse(previous) < 15 * 60_000) { row.code = 'DISCOVERY_COOLDOWN'; continue; }
          disk.attemptedAt[key] = now().toISOString(); await save();
          let data;
          try { data = await reader(source, bounded); }
          catch (error) { row.code = error instanceof Error && /^DISCOVERY_[A-Z_]+$/.test(error.message) ? error.message : 'DISCOVERY_SOURCE_FAILED'; continue; }
          row.rejected = data.rejected;
          for (const job of data.jobs) {
            bounded.throwIfAborted();
            if (report.added >= 100) { row.code = 'DISCOVERY_IMPORT_LIMIT'; break; }
            const fallback = !job.location && source.locationFallback;
            const effective = fallback ? { ...job, location: source.locationFallback! } : job;
            const reasons = discoveryReasons(effective, config);
            if (fallback && reasons.length) reasons.push('Konum kaynağı: kullanıcı tarafından tanımlanan şirket varsayılanı (' + source.locationFallback + ').');
            if (!reasons.length) { row.filtered++; continue; }
            if (known.has(job.url) || knownIds.has(key + ':' + job.externalId)) { row.duplicates++; continue; }
            const id = randomUUID(), timestamp = now().toISOString();
            const posting = postingSchema.parse({ version: 1, id, company: source.company, title: job.title, text: job.text,
              sourceUrl: job.url, country: 'ZZ', language: 'en', documentLanguage: null, photoPolicy: 'unspecified', sponsorship: 'not_stated', checkedOn: timestamp.slice(0, 10) });
            await store.add({ version: 1, id, posting, state: 'review', createdAt: timestamp, updatedAt: timestamp, analysis: null, lastError: null,
              discovery: { criteria:{roles:config.roles,earlyCareer:config.earlyCareer,keywords:config.keywords,excludedTitles:config.excludedTitles}, sourceCheck:{status:'open',at:timestamp}, sourceKey: key, externalId: job.externalId, discoveredAt: timestamp, location: effective.location, remote: job.remote, reasons, careerLevel: careerLevel(job).level, routingConfirmed: false } });
            known.add(job.url); knownIds.add(key + ':' + job.externalId); row.added++; report.added++;
          }
        }
        disk.lastReport = report; await save(); return structuredClone(report);
      } finally { busy = false; }
    },
  };
}
