import { describe, expect, it } from 'vitest';
import type { DependencyGraph, RepositorySnapshot } from '@codedna/shared';
import { folderView } from './architecture-guide';
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
  it('shows direct folders and files without mistaking prefix siblings', () => {
    const root = folderView(snapshot, graph, '');
    expect(root.folders).toEqual([{ path: 'src', name: 'src', count: 2 }]);
    expect(root.files[0]?.path).toBe('README.js');
    expect(folderView(snapshot, graph, 'src/u').files).toEqual([]);
  });
  it('summarizes actual crossing dependencies in both directions', () => {
    expect(folderView(snapshot, graph, 'src/ui').connections).toEqual([
      { path: 'Package: react', count: 1, direction: 'uses' },
      { path: 'src/lib', count: 1, direction: 'uses' },
    ]);
    expect(folderView(snapshot, graph, 'src/lib').connections).toEqual([
      { path: 'src/ui', count: 1, direction: 'used-by' },
    ]);
    expect(folderView(snapshot, graph, 'src').connections).toEqual([
      { path: 'Package: react', count: 1, direction: 'uses' },
    ]);
  });
});
