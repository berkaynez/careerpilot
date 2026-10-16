import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import { browserTools } from '../src/agent/tools.js';
import { loadAgentConfig, parseMicroUsd } from '../src/config.js';
import { JsonlEventSink } from '../src/events.js';
import type { LLMRequest } from '../src/llm.js';
import { validateDecision } from '../src/validation.js';
import { fictionalCandidate, fictionalPersonalData } from '../src/profile.js';
import { defaultApplicationPolicy } from '../src/policy.js';

const signal = new AbortController().signal;
const request: LLMRequest = {
  config: { provider: 'openai-compatible', model: 'offline-model', execution: 'cloud', maxInputTokens: 2000, maxOutputTokens: 500,
    pricing: { inputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 2, source: 'synthetic rates', verifiedOn: '2020-01-01' } },
  messages: [{ role: 'system', content: 'Use tools' }, { role: 'user', content: 'Local task' }], tools: browserTools,
};

test('adapter checks input before generation, uses bounded output, and includes reasoning tokens in usage', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const provider = new OpenAICompatibleProvider('offline-key', 'https://offline.invalid/v1', async (url, init) => {
    seen.push({ url, init });
    return url.endsWith('/input_tokens') ? Response.json({ input_tokens: 100 }) : Response.json({ status: 'completed',
      usage: { input_tokens: 100, output_tokens: 55, output_tokens_details: { reasoning_tokens: 40 } },
      output: [{ type: 'function_call', call_id: 'call-1', name: 'wait_for_change', arguments: '{}' }] });
  });
  const response = await provider.generate(request, signal);
  assert.equal(response.usage.outputTokens, 55);
  assert.equal(response.calls[0]?.name, 'wait_for_change');
  assert.equal(seen.length, 2);
  assert.equal(seen[1]?.init.redirect, 'error');
  const body = JSON.parse(String(seen[1]?.init.body));
  assert.equal(body.model, 'offline-model'); assert.equal(body.max_output_tokens, 500);
  assert.equal(body.store, false); assert.equal(body.tool_choice, 'required');
});

test('adapter never retries HTTP failures or guesses input counts', async () => {
  let calls = 0;
  const oversized = new OpenAICompatibleProvider('offline-key', undefined, async () => { calls++; return Response.json({ input_tokens: 2001 }); });
  await assert.rejects(oversized.generate(request, signal), /PROVIDER_INPUT_LIMIT/);
  assert.equal(calls, 1);
  calls = 0;
  const failed = new OpenAICompatibleProvider('offline-key', undefined, async () => { calls++; throw new Error('sensitive transport detail offline-key'); });
  await assert.rejects(failed.generate(request, signal), error => error instanceof Error && error.message === 'PROVIDER_NETWORK_ERROR');
  assert.equal(calls, 1);
  assert.throws(() => new OpenAICompatibleProvider('offline-key', 'http://example.invalid'), /CONFIGURATION/);
});

test('malformed tool JSON retains usage for accounting instead of discarding billable response', async () => {
  const provider = new OpenAICompatibleProvider('offline-key', undefined, async url => url.endsWith('/input_tokens')
    ? Response.json({ input_tokens: 10 }) : Response.json({ status: 'completed', usage: { input_tokens: 10, output_tokens: 10 },
      output: [{ type: 'function_call', call_id: 'call-1', name: 'fill_fields', arguments: '{bad' }] }));
  const response = await provider.generate(request, signal);
  assert.equal(response.calls[0]?.arguments, null);
  assert.equal(response.usage.inputTokens, 10);
});

test('configuration requires paid opt-in, explicit model/pricing, verified date and a $5 default stop', () => {
  const env = { CAREERPILOT_ENABLE_PAID_CALLS: 'true', MODEL_PRICING_VERIFIED: 'true', OPENAI_API_KEY: 'offline-key',
    OPENAI_MODEL: 'explicit-model', MODEL_INPUT_USD_PER_MILLION: '0.123456', MODEL_OUTPUT_USD_PER_MILLION: '1.234567',
    MODEL_PRICING_SOURCE: 'https://example.invalid/pricing', MODEL_PRICING_VERIFIED_ON: '2020-01-01' };
  const config = loadAgentConfig(env);
  assert.equal(config.limitMicroUsd, 5_000_000);
  assert.equal(config.runLimitMicroUsd, 100_000);
  assert.equal(loadAgentConfig({ ...env, PER_RUN_BUDGET_USD: '0.025' }).runLimitMicroUsd, 25_000);
  assert.equal(config.model.pricing?.inputMicroUsdPerMillion, 123456);
  assert.equal(config.consent['application.submit'], false);
  assert.equal(parseMicroUsd('8'), 8_000_000);
  assert.throws(() => parseMicroUsd('0.1234567'));
  assert.throws(() => loadAgentConfig({ ...env, OPENAI_MODEL: '' }));
  assert.throws(() => loadAgentConfig({ ...env, MODEL_PRICING_VERIFIED: 'false' }));
  assert.throws(() => loadAgentConfig({ ...env, MODEL_PRICING_VERIFIED_ON: '2020-02-31' }));
  assert.throws(() => loadAgentConfig({ ...env, MONTHLY_BUDGET_USD: '8.000001' }));
  for (const amount of ['0', '-0.1', 'NaN', '0.1234567']) assert.throws(() => loadAgentConfig({ ...env, PER_RUN_BUDGET_USD: amount }));
  assert.throws(() => loadAgentConfig({ ...env, CAREERPILOT_ENABLE_PAID_CALLS: 'false' }));
});

test('consent controls cannot use unrelated boolean candidate facts', () => {
  const observation = { id: 'obs', origin: 'http://127.0.0.1:3000', title: '', text: '', errors: [], controls: [
    { id: 'accuracy', kind: 'checkbox' as const, consentId: 'application.accuracy', label: 'Confirm accuracy', help: '', required: true, options: [] },
  ] };
  const policy = { ...defaultApplicationPolicy, allowedOrigin: observation.origin, consent: { 'application.accuracy': true } };
  assert.equal(validateDecision({ kind: 'action', observationId: 'obs', action: { kind: 'check', elementId: 'accuracy', checked: true,
    evidence: { kind: 'fact', claim: { factId: 'authorization.US', value: true } } } }, observation, fictionalCandidate, fictionalPersonalData, policy, 0).ok, false);
});

test('structured logs discard extra properties and include only metadata', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'careerpilot-events-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'run.jsonl');
  const event = { runId: 'run', at: new Date().toISOString(), type: 'decision' as const, code: 'TOOL_FILL_FIELDS', factIds: ['education.school'], usage: null, costMicroUsd: null,
    rawResponse: 'unnecessary personal answer', credentials: 'offline-key' };
  await new JsonlEventSink(path).write(event);
  const log = readFileSync(path, 'utf8');
  assert.ok(log.includes('TOOL_FILL_FIELDS'));
  assert.ok(!log.includes('unnecessary personal answer') && !log.includes('offline-key'));
});
