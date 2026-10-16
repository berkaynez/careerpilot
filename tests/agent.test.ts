import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLMDecisionPolicy } from '../src/agent/decision-policy.js';
import { BrowserAgentRunner } from '../src/agent/runner.js';
import { FileBudgetManager } from '../src/persistent-budget.js';
import { InMemoryBudgetManager } from '../src/budget.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';
import type { HttpTransport } from '../src/providers/openai-compatible.js';
import type { LLMProvider, LLMRequest, ModelConfig, ToolCall } from '../src/llm.js';
import type { AgentEvent, BrowserExecutor, BrowserObservation, DecisionContext } from '../src/contracts.js';
import { fictionalCandidate as candidate, fictionalPersonalData as personal } from '../src/profile.js';
import { defaultApplicationPolicy } from '../src/policy.js';
import { PlaywrightBrowserExecutor } from '../src/browser/executor.js';
import { startMockServer } from '../src/mocks/server.js';
import { browserTools, parseCall, toDecision } from '../src/agent/tools.js';

const signal = new AbortController().signal;
const model: ModelConfig = { provider: 'test', execution: 'cloud', model: 'offline-model', maxInputTokens: 12_000, maxOutputTokens: 2_000,
  pricing: { inputMicroUsdPerMillion: 1_000_000, outputMicroUsdPerMillion: 2_000_000, source: 'synthetic test rates', verifiedOn: '2026-10-16' } };
const observation: BrowserObservation = { id: 'obs-test', origin: 'http://127.0.0.1:3000', title: 'Unfamiliar page',
  text: 'Alex Example alex@example.invalid', errors: [], controls: [{ id: 'field-a', kind: 'text', label: 'Your public role', help: '', required: true, options: [] }] };
const policy = { ...defaultApplicationPolicy, allowedOrigin: observation.origin, consent: { 'application.accuracy': true, 'application.submit': true } };
const context: DecisionContext = { observation, candidate, personalReferenceIds: Object.keys(personal.references), policy, previousResults: [] };
const call = (name: string, args: unknown): ToolCall => ({ id: 'call-test', name, arguments: args });
const reply = (calls: ToolCall[]) => ({ calls, usage: { inputTokens: 100, outputTokens: 50 }, usageSource: 'provider' as const });
const stateFrom = (request: LLMRequest) => JSON.parse((request.messages.find(message => message.role === 'user') as { content: string }).content);

test('tool schemas reject arbitrary answers, unsupported tool names and ambiguous sources', () => {
  assert.throws(() => parseCall(call('eval', { code: 'unsafe' })));
  assert.throws(() => parseCall(call('fill_fields', { actions: [{ kind: 'fill', elementId: 'field-a', value: 'invented' }] })));
  const invalid = call('fill_fields', { actions: [{ kind: 'fill', elementId: 'field-a', factId: 'experience.role', personalReferenceId: 'personal.email', optionId: null }] });
  assert.throws(() => toDecision(parseCall(invalid), context));
  for (const tool of browserTools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual([...tool.inputSchema.required as string[]].sort(), Object.keys(tool.inputSchema.properties as object).sort());
  }
});

test('policy filters private data, discloses facts only on demand and recovers from invalid calls', async () => {
  const requests: LLMRequest[] = [];
  const provider: LLMProvider = { id: 'mock', async generate(request) {
    requests.push(request);
    if (requests.length === 1) return reply([call('fill_fields', { secret: 'do-not-echo-model-secret' })]);
    if (requests.length === 2) return reply([call('read_candidate_facts', { factIds: ['experience.role'] })]);
    return reply([call('fill_fields', { actions: [{ kind: 'fill', elementId: 'field-a', factId: 'experience.role', personalReferenceId: null, optionId: null }] })]);
  } };
  const decision = await new LLMDecisionPolicy({ runId: 'test', provider, model, budget: new InMemoryBudgetManager(), personal }).decide(context, signal);
  assert.equal(decision.kind, 'batch');
  assert.equal(stateFrom(requests[0]!).facts.length, 0);
  assert.deepEqual(stateFrom(requests[2]!).facts, [{ id: 'experience.role', value: 'Software Engineer' }]);
  const sent = JSON.stringify(requests);
  assert.ok(!sent.includes('Alex Example') && !sent.includes('alex@example.invalid'));
  assert.ok(!sent.includes('do-not-echo-model-secret'));
  assert.ok(!sent.includes('Example Institute'));
});

