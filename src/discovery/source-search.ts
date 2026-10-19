import { z } from 'zod';
import { sourceSchema, sourceKey } from './sources.js';
import type { Source } from './sources.js';
const inputSchema = z.strictObject({ roles: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  locations: z.array(z.string().trim().min(1).max(80)).min(1).max(10) });
const quote = (value: string) => '"' + value.replace(/["\\\r\n]/g, ' ') + '"';
/** Build at most four query drafts. Does not contact a search service or send a profile. */
export function sourceSearchQueries(input: z.input<typeof inputSchema>): string[] {
  const { roles, locations } = inputSchema.parse(input);
  const sites = '(site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:boards.greenhouse.io)';
  const level = '(junior OR "new grad" OR graduate OR "entry level")';
  const result: string[] = [];
  // Interleave groups so role families are not silently truncated to the first four entries.
  for (let i = 0; i < Math.min(roles.length, 4); i++) {
    const group = roles.filter((_, index) => index % 4 === i);
    const query = sites + ' (' + group.map(quote).join(' OR ') + ') ' + level + ' (' + locations.map(quote).join(' OR ') + ')';
    if (query.length > 400) throw new Error('DISCOVERY_SEARCH_QUERY_TOO_LONG');
    result.push(query);
  }
  return result;
}
/** Two role-based searches across supported job sites; results are individual postings, not a company catalogue. */
export function jobSearchQueries(input: z.input<typeof inputSchema> & { earlyCareer?: boolean }): string[] {
  const { roles, locations } = inputSchema.parse({roles:input.roles,locations:input.locations});
  const sites = '(site:linkedin.com/jobs/view OR site:indeed.com OR site:kariyer.net/is-ilani OR site:lever.co OR site:greenhouse.io)';
  const result: string[] = [];
  for (let i = 0; i < Math.min(roles.length, 2); i++) {
    const group = roles.filter((_, index) => index % 2 === i);
    const query = sites + ' (' + group.map(quote).join(' OR ') + ') ' + (input.earlyCareer === false ? '' : '(junior OR "new grad" OR "yeni mezun") ') + '(' + locations.map(quote).join(' OR ') + ')';
    if (query.length > 400) throw new Error('DISCOVERY_SEARCH_QUERY_TOO_LONG');
    result.push(query);
  }
  return result;
}
/** Search links are untrusted: never follow redirects, fetch an arbitrary host, or infer a company country. */
export function sourcesFromSearchURLs(urls: string[]): Source[] {
  if (urls.length > 100) throw new Error('DISCOVERY_SEARCH_RESULTS_LIMIT');
  const found = new Map<string, Source>();
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) continue;
      let provider: 'lever' | 'greenhouse';
      if (url.hostname === 'jobs.lever.co') provider = 'lever';
      else if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(url.hostname)) provider = 'greenhouse';
      else continue;
      const path = url.pathname.replace(/\/$/, '');
      const match = provider === 'lever' ? /^\/([a-zA-Z0-9_-]{1,80})(?:\/[a-f0-9-]{36}(?:\/apply)?)?$/.exec(path)
        : /^\/([a-zA-Z0-9_-]{1,80})(?:\/jobs\/\d+)?$/.exec(path);
      if (!match) continue;
      const source = sourceSchema.parse({ provider, board: match[1], company: 'Kaynak: ' + match[1] });
      found.set(sourceKey(source), source);
    } catch { /* Invalid/unsupported links cannot become requests. */ }
  }
  return [...found.values()].slice(0, 20);
}
