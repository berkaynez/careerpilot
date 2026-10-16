import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadAgentConfig } from './config.js';
import { FileBudgetManager } from './persistent-budget.js';
import { JsonlEventSink } from './events.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { LLMDecisionPolicy } from './agent/decision-policy.js';
import { BrowserAgentRunner } from './agent/runner.js';
import { PlaywrightBrowserExecutor } from './browser/executor.js';
import { startMockServer } from './mocks/server.js';
import { fictionalCandidate as candidate, fictionalPersonalData as personal } from './profile.js';
import { defaultApplicationPolicy } from './policy.js';

async function main(): Promise<void> {
  const config = loadAgentConfig();
  const budget = new FileBudgetManager(join(config.stateDir, 'budget.jsonl'), config.limitMicroUsd, undefined, config.runLimitMicroUsd);
  const provider = new OpenAICompatibleProvider(config.apiKey, config.baseUrl);
  // Own the server: no user-supplied job URL or arbitrary local application target.
  const server = await startMockServer();
  const runId = randomUUID();
  const logPath = join(config.stateDir, 'runs', `${runId}.jsonl`);
  const events = new JsonlEventSink(logPath);
  const policy = { ...defaultApplicationPolicy, allowedOrigin: server.origin, consent: config.consent,
    maxRunMs: config.maxRunMs, maxActions: config.maxActions };
  const applicationUrl = `${server.origin}/applications/single`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  let browser: PlaywrightBrowserExecutor | undefined;
  try {
    console.log(JSON.stringify({ runId, model: config.model.model, applicationUrl, logPath,
      monthlyLimitMicroUsd: config.limitMicroUsd, perRunLimitMicroUsd: config.runLimitMicroUsd }));
    browser = await PlaywrightBrowserExecutor.create({ runId, applicationUrl, candidate, personal, policy, events, headless: config.headless });
    const decisionPolicy = new LLMDecisionPolicy({ runId, provider, model: config.model, budget, personal, events });
    const runner = new BrowserAgentRunner({ browser, policy: decisionPolicy, verifier: server, budget, personal, events });
    const result = await runner.run({ runId, applicationUrl, candidate, policy }, controller.signal);
    console.log(JSON.stringify({ ...result, budget: budget.snapshot(), logPath }, null, 2));
    process.exitCode = result.outcome.status === 'submitted' ? 0 : 1;
  } finally {
    await browser?.close(); await server.close();
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
  }
}

void main().catch(error => {
  const code = error instanceof Error && /^(CONFIG|BUDGET|PROVIDER)_[A-Z_]+$/.test(error.message) ? error.message : 'CLI_FAILED';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
