import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { GET } from '../status/route';

const item = { id: 'ev:source:a.ts:1-1', kind: 'source', title: 't', path: 'a.ts', excerpt: 'export function a() {}', origin: 'source' };
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/ai/explain', { method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', ...headers }, body: JSON.stringify(body) });
const good = { question: 'How?', consent: true, bundle: { items: [item] }, behaviors: [] };
const configure = () => {
  vi.stubEnv('CODEDNA_AI_PROVIDER', 'openai-compatible');
  vi.stubEnv('CODEDNA_AI_MODEL', 'm');
  vi.stubEnv('CODEDNA_AI_BASE_URL', 'http://localhost:11434/v1');
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('AI endpoints', () => {
  it('reports unavailable without leaking configuration, and never calls out', async () => {
    vi.stubEnv('CODEDNA_AI_PROVIDER', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await (await GET()).json()).toMatchObject({ configured: false });
    const response = await POST(request(good));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('can be disabled and is off in production unless explicitly allowed', async () => {
    configure();
    vi.stubEnv('CODEDNA_AI_DISABLED', '1');
    expect((await (await GET()).json()).enabled).toBe(false);
    vi.stubEnv('CODEDNA_AI_DISABLED', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request(good))).status).toBe(503);
  });
  it('requires explicit consent before contacting the provider', async () => {
    configure();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await POST(request({ ...good, consent: 'yes' }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('consent_required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects cross-origin, oversize and malformed requests', async () => {
    configure();
    expect((await POST(request(good, { origin: 'http://evil.example' }))).status).toBe(403);
    expect((await POST(request({ ...good, bundle: { items: [{ ...item, excerpt: 'x'.repeat(5000) }] } }))).status).toBe(400);
    expect((await POST(request({ ...good, bundle: { items: [] } }))).status).toBe(400);
  });
  it('returns a grounded, qualified answer and rejects uncited output', async () => {
    configure();
    const reply = (content: string) => vi.fn(async () => Response.json({ choices: [{ message: { content } }] }));
    vi.stubGlobal('fetch', reply(JSON.stringify({ explanation: 'a is declared.', evidenceIds: [item.id, 'ev:fake'], uncertainty: [], targets: [] })));
    const ok = await POST(request(good));
    expect(ok.status).toBe(200);
    expect((await ok.json()).answer).toMatchObject({ origin: 'ai', certainty: 'inferred', evidenceIds: [item.id] });
    vi.stubGlobal('fetch', reply(JSON.stringify({ explanation: 'x', evidenceIds: ['ev:fake'] })));
    const bad = await POST(request(good));
    expect(bad.status).toBe(502);
    expect((await bad.json()).error.code).toBe('invalid_output');
  });
  it('maps provider rate limits and failures without exposing details', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 429 })));
    expect((await POST(request(good))).status).toBe(429);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret-host'); }));
    const failed = await POST(request(good));
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain('secret-host');
  });
});
