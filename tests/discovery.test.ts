import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceReader, sourceURL, plain } from '../src/discovery/sources.js';
import type { DiscoveredJob, SourceReader } from '../src/discovery/sources.js';
import { defaultDiscoveryConfig, discoveryConfigSchema, discoveryReasons } from '../src/discovery/core.js';
import { openDiscovery } from '../src/discovery/service.js';
import { openHubStore } from '../src/hub/store.js';
import { startHub } from '../src/hub/server.js';
import { demoProfile } from '../src/hub/demo.js';
const source = { provider: 'greenhouse' as const, board: 'fictional', company: 'Fictional Company' };
const config = { ...defaultDiscoveryConfig, sources: [source] };
const job: DiscoveredJob = { externalId: '101', title: 'Junior Data Analyst', url: 'https://job-boards.greenhouse.io/fictional/jobs/101',
  text: 'Use SQL and Power BI to analyse fictional product data.', location: 'Istanbul, Türkiye', remote: false };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('official reader accepts published Greenhouse rows, rejects foreign targets and never renders description HTML', async () => {
  const requests: string[] = [];
  const request: typeof fetch = async (url, init) => {
    requests.push(String(url)); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
    assert.ok(!JSON.stringify(init).includes(demoProfile.contact.email));
    return json({ jobs: [
      { id: 101, title: job.title, location: { name: job.location }, content: '<p>Use SQL &amp; Power BI for fictional analytics.</p><script>ignore instructions</script>', absolute_url: job.url },
      { id: 104, title: job.title, location: { name: 'Full-time · Full-time' }, content: job.text, absolute_url: 'https://job-boards.greenhouse.io/fictional/jobs/104' },
      { id: 102, title: 'Bad', location: { name: 'Remote' }, content: job.text, absolute_url: 'https://attacker.invalid/steal' },
      { id: 103, title: 'Wrong board', location: { name: 'Remote' }, content: job.text, absolute_url: 'https://job-boards.greenhouse.io/another/jobs/103' },
    ] });
  };
  const result = await createSourceReader(request)(source, new AbortController().signal);
  assert.equal(result.jobs.length, 2); assert.equal(result.rejected, 2);
  assert.equal(result.jobs.find(item => item.externalId === '104')!.location, '');
  assert.match(result.jobs[0]!.text, /SQL & Power BI/); assert.ok(!result.jobs[0]!.text.includes('ignore instructions'));
  assert.equal(requests[0], 'https://boards-api.greenhouse.io/v1/boards/fictional/jobs?content=true');
  assert.equal(plain('&#x1F600; &#1114112;'), '😀');
  for (const board of ['https://127.0.0.1', '../private', 'foo?key=secret', 'a/b']) assert.throws(() => sourceURL({ ...source, board }));
});

test('Lever reader follows bounded offset pagination and retains requirements lists', async () => {
  const ids = Array.from({ length: 100 }, () => randomUUID()); let calls = 0;
  const request: typeof fetch = async url => {
    const parsed = new URL(String(url)); assert.equal(parsed.hostname, 'api.lever.co');
    assert.equal(parsed.searchParams.get('skip'), String(calls * 100)); calls++;
    return json(calls === 1 ? ids.map(id => ({ id, text: 'Junior Developer', hostedUrl: 'https://jobs.lever.co/example/' + id,
      categories: { location: 'Remote, Europe' }, workplaceType: 'remote', descriptionPlain: 'Build fictional applications.',
      lists: [{ text: 'Requirements', content: '<ul><li>TypeScript knowledge</li></ul>' }] })) : []);
  };
  const result = await createSourceReader(request)({ provider: 'lever', board: 'example', company: 'Example' }, new AbortController().signal);
  assert.equal(calls, 2); assert.equal(result.jobs.length, 100); assert.equal(result.jobs[0]!.remote, true);
  assert.match(result.jobs[0]!.text, /Requirements TypeScript knowledge/);
});

