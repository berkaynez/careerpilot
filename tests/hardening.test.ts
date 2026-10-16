import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBudgetManager } from '../src/persistent-budget.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { ProviderError } from '../src/llm.js';
import type { LLMRequest, ModelConfig, ProviderErrorCode } from '../src/llm.js';
import { LLMDecisionPolicy } from '../src/agent/decision-policy.js';
import { fictionalCandidate, fictionalPersonalData } from '../src/profile.js';
import { defaultApplicationPolicy } from '../src/policy.js';
import type { AgentEvent } from '../src/contracts.js';

// Synthetic test pricing, not actual provider rates.
const pricing = { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 2_000_000, source: 'synthetic', verifiedOn: '2020-01-01' };
const usage = (inputTokens: number) => ({ inputTokens, outputTokens: 0 });
const model: ModelConfig = { provider: 'openai-compatible', model: 'offline', execution: 'cloud', pricing, maxInputTokens: 12_000, maxOutputTokens: 2_000 };
const request: LLMRequest = { config: model, messages: [], tools: [] };
const signal = new AbortController().signal;
const temporaryLedger = (t: { after(fn: () => void): void }) => {
  const directory = mkdtempSync(join(tmpdir(), 'careerpilot-hardening-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'budget.jsonl');
};

test('default run cap counts settled and pending costs after restart independently of other runs', t => {
  const path = temporaryLedger(t);
  const first = new FileBudgetManager(path);
  const settled = first.reserve('a', usage(60_000), pricing);
  first.settle(settled.id, usage(40_000));
  const pending = first.reserve('a', usage(60_000), pricing); // Exact $0.10 boundary.
  const restarted = new FileBudgetManager(path);
  const before = readFileSync(path, 'utf8');
  assert.throws(() => restarted.reserve('a', usage(1), pricing), /BUDGET_RUN_STOP/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(restarted.runAccounting('a').costMicroUsd, 100_000);
  restarted.reserve('b', usage(100_000), pricing);
  restarted.settle(pending.id, usage(30_000));
  first.reserve('a', usage(30_000), pricing); // Settled savings become available.
  assert.equal(first.runAccounting('a').costMicroUsd, 100_000);
  assert.equal(first.snapshot().targetReached, false);
});

test('run cap is configurable; monthly cap still applies and rollover does not clear a run', t => {
  const path = temporaryLedger(t);
  let now = new Date('2026-10-31T23:59:59Z');
  const custom = new FileBudgetManager(path, 5_000_000, () => now, 200_000);
  custom.reserve('run', usage(200_000), pricing);
  now = new Date('2026-11-01T00:00:01Z');
  assert.equal(custom.snapshot().reservedMicroUsd, 0);
  assert.throws(() => custom.reserve('run', usage(1), pricing), /BUDGET_RUN_STOP/);
  const lowMonthly = new FileBudgetManager(path, 10_000, () => now, 200_000);
  assert.throws(() => lowMonthly.reserve('new-run', usage(10_001), pricing), /BUDGET_MONTHLY_STOP/);
  for (const limit of [0, -1, NaN, 0.5]) assert.throws(() => new FileBudgetManager(path, 5_000_000, () => now, limit), /BUDGET_RUN_LIMIT_INVALID/);
});

test('provider classifies HTTP failures without reading or retaining sensitive error bodies', async () => {
  const cases: [number, ProviderErrorCode][] = [
    [400, 'PROVIDER_INVALID_REQUEST'], [401, 'PROVIDER_AUTHENTICATION_ERROR'], [403, 'PROVIDER_PERMISSION_ERROR'],
    [404, 'PROVIDER_NOT_FOUND'], [422, 'PROVIDER_INVALID_REQUEST'], [429, 'PROVIDER_RATE_OR_QUOTA_LIMIT'],
    [500, 'PROVIDER_SERVER_ERROR'], [503, 'PROVIDER_SERVER_ERROR'], [408, 'PROVIDER_TIMEOUT'], [418, 'PROVIDER_HTTP_ERROR'],
  ];
  for (const [status, code] of cases) {
    let requests = 0, bodyReads = 0;
    const provider = new OpenAICompatibleProvider('sensitive-key', 'https://offline.invalid/v1', async url => {
      requests++;
      if (url.endsWith('/input_tokens')) return Response.json({ input_tokens: 10 });
      const response = new Response('sensitive-key Alex Example', { status });
      response.text = async () => { bodyReads++; return 'sensitive-key Alex Example'; };
      return response;
    });
    await assert.rejects(provider.generate(request, signal), error => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, code); assert.equal(error.stage, 'generation'); assert.equal(error.httpStatus, status);
      assert.ok(!`${error}${JSON.stringify(error)}`.includes('sensitive-key'));
      assert.ok(!JSON.stringify(error).includes('Alex Example'));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(requests, 2); assert.equal(bodyReads, 0);
  }
});

test('provider distinguishes timeout, abort, network, invalid JSON/schema and oversized responses', async () => {
  const scenarios: [ProviderErrorCode, () => Response | never][] = [
    ['PROVIDER_TIMEOUT', () => { throw new DOMException('sensitive-key', 'TimeoutError'); }],
    ['PROVIDER_NETWORK_ERROR', () => { throw new TypeError('sensitive-key'); }],
    ['PROVIDER_INVALID_JSON', () => new Response('{sensitive-key')],
    ['PROVIDER_INVALID_RESPONSE', () => Response.json({ unexpected: 'sensitive-key' })],
    ['PROVIDER_RESPONSE_TOO_LARGE', () => new Response('sensitive-key'.repeat(100_000))],
  ];
  for (const [code, result] of scenarios) {
    const provider = new OpenAICompatibleProvider('sensitive-key', undefined, async () => result());
    await assert.rejects(provider.generate(request, signal), error => error instanceof ProviderError
      && error.code === code && error.stage === 'preflight' && error.message === code && error.cause === undefined);
  }
  let requests = 0;
  const provider = new OpenAICompatibleProvider('sensitive-key', undefined, async () => { requests++; return Response.json({}); });
  await assert.rejects(provider.generate(request, AbortSignal.abort('sensitive-key')), error => error instanceof ProviderError && error.code === 'PROVIDER_ABORTED');
  assert.equal(requests, 0);
});

test('uncertain classified failures retain reservations and stop this run before another provider call', async t => {
  const path = temporaryLedger(t);
  const events: AgentEvent[] = [];
  let providerRequests = 0;
  const provider = new OpenAICompatibleProvider('sensitive-key', undefined, async url => {
    providerRequests++;
    return url.endsWith('/input_tokens') ? Response.json({ input_tokens: 10 }) : new Response('sensitive-key Alex Example', { status: 503 });
  });
  const context = { observation: { id: 'obs', origin: 'http://127.0.0.1:3000', title: '', text: '', controls: [], errors: [] },
    candidate: fictionalCandidate, personalReferenceIds: Object.keys(fictionalPersonalData.references), previousResults: [],
    policy: { ...defaultApplicationPolicy, allowedOrigin: 'http://127.0.0.1:3000' } };
  const makePolicy = () => new LLMDecisionPolicy({ runId: 'uncertain', model, provider, personal: fictionalPersonalData,
    budget: new FileBudgetManager(path), events: { async write(event) { events.push(event); } } });
  // Explicit caller attempts, not adapter retries. Each uncertain request reserves
  // $0.016; six fit in $0.10 and the seventh must never contact the provider.
  for (let attempt = 0; attempt < 6; attempt++) await assert.rejects(makePolicy().decide(context, signal), /PROVIDER_SERVER_ERROR/);
  await assert.rejects(makePolicy().decide(context, signal), /BUDGET_RUN_STOP/);
  assert.equal(providerRequests, 12);
  const restarted = new FileBudgetManager(path);
  assert.equal(restarted.snapshot().reservedMicroUsd, 96_000);
  assert.equal(restarted.snapshot().spentMicroUsd, 0);
  assert.equal(restarted.runAccounting('uncertain').costMicroUsd, 96_000);
  assert.equal(events.filter(event => event.code === 'PROVIDER_SERVER_ERROR').length, 6);
  assert.ok(!JSON.stringify(events).includes('sensitive-key') && !JSON.stringify(events).includes('Alex Example'));
});
