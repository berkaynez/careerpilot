import type { TokenUsage, TokenPricing } from './budget.js';
import { estimateCost } from './budget.js';

export interface ModelConfig {
  provider: string;
  model: string | null;
  execution: 'local' | 'cloud';
  maxInputTokens: number;
  maxOutputTokens: number;
  pricing: TokenPricing | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

/** Arguments remain unknown until a deterministic tool validator accepts them. */
export interface ToolCall { id: string; name: string; arguments: unknown }
export type LLMMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; calls: readonly ToolCall[] }
  | { role: 'tool'; callId: string; content: string };

export interface LLMRequest {
  config: ModelConfig;
  messages: readonly LLMMessage[];
  tools: readonly ToolDefinition[];
}

export interface LLMResponse {
  calls: readonly ToolCall[];
  usage: TokenUsage;
  usageSource: 'provider' | 'conservative-estimate';
}

/** OpenAI and Ollama adapters will implement this; no networking in Phase 1. */
export interface LLMProvider {
  readonly id: string;
  generate(request: LLMRequest, signal: AbortSignal): Promise<LLMResponse>;
}

export interface DecisionValidator<T> { parse(input: unknown): T }

export const modelConfigurations: Readonly<Record<'openai' | 'ollama', ModelConfig>> = {
  openai: {
    provider: 'openai', model: null, execution: 'cloud',
    maxInputTokens: 4_000, maxOutputTokens: 800, pricing: null,
  },
  ollama: {
    provider: 'ollama', model: null, execution: 'local',
    maxInputTokens: 4_000, maxOutputTokens: 800, pricing: null,
  },
};

export function validateModelConfig(config: ModelConfig): void {
  if (!config.provider.trim() || !config.model?.trim()) throw new Error('Explicit provider and model required');
  if (![config.maxInputTokens, config.maxOutputTokens].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Positive token limits required');
  }
  if (config.execution === 'cloud' && !config.pricing) throw new Error('Verified cloud pricing required');
  if (!['local', 'cloud'].includes(config.execution)) throw new Error('Invalid execution mode');
  if (config.pricing) estimateCost({ inputTokens: 0, outputTokens: 0 }, config.pricing);
}
