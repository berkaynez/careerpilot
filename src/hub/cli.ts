import { openSourceSearch } from '../discovery/search-provider.js';
import { resolve, join } from 'node:path';
import { access } from 'node:fs/promises';
import { assistAnswersSchema } from '../applications/fields.js';
import { startMockServer } from '../mocks/server.js';
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
    answers: { type: 'string' }, 'enable-search': { type: 'boolean' }, 'enable-model': { type: 'boolean' }, port: { type: 'string', default: '3210' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('npm run hub -- [--demo] [--profile <özel-profil.json>] [--port 3210] [--enable-model] [--enable-search]\nÖrnek mod tamamen kurgusaldır. Model varsayılan olarak kapalıdır; etkinleştirilse bile her analiz panelde ayrıca onay ister.'); return; }
  if (values.demo && (values.profile || values.answers || values['enable-model'] || values['enable-search'])) throw new Error('HUB_DEMO_FLAGS_INVALID');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('HUB_PORT_INVALID');
  if (values['enable-model'] || values['enable-search']) {
    try { process.loadEnvFile(resolve('.env')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const state = resolve(process.env.CAREERPILOT_STATE_DIR ?? '.careerpilot');
  const profile = values.demo ? demoProfile : profileSchema.parse(await readLocalJSON(resolve(values.profile ?? '.careerpilot/profile.json')));
  const sourceSearch = values['enable-search'] ? await openSourceSearch(join(state, 'hub'), process.env.SERPAPI_API_KEY ?? '') : undefined;
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
  let answers = values.demo ? assistAnswersSchema.parse({ firstName: 'Örnek', lastName: 'Aday' }) : assistAnswersSchema.parse({});
  if (!values.demo) {
    const answerPath = resolve(values.answers ?? '.careerpilot/lever-answers.json');
    let exists = false; try { await access(answerPath); exists = true; } catch { if (values.answers) throw new Error('ASSIST_ANSWERS_UNAVAILABLE'); }
    if (exists) answers = assistAnswersSchema.parse(await readLocalJSON(answerPath));
  }
  const mock = values.demo ? await startMockServer() : undefined;
  let hub;
  try { hub = await startHub({ directory: join(state, values.demo ? 'hub-demo' : 'hub', 'jobs'), profile, port,
    answers, ...(sourceSearch ? { sourceSearch } : {}), ...(mock ? { demoFormUrl: mock.origin + '/applications/single' } : {}),
    ...(analyze ? { analyze } : {}), ...(modelInfo ? { modelInfo } : {}), ...(values.demo ? { demo: true, seed: demoRecords() } : {}) });
  } catch (error) { await mock?.close(); throw error; }
  console.log('CareerPilot paneli: ' + hub.origin + (values.demo ? ' — kurgusal örnek modu' : ' — yerel kayıtlar'));
  console.log('Model ' + (analyze ? 'hazır; her çağrı panelden ayrıca onaylanmalı.' : 'kapalı. İlan kaydı ve analiz içe aktarma ücretsizdir.'));
  console.log('Kaynak araması ' + (sourceSearch ? 'hazır; her arama panelden kriter paylaşımı ve ücretsiz kota onayı ister.' : 'kapalı.'));
  console.log('Bu terminal açık kaldığı sürece panel çalışır. Durdurmak için Ctrl+C; yeniden açmak için npm start.');
  let closing = false;
  const stop = () => { if (!closing) { closing = true; void hub.close().then(() => mock?.close()).catch(() => { process.exitCode = 1; }); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
void main().catch(error => {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error('Panel portu kullanımda. Açık CareerPilot terminalini kontrol et; ikinci kopyayı başlatma. Farklı port için npm run hub -- --port 3212 --enable-search --enable-model kullan.');
    process.exitCode = 1; return;
  }
  const code = error instanceof Error && /^(HUB|CONFIG|PREP|ASSIST|DISCOVERY)_[A-Z_]+$/.test(error.message) ? error.message : 'HUB_START_FAILED';
  console.error(code + ': Panel açılamadı; profil dosyasını, portu ve seçtiysen model/arama ayarlarını kontrol et.'); process.exitCode = 1;
});
