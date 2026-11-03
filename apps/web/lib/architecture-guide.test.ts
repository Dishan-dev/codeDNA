import { describe, expect, it } from 'vitest';
import type { DependencyGraph, RepositorySnapshot } from '@codedna/shared';
import {
  folderView,
  graphForFolder,
  graphForRootFiles,
  graphForQuestion,
} from './architecture-guide';
const metadata = { confidence: 1, evidence: [] };
const snapshot: RepositorySnapshot = {
  schemaVersion: '1.0',
  id: 'fixture',
  files: [
    { id: '1', path: 'src/ui/page.tsx', content: '' },
    { id: '2', path: 'src/lib/data.ts', content: '' },
    { id: '3', path: 'README.js', content: '' },
  ],
};
const graph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [
    { id: 'a', label: 'src/ui/page.tsx', kind: 'file', metadata },
    { id: 'b', label: 'src/lib/data.ts', kind: 'file', metadata },
    { id: 'c', label: 'react', kind: 'external', metadata },
  ],
  edges: [
    { id: '1', sourceId: 'a', targetId: 'b', metadata },
    { id: '2', sourceId: 'a', targetId: 'c', metadata },
  ],
};
describe('guided folder exploration', () => {
  it('scopes root files and keeps only directly connected neighbors', () => {
    const rootGraph: DependencyGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: 'root', label: 'index.ts', kind: 'file', metadata },
      ],
      edges: [
        ...graph.edges,
        { id: 'root-edge', sourceId: 'root', targetId: 'b', metadata },
      ],
    };
    const scoped = graphForRootFiles(rootGraph);
    expect(scoped.nodes.map((node) => node.id)).toEqual(['b', 'root']);
    expect(scoped.edges.map((edge) => edge.id)).toEqual(['root-edge']);
  });
  it('keeps folder files, direct neighbours and real connecting edges', () => {
    const view = graphForFolder(graph, 'src/lib');
    expect(view.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(view.edges.map((edge) => edge.id)).toEqual(['1']);
    expect(graphForFolder(graph, 'src/l').nodes).toEqual([]);
    expect(graphForFolder(graph, '')).toBe(graph);
  });
  it('shows direct folders and files without mistaking prefix siblings', () => {
    const root = folderView(snapshot, graph, '');
    expect(root.folders).toEqual([{ path: 'src', name: 'src', count: 2 }]);
    expect(root.files[0]?.path).toBe('README.js');
    expect(folderView(snapshot, graph, 'src/u').files).toEqual([]);
  });
  it('summarizes actual crossing dependencies in both directions', () => {
    const summaries = (path: string) =>
      folderView(snapshot, graph, path).connections.map(
        ({ path, count, direction }) => ({ path, count, direction }),
      );
    expect(summaries('src/ui')).toEqual([
      { path: 'Package: react', count: 1, direction: 'uses' },
      { path: 'src/lib', count: 1, direction: 'uses' },
    ]);
    expect(summaries('src/lib')).toEqual([
      { path: 'src/ui', count: 1, direction: 'used-by' },
    ]);
    expect(summaries('src')).toEqual([
      { path: 'Package: react', count: 1, direction: 'uses' },
    ]);
    expect(
      folderView(snapshot, graph, 'src/lib').connections[0]?.edges.map(
        (edge) => edge.id,
      ),
    ).toEqual(['1']);
  });
  it('answers dependency questions using only actual directed edges', () => {
    expect(
      graphForQuestion(graph, 'a', 'uses').edges.map((edge) => edge.id),
    ).toEqual(['1', '2']);
    expect(graphForQuestion(graph, 'a', 'dependents').edges).toEqual([]);
    expect(
      graphForQuestion(graph, 'b', 'dependents').edges.map((edge) => edge.id),
    ).toEqual(['1']);
    expect(
      graphForQuestion(graph, 'b', 'direct').nodes.map((node) => node.id),
    ).toEqual(['a', 'b']);
    expect(graphForQuestion(graph, null, 'uses')).toBe(graph);
  });
});
