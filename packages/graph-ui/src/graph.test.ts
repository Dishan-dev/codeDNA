import { describe, expect, it } from 'vitest';
import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from '@codedna/shared';
import { adaptGraph, neighborhood } from './graph.js';
import { fallbackLayout, layoutGraph } from './layout.js';
const metadata = { confidence: 1, evidence: [] };
const node = (id: string): DependencyNode => ({
  id,
  label: id,
  kind: 'file',
  metadata,
});
const edge = (
  id: string,
  sourceId: string,
  targetId: string,
): DependencyEdge => ({
  id,
  sourceId,
  targetId,
  kind: 'import',
  specifier: './target',
  metadata,
});
const graph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [node('file:c'), node('file:b'), node('file:a')],
  edges: [
    edge('edge:1', 'file:a', 'file:b'),
    edge('edge:2', 'file:b', 'file:a'),
  ],
};
describe('architecture graph adapter', () => {
  it('preserves stable identities, direction, metadata, and counts', () => {
    const adapted = adaptGraph(graph);
    expect(adapted.nodes.map((n) => n.id)).toEqual([
      'file:a',
      'file:b',
      'file:c',
    ]);
    expect(adapted.edges[0]).toMatchObject({
      id: 'edge:1',
      source: 'file:a',
      target: 'file:b',
      data: { source: graph.edges[0] },
    });
    expect(adapted.nodes[0]?.data).toMatchObject({ incoming: 1, outgoing: 1 });
    expect(
      adaptGraph({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(adapted);
  });
  it('computes only the directly connected neighborhood', () => {
    const { nodes, edgeIds } = neighborhood(adaptGraph(graph).edges, 'file:a');
    expect([...nodes].sort()).toEqual(['file:a', 'file:b']);
    expect([...edgeIds].sort()).toEqual(['edge:1', 'edge:2']);
    expect(neighborhood(adaptGraph(graph).edges, null).nodes.size).toBe(0);
  });
  it('lays out cycles and disconnected nodes deterministically without overlap', async () => {
    const input = adaptGraph(graph);
    const first = await layoutGraph(input);
    const second = await layoutGraph(input);
    expect(first.nodes.map((n) => n.position)).toEqual(
      second.nodes.map((n) => n.position),
    );
    expect(
      new Set(first.nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
    ).toBe(3);
    for (const [i, a] of first.nodes.entries())
      for (const b of first.nodes.slice(i + 1))
        expect(
          Math.abs(a.position.x - b.position.x) >= 220 ||
            Math.abs(a.position.y - b.position.y) >= 82,
        ).toBe(true);
  });
  it('places every node in the fallback grid', () => {
    const result = fallbackLayout(adaptGraph(graph));
    expect(result.nodes).toHaveLength(3);
    expect(
      new Set(result.nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
    ).toBe(3);
  });
  it('lays out a 500-file chain without truncating it', async () => {
    const nodes = Array.from({ length: 500 }, (_, i) =>
      node(`file:${i.toString().padStart(3, '0')}`),
    );
    const edges = nodes
      .slice(1)
      .map((n, i) => edge(`e:${i}`, nodes[i]!.id, n.id));
    const result = await layoutGraph(
      adaptGraph({ schemaVersion: '1.0', nodes, edges }),
    );
    expect(result.nodes).toHaveLength(500);
    expect(result.edges).toHaveLength(499);
  }, 30000);
  it('handles empty and single file graphs', async () => {
    expect(
      (await layoutGraph(adaptGraph({ ...graph, nodes: [], edges: [] }))).nodes,
    ).toEqual([]);
    expect(
      (
        await layoutGraph(
          adaptGraph({ ...graph, nodes: [node('file:only')], edges: [] }),
        )
      ).nodes,
    ).toHaveLength(1);
  });
});
