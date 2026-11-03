import type { AiStatus } from '@codedna/shared';
import type { AiProvider } from '@codedna/core/ai-grounding';

/** Server-only. Credentials come from the environment and never reach a client bundle. */
export interface AiConfig {
  provider: 'anthropic' | 'openai-compatible';
  model: string;
  baseUrl: string;
  apiKey?: string;
  external: boolean;
}
type Env = Record<string, string | undefined>;
const isLocal = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);

export function readAiConfig(env: Env = process.env): { config?: AiConfig; status: AiStatus } {
  const off = (reason: string, enabled = true): { status: AiStatus } => ({ status: { configured: false, enabled, external: false, reason } });
  if (env.CODEDNA_AI_DISABLED === '1') return off('AI explanations are disabled.', false);
  const provider = env.CODEDNA_AI_PROVIDER;
  if (!provider) return off('No AI provider is configured.');
  if (provider !== 'anthropic' && provider !== 'openai-compatible') return off('The configured AI provider is not supported.');
  if (env.NODE_ENV === 'production' && env.CODEDNA_AI_ALLOW_PRODUCTION !== '1') return off('AI explanations are not enabled for public deployment.');
  const model = env.CODEDNA_AI_MODEL?.trim();
  if (!model) return off('CODEDNA_AI_MODEL is not set.');
  const raw = env.CODEDNA_AI_BASE_URL?.trim() || (provider === 'anthropic' ? 'https://api.anthropic.com' : '');
  let url: URL;
  try { url = new URL(raw); } catch { return off('CODEDNA_AI_BASE_URL is missing or invalid.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) return off('The AI endpoint must use HTTPS unless it is local.');
  const external = !isLocal(url.hostname);
  const apiKey = env.CODEDNA_AI_API_KEY?.trim();
  if (!apiKey && (external || provider === 'anthropic')) return off('CODEDNA_AI_API_KEY is not set.');
  const config: AiConfig = { provider, model, baseUrl: url.toString().replace(/\/+$/, ''), ...(apiKey ? { apiKey } : {}), external };
  return { config, status: { configured: true, enabled: true, external, provider, model } };
}

export class AiProviderError extends Error {
  constructor(readonly code: 'rate_limited' | 'timeout' | 'provider_error', message: string) { super(message); }
}
const TIMEOUT_MS = 25_000;
async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    if (response.status === 429) throw new AiProviderError('rate_limited', 'The AI provider is rate limiting requests.');
    if (!response.ok) throw new AiProviderError('provider_error', `The AI provider returned status ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError('timeout', 'The AI provider timed out.');
    throw new AiProviderError('provider_error', 'The AI provider could not be reached.');
  } finally { clearTimeout(timer); }
}
export function createAiProvider(config: AiConfig): AiProvider {
  const key = config.apiKey;
  if (config.provider === 'anthropic') {
    return {
      id: 'anthropic', model: config.model,
      async complete({ system, user, maxTokens, signal }) {
        const data = (await post(`${config.baseUrl}/v1/messages`, { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' }, { model: config.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, signal)) as { content?: { type?: string; text?: string }[] };
        const text = data.content?.find((part) => part.type === 'text')?.text;
        if (typeof text !== 'string') throw new AiProviderError('provider_error', 'The AI provider returned an unexpected response.');
        return text;
      },
    };
  }
  return {
    id: 'openai-compatible', model: config.model,
    async complete({ system, user, maxTokens, signal }) {
      const data = (await post(`${config.baseUrl}/chat/completions`, key ? { authorization: `Bearer ${key}` } : {}, { model: config.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, signal)) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new AiProviderError('provider_error', 'The AI provider returned an unexpected response.');
      return text;
    },
  };
}
