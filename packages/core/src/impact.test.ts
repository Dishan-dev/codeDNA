import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, UIFlowGraph } from '@codedna/shared';
import {
  analyzeImpact,
  analyzeSnapshot,
  createImpactAnalyzer,
} from './index.js';
function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'impact-fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const fixture = snapshot({
  'base.ts': 'export const base=1',
  'left.ts': `import {base} from './base'; export const left=base`,
  'right.ts': `import {base} from './base'; export const right=base`,
  'top.ts': `import {left} from './left'; import {right} from './right'; export const top=left+right`,
  'outside.ts': 'export const outside=1',
});
const flow: UIFlowGraph = {
  schemaVersion: '1.0',
  nodes: [
    {
      id: 'screen:top',
      label: 'Top',
      sourceFile: 'top.ts',
      framework: 'test',
      metadata: {
        confidence: 1,
        evidence: [{ description: 'Screen declaration' }],
      },
    },
    {
      id: 'screen:unknown',
      label: 'Shared',
      metadata: { confidence: 0.5, evidence: [] },
    },
  ],
  edges: [
    {
      id: 'navigation-only',
      sourceId: 'screen:top',
      targetId: 'screen:unknown',
      metadata: { confidence: 1, evidence: [] },
    },
  ],
};
describe('impact analysis', () => {
  it('uses incoming dependency edges, shortest distances, and multiple diamond paths', () => {
    const result = analyzeImpact(analyzeSnapshot(fixture), 'base.ts', {
      uiFlowGraph: flow,
    });
    expect(result.files.map((f) => [f.path, f.category, f.distance])).toEqual([
      ['base.ts', 'selected', 0],
      ['left.ts', 'direct', 1],
      ['right.ts', 'direct', 1],
      ['top.ts', 'transitive', 2],
    ]);
    const paths = result.files.find((f) => f.path === 'top.ts')!.paths;
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => p.fileIds)).toEqual(
      expect.arrayContaining([
        ['file:top.ts', 'file:left.ts', 'file:base.ts'],
        ['file:top.ts', 'file:right.ts', 'file:base.ts'],
      ]),
    );
    expect(
      paths.every(
        (p) => p.certainty === 'source-evidenced' && p.evidence.length === 2,
      ),
    ).toBe(true);
    expect(result.summary).toEqual({ direct: 2, transitive: 1, screens: 1 });
    expect(result.screens[0]?.sourceFile).toBe('top.ts');
    expect(result.screens[0]?.paths).toHaveLength(2);
    expect(
      result.dependencyGraph.edges.every((e) => e.id !== 'navigation-only'),
    ).toBe(true);
  });
  it('supports isolated files, disconnected graphs, unknown files and empty graphs', () => {
    const analysis = analyzeSnapshot(fixture);
    const isolated = analyzeImpact(analysis, 'outside.ts');
    expect(isolated.files).toHaveLength(1);
    expect(isolated.summary.direct).toBe(0);
    expect(isolated.traversal.complete).toBe(true);
    const unknown = analyzeImpact(analysis, 'missing.ts');
    expect(unknown.files).toHaveLength(0);
    expect(unknown.diagnostics[0]?.code).toBe('unknown-file');
    const empty = analyzeImpact(analyzeSnapshot(snapshot({})), 'missing.ts');
    expect(empty.files).toHaveLength(0);
  });
  it('handles cycles and selects shortest reverse paths', () => {
    const result = analyzeImpact(
      analyzeSnapshot(
        snapshot({
          'a.ts': `import './b'`,
          'b.ts': `import './a'`,
          'c.ts': `import './a'; import './b'`,
        }),
      ),
      'a.ts',
    );
    expect(result.files.map((f) => [f.path, f.distance])).toEqual([
      ['a.ts', 0],
      ['b.ts', 1],
      ['c.ts', 1],
    ]);
    expect(
      result.files.every((f) =>
        f.paths.every((p) => new Set(p.fileIds).size === p.fileIds.length),
      ),
    ).toBe(true);
  });
  it('reports incomplete source and malformed graph edges', () => {
    const result = analyzeSnapshot(fixture);
    result.diagnostics.push({
      id: 'bad',
      severity: 'warning',
      message: 'unresolved',
    });
    result.dependencyGraph.edges.push({
      id: 'bad-edge',
      sourceId: 'missing',
      targetId: 'file:base.ts',
      metadata: { confidence: 1, evidence: [] },
    });
    const impact = analyzeImpact(result, 'base.ts', {
      snapshotComplete: false,
      uiFlowDiagnostics: [
        { id: 'ui', severity: 'warning', message: 'ambiguous' },
      ],
    });
    expect(impact.traversal.complete).toBe(false);
    expect(impact.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'partial-snapshot',
        'analysis-diagnostics',
        'ui-flow-diagnostics',
        'invalid-edges',
      ]),
    );
  });
  it('handles a graph missing its edge list without claiming completeness', () => {
    const result = analyzeSnapshot(fixture);
    const partial = {
      ...result,
      dependencyGraph: { ...result.dependencyGraph, edges: undefined },
    } as unknown as typeof result;
    const impact = analyzeImpact(partial, 'base.ts');
    expect(impact.files).toHaveLength(1);
    expect(impact.traversal.complete).toBe(false);
    expect(impact.diagnostics.some((d) => d.code === 'missing-graph')).toBe(
      true,
    );
  });
  it('marks low-evidence edges uncertain without inventing links', () => {
    const result = analyzeSnapshot(fixture);
    result.dependencyGraph.edges.find(
      (e) => e.sourceId === 'file:left.ts',
    )!.metadata = { confidence: 0.5, evidence: [] };
    const impact = analyzeImpact(result, 'base.ts');
    expect(
      impact.files.find((f) => f.path === 'left.ts')?.paths[0]?.certainty,
    ).toBe('uncertain');
    expect(
      impact.diagnostics.some((d) => d.code === 'uncertain-evidence'),
    ).toBe(true);
  });
  it('honors traversal and path limits explicitly', () => {
    const result = analyzeSnapshot(fixture);
    const depth = analyzeImpact(result, 'base.ts', { maxDepth: 1 });
    expect(depth.files).toHaveLength(3);
    expect(depth.traversal.truncated).toBe(true);
    const count = analyzeImpact(result, 'base.ts', { maxFiles: 2 });
    expect(count.files).toHaveLength(2);
    expect(count.diagnostics.some((d) => d.code === 'traversal-limited')).toBe(
      true,
    );
    const paths = analyzeImpact(result, 'base.ts', { maxPathsPerFile: 1 });
    expect(paths.files.find((f) => f.path === 'top.ts')?.paths).toHaveLength(1);
    expect(paths.diagnostics.some((d) => d.code === 'paths-limited')).toBe(
      true,
    );
    expect(() => analyzeImpact(result, 'base.ts', { maxFiles: 0 })).toThrow(
      RangeError,
    );
  });
  it('only attributes screens with explicit source files and does not use navigation connectivity', () => {
    const impact = analyzeImpact(analyzeSnapshot(fixture), 'base.ts', {
      uiFlowGraph: flow,
    });
    expect(impact.screens.map((s) => s.screen.id)).toEqual(['screen:top']);
    expect(impact.screens[0]?.evidence[0]?.description).toBe(
      'Screen declaration',
    );
    const result = analyzeSnapshot(fixture);
    result.uiFlowGraph = flow;
    expect(
      analyzeImpact(result, 'base.ts').screens.map((s) => s.screen.id),
    ).toEqual(['screen:top']);
  });
  it('is deterministic with reordered graph data and repeated indexed analysis', () => {
    const result = analyzeSnapshot(fixture),
      index = createImpactAnalyzer(result, { uiFlowGraph: flow });
    const first = index.analyze('base.ts');
    expect(index.analyze('base.ts')).toEqual(first);
    expect(
      analyzeImpact(
        {
          ...result,
          dependencyGraph: {
            ...result.dependencyGraph,
            nodes: [...result.dependencyGraph.nodes].reverse(),
            edges: [...result.dependencyGraph.edges].reverse(),
          },
        },
        'base.ts',
        { uiFlowGraph: flow },
      ),
    ).toEqual(first);
  });
  it('handles a 500-file graph without truncating when limits permit', () => {
    const files: Record<string, string> = { 'f0.ts': 'export const a=1' };
    for (let i = 1; i < 500; i++) files[`f${i}.ts`] = `import './f${i - 1}'`;
    const result = analyzeSnapshot(snapshot(files)),
      start = Date.now(),
      impact = analyzeImpact(result, 'f0.ts', { maxDepth: 500, maxFiles: 501 });
    expect(impact.files).toHaveLength(500);
    expect(impact.files.at(-1)?.distance).toBe(499);
    expect(impact.traversal.truncated).toBe(false);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);
});
