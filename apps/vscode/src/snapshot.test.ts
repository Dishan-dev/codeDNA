import { describe, expect, it } from 'vitest';
import {
  acquireSnapshot,
  acquireWithDeadline,
  normalizeRelative,
  supportedPath,
  type SnapshotProvider,
} from './snapshot.js';
const bytes = (s: string) => new TextEncoder().encode(s);
function provider(
  data: Record<string, string>,
  unsafe: string[] = [],
): SnapshotProvider {
  return {
    async list() {
      return { paths: Object.keys(data), limited: false };
    },
    async safe(path) {
      return !unsafe.includes(path);
    },
    async read(path) {
      if (data[path] === undefined) throw new Error('missing');
      return bytes(data[path]!);
    },
  };
}
const signal = () => new AbortController().signal;
describe('local workspace snapshots', () => {
  it('normalizes paths and rejects traversal, absolute and Windows paths', () => {
    expect(normalizeRelative('src/./a.ts')).toBe('src/a.ts');
    for (const path of ['../a.ts', '/a.ts', 'C:/a.ts', 'a\\b.ts', 'a/../b.ts'])
      expect(normalizeRelative(path)).toBeNull();
  });
  it('excludes generated, dependency and unsupported files', () => {
    for (const path of [
      'node_modules/a.ts',
      '.git/a.js',
      'build/a.ts',
      '.expo/a.ts',
      'a.min.js',
      'README.md',
    ])
      expect(supportedPath(path)).toBe(false);
    expect(supportedPath('src/a.tsx')).toBe(true);
    expect(supportedPath('tsconfig.json')).toBe(true);
  });
  it('builds sorted snapshots and skips symlinks and failed reads explicitly', async () => {
    const input = provider(
      { 'z.ts': 'z', 'a.ts': 'a', 'node_modules/x.ts': 'x', 'linked.ts': 's' },
      ['linked.ts'],
    );
    const old = input.read;
    input.read = async (path, s) => {
      if (path === 'z.ts') throw new Error('unreadable');
      return old(path, s);
    };
    const out = await acquireSnapshot(input, 'repo', signal());
    expect(out.snapshot.files.map((f) => f.path)).toEqual(['a.ts']);
    expect(out.complete).toBe(false);
    expect(out.diagnostics).toHaveLength(2);
  });
  it('applies file count and content limits', async () => {
    const out = await acquireSnapshot(
      provider({ 'a.ts': '123', 'b.ts': '1234', 'c.ts': '123' }),
      'repo',
      signal(),
      { maxFiles: 1, maxFileBytes: 3, maxTotalBytes: 4, maxTimeMs: 1000 },
    );
    expect(out.snapshot.files).toHaveLength(1);
    expect(out.complete).toBe(false);
    const size = await acquireSnapshot(
      provider({ 'a.ts': '1234' }),
      'repo',
      signal(),
      { maxFiles: 5, maxFileBytes: 3, maxTotalBytes: 4, maxTimeMs: 1000 },
    );
    expect(size.snapshot.files).toHaveLength(0);
    expect(size.complete).toBe(false);
  });
  it('handles cancellation and revision isolation', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      acquireSnapshot(provider({ 'a.ts': 'a' }), 'repo', abort.signal),
    ).rejects.toThrow('cancelled');
    const a = await acquireSnapshot(provider({ 'a.ts': 'a' }), 'one', signal());
    const b = await acquireSnapshot(provider({ 'a.ts': 'b' }), 'one', signal());
    const other = await acquireSnapshot(
      provider({ 'a.ts': 'a' }),
      'two',
      signal(),
    );
    expect(a.snapshot.revision).not.toBe(b.snapshot.revision);
    expect(a.snapshot.id).not.toBe(other.snapshot.id);
  });
  it('times out even when a provider call never completes', async () => {
    const stalled = provider({});
    stalled.list = () => new Promise(() => {});
    await expect(
      acquireWithDeadline(stalled, 'repo', signal(), {
        maxFiles: 1,
        maxFileBytes: 1,
        maxTotalBytes: 1,
        maxTimeMs: 5,
      }),
    ).rejects.toThrow('timed out');
  });
  it('accepts at least 500 source files', async () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < 500; i++) data[`src/f${i}.ts`] = 'export const x=1';
    const out = await acquireSnapshot(provider(data), 'repo', signal());
    expect(out.snapshot.files).toHaveLength(500);
    expect(out.complete).toBe(true);
  });
});
