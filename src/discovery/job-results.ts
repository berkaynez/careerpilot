import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jobLink } from '../jobs/links.js';
import { plain } from './sources.js';
import { careerLevel } from './level.js';
import type { DiscoveryConfig } from './core.js';
import type { openHubStore } from '../hub/store.js';

export const searchHitSchema = z.strictObject({ url: z.string().max(2000), title: z.string().max(1200), snippet: z.string().max(3000),
  query: z.string().max(400), platform: z.enum(['linkedin','indeed','kariyer','lever','greenhouse']) });
export type SearchHit = z.infer<typeof searchHitSchema>;
export function searchHits(rows: { link: string; title?: string | undefined; snippet?: string | undefined }[], query: string) {
  const hits: SearchHit[] = []; let rejected = 0;
  for (const row of rows) {
    try {
      const link = jobLink(row.link), title = plain(row.title ?? '').slice(0, 1200);
      if (!title) throw new Error('DISCOVERY_SEARCH_TITLE_REQUIRED');
      hits.push(searchHitSchema.parse({ ...link, title, snippet: plain(row.snippet ?? '').slice(0, 3000), query }));
    } catch { rejected++; }
  }
  return { hits, rejected };
}
const normal = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
const contains = (text: string, term: string) => (' ' + normal(text) + ' ').includes(' ' + normal(term) + ' ');
/** Import unverified search evidence, never crawl an account or present a snippet as a full job description. */
export async function importSearchJobs(store: Awaited<ReturnType<typeof openHubStore>>, raw: SearchHit[], config: DiscoveryConfig, now = () => new Date()) {
  const hits = z.array(searchHitSchema).max(40).parse(raw), known = new Set(store.list().map(record => { try { return jobLink(record.posting.sourceUrl).url; } catch { return record.posting.sourceUrl; } }));
  const report = { added: 0, duplicates: 0, filtered: 0, rejected: 0, modelCalls: 0 };
  for (const hit of hits) {
    let link; try { link = jobLink(hit.url); if (link.platform !== hit.platform) throw new Error('invalid'); } catch { report.rejected++; continue; }
    if (known.has(link.url)) { report.duplicates++; continue; }
    if (!config.roles.some(role => contains(hit.title, role)) || config.excludedTitles.some(term => contains(hit.title, term))
      || (config.keywords.length && !config.keywords.some(term => contains(hit.title + ' ' + hit.snippet, term)))
      || config.earlyCareer && careerLevel({title:hit.title,text:hit.snippet}).level === 'experienced') { report.filtered++; continue; }
    const id = randomUUID(), at = now().toISOString();
    await store.add({ version: 1, id, posting: { version: 1, id, company: 'Şirket doğrulanmalı', title: hit.title,
      text: 'Arama sonucu özeti — tam ilan metni doğrulanmadı.\n' + hit.snippet,
      sourceUrl: link.url, country: 'ZZ', language: 'en', documentLanguage: null, photoPolicy: 'unspecified', sponsorship: 'not_stated', checkedOn: at.slice(0,10) },
      state: 'review', createdAt: at, updatedAt: at, analysis: null, lastError: null,
      discovery: { sourceKey: 'search:' + hit.platform, externalId: createHash('sha256').update(link.url).digest('hex'), discoveredAt: at,
        location: '', remote: false, routingConfirmed: false, careerLevel: careerLevel({title:hit.title,text:hit.snippet}).level,
        reasons: ['Rol ifadesi arama başlığında eşleşti; adayın şartları sağladığı doğrulanmadı.', 'Arama indeksi güncel/açık ilan veya çalışma ülkesini doğrulamaz.'],
        search: { query: hit.query, snippet: hit.snippet, verified: false } } });
    known.add(link.url); report.added++;
  }
  return report;
}
