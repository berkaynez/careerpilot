import test from 'node:test';
import { get as httpGet } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHub } from '../src/hub/server.js';
import type { HubAnalyzer } from '../src/hub/server.js';
import { demoProfile, demoRecords } from '../src/hub/demo.js';
import { postingSchema } from '../src/preparation/posting.js';
import { jobSchema, validatePlan } from '../src/preparation/core.js';

async function fixture(t: { after: (callback: () => Promise<void>) => void }, analyze?: HubAnalyzer) {
  const dir = await mkdtemp(join(tmpdir(), 'careerpilot-hub-'));
  const server = await startHub({ directory: join(dir, 'jobs'), profile: demoProfile, ...(analyze ? { analyze } : {}) });
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }); });
  const session = await (await fetch(server.origin + '/api/session')).json();
  const request = (path: string, data?: unknown, headers: Record<string, string> = {}) => fetch(server.origin + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'X-Hub-Token': session.token, Origin: server.origin, 'Content-Type': 'application/json', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { dir, server, session, request };
}
const input = { company: 'Example Fictional', title: 'Junior analyst', country: 'TR', language: 'en',
  sourceUrl: 'https://example.invalid/role', text: 'Relevant degree. SQL knowledge preferred.' };
function result(posting: ReturnType<typeof postingSchema.parse>) {
  const { text, ...metadata } = posting;
  const job = jobSchema.parse({ ...metadata, requirements: [
    { id: 'degree', text: 'Relevant degree.', priority: 'essential' },
    { id: 'sql', text: 'SQL knowledge preferred.', priority: 'preferred' },
  ] });
  const plan = validatePlan({ assessments: [
    { requirementId: 'degree', evidenceLevel: 'documented', factIds: ['degree'] },
    { requirementId: 'sql', evidenceLevel: 'related', factIds: ['sql'] },
  ], coverLetterFactIds: ['degree'], focusRequirementId: 'degree' }, demoProfile, job);
  return { job, plan, costMicroUsd: 123 };
}

