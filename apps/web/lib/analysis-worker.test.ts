import { describe, expect, it } from 'vitest';
import { runAnalysisWorker } from './analysis-worker';
const snapshot = {
  schemaVersion: '1.0' as const,
  id: 'test',
  files: [
    {
      id: 'app/page.tsx',
      path: 'app/page.tsx',
      content: 'export default function Page(){return null}',
    },
  ],
};
describe('server analysis worker', () => {
  it('produces isolated dependency and UI-flow results', async () => {
    const value = await runAnalysisWorker(
      snapshot,
      new AbortController().signal,
    );
    expect(value.analysis.snapshotId).toBe('test');
    expect(value.uiFlow.graph.nodes[0]?.routePath).toBe('/');
  });
  it('aborts promptly and does not return a stale result', async () => {
    const controller = new AbortController();
    const result = runAnalysisWorker(snapshot, controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
  });
  it('enforces an analysis deadline', async () => {
    await expect(
      runAnalysisWorker(snapshot, new AbortController().signal, {
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
  it('isolates simultaneous snapshots', async () => {
    const other = {
      ...snapshot,
      id: 'other',
      files: [
        {
          id: 'src/other.ts',
          path: 'src/other.ts',
          content: 'export const other = 1;',
        },
      ],
    };
    const [a, b] = await Promise.all([
      runAnalysisWorker(snapshot, new AbortController().signal),
      runAnalysisWorker(other, new AbortController().signal),
    ]);
    expect(a.analysis.snapshotId).toBe('test');
    expect(b.analysis.snapshotId).toBe('other');
    expect(
      b.analysis.dependencyGraph.nodes.some(
        (node) => node.label === 'app/page.tsx',
      ),
    ).toBe(false);
  });
});
