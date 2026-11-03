import type { EvidenceBundle, EvidenceItem } from '@codedna/shared';
import { AI_LIMITS, aiAnswer, buildGroundedPrompt, validateAiResponse } from '@codedna/core/ai-grounding';
import { AiProviderError, createAiProvider, readAiConfig } from '../../../../lib/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY = 96 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const recent: number[] = [];
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const fail = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status, headers });
const KINDS = new Set(['documentation', 'route', 'entry-point', 'symbol', 'reference', 'flow-step', 'source']);

function parseItem(value: unknown): EvidenceItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.path !== 'string' || typeof v.excerpt !== 'string' || typeof v.title !== 'string' || typeof v.kind !== 'string' || !KINDS.has(v.kind)) return undefined;
  if (v.id.length > 300 || v.path.length > 400 || v.excerpt.length > AI_LIMITS.maxExcerpt) return undefined;
  const origin = v.origin === 'documentation' ? 'documentation' : 'source';
  const loc = v.location as { start?: { line?: unknown } } | undefined;
  const line = typeof loc?.start?.line === 'number' ? loc.start.line : undefined;
  return { id: v.id, kind: v.kind as EvidenceItem['kind'], title: v.title.slice(0, 200), path: v.path, excerpt: v.excerpt, origin, ...(line ? { location: { path: v.path, start: { line, column: 1 }, end: { line, column: 1 } } } : {}) };
}

export async function POST(request: Request) {
  const { config, status } = readAiConfig();
  if (!config) return fail('not_configured', status.reason ?? 'AI explanations are not available.', 503);
  const origin = request.headers.get('origin');
  if (origin) {
    let same: boolean;
    try { same = new URL(origin).host === (request.headers.get('host') ?? new URL(request.url).host); } catch { same = false; }
    if (!same) return fail('forbidden', 'Cross-origin requests are not allowed.', 403);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return fail('invalid_request', 'Expected a JSON request.', 415);
  const text = await request.text();
  if (text.length > MAX_BODY) return fail('invalid_request', 'Request is too large.', 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { return fail('invalid_request', 'Malformed JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_request', 'Malformed request.', 400);
  // Repository text only leaves this machine after an explicit, per-request user decision.
  if (body.consent !== true) return fail('consent_required', 'Sending repository excerpts to an AI provider requires your explicit permission.', 403);
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const rawItems = (body.bundle as { items?: unknown } | undefined)?.items;
  if (!question || question.length > AI_LIMITS.maxQuestion || !Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > AI_LIMITS.maxItems) return fail('invalid_request', 'A question and between 1 and 16 evidence items are required.', 400);
  const items = rawItems.map(parseItem);
  if (items.some((item) => !item)) return fail('invalid_request', 'Evidence items are malformed.', 400);
  const bundle: EvidenceBundle = { schemaVersion: '1.0', query: { question }, items: items as EvidenceItem[], truncated: false };
  if (bundle.items.reduce((n, item) => n + item.excerpt.length, 0) > AI_LIMITS.maxTotalChars) return fail('invalid_request', 'Evidence is too large.', 413);
  const behaviors = Array.isArray(body.behaviors)
    ? (body.behaviors as unknown[]).flatMap((b) => { const r = b as { id?: unknown; title?: unknown }; return typeof r?.id === 'string' && typeof r.title === 'string' ? [{ id: r.id.slice(0, 300), title: r.title.slice(0, 200) }] : []; }).slice(0, 40)
    : [];
  const now = Date.now();
  while (recent.length && recent[0]! <= now - RATE_WINDOW_MS) recent.shift();
  if (recent.length >= RATE_LIMIT) return fail('rate_limited', 'Too many AI requests. Try again shortly.', 429);
  recent.push(now);
  try {
    const prompt = buildGroundedPrompt(question, bundle, behaviors);
    const raw = await createAiProvider(config).complete({ ...prompt, maxTokens: 900, signal: request.signal });
    const checked = validateAiResponse(raw, bundle, behaviors.map((b) => b.id));
    if (!checked.ok) return fail('invalid_output', 'The AI response could not be verified against the evidence, so it was discarded.', 502);
    return Response.json({ answer: aiAnswer(question, checked, bundle) }, { headers });
  } catch (error) {
    if (error instanceof AiProviderError) return fail(error.code, error.message, error.code === 'rate_limited' ? 429 : error.code === 'timeout' ? 504 : 502);
    return fail('provider_error', 'The AI provider failed.', 502);
  }
}
