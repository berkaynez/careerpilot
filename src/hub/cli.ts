import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readLocalJSON } from '../preparation/files.js';
import { profileSchema } from '../preparation/core.js';
import { preparePostingWithModel } from '../preparation/posting.js';
import { loadAgentConfig } from '../config.js';
import { FileBudgetManager } from '../persistent-budget.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { startHub } from './server.js';
import type { HubAnalyzer } from './server.js';
import { demoProfile, demoRecords } from './demo.js';

async function main() {
  const { values } = parseArgs({ strict: true, options: { demo: { type: 'boolean' }, profile: { type: 'string' },
    'enable-model': { type: 'boolean' }, port: { type: 'string', default: '3210' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('npm run hub -- [--demo] [--profile <özel-profil.json>] [--port 3210] [--enable-model]\nÖrnek mod tamamen kurgusaldır. Model varsayılan olarak kapalıdır; etkinleştirilse bile her analiz panelde ayrıca onay ister.'); return; }
  if (values.demo && (values.profile || values['enable-model'])) throw new Error('HUB_DEMO_FLAGS_INVALID');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('HUB_PORT_INVALID');
  if (values['enable-model']) {
    try { process.loadEnvFile(resolve('.env')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const state = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot');
  const profile = values.demo ? demoProfile : profileSchema.parse(await readLocalJSON(resolve(values.profile ?? '.careerpilot/profile.json')));
  let analyze: HubAnalyzer | undefined;
  let modelInfo: { name: string; destination: string; monthlyLimitUsd: number; perRunLimitUsd: number } | undefined;
  if (values['enable-model']) {
    const config = loadAgentConfig(), provider = new OpenAICompatibleProvider(config.apiKey, config.baseUrl);
    const budget = new FileBudgetManager(join(config.stateDir, 'budget.jsonl'), config.limitMicroUsd, undefined, config.runLimitMicroUsd);
    modelInfo = { name: config.model.model ?? 'Belirtilmemiş', destination: new URL(config.baseUrl).origin, monthlyLimitUsd: config.limitMicroUsd / 1_000_000, perRunLimitUsd: config.runLimitMicroUsd / 1_000_000 };
    analyze = async (posting, signal) => {
      const runId = randomUUID();
      const result = await preparePostingWithModel(profile, posting, { runId, provider, model: config.model, budget,
        paidCallApproved: true, cloudProfileApproved: true }, AbortSignal.any([signal, AbortSignal.timeout(config.maxRunMs)]));
      return { ...result, costMicroUsd: budget.runAccounting(runId).costMicroUsd };
    };
  }
  const hub = await startHub({ directory: join(state, values.demo ? 'hub-demo' : 'hub', 'jobs'), profile, port,
    ...(analyze ? { analyze } : {}), ...(modelInfo ? { modelInfo } : {}), ...(values.demo ? { demo: true, seed: demoRecords() } : {}) });
  console.log('CareerPilot paneli: ' + hub.origin + (values.demo ? ' — kurgusal örnek modu' : ' — yerel kayıtlar'));
  console.log('Model ' + (analyze ? 'hazır; her çağrı panelden ayrıca onaylanmalı.' : 'kapalı. İlan kaydı ve analiz içe aktarma ücretsizdir.'));
  let closing = false;
  const stop = () => { if (!closing) { closing = true; void hub.close().catch(() => { process.exitCode = 1; }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
void main().catch(error => {
  const code = error instanceof Error && /^(HUB|CONFIG|PREP)_[A-Z_]+$/.test(error.message) ? error.message : 'HUB_START_FAILED';
  console.error(code + ': Panel açılamadı; profil dosyasını, portu ve seçtiysen model ayarlarını kontrol et.'); process.exitCode = 1;
});
