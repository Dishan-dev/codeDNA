import { describe, expect, it } from 'vitest';
import { routeDependencies } from './route-context.js';
import type { AnalysisResult, UIFlowNode } from '@codedna/shared';
const metadata = { confidence: 1, evidence: [] };
const screen: UIFlowNode = {
  id: 's',
  label: '/',
  sourceFile: 'app/page.tsx',
  metadata,
};
const result: AnalysisResult = {
  schemaVersion: '1.0',
  snapshotId: 's',
  diagnostics: [],
  uiFlowGraph: { schemaVersion: '1.0', nodes: [], edges: [] },
  dependencyGraph: {
    schemaVersion: '1.0',
    nodes: ['app/page.tsx', 'lib/a.ts', 'lib/b.ts'].map((path) => ({
      id: `file:${path}`,
      label: path,
      kind: 'file',
      metadata,
    })),
    edges: [
      {
        id: 'a',
        sourceId: 'file:app/page.tsx',
        targetId: 'file:lib/a.ts',
        metadata,
      },
      {
        id: 'b',
        sourceId: 'file:lib/a.ts',
        targetId: 'file:lib/b.ts',
        metadata,
      },
    ],
  },
};
describe('route source dependencies', () => {
  it('returns bounded real directed edges', () => {
    const context = routeDependencies(screen, result, { maxDepth: 1 });
    expect(context.nodes.map((item) => item.node.label)).toEqual([
      'app/page.tsx',
      'lib/a.ts',
    ]);
    expect(context.edges.map((item) => item.id)).toEqual(['a']);
    expect(context.truncated).toBe(true);
  });
  it('reports missing source without inventing nodes', () => {
    expect(
      routeDependencies({ ...screen, sourceFile: 'missing.ts' }, result)
        .available,
    ).toBe(false);
  });
});
