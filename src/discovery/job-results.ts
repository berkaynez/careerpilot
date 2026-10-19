import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jobLink } from '../jobs/links.js';
import { plain } from './sources.js';
import { careerLevel } from './level.js';
import { containsTerm as contains, roleTerms } from './role-profiles.js';
import type { DiscoveryConfig } from './core.js';
import type { openHubStore } from '../hub/store.js';

export const searchHitSchema = z.strictObject({ url: z.string().max(2000), title: z.string().max(1200), snippet: z.string().max(3000),
  dateHint: z.string().max(160).nullable().default(null), query: z.string().max(400), platform: z.enum(['linkedin','indeed','kariyer','lever','greenhouse']) });
export type SearchHit = z.infer<typeof searchHitSchema>;
export const rejectionReasonsSchema = z.strictObject({
  listingPage: z.number().int().nonnegative().default(0),
  unsupportedSite: z.number().int().nonnegative().default(0),
  unsafeURL: z.number().int().nonnegative().default(0),
  missingTitle: z.number().int().nonnegative().default(0),
  invalidPosting: z.number().int().nonnegative().default(0),
});
function rejectedURL(value: string): 'listingPage' | 'unsupportedSite' | 'unsafeURL' | 'invalidPosting' {
  try {
    const url = new URL(value), host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || /^(localhost|127\.|10\.|192\.168\.|\[)/.test(host)) return 'unsafeURL';
    if (!/^(?:www\.|[a-z]{2}\.)?linkedin\.com$/.test(host) && !/^(?:www\.|[a-z]{2}\.)?indeed\.com$/.test(host)
      && !['kariyer.net','www.kariyer.net','jobs.lever.co','boards.greenhouse.io','job-boards.greenhouse.io','job-boards.eu.greenhouse.io'].includes(host)) return 'unsupportedSite';
    if (/^\/?$/.test(url.pathname) || /^\/jobs(?:\/search)?\/?$/.test(url.pathname)
      || host === 'jobs.lever.co' && /^\/[^/]+\/?$/.test(url.pathname)
      || host.endsWith('greenhouse.io') && /^\/[^/]+\/?$/.test(url.pathname)) return 'listingPage';
    return 'invalidPosting';
  } catch { return 'unsafeURL'; }
}
export function searchHits(rows: { link: string; title?: string | undefined; snippet?: string | undefined; date?: string | undefined }[], query: string) {
  const hits: SearchHit[] = [], rejectionReasons = rejectionReasonsSchema.parse({}); let rejected = 0;
  for (const row of rows) {
    try {
      const link = jobLink(row.link), title = plain(row.title ?? '').slice(0, 1200);
      if (!title) throw new Error('DISCOVERY_SEARCH_TITLE_REQUIRED');
      hits.push(searchHitSchema.parse({ ...link, title, snippet: plain(row.snippet ?? '').slice(0, 3000), dateHint: row.date ? plain(row.date).slice(0, 160) || null : null, query }));
    } catch (error) { rejected++; rejectionReasons[error instanceof Error && error.message === 'DISCOVERY_SEARCH_TITLE_REQUIRED' ? 'missingTitle' : rejectedURL(row.link)]++; }
  }
  return { hits, rejected, rejectionReasons };
}
export function searchFilterReason(title:string, text:string, config:DiscoveryConfig): 'role'|'excludedTitle'|'keyword'|'experience'|null {
  return !roleTerms(config.roles).some(role=>contains(title,role)) ? 'role'
    : config.excludedTitles.some(term=>contains(title,term)) ? 'excludedTitle'
    : config.keywords.length && !config.keywords.some(term=>contains(title+' '+text,term)) ? 'keyword'
    : config.earlyCareer && careerLevel({title,text}).level==='experienced' ? 'experience' : null;
}
/** Import unverified search evidence, never crawl an account or present a snippet as a full job description. */
export async function importSearchJobs(store: Awaited<ReturnType<typeof openHubStore>>, raw: SearchHit[], config: DiscoveryConfig, now = () => new Date()) {
  const hits = z.array(searchHitSchema).max(40).parse(raw), known = new Set(store.list({includeTrashed:true}).flatMap(record => { let url=record.posting.sourceUrl; try { url=jobLink(url).url; } catch {} return [url,...(record.discovery?.search?.originalURL?[record.discovery.search.originalURL]:[])]; }));
  const filterReasons = { role: 0, excludedTitle: 0, keyword: 0, experience: 0 };
  const report = { added: 0, duplicates: 0, filtered: 0, rejected: 0, modelCalls: 0, filterReasons };
  for (const hit of hits) {
    let link; try { link = jobLink(hit.url); if (link.platform !== hit.platform) throw new Error('invalid'); } catch { report.rejected++; continue; }
    if (known.has(link.url)) { report.duplicates++; continue; }
    const reason = searchFilterReason(hit.title, hit.snippet, config);
    if (reason) { report.filtered++; filterReasons[reason]++; continue; }
    const id = randomUUID(), at = now().toISOString();
    await store.add({ version: 1, id, posting: { version: 1, id, company: 'Şirket doğrulanmalı', title: hit.title,
      text: 'Arama sonucu özeti — tam ilan metni doğrulanmadı.\n' + hit.snippet,
      sourceUrl: link.url, country: 'ZZ', language: 'en', documentLanguage: null, photoPolicy: 'unspecified', sponsorship: 'not_stated', checkedOn: at.slice(0,10) },
      state: 'review', createdAt: at, updatedAt: at, analysis: null, lastError: null,
      discovery: { sourceKey: 'search:' + hit.platform, externalId: createHash('sha256').update(link.url).digest('hex'), discoveredAt: at,
        location: '', remote: false, routingConfirmed: false, careerLevel: careerLevel({title:hit.title,text:hit.snippet}).level,
        reasons: ['Rol ifadesi arama başlığında eşleşti; adayın şartları sağladığı doğrulanmadı.', 'Arama indeksi güncel/açık ilan veya çalışma ülkesini doğrulamaz.'],
        search: { query: hit.query, snippet: hit.snippet, dateHint: hit.dateHint, verified: false } } });
    known.add(link.url); report.added++;
  }
  return report;
}
