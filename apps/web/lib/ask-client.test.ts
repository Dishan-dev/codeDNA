import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAiAnswer } from './ask-client';

const bundle = { schemaVersion: '1.0' as const, query: {}, items: [], truncated: false };
afterEach(() => vi.unstubAllGlobals());

describe('AI client boundaries', () => {
  it('never contacts the server without consent', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await requestAiAnswer('q', bundle, [], false)).toMatchObject({ ok: false, code: 'consent_required' });
    expect(spy).not.toHaveBeenCalled();
  });
  it('turns provider errors and network failures into non-throwing results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'rate_limited', message: 'Slow down' } }, { status: 429 })));
    expect(await requestAiAnswer('q', bundle, [], true)).toEqual({ ok: false, code: 'rate_limited', message: 'Slow down' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await requestAiAnswer('q', bundle, [], true)).toMatchObject({ ok: false, code: 'provider_error' });
  });
  it('sends only the evidence items, the question and consent', async () => {
    const spy = vi.fn(async () => Response.json({ answer: { text: 'x' } }));
    vi.stubGlobal('fetch', spy);
    await requestAiAnswer('q', { ...bundle, items: [] }, [{ id: 'b', title: 'T' }], true);
    const call = spy.mock.calls[0] as unknown as [string, { body: string }];
    expect(Object.keys(JSON.parse(call[1].body)).sort()).toEqual(['behaviors', 'bundle', 'consent', 'question']);
  });
});
