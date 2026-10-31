import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '@codedna/shared';
import {
  buildArchitectureOverview,
  groupDetailGraph,
} from './architecture-overview.js';
const meta = { confidence: 1, evidence: [] };
const graph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [
    { id: 'a', label: 'apps/web/app/page.tsx', kind: 'file', metadata: meta },
    {
      id: 'b',
      label: 'packages/core/src/index.ts',
      kind: 'file',
      metadata: meta,
    },
    {
      id: 'c',
      label: 'packages/core/src/util.ts',
      kind: 'file',
      metadata: meta,
    },
    { id: 'd', label: 'react', kind: 'external', metadata: meta },
  ],
  edges: [
    { id: '1', sourceId: 'a', targetId: 'b', metadata: meta },
    { id: '2', sourceId: 'a', targetId: 'c', metadata: meta },
    { id: '3', sourceId: 'b', targetId: 'c', metadata: meta },
    { id: '4', sourceId: 'a', targetId: 'd', metadata: meta },
  ],
};
describe('architecture overview', () => {
  it('groups actual paths and aggregates directed edges with original evidence', () => {
    const result = buildArchitectureOverview(graph);
    const app = result.groups.find((group) => group.label === 'apps/web')!;
    const core = result.groups.find(
      (group) => group.label === 'packages/core',
    )!;
    const edge = result.graph.edges.find(
      (item) => item.sourceId === app.id && item.targetId === core.id,
    )!;
    expect(edge.specifier).toBe('2 source dependencies');
    expect(result.edgeEvidence[edge.id]?.map((item) => item.id)).toEqual([
      '1',
      '2',
    ]);
    expect(core.internalEdges).toBe(1);
    expect(
      result.groups.find((group) => group.label === 'External packages')
        ?.fileIds,
    ).toEqual(['d']);
    expect(groupDetailGraph(graph, core).edges.map((item) => item.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
  it('is deterministic regardless of input order', () => {
    expect(
      buildArchitectureOverview({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(buildArchitectureOverview(graph));
  });
});