test('invalid tool retries are bounded and unknown facts cannot become browser actions', async () => {
  let count = 0;
  const provider: LLMProvider = { id: 'mock', async generate() { count++; return reply([call('fill_fields', {
    actions: [{ kind: 'fill', elementId: 'field-a', factId: 'invented.qualification', personalReferenceId: null, optionId: null }],
  })]); } };
  await assert.rejects(new LLMDecisionPolicy({ runId: 'retry', provider, model, budget: new InMemoryBudgetManager(), personal }).decide(context, signal), /POLICY_TOOL_RETRY_LIMIT/);
  assert.equal(count, 4);
});

test('provider failures are not retried and their reservations survive restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'careerpilot-agent-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'ledger.jsonl');
  let count = 0;
  const provider: LLMProvider = { id: 'mock', async generate() { count++; throw new Error('PROVIDER_REQUEST_FAILED'); } };
  await assert.rejects(new LLMDecisionPolicy({ runId: 'failed', provider, model, budget: new FileBudgetManager(path), personal }).decide(context, signal));
  assert.equal(count, 1);
  const restarted = new FileBudgetManager(path);
  assert.ok(restarted.snapshot().reservedMicroUsd > 0);
  assert.ok(restarted.runAccounting('failed').costMicroUsd > 0);
});

test('runner stops for missing information and rejects receipts for another run', async () => {
  const browser: BrowserExecutor = { async observe() { return observation; }, async execute() { return [{ observationId: observation.id, status: 'executed', code: 'ACTION_EXECUTED' }]; } };
  const dependencies = { browser, budget: new InMemoryBudgetManager(), personal,
    policy: { async decide() { return { kind: 'stop' as const, outcome: 'needs_information' as const, reason: 'missing' }; } },
    verifier: { async verify() { return null; } } };
  const request = { runId: 'runner', applicationUrl: `${observation.origin}/applications/single`, candidate, policy };
  assert.equal((await new BrowserAgentRunner(dependencies).run(request, signal)).outcome.status, 'needs_information');
  let verifications = 0;
  const result = await new BrowserAgentRunner({ ...dependencies,
    policy: { async decide() { return { kind: 'action' as const, observationId: observation.id, action: { kind: 'wait' as const } }; } },
    verifier: { async verify() { return ++verifications === 1 ? null : { runId: 'another', receiptId: 'forged', origin: observation.origin }; } },
  }).run(request, signal);
  assert.equal(result.outcome.status, 'blocked');
});

test('runner refuses premature submission before any browser execution', async () => {
  const submitObservation: BrowserObservation = { ...observation, controls: [{ id: 'submit', kind: 'button', label: 'Send', help: '', required: false, options: [], buttonEffect: 'submission' }] };
  let executions = 0;
  const runner = new BrowserAgentRunner({ budget: new InMemoryBudgetManager(), personal,
    browser: { async observe() { return submitObservation; }, async canSubmit() { return false; }, async execute() { executions++; return []; } },
    policy: { async decide() { return { kind: 'action', observationId: observation.id, action: { kind: 'submit', elementId: 'submit', consentId: 'application.submit' } }; } },
    verifier: { async verify() { return null; } },
  });
  assert.equal((await runner.run({ runId: 'premature', applicationUrl: `${observation.origin}/applications/single`, candidate, policy }, signal)).outcome.status, 'needs_information');
  assert.equal(executions, 0);
});