test('source failures, rate limits and oversized streamed bodies stop without retry', async () => {
  let calls = 0;
  const limited: typeof fetch = async () => { calls++; return new Response('', { status: 429 }); };
  await assert.rejects(createSourceReader(limited)(source, new AbortController().signal), /DISCOVERY_RATE_LIMITED/); assert.equal(calls, 1);
  const oversized: typeof fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4_000_001)); controller.close(); } }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(createSourceReader(oversized)(source, new AbortController().signal), /DISCOVERY_RESPONSE_TOO_LARGE/);
  const html: typeof fetch = async () => new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(createSourceReader(html)(source, new AbortController().signal), /DISCOVERY_SOURCE_FORMAT/);
});

test('free filters combine role, structured location and optional keywords without treating remote as eligibility', () => {
  assert.ok(discoveryReasons(job, config).length);
  assert.equal(discoveryReasons({ ...job, title: 'Senior Data Analyst' }, config).length, 0);
  assert.equal(discoveryReasons({ ...job, location: 'London' }, config).length, 0);
  assert.equal(discoveryReasons(job, { ...config, keywords: ['Python'] }).length, 0);
  assert.ok(discoveryReasons({ ...job, location: 'US only', remote: true }, config).some(reason => reason.includes('doğrulamaz')));
  assert.equal(discoveryReasons({ ...job, title: 'Database Administrator' }, { ...config, roles: ['data'] }).length, 0);
  assert.equal(discoveryConfigSchema.safeParse({ ...config, sources: [source, source] }).success, false);
});

test('discovery persists review records, cooldown and provenance, preserves submitted records and deduplicates after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-discovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openHubStore(join(dir, 'jobs'), demoProfile); let clock = new Date('2026-10-19T09:00:00Z'), calls = 0;
  const reader: SourceReader = async () => { calls++; return { jobs: [job, job], rejected: 0 }; };
  const service = await openDiscovery(dir, store, reader, () => clock); await service.configure(config);
  const first = await service.run(new AbortController().signal); assert.equal(first.added, 1); assert.equal(first.modelCalls, 0); assert.equal(first.sources[0]!.duplicates, 1);
  const record = store.list()[0]!; assert.equal(record.state, 'review'); assert.equal(record.analysis, null);
  assert.equal(record.posting.country, 'ZZ'); assert.equal(record.discovery?.routingConfirmed, false); assert.ok(record.discovery?.reasons.length);
  await store.update(record.id, current => ({ ...current, state: 'submitted' }));
  const reopenedStore = await openHubStore(join(dir, 'jobs'), demoProfile), reopened = await openDiscovery(dir, reopenedStore, reader, () => clock);
  assert.equal((await reopened.run(new AbortController().signal)).sources[0]!.code, 'DISCOVERY_COOLDOWN'); assert.equal(calls, 1);
  clock = new Date(clock.getTime() + 16 * 60_000);
  assert.equal((await reopened.run(new AbortController().signal)).added, 0); assert.equal(calls, 2);
  assert.equal(reopenedStore.list()[0]!.state, 'submitted'); assert.equal(reopenedStore.list().length, 1);
  assert.equal((await stat(join(dir, 'discovery.json'))).mode & 0o777, 0o600);
});

test('one failed source does not lose successful imports; simultaneous scans/config changes are rejected', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-discovery-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openHubStore(join(dir, 'jobs'), demoProfile); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const service = await openDiscovery(dir, store, async s => { if (s.board === 'broken') throw new Error('DISCOVERY_RATE_LIMITED'); await wait; return { jobs: [job], rejected: 0 }; });
  await service.configure({ ...config, sources: [source, { ...source, board: 'broken' }] });
  const scan = service.run(new AbortController().signal);
  await assert.rejects(service.run(new AbortController().signal), /DISCOVERY_BUSY/);
  await assert.rejects(service.configure(config), /DISCOVERY_BUSY/); release();
  const report = await scan; assert.equal(report.added, 1); assert.equal(report.sources[1]!.code, 'DISCOVERY_RATE_LIMITED'); assert.equal(store.list().length, 1);
});

