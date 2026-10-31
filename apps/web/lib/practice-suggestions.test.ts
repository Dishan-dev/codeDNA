import { describe, expect, it } from 'vitest';
import type { AnalysisDiagnostic, DependencyGraph } from '@codedna/shared';
import { filePracticeSuggestions } from './practice-suggestions';
const metadata = { confidence: 1, evidence: [] };
const graph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [
    { id: 'a', label: 'src/a.ts', kind: 'file', metadata },
    { id: 'b', label: 'src/b.ts', kind: 'file', metadata },
    { id: 'c', label: 'src/c.ts', kind: 'file', metadata },
  ],
  edges: [
    { id: '1', sourceId: 'a', targetId: 'b', metadata },
    { id: '2', sourceId: 'b', targetId: 'c', metadata },
    { id: '3', sourceId: 'c', targetId: 'a', metadata },
  ],
};
describe('practice suggestions', () => {
  it('finds a source-evidenced cycle without declaring it a defect', () => {
    const result = filePracticeSuggestions(graph, [], 'a', true);
    expect(result.map((item) => item.id)).toContain('cycle');
    expect(result[0]?.explanation).toContain(
      'src/a.ts → src/b.ts → src/c.ts → src/a.ts',
    );
    expect(result[0]?.explanation).toContain('not always wrong');
  });
  it('reports unresolved imports only for the selected source and preserves their location', () => {
    const diagnostics: AnalysisDiagnostic[] = [
      {
        id: 'x',
        severity: 'warning',
        code: 'unresolved-module',
        message: 'Could not resolve',
        location: {
          path: 'src/a.ts',
          start: { line: 3, column: 1 },
          end: { line: 3, column: 5 },
        },
      },
    ];
    expect(
      filePracticeSuggestions(
        { ...graph, edges: [] },
        diagnostics,
        'a',
        true,
      )[0],
    ).toMatchObject({ id: 'x', location: { path: 'src/a.ts', line: 3 } });
    expect(
      filePracticeSuggestions({ ...graph, edges: [] }, diagnostics, 'b', true),
    ).toEqual([]);
  });
  it('does not treat an acyclic graph as a cycle and discloses partial data', () => {
    const result = filePracticeSuggestions(
      { ...graph, edges: graph.edges.slice(0, 2) },
      [],
      'a',
      false,
    );
    expect(result.map((item) => item.id)).toEqual(['partial']);
  });
});
