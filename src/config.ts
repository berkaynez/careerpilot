import { resolve } from 'node:path';
import type { ModelConfig } from './llm.js';

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) throw new Error(`CONFIG_${key}_REQUIRED`);
  return value;
};

/** Decimal USD to integer micro-USD, without binary floating-point rounding. */
export function parseMicroUsd(value: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('CONFIG_INVALID_USD_AMOUNT');
  const [whole = '', fraction = ''] = value.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('CONFIG_INVALID_USD_AMOUNT');
  return Number(result);
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.CAREERPILOT_ENABLE_PAID_CALLS !== 'true') throw new Error('CONFIG_PAID_CALLS_NOT_ENABLED');
  if (env.MODEL_PRICING_VERIFIED !== 'true') throw new Error('CONFIG_VERIFIED_PRICING_REQUIRED');
  const verifiedOn = required(env, 'MODEL_PRICING_VERIFIED_ON');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn) || Number.isNaN(Date.parse(verifiedOn))
    || new Date(verifiedOn).toISOString().slice(0, 10) !== verifiedOn || verifiedOn > new Date().toISOString().slice(0, 10)) throw new Error('CONFIG_PRICING_DATE_INVALID');
  const source = required(env, 'MODEL_PRICING_SOURCE');
  const sourceUrl = new URL(source);
  if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password || sourceUrl.search || sourceUrl.hash) throw new Error('CONFIG_PRICING_SOURCE_INVALID');
  const number = (key: string, fallback: number, ceiling: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) throw new Error(`CONFIG_${key}_INVALID`);
    return value;
  };
  const limitMicroUsd = parseMicroUsd(env.MONTHLY_BUDGET_USD ?? '5');
  if (limitMicroUsd <= 0 || limitMicroUsd > 8_000_000) throw new Error('CONFIG_MONTHLY_BUDGET_INVALID');
  const runLimitMicroUsd = parseMicroUsd(env.PER_RUN_BUDGET_USD ?? '0.10');
  if (runLimitMicroUsd <= 0) throw new Error('CONFIG_PER_RUN_BUDGET_INVALID');
  const model: ModelConfig = {
    provider: 'openai-compatible', model: required(env, 'OPENAI_MODEL'), execution: 'cloud',
    maxInputTokens: number('MAX_INPUT_TOKENS', 12_000, 32_000),
    maxOutputTokens: number('MAX_OUTPUT_TOKENS', 2_000, 8_000),
    pricing: {
      inputMicroUsdPerMillion: parseMicroUsd(required(env, 'MODEL_INPUT_USD_PER_MILLION')),
      outputMicroUsdPerMillion: parseMicroUsd(required(env, 'MODEL_OUTPUT_USD_PER_MILLION')),
      source, verifiedOn,
    },
  };
  if (!model.pricing || model.pricing.inputMicroUsdPerMillion <= 0 || model.pricing.outputMicroUsdPerMillion <= 0) throw new Error('CONFIG_POSITIVE_CLOUD_PRICING_REQUIRED');
  return {
    model, limitMicroUsd, runLimitMicroUsd, apiKey: required(env, 'OPENAI_API_KEY'),
    baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    stateDir: resolve(env.CAREERPILOT_STATE_DIR ?? '.careerpilot'),
    maxRunMs: number('MAX_RUN_MS', 120_000, 600_000),
    maxActions: number('MAX_ACTIONS', 40, 60),
    headless: env.HEADLESS !== 'false',
    consent: { 'application.accuracy': env.MOCK_CONSENT_ACCURACY === 'true', 'application.submit': env.MOCK_CONSENT_SUBMIT === 'true' },
  };
}
