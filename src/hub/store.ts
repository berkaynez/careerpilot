import { randomUUID } from 'node:crypto';
import { mkdir, chmod, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { postingSchema } from '../preparation/posting.js';
import { jobSchema, planSchema, validatePlan } from '../preparation/core.js';
import type { Profile } from '../preparation/core.js';
import { readLocalJSON } from '../preparation/files.js';

export const states = ['saved', 'ready', 'review', 'submitted', 'archived'] as const;
export const stateSchema = z.enum(states);
export const recordSchema = z.strictObject({
  version: z.literal(1), id: z.uuid(), posting: postingSchema,
  state: stateSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  analysis: z.strictObject({ job: jobSchema, plan: planSchema,
    origin: z.enum(['model', 'imported_review', 'demo']), at: z.iso.datetime(), costMicroUsd: z.number().int().nonnegative().nullable() }).nullable(),
  lastError: z.string().regex(/^[A-Z_]+$/).nullable(),
  discovery: z.strictObject({ sourceKey: z.string().regex(/^(?:(?:lever|greenhouse):[a-z0-9_-]{1,80}|search:(?:linkedin|indeed|kariyer|lever|greenhouse|freehire))$/), externalId: z.string().max(200),
    search: z.strictObject({ provider: z.enum(['serpapi','freehire']).default('serpapi'), originalURL: z.string().max(2000).nullable().default(null), query: z.string().max(400), snippet: z.string().max(3000), dateHint: z.string().max(160).nullable().default(null), verified: z.boolean() }).nullable().default(null),
    discoveredAt: z.iso.datetime(), location: z.string().max(24000), remote: z.boolean(), reasons: z.array(z.string().max(500)).max(10), careerLevel: z.enum(['entry', 'experienced', 'unclear']).default('unclear'), routingConfirmed: z.boolean() }).nullable().default(null),
});
export type HubRecord = z.infer<typeof recordSchema>;

/** One process, one write queue; records are private and atomically replaced. */
export async function openHubStore(directory: string, profile: Profile) {
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const records = new Map<string, HubRecord>();
  const check = (raw: unknown) => {
    const record = recordSchema.parse(raw);
    if (record.id !== record.posting.id) throw new Error('HUB_RECORD_INVALID');
    if (record.analysis) {
      const { job, plan } = record.analysis;
      for (const key of ['id', 'company', 'title', 'country', 'language', 'sourceUrl', 'documentLanguage', 'photoPolicy', 'sponsorship', 'checkedOn'] as const)
        if (job[key] !== record.posting[key]) throw new Error('HUB_RECORD_INVALID');
      validatePlan(plan, profile, job);
    }
    return record;
  };
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const record = check(await readLocalJSON(join(directory, file)));
    if (file !== record.id + '.json') throw new Error('HUB_RECORD_INVALID');
    records.set(record.id, record);
  }
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const next = tail.then(action); tail = next.catch(() => {}); return next;
  };
  const save = async (raw: HubRecord) => {
    const record = check(raw), temporary = join(directory, randomUUID() + '.tmp');
    try {
      await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(directory, record.id + '.json'));
      records.set(record.id, record); return structuredClone(record);
    } finally { await rm(temporary, { force: true }); }
  };
  return {
    list: () => [...records.values()].map(record => structuredClone(record)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get(id: string) { const value = records.get(id); if (!value) throw new Error('HUB_NOT_FOUND'); return structuredClone(value); },
    add: (record: z.input<typeof recordSchema>) => enqueue(async () => {
      if (records.has(record.id)) throw new Error('HUB_RECORD_EXISTS');
      return save(check(record));
    }),
    update: (id: string, change: (record: HubRecord) => HubRecord) => enqueue(async () => {
      const old = records.get(id); if (!old) throw new Error('HUB_NOT_FOUND');
      const next = change(structuredClone(old));
      if (next.id !== old.id) throw new Error('HUB_RECORD_INVALID');
      return save({ ...next, updatedAt: new Date().toISOString() });
    }),
  };
}
