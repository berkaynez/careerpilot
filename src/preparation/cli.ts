import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { profileSchema, jobSchema, planWithModel } from './core.js';
import { readLocalJSON, writePreparation } from './files.js';
import { loadAgentConfig } from '../config.js';
import { FileBudgetManager } from '../persistent-budget.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, job: { type: 'string' }, review: { type: 'string' },
    model: { type: 'boolean' }, 'approve-paid-call': { type: 'boolean' }, 'approve-cloud-profile': { type: 'boolean' } }, strict: true });
  if (!values.profile || !values.job || Boolean(values.review) === Boolean(values.model)) throw new Error('PREP_ARGUMENTS_INVALID');
  const profile = profileSchema.parse(await readLocalJSON(resolve(values.profile)));
  const job = jobSchema.parse(await readLocalJSON(resolve(values.job)));
  const runId = randomUUID();
  const stateDir = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot');
  let plan: unknown;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    if (values.model) {
      // Existing .env opt-ins alone cannot authorise a new real-profile cloud request.
      if (!values['approve-paid-call'] || !values['approve-cloud-profile']) throw new Error('PREP_MODEL_CONSENT_REQUIRED');
      const config = loadAgentConfig();
      plan = await planWithModel(profile, job, { runId, model: config.model,
        provider: new OpenAICompatibleProvider(config.apiKey, config.baseUrl),
        budget: new FileBudgetManager(join(config.stateDir, 'budget.jsonl'), config.limitMicroUsd, undefined, config.runLimitMicroUsd),
        paidCallApproved: true, cloudProfileApproved: true }, AbortSignal.any([controller.signal, AbortSignal.timeout(config.maxRunMs)]));
    } else {
      plan = await readLocalJSON(resolve(values.review!));
    }
    controller.signal.throwIfAborted();
    const parent = join(stateDir, 'prepared');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const result = await writePreparation(join(parent, runId), profile, job, plan, values.model ? 'model' : 'local_review');
    console.log(JSON.stringify(result, null, 2));
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
void main().catch(error => {
  const code = error instanceof Error && /^(PREP|CONFIG|BUDGET|PROVIDER)_[A-Z_]+$/.test(error.message) ? error.message : 'PREP_FAILED';
  console.error(JSON.stringify({ code })); process.exitCode = 1;
});
