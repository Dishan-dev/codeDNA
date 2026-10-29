import { describe, expect, it } from 'vitest';
import type { AnalysisDiagnostic, UIFlowGraph } from '@codedna/shared';
import { adaptUIFlowGraph } from './ui-flow-graph.js';
import { neighborhood } from './graph.js';
import { fallbackLayout, layoutGraph } from './layout.js';
const metadata = { confidence: 1, evidence: [] };
const graph: UIFlowGraph = {
  schemaVersion: '1.0',
  nodes: [
    {
      id: 'screen:b',
      label: '/items/[id]',
      routePath: '/items/[id]',
      sourceFile: 'app/items/[id]/page.tsx',
      metadata,
    },
    {
      id: 'screen:a',
      label: '/',
      routePath: '/',
      sourceFile: 'app/page.tsx',
      metadata,
    },
    {
      id: 'screen:c',
      label: '/other',
      routePath: '/other',
      sourceFile: 'app/other/page.tsx',
      metadata,
    },
  ],
  edges: [
    {
      id: 'edge:a-b',
      sourceId: 'screen:a',
      targetId: 'screen:b',
      kind: 'link',
      metadata,
    },
    {
      id: 'edge:b-a',
      sourceId: 'screen:b',
      targetId: 'screen:a',
      kind: 'push',
      metadata,
    },
  ],
  navigationEvents: [
    {
      id: 'unresolved',
      sourceId: 'screen:a',
      kind: 'link',
      resolution: 'unresolved',
      location: {
        path: 'app/page.tsx',
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
      },
      metadata,
    },
  ],
};
describe('UI flow graph adapter', () => {
  it('preserves stable node and edge IDs, direction, metadata, and dynamic labels', () => {
    const result = adaptUIFlowGraph(graph);
    expect(result.nodes.map((n) => n.id)).toEqual([
      'screen:a',
      'screen:b',
      'screen:c',
    ]);
    expect(result.nodes[1]?.data.dynamic).toBe(true);
    expect(result.nodes[0]?.data.dynamic).toBe(false);
    expect(result.edges[0]).toMatchObject({
      id: 'edge:a-b',
      source: 'screen:a',
      target: 'screen:b',
      data: { source: graph.edges[0] },
    });
    expect(result.edges).toHaveLength(2);
    expect(
      adaptUIFlowGraph({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        edges: [...graph.edges].reverse(),
      }),
    ).toEqual(result);
  });
  it('labels React Router parameters and splats as dynamic', () => {
    const result = adaptUIFlowGraph({
      ...graph,
      nodes: [
        { ...graph.nodes[0]!, routePath: '/items/:id' },
        { ...graph.nodes[1]!, routePath: '/files/*' },
      ],
      edges: [],
    });
    expect(result.nodes.every((node) => node.data.dynamic)).toBe(true);
  });
  it('maps source diagnostics and computes direct neighbors only', () => {
    const diagnostic: AnalysisDiagnostic = {
      id: 'd',
      severity: 'warning',
      message: 'problem',
      location: {
        path: 'app/page.tsx',
        start: { line: 1, column: 1 },
        end: { line: 1, column: 2 },
      },
    };
    const result = adaptUIFlowGraph(graph, [diagnostic]);
    expect(result.nodes[0]?.data.diagnostics).toBe(1);
    const adjacent = neighborhood(result.edges, 'screen:a');
    expect([...adjacent.nodes].sort()).toEqual(['screen:a', 'screen:b']);
    expect([...adjacent.edgeIds].sort()).toEqual(['edge:a-b', 'edge:b-a']);
  });
  it('lays out disconnected cyclic and empty graphs safely', async () => {
    const adapted = adaptUIFlowGraph(graph);
    const result = await layoutGraph(adapted);
    const repeat = await layoutGraph(adapted);
    expect(result.nodes.map((n) => n.position)).toEqual(
      repeat.nodes.map((n) => n.position),
    );
    expect(
      new Set(result.nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
    ).toBe(3);
    expect(fallbackLayout(adapted).nodes).toHaveLength(3);
    const empty = adaptUIFlowGraph({
      schemaVersion: '1.0',
      nodes: [],
      edges: [],
    });
    expect((await layoutGraph(empty)).nodes).toEqual([]);
  });
});
