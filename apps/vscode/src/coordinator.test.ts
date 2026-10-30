import { describe, expect, it, vi } from 'vitest';
import { AnalysisCoordinator } from './coordinator.js';
describe('analysis coordinator', () => {
  it('caches per workspace, refreshes and invalidates', async () => {
    const load = vi.fn(async (key: string) => ({
        snapshot: { revision: key },
      })),
      run = vi.fn(
        async (s: { snapshot: { revision: string } }) => s.snapshot.revision,
      );
    const c = new AnalysisCoordinator(load, run);
    await c.run('one');
    await c.run('one');
    await c.run('two');
    expect(run).toHaveBeenCalledTimes(2);
    c.invalidate('one');
    await c.run('one');
    await c.run('one', true);
    expect(run).toHaveBeenCalledTimes(4);
  });
  it('rejects stale work immediately after invalidation', async () => {
    let resolve!: (s: { snapshot: { revision: string } }) => void;
    const c = new AnalysisCoordinator(
      () =>
        new Promise<{ snapshot: { revision: string } }>((r) => {
          resolve = r;
        }),
      async () => 42,
    );
    const pending = c.run('one');
    c.invalidate('one');
    await expect(pending).rejects.toThrow('cancelled');
    resolve({ snapshot: { revision: 'old' } });
  });
  it('does not cancel a different workspace when invalidating cached data', async () => {
    let resolve!: (s: { snapshot: { revision: string } }) => void;
    const c = new AnalysisCoordinator(
      () =>
        new Promise<{ snapshot: { revision: string } }>((r) => {
          resolve = r;
        }),
      async () => 42,
    );
    const pending = c.run('one');
    c.invalidate('two');
    resolve({ snapshot: { revision: 'new' } });
    expect((await pending).value).toBe(42);
  });
  it('bounds the cache and evicts least recently used workspaces', async () => {
    const run = vi.fn(
      async (s: { snapshot: { revision: string } }) => s.snapshot.revision,
    );
    const c = new AnalysisCoordinator(
      async (key: string) => ({ snapshot: { revision: key } }),
      run,
    );
    await c.run('one');
    await c.run('two');
    await c.run('three');
    await c.run('one');
    await c.run('four');
    await c.run('two');
    expect(run).toHaveBeenCalledTimes(5);
  });

  it('cancels in-flight work when switching to a cached workspace', async () => {
    let resolve!: (s: { snapshot: { revision: string } }) => void;
    const c = new AnalysisCoordinator(
      (key: string) =>
        key === 'cached'
          ? Promise.resolve({ snapshot: { revision: key } })
          : new Promise<{ snapshot: { revision: string } }>((r) => {
              resolve = r;
            }),
      async (s) => s.snapshot.revision,
    );
    await c.run('cached');
    const pending = c.run('other');
    expect((await c.run('cached')).value).toBe('cached');
    await expect(pending).rejects.toThrow('cancelled');
    resolve({ snapshot: { revision: 'old' } });
  });
});
