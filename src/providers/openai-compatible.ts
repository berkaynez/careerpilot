import { z } from 'zod';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm.js';
import { ProviderError, validateModelConfig } from '../llm.js';
import type { ProviderErrorCode } from '../llm.js';

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;
const countSchema = z.object({ input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const responseSchema = z.object({
  status: z.string(),
  usage: z.object({ input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }),
  output: z.array(z.object({ type: z.string(), call_id: z.string().optional(), name: z.string().optional(), arguments: z.string().optional() })),
});

/** Responses-compatible API only; no SDK retries, redirects, storage, or fallback. */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = 'openai-compatible';
  private readonly base: string;
  constructor(private readonly apiKey: string, baseUrl = 'https://api.openai.com/v1', private readonly transport: HttpTransport = fetch) {
    const url = new URL(baseUrl);
    if (!apiKey.trim() || url.username || url.password || url.search || url.hash
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('PROVIDER_CONFIGURATION_INVALID');
    this.base = url.href.replace(/\/$/, '');
  }

  async generate(request: LLMRequest, signal: AbortSignal): Promise<LLMResponse> {
    validateModelConfig(request.config);
    const input = request.messages.flatMap<Record<string, unknown>>(message => {
      if (message.role === 'assistant') return message.calls.map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }));
      if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.callId, output: message.content }];
      return [{ role: message.role, content: message.content }];
    });
    const tools = request.tools.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: true }));
    const common = { model: request.config.model, input, tools };
    const post = async (path: string, body: unknown, stage: ProviderError['stage']): Promise<unknown> => {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
      try {
        requestSignal.throwIfAborted();
        const response = await this.transport(`${this.base}${path}`, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: requestSignal });
        if (!response.ok) {
          const status = response.status;
          const code: ProviderErrorCode = status === 401 ? 'PROVIDER_AUTHENTICATION_ERROR'
            : status === 403 ? 'PROVIDER_PERMISSION_ERROR' : status === 404 ? 'PROVIDER_NOT_FOUND'
              : status === 400 || status === 422 ? 'PROVIDER_INVALID_REQUEST'
                : status === 429 ? 'PROVIDER_RATE_OR_QUOTA_LIMIT' : status === 408 ? 'PROVIDER_TIMEOUT'
                  : status >= 500 ? 'PROVIDER_SERVER_ERROR' : 'PROVIDER_HTTP_ERROR';
          // Do not read error bodies: they may echo credentials or candidate data.
          throw new ProviderError(code, stage, status);
        }
        const text = await response.text();
        if (Buffer.byteLength(text) > 1_000_000) throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', stage);
        try { return JSON.parse(text); } catch { throw new ProviderError('PROVIDER_INVALID_JSON', stage); }
      } catch (error) {
        if (signal.aborted) throw new ProviderError('PROVIDER_ABORTED', stage);
        if (error instanceof ProviderError) throw error;
        const timeout = (requestSignal.aborted && requestSignal.reason instanceof DOMException && requestSignal.reason.name === 'TimeoutError')
          || (error instanceof DOMException && error.name === 'TimeoutError');
        throw new ProviderError(timeout ? 'PROVIDER_TIMEOUT' : error instanceof DOMException && error.name === 'AbortError'
          ? 'PROVIDER_ABORTED' : 'PROVIDER_NETWORK_ERROR', stage);
      }
    };
    // Count the exact input + tool schemas before enabling generation. Compatible
    // services without this endpoint fail closed rather than guessing a tokenizer.
    const count = countSchema.safeParse(await post('/responses/input_tokens', common, 'preflight'));
    if (!count.success) throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'preflight');
    if (count.data.input_tokens > request.config.maxInputTokens) throw new ProviderError('PROVIDER_INPUT_LIMIT', 'preflight');
    const parsed = responseSchema.safeParse(await post('/responses', { ...common, store: false,
      tool_choice: 'required', parallel_tool_calls: false, max_output_tokens: request.config.maxOutputTokens }, 'generation'));
    if (!parsed.success) throw new ProviderError('PROVIDER_INVALID_RESPONSE', 'generation');
    const response = parsed.data;
    const calls = response.status === 'completed' ? response.output.filter(item => item.type === 'function_call').map(item => {
      let args: unknown = null;
      try { args = JSON.parse(item.arguments ?? 'null'); } catch { /* Runtime policy validator handles malformed arguments. */ }
      return { id: item.call_id ?? '', name: item.name ?? '', arguments: args };
    }) : [];
    return { calls, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }, usageSource: 'provider' };
  }
}
