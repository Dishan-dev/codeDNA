import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';
describe('liveness', () => {
  it('reports production demo mode without caching', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const response = GET();
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        status: 'ok',
        mode: 'demo-only',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
