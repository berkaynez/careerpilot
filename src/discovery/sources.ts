import { z } from 'zod';
import { jobLink } from '../jobs/links.js';

export const sourceSchema = z.strictObject({ provider: z.enum(['greenhouse', 'lever']),
  board: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,80}$/), company: z.string().trim().min(1).max(120) });
export type Source = z.infer<typeof sourceSchema>;
export interface DiscoveredJob { externalId: string; title: string; text: string; url: string; location: string; remote: boolean; }
export type SourceReader = (source: Source, signal: AbortSignal) => Promise<{ jobs: DiscoveredJob[]; rejected: number }>;
export const sourceKey = (source: Source) => source.provider + ':' + source.board.toLowerCase();
export function sourceURL(source: Source) {
  const checked = sourceSchema.parse(source), board = encodeURIComponent(checked.board);
  return checked.provider === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`
    : `https://api.lever.co/v0/postings/${board}?mode=json&limit=100&skip=0`;
}
const MAX_BYTES = 4_000_000;
async function getJSON(url: string, signal: AbortSignal, request: typeof fetch) {
  const response = await request(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    headers: { Accept: 'application/json', 'User-Agent': 'CareerPilot/0.1 public-job-discovery' } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 429 ? 'DISCOVERY_RATE_LIMITED' : 'DISCOVERY_SOURCE_HTTP'); }
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) { await response.body?.cancel(); throw new Error('DISCOVERY_SOURCE_FORMAT'); }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) { await response.body.cancel(); throw new Error('DISCOVERY_RESPONSE_TOO_LARGE'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength;
    if (total > MAX_BYTES) throw new Error('DISCOVERY_RESPONSE_TOO_LARGE'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { throw new Error('DISCOVERY_SOURCE_FORMAT'); }
}
/** Convert untrusted descriptions to bounded plain text; never render source HTML. */
export function plain(value: string) {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity]!)
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, raw: string) => { const n = raw[0]?.toLowerCase() === 'x' ? parseInt(raw.slice(1), 16) : Number(raw);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : ' '; })
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
const greenhouseRow = z.object({ id: z.number().int().positive(), title: z.string().min(1).max(1200), absolute_url: z.string(),
  location: z.object({ name: z.string().max(2000) }), content: z.string().min(20).max(500_000) });
const leverRow = z.object({ id: z.uuid(), text: z.string().min(1).max(1200), hostedUrl: z.string(),
  categories: z.object({ location: z.string().max(2000).optional(), allLocations: z.array(z.string().max(2000)).max(100).optional() }).optional(),
  workplaceType: z.string().optional(), descriptionPlain: z.string().max(500_000).optional(), description: z.string().max(500_000).optional(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).max(100).optional(), additionalPlain: z.string().max(100_000).optional() });
function checkedJob(source: Source, externalId: string, title: string, url: string, location: string, text: string, remote: boolean): DiscoveredJob {
  const link = jobLink(url), parsed = new URL(link.url), segments = parsed.pathname.split('/');
  if (link.platform !== source.provider || segments[1]?.toLowerCase() !== source.board.toLowerCase()
    || segments[source.provider === 'lever' ? 2 : 3] !== externalId) throw new Error('DISCOVERY_POSTING_URL_INVALID');
  const clean = plain(text).slice(0, 24_000);
  if (clean.length < 20 || !plain(title)) throw new Error('DISCOVERY_POSTING_INVALID');
  return { externalId, title: plain(title), url: link.url, location: plain(location), text: clean, remote };
}
/** Production URLs are constructed from validated board IDs only. No credentials, redirects or browser session. */
export function createSourceReader(request: typeof fetch = fetch): SourceReader {
  return async (source, signal) => {
    const jobs: DiscoveredJob[] = []; let rejected = 0;
    if (source.provider === 'greenhouse') {
      const body = z.object({ jobs: z.array(z.unknown()).max(5000) }).parse(await getJSON(sourceURL(source), signal, request));
      for (const raw of body.jobs) { try { const row = greenhouseRow.parse(raw);
        jobs.push(checkedJob(source, String(row.id), row.title, row.absolute_url, row.location.name, row.content, /\bremote\b/i.test(row.location.name)));
      } catch { rejected++; } }
    } else {
      // Lever uses offset pagination. Bounds protect the local app; a truncated scan is reported.
      for (let page = 0; page < 10; page++) {
        const url = new URL(sourceURL(source)); url.searchParams.set('skip', String(page * 100));
        const rows = z.array(z.unknown()).max(100).parse(await getJSON(url.href, signal, request));
        for (const raw of rows) { try { const row = leverRow.parse(raw), location = [row.categories?.location, ...(row.categories?.allLocations ?? [])].filter(Boolean).join(' · ');
          const description = [row.descriptionPlain ?? row.description ?? '', ...(row.lists ?? []).map(list => list.text + ' ' + list.content), row.additionalPlain ?? ''].join('\n');
          jobs.push(checkedJob(source, row.id, row.text, row.hostedUrl, location, description, row.workplaceType === 'remote' || /\bremote\b/i.test(location)));
        } catch { rejected++; } }
        if (rows.length < 100) return { jobs, rejected };
        if (page === 9) throw new Error('DISCOVERY_PAGE_LIMIT');
      }
    }
    return { jobs, rejected };
  };
}