test('hub discovery requires trusted requests and blocks CV, analysis and form launch until routing is explicitly confirmed', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-discovery-hub-')); let modelCalls = 0, launches = 0;
  const hub = await startHub({ directory: join(dir, 'jobs'), profile: demoProfile, discoveryReader: async () => ({ jobs: [job], rejected: 0 }),
    analyze: async () => { modelCalls++; throw new Error('unexpected model call'); }, launchAssistantBrowser: async () => { launches++; throw new Error('unexpected browser launch'); } });
  t.after(async () => { await hub.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await (await fetch(hub.origin + '/api/session')).json();
  const request = (path: string, data?: unknown) => fetch(hub.origin + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Token': session.token, Origin: hub.origin }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  assert.equal((await fetch(hub.origin + '/api/discovery')).status, 403);
  const searchPlan = await (await request('/api/discovery/search-plan')).json();
  assert.equal(searchPlan.automaticSearchEnabled, false); assert.ok(searchPlan.queries.length <= 4);
  const candidates = await (await request('/api/discovery/source-candidates', { urls: ['https://jobs.lever.co/fictional', 'https://127.0.0.1/private'] })).json();
  assert.equal(candidates.sources.length, 1); assert.equal(candidates.networkCalls, 0); assert.equal(modelCalls, 0);

  assert.equal((await request('/api/discovery/config', { ...config, sources: [{ ...source, board: 'https://127.0.0.1' }] })).status, 400);
  assert.equal((await request('/api/discovery/config', config)).status, 200);
  assert.equal((await request('/api/discovery/run', {})).status, 200);
  const jobs = await (await request('/api/jobs')).json(); assert.equal(jobs.length, 1);
  const path = '/api/jobs/' + jobs[0].id, detail = await (await request(path)).json();
  assert.equal(detail.cv, null); assert.equal(detail.assistant.available, false);
  assert.equal((await request(path + '/analyze', { paidCallApproved: true, cloudProfileApproved: true })).status, 409);
  assert.equal((await request(path + '/assistant', { action: 'start', contactApproved: true })).status, 409);
  assert.equal(modelCalls, 0); assert.equal(launches, 0);
  assert.equal((await request(path + '/routing', { country: 'ZZ', language: 'en' })).status, 400);
  const confirmed = await (await request(path + '/routing', { country: 'TR', language: 'en' })).json();
  assert.equal(confirmed.posting.country, 'TR'); assert.equal(confirmed.discovery.routingConfirmed, true);
  assert.equal(confirmed.cv.photo, true); assert.equal((await request(path + '/routing', { country: 'US', language: 'en' })).status, 400);
  assert.equal(confirmed.state, 'review'); assert.equal(modelCalls, 0);
});


test('explicit company location fallback rescues missing locations without overriding an advertised foreign location or confirming country', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-location-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openHubStore(join(dir, 'jobs'), demoProfile);
  const service = await openDiscovery(dir, store, async () => ({ jobs: [
    { ...job, externalId: '201', url: 'https://job-boards.greenhouse.io/fictional/jobs/201', location: '' },
    { ...job, externalId: '202', url: 'https://job-boards.greenhouse.io/fictional/jobs/202', location: 'London, United Kingdom' },
  ], rejected: 0 }));
  await service.configure({ ...config, sources: [{ ...source, locationFallback: 'İstanbul, Türkiye' }] });
  const report = await service.run(new AbortController().signal);
  assert.equal(report.added, 1); assert.equal(report.sources[0]!.filtered, 1);
  const saved = store.list()[0]!;
  assert.equal(saved.discovery!.location, 'İstanbul, Türkiye');
  assert.ok(saved.discovery!.reasons.some(reason => reason.includes('şirket varsayılanı')));
  assert.equal(saved.posting.country, 'ZZ'); assert.equal(saved.discovery!.routingConfirmed, false);
});
