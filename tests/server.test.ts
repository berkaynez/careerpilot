import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from '../src/mocks/server.js';

const signal = new AbortController().signal;
const payload = (runId: string) => new URLSearchParams({
  runId, fullName: 'Alex Example', email: 'alex@example.invalid', school: 'Example Institute',
  degree: 'Bachelor of Science', role: 'Software Engineer', project: 'Built an internal task tracking application', accuracy: 'on',
});

test('server validates independently, verifies receipts, and deduplicates submission retries', async t => {
  const server = await startMockServer();
  t.after(() => server.close());
  const post = (data: URLSearchParams, origin = server.origin) => fetch(`${server.origin}/applications/single/submit`, {
    method: 'POST', headers: { origin }, body: data,
  });
  assert.equal(await server.verify('server-test', signal), null);
  assert.equal((await post(new URLSearchParams({ runId: 'server-test' }))).status, 422);
  assert.equal(await server.verify('server-test', signal), null);
  assert.equal((await post(payload('server-test'), 'http://127.0.0.1:1')).status, 403);
  assert.equal((await post(payload('server-test'))).status, 200);
  const receipt = await server.verify('server-test', signal);
  assert.ok(receipt);
  assert.equal(receipt.origin, server.origin);
  assert.equal((await post(payload('server-test'))).status, 200);
  assert.deepEqual(await server.verify('server-test', signal), receipt);
  const changed = payload('server-test'); changed.set('role', 'Changed job title');
  assert.equal((await post(changed)).status, 409);
  assert.deepEqual(await (await fetch(`${server.origin}/api/receipts/server-test`)).json(), receipt);
  receipt.receiptId = 'tampered copy';
  assert.notEqual((await server.verify('server-test', signal))?.receiptId, receipt.receiptId);
});

test('dynamic server validation requires conditional answers and complete repeated positions', async t => {
  const server = await startMockServer(); t.after(() => server.close());
  const data = new URLSearchParams({ runId: 'dynamic-server', fullName: 'Alex Example', email: 'alex@example.invalid',
    employmentStatus: 'Employed', workRole: 'Software Engineer', workCompany: 'Example Systems',
    project: 'Built an internal task tracking application', accuracy: 'on' });
  const post = () => fetch(`${server.origin}/applications/dynamic/submit`, { method: 'POST', headers: { origin: server.origin }, body: data });
  assert.equal((await post()).status, 422);
  data.set('currentEmployer', 'Example Systems'); data.append('workRole', 'Software Engineer');
  assert.equal((await post()).status, 422);
  data.append('workCompany', 'Example Systems');
  assert.equal((await post()).status, 200);
  assert.ok(await server.verify('dynamic-server', signal));
});
