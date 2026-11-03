import { describe, expect, it } from 'vitest';
import type {
  RepositorySnapshot,
  AnalysisResult,
  UIFlowGraph,
} from '@codedna/shared';
import { summarizeRepository } from './repository-overview.js';
const metadata = { confidence: 1, evidence: [] };
const snapshot: RepositorySnapshot = {
  schemaVersion: '1.0',
  id: 'repo',
  revision: 'abc',
  files: [
    { id: 'a', path: 'apps/web/app/page.tsx', content: '' },
    { id: 'b', path: 'packages/core/index.ts', content: '' },
  ],
};
const flow: UIFlowGraph = {
  schemaVersion: '1.0',
  nodes: [
    {
      id: 'route:/',
      label: '/',
      framework: 'next-app-router',
      sourceFile: 'apps/web/app/page.tsx',
      routePath: '/',
      metadata,
    },
  ],
  edges: [],
};
const result: AnalysisResult = {
  schemaVersion: '1.0',
  snapshotId: 'repo',
  dependencyGraph: {
    schemaVersion: '1.0',
    nodes: [
      {
        id: 'file:apps/web/app/page.tsx',
        label: 'apps/web/app/page.tsx',
        kind: 'file',
        metadata,
      },
      {
        id: 'file:packages/core/index.ts',
        label: 'packages/core/index.ts',
        kind: 'file',
        metadata,
      },
    ],
    edges: [
      {
        id: 'e',
        sourceId: 'file:apps/web/app/page.tsx',
        targetId: 'file:packages/core/index.ts',
        metadata,
      },
    ],
  },
  diagnostics: [
    {
      id: 'd',
      severity: 'warning',
      code: 'unresolved-module',
      message: 'missing',
    },
  ],
  uiFlowGraph: flow,
};
describe('repository overview', () => {
  it('groups actual paths with directed evidence and detected routes', () => {
    const data = summarizeRepository(snapshot, result, flow, false);
    expect(data.modules.map((item) => item.path)).toEqual([
      'apps/web',
      'packages/core',
    ]);
    expect(data.modules[0]).toMatchObject({ outgoing: 1, fileCount: 1 });
    expect(data.relationships[0]?.edges[0]?.id).toBe('e');
    expect(data.frameworks[0]).toMatchObject({
      id: 'next-app-router',
      evidence: [{ path: 'apps/web/app/page.tsx' }],
    });
    expect(data).toMatchObject({
      revision: 'abc',
      complete: false,
      unresolved: 1,
    });
  });
  it('is deterministic and reports unknown when evidence is absent', () => {
    expect(
      summarizeRepository(
        { ...snapshot, files: [...snapshot.files].reverse() },
        result,
        flow,
      ),
    ).toEqual(summarizeRepository(snapshot, result, flow));
    expect(
      summarizeRepository(snapshot, undefined, {
        schemaVersion: '1.0',
        nodes: [],
        edges: [],
      }).frameworks,
    ).toEqual([]);
  });
  it('groups 500 files while preserving distinct repository revisions', () => {
    const files = Array.from({ length: 500 }, (_, index) => ({
      id: `${index}`,
      path: `packages/p${index % 5}/src/f${index}.ts`,
      content: '',
    }));
    const large = { ...snapshot, id: 'large', revision: 'one', files };
    const emptyFlow = { schemaVersion: '1.0' as const, nodes: [], edges: [] };
    const first = summarizeRepository(large, undefined, emptyFlow, false);
    const second = summarizeRepository(
      { ...large, revision: 'two' },
      undefined,
      emptyFlow,
      false,
    );
    expect(first.modules).toHaveLength(5);
    expect(first.modules.map((module) => module.fileCount)).toEqual([
      100, 100, 100, 100, 100,
    ]);
    expect(first.complete).toBe(false);
    expect(first.revision).toBe('one');
    expect(second.revision).toBe('two');
    expect(first.modules).toEqual(second.modules);
  });
  it('records external packages only with source-located evidence', () => {
    const located = {
      ...result,
      dependencyGraph: {
        ...result.dependencyGraph,
        nodes: [
          ...result.dependencyGraph.nodes,
          {
            id: 'external:react',
            label: 'react',
            kind: 'external' as const,
            metadata,
          },
        ],
        edges: [
          ...result.dependencyGraph.edges,
          {
            id: 'pkg',
            sourceId: 'file:apps/web/app/page.tsx',
            targetId: 'external:react',
            kind: 'import' as const,
            location: {
              path: 'apps/web/app/page.tsx',
              start: { line: 2, column: 1 },
              end: { line: 2, column: 10 },
            },
            metadata,
          },
        ],
      },
    };
    expect(summarizeRepository(snapshot, located, flow).technologies).toEqual([
      { name: 'react', evidence: [{ path: 'apps/web/app/page.tsx', line: 2 }] },
    ]);
  });
});
