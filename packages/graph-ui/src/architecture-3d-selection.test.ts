import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '@codedna/shared';
import { buildSceneGraph, visibleSelectionId } from './architecture-3d-data.js';
describe('visible 3D selection', () => {
  it('maps a selected file to its collapsed group and then to the file when expanded', () => {
    const metadata = { confidence: 1, evidence: [] };
    const graph: DependencyGraph = {
      schemaVersion: '1.0',
      nodes: [{ id: 'file:a', label: 'src/a.ts', kind: 'file', metadata }],
      edges: [],
    };
    expect(
      visibleSelectionId(buildSceneGraph(graph, new Set()), graph, 'file:a'),
    ).toBe('cluster:src');
    expect(
      visibleSelectionId(
        buildSceneGraph(graph, new Set(['src'])),
        graph,
        'file:a',
      ),
    ).toBe('file:a');
    expect(
      visibleSelectionId(buildSceneGraph(graph, new Set()), graph, 'missing'),
    ).toBeNull();
  });
});
