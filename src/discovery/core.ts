import { careerLevel } from './level.js';
import { z } from 'zod';
import { sourceSchema } from './sources.js';
import type { DiscoveredJob } from './sources.js';
const terms = z.array(z.string().trim().min(1).max(120)).max(20);
export const discoveryConfigSchema = z.strictObject({ version: z.literal(1), sources: z.array(sourceSchema).max(20),
  earlyCareer: z.boolean().default(true), roles: terms.min(1), locations: terms, keywords: terms, excludedTitles: terms,
}).superRefine((value, context) => { const keys = value.sources.map(s => s.provider + ':' + s.board.toLowerCase());
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Duplicate board' }); });
export type DiscoveryConfig = z.infer<typeof discoveryConfigSchema>;
export const defaultDiscoveryConfig: DiscoveryConfig = { version: 1, sources: [], earlyCareer: true,
  roles: ['software engineer', 'developer', 'data analyst', 'business analyst', 'AI engineer', 'IT auditor', 'IT audit', 'yazılım geliştirici', 'veri analisti', 'iş analisti', 'BT denetim'],
  locations: ['Istanbul', 'Türkiye', 'Turkey', 'Remote'], keywords: [], excludedTitles: ['senior', 'sr', 'lead', 'principal', 'manager', 'director', 'staff'] };
const normal = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const contains = (text: string, term: string) => Boolean(normal(term)) && (' ' + normal(text) + ' ').includes(' ' + normal(term) + ' ');
/** A free lexical filter, never a qualification score, eligibility decision or hiring prediction. */
export function discoveryReasons(job: DiscoveredJob, config: DiscoveryConfig): string[] {
  const level = careerLevel(job);
  if (config.earlyCareer && level.level === 'experienced') return [];
  if (config.excludedTitles.some(term => contains(job.title, term))) return [];
  const role = config.roles.find(term => contains(job.title, term)); if (!role) return [];
  const location = config.locations.find(term => contains(job.location + (job.remote ? ' Remote' : ''), term));
  if (config.locations.length && !location) return [];
  const keyword = config.keywords.find(term => contains(job.title + ' ' + job.text, term));
  if (config.keywords.length && !keyword) return [];
  return ['Pozisyon: ' + role, level.reason, ...(location ? ['Konum etiketi: ' + location] : []), ...(keyword ? ['Anahtar kelime: ' + keyword] : []),
    ...(job.remote ? ['Remote etiketi çalışma ülkesi veya çalışma hakkını doğrulamaz.'] : [])];
}
