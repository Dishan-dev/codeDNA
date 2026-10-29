import { describe, expect, it, vi } from 'vitest';
import { AcquisitionError } from '@codedna/github';
import { POST } from './route';
vi.mock('@codedna/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codedna/github')>();
  return {
    ...actual,
    acquireRepository: vi.fn(async () => {
      throw new actual.AcquisitionError(
        'rate_limited',
        'GitHub rate limit reached. Try again later.',
      );
    }),
  };
});
describe('acquisition endpoint', () => {
  it('rejects malformed requests without caching', async () => {
    const response = await POST(
      new Request('http://localhost/api/repositories/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"url":3}',
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('maps adapter errors to safe public responses', async () => {
    expect(AcquisitionError).toBeDefined();
    const response = await POST(
      new Request('http://localhost/api/repositories/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/a/b' }),
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: {
        code: 'rate_limited',
        message: 'GitHub rate limit reached. Try again later.',
      },
    });
  });
});