test('full single-page agent uses mocked Responses transport, batched actions and verified receipts', async t => {
  const server = await startMockServer();
  const directory = mkdtempSync(join(tmpdir(), 'careerpilot-agent-integration-'));
  const runId = 'agent-offline';
  const applicationUrl = `${server.origin}/applications/single`;
  const applicationPolicy = { ...policy, allowedOrigin: server.origin };
  const events: AgentEvent[] = [];
  const sink = { async write(event: AgentEvent) { events.push(event); } };
  let browser: PlaywrightBrowserExecutor | undefined;
  t.after(async () => { await browser?.close(); await server.close(); rmSync(directory, { recursive: true, force: true }); });
  browser = await PlaywrightBrowserExecutor.create({ runId, applicationUrl, candidate, personal, policy: applicationPolicy, events: sink });
  const budget = new FileBudgetManager(join(directory, 'budget.jsonl'));
  let generationCount = 0, countRequests = 0;
  const wireRequests: unknown[] = [];
  // This is a transport fixture, not a production decision script. Resolve only
  // current observation IDs so the actual policy, runner and browser all run.
  const transport: HttpTransport = async (url, init) => {
    const body = JSON.parse(String(init.body)); wireRequests.push(body);
    if (url.endsWith('/input_tokens')) { countRequests++; return Response.json({ input_tokens: 1500 }); }
    generationCount++;
    assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false);
    assert.ok(body.tools.every((tool: { strict: boolean }) => tool.strict));
    const state = JSON.parse(body.input.find((item: { role: string }) => item.role === 'user').content);
    const id = (label: string) => state.observation.controls.find((control: { label: string }) => control.label === label).id;
    const field = (label: string, factId: string | null, personalReferenceId: string | null, optionId: string | null = null) => ({
      kind: optionId ? 'select' : 'fill', elementId: id(label), factId, personalReferenceId, optionId,
    });
    let selected: ToolCall;
    if (generationCount === 1) selected = call('read_candidate_facts', { factIds: ['education.degree'] });
    else if (generationCount === 2) selected = call('fill_fields', { actions: [field('Full name', null, 'personal.fullName'), field('Email address', null, 'personal.email'),
      field('School or university', 'education.school', null), field('Most recent job title', 'experience.role', null)] });
    else if (generationCount === 3) {
      const options = state.observation.controls.find((control: { label: string }) => control.label === 'Highest qualification').options;
      selected = call('fill_fields', { actions: [field('Highest qualification', 'education.degree', null, options.find((option: { label: string }) => option.label === 'Bachelor of Science').id),
        field('Describe a relevant project', 'experience.project', null)] });
    } else if (generationCount === 4) selected = call('set_checked', { elementId: id('I confirm these fictional application details are accurate'), checked: true, factId: null, consentId: 'application.accuracy' });
    else selected = call('submit_application', { elementId: id('Submit mock application'), consentId: 'application.submit' });
    return Response.json({ status: 'completed', usage: { input_tokens: 1500, output_tokens: 150 },
      output: [{ type: 'function_call', call_id: `call-${generationCount}`, name: selected.name, arguments: JSON.stringify(selected.arguments) }] });
  };
  const provider = new OpenAICompatibleProvider('offline-key-not-a-secret', 'https://offline.invalid/v1', transport);
  const decisionPolicy = new LLMDecisionPolicy({ runId, provider, model, budget, personal, events: sink });
  const result = await new BrowserAgentRunner({ browser, policy: decisionPolicy, verifier: server, budget, personal, events: sink })
    .run({ runId, applicationUrl, candidate, policy: applicationPolicy }, signal);
  assert.equal(result.outcome.status, 'submitted', JSON.stringify(result));
  assert.deepEqual(result.outcome.status === 'submitted' && result.outcome.receipt, await server.verify(runId, signal));
  assert.equal(generationCount, 5); assert.equal(countRequests, 5);
  assert.equal(result.usage.inputTokens, 7500);
  assert.equal(result.costMicroUsd, 9000);
  const restarted = new FileBudgetManager(join(directory, 'budget.jsonl'));
  assert.equal(restarted.snapshot().reservedMicroUsd, 0);
  assert.equal(restarted.runAccounting(runId).costMicroUsd, result.costMicroUsd);
  const sent = JSON.stringify(wireRequests);
  assert.ok(!sent.includes('Alex Example') && !sent.includes('alex@example.invalid'));
  assert.ok(!sent.includes('Built an internal task tracking application'));
  assert.ok(!JSON.stringify(events).includes('offline-key-not-a-secret'));
  assert.ok(events.some(event => event.code === 'TOOL_FILL_FIELDS'));
});
