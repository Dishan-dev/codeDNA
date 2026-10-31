import { describe, it, expect } from 'vitest';
import type { DependencyGraph } from '@codedna/shared';
import {
  buildSceneGraph,
  canRender3D,
  folderOf,
  MAX_3D_NODES,
  MAX_3D_EDGES,
} from './architecture-3d-data.js';
const metadata = { confidence: 1, evidence: [] };
const graph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [
    { id: 'a', label: 'src/ui/a.ts', kind: 'file', metadata },
    { id: 'b', label: 'src/data/b.ts', kind: 'file', metadata },
    { id: 'c', label: 'src/ui/c.ts', kind: 'file', metadata },
  ],
  edges: [
    {
      id: '1',
      sourceId: 'a',
      targetId: 'b',
      kind: 'import',
      specifier: '../data/b',
      metadata,
    },
    { id: '2', sourceId: 'c', targetId: 'b', kind: 're-export', metadata },
    { id: '3', sourceId: 'a', targetId: 'c', kind: 'import', metadata },
  ],
};
describe('3D scene transformation', () => {
  it('is deterministic and retains collapsed edge direction and evidence', () => {
    const scene = buildSceneGraph(graph, new Set());
    expect(scene).toEqual(
      buildSceneGraph(
        {
          ...graph,
          nodes: [...graph.nodes].reverse(),
          edges: [...graph.edges].reverse(),
        },
        new Set(),
      ),
    );
    const edge = scene.edges.find((e) =>
      e.evidence.some((item) => item.id === '1'),
    )!;
    expect(edge.sourceId).toBe('cluster:src%2Fui');
    expect(edge.targetId).toBe('cluster:src%2Fdata');
    expect(edge.evidence.map((e) => e.id)).toEqual(['1', '2']);
    expect(
      scene.edges.some(
        (edge) =>
          edge.sourceId === edge.targetId && edge.evidence[0]?.id === '3',
      ),
    ).toBe(true);
  });
  it('expands files with stable ids and source evidence', () => {
    const scene = buildSceneGraph(graph, new Set(['src/ui']));
    expect(scene.nodes.find((node) => node.id === 'a')?.source?.label).toBe(
      'src/ui/a.ts',
    );
    expect(
      scene.edges.find((edge) => edge.evidence[0]?.id === '1')?.sourceId,
    ).toBe('a');
    expect(folderOf(graph.nodes[0]!)).toBe('src/ui');
  });
  it('rejects graphs beyond explicit limits', () => {
    expect(canRender3D(graph)).toBe(true);
    expect(
      canRender3D({
        ...graph,
        nodes: Array(MAX_3D_NODES + 1).fill(graph.nodes[0]),
      }),
    ).toBe(false);
    expect(
      canRender3D({
        ...graph,
        edges: Array(MAX_3D_EDGES + 1).fill(graph.edges[0]),
      }),
    ).toBe(false);
  });
});
