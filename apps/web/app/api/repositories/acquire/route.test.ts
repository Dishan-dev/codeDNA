import { describe, expect, it, vi } from 'vitest';
import { AcquisitionError, acquireRepository } from '@codedna/github';
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
  it('returns both analyses for the same acquired snapshot', async () => {
    const snapshot = {
      schemaVersion: '1.0' as const,
      id: 'repo@revision',
      revision: 'revision',
      files: [
        {
          id: 'app/page.tsx',
          path: 'app/page.tsx',
          content: 'export default function Page(){return null}',
        },
      ],
    };
    vi.mocked(acquireRepository).mockResolvedValueOnce({
      repository: { owner: 'a', repo: 'b', url: 'https://github.com/a/b' },
      commitSha: 'revision',
      snapshot,
      diagnostics: [],
      completeness: { complete: true, skippedFiles: 0 },
    });
    const response = await POST(
      new Request('http://localhost/api/repositories/acquire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://github.com/a/b' }),
      }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.analysis.snapshotId).toBe(snapshot.id);
    expect(body.uiFlow.graph.nodes[0].routePath).toBe('/');
    expect(body.snapshot).toEqual(snapshot);
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