test('hub serves local assets, rejects cross-origin/host requests and requires session tokens', async t => {
  const app = await fixture(t);
  const home = await fetch(app.server.origin);
  assert.match(await home.text(), /CareerPilot/);assert.match(home.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.equal(home.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(app.server.origin + '/api/jobs')).status, 403);
  assert.equal((await app.request('/api/jobs', input, { Origin: 'https://attacker.invalid' })).status, 403);
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    httpGet(app.server.origin + '/api/session', { headers: { Host: 'attacker.invalid' } }, response => { response.resume();resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal((await fetch(app.server.origin + '/api/session', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await app.request('/api/jobs', input, { 'X-Hub-Token': 'wrong' })).status, 403);
  assert.equal((await app.request('/api/jobs', input, { Origin: '' })).status, 403);
  assert.equal((await app.request('/api/jobs', input, { 'Content-Type': 'text/plain' })).status, 400);
  const safe = JSON.stringify(app.session);
  for (const value of [demoProfile.contact.email, demoProfile.contact.phone, '/fictional/cv.pdf']) assert.ok(!safe.includes(value));
  assert.equal((await app.request('/.env')).status, 404);
  assert.equal((await app.request('/api/jobs', { ...input, sourceUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await app.request('/api/jobs', { ...input, text: 'x'.repeat(201000) })).status, 400);
});

test('job creation and manual status persist privately without making model calls', async t => {
  let calls = 0;const app = await fixture(t, async posting => { calls++;return result(posting); });
  const created = await (await app.request('/api/jobs', input)).json();
  assert.equal(created.state, 'saved');assert.equal(created.score, null);
  assert.equal((await app.request('/api/jobs/' + created.id + '/status', { state: 'ready' })).status, 400);
  assert.equal((await app.request('/api/jobs/' + created.id + '/status', { state: 'submitted' })).status, 200);
  assert.equal(calls, 0);assert.equal((await (await app.request('/api/jobs')).json())[0].state, 'submitted');
  const file = join(app.dir, 'jobs', created.id + '.json');
  assert.equal((await stat(file)).mode & 0o777, 0o600);assert.equal((await stat(join(app.dir, 'jobs'))).mode & 0o777, 0o700);
  assert.ok(!JSON.stringify(created).includes('/fictional/'));
  const reopened = await startHub({ directory: join(app.dir, 'jobs'), profile: demoProfile });
  try {
    const session = await (await fetch(reopened.origin + '/api/session')).json();
    const records = await (await fetch(reopened.origin + '/api/jobs', { headers: { 'X-Hub-Token': session.token } })).json();
    assert.equal(records.length, 1);assert.equal(records[0].state, 'submitted');
  } finally { await reopened.close(); }
  assert.deepEqual((await readdir(join(app.dir, 'jobs'))).filter(file => file.endsWith('.tmp')), []);
});

test('analysis requires both fresh consents, reuses verified match scoring and records cost', async t => {
  let calls = 0;const app = await fixture(t, async posting => { calls++;return result(posting); });
  const created = await (await app.request('/api/jobs', input)).json(), path = '/api/jobs/' + created.id;
  for (const consent of [{}, { paidCallApproved: true }, { paidCallApproved: true, cloudProfileApproved: false }])
    assert.equal((await app.request(path + '/analyze', consent)).status, 403);
  assert.equal(calls, 0);
  const response = await app.request(path + '/analyze', { paidCallApproved: true, cloudProfileApproved: true });
  assert.equal(response.status, 200);
  const analyzed = await response.json();
  assert.equal(analyzed.score, 88);assert.equal(analyzed.analysis.match.totals.possible, 4);
  assert.equal(analyzed.analysis.costMicroUsd, 123);assert.equal(analyzed.state, 'ready');assert.equal(analyzed.analyzing, false);
  await app.request('/api/jobs');await app.request(path);
  assert.equal(calls, 1);
  const stored = JSON.parse(await readFile(join(app.dir, 'jobs', created.id + '.json'), 'utf8'));
  assert.equal(stored.analysis.costMicroUsd, 123);
});

test('failed analysis stays unscored, preserves safe failure reason and never retries', async t => {
  let calls = 0;const app = await fixture(t, async () => { calls++;throw new Error('PROVIDER_NETWORK_ERROR'); });
  const created = await (await app.request('/api/jobs', input)).json(), path = '/api/jobs/' + created.id;
  assert.equal((await app.request(path + '/analyze', { paidCallApproved: true, cloudProfileApproved: true })).status, 502);
  const saved = await (await app.request(path)).json();
  assert.equal(saved.score, null);assert.equal(saved.lastError, 'PROVIDER_NETWORK_ERROR');assert.equal(saved.state, 'saved');assert.equal(calls, 1);
});

test('double analysis requests cannot invoke the model twice, and manual tracking is preserved', async t => {
  let calls = 0, release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
  const app = await fixture(t, async posting => { calls++;started();await waiting;return result(posting); });
  const created = await (await app.request('/api/jobs', input)).json(), path = '/api/jobs/' + created.id;
  const consent = { paidCallApproved: true, cloudProfileApproved: true };
  const first = app.request(path + '/analyze', consent);await ready;
  assert.equal((await app.request(path + '/analyze', consent)).status, 409);
  await app.request(path + '/status', { state: 'archived' });release();
  const completed = await (await first).json();assert.equal(completed.state, 'archived');assert.equal(calls, 1);
});

test('import recomputes score from profile references and does not trust a stored score or arbitrary file path', async t => {
  const app = await fixture(t), data = demoRecords()[0]!.analysis!;
  const imported = await (await app.request('/api/import', { job: data.job, plan: data.plan })).json();
  assert.equal(imported.score, 71);assert.equal(imported.analysis.origin, 'imported_review');
  assert.equal(imported.analysis.costMicroUsd, null);
  assert.equal((await app.request('/api/import', { job: data.job, plan: { ...data.plan, score: 100 } })).status, 400);
  assert.equal((await app.request('/api/import', { job: data.job, plan: data.plan, path: '/etc/passwd' })).status, 400);
  assert.equal((await app.request('/api/jobs/' + imported.id + '/analyze', { paidCallApproved: true, cloudProfileApproved: true })).status, 409);
  const invalid = { ...data.plan, assessments: data.plan.assessments.map(item => ({ ...item, factIds: ['nonexistent'] })) };
  assert.equal((await app.request('/api/import', { job: data.job, plan: invalid })).status, 400);
});
