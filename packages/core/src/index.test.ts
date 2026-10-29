import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeSnapshot, SnapshotValidationError } from './index.js';

function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
describe('snapshot analysis', () => {
  it('extracts internal, external and circular dependencies with locations', () => {
    const result = analyzeSnapshot(
      snapshot({
        'src/a.ts': `import {b} from './b'; export {x} from './dir'; import React from 'react';`,
        'src/b.ts': `import './a'; export const b=1;`,
        'src/dir/index.ts': `export const x=1;`,
        'src/view.tsx': `import React from 'react'; export const View = () => <div/>;`,
      }),
    );
    expect(result.diagnostics).toEqual([]);
    expect(
      result.dependencyGraph.edges.map((e) => [e.sourceId, e.targetId, e.kind]),
    ).toEqual(
      expect.arrayContaining([
        ['file:src/a.ts', 'file:src/b.ts', 'import'],
        ['file:src/b.ts', 'file:src/a.ts', 'import'],
        ['file:src/a.ts', 'file:src/dir/index.ts', 're-export'],
        ['file:src/a.ts', 'package:react', 'import'],
      ]),
    );
    expect(
      result.dependencyGraph.edges.every(
        (e) => e.location && e.metadata.evidence.length,
      ),
    ).toBe(true);
    expect(
      result.dependencyGraph.nodes.find((n) => n.id === 'package:react')?.kind,
    ).toBe('external');
  });
  it('reports unresolved and nonliteral imports while continuing past syntax errors', () => {
    const result = analyzeSnapshot(
      snapshot({
        'a.ts': `import('./missing'); import(name); const x = require('./b'); require(variable);`,
        'b.js': `const = ;`,
        'c.js': `export * from './a';`,
      }),
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unresolved-module', 'unresolved-dynamic']),
    );
    expect(
      result.diagnostics.some(
        (d) => d.code?.startsWith('TS') && d.location?.path === 'b.js',
      ),
    ).toBe(true);
    expect(result.dependencyGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'require', targetId: 'file:b.js' }),
        expect.objectContaining({ kind: 're-export', targetId: 'file:a.ts' }),
      ]),
    );
  });
  it('resolves aliases and literal dynamic imports', () => {
    const result = analyzeSnapshot(
      snapshot({
        'tsconfig.json': JSON.stringify({
          compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
        }),
        'src/main.ts': `import { x } from '@app/util'; import('./util.js'); import('@app/missing');`,
        'src/util.ts': 'export const x=1;',
      }),
    );
    expect(
      result.dependencyGraph.edges.filter(
        (e) => e.targetId === 'file:src/util.ts',
      ),
    ).toHaveLength(2);
    expect(result.diagnostics.some((d) => d.code === 'unresolved-module')).toBe(
      true,
    );
    expect(
      result.dependencyGraph.nodes.some((n) => n.id === 'package:@app/missing'),
    ).toBe(false);
  });
  it('resolves nested config paths without baseUrl and diagnoses bad config', () => {
    const result = analyzeSnapshot(
      snapshot({
        'app/jsconfig.json': JSON.stringify({
          compilerOptions: { paths: { '~/*': ['src/*'] } },
        }),
        'app/main.js': `import '~/util';`,
        'app/src/util.js': 'export const a = 1;',
        'other/tsconfig.json': '{ invalid',
        'other/main.ts': `import './missing';`,
      }),
    );
    expect(result.dependencyGraph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: 'file:app/src/util.js' }),
      ]),
    );
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === 'config' && d.location?.path === 'other/tsconfig.json',
      ),
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'unresolved-module')).toBe(
      true,
    );
  });
  it('validates paths, limits, schema and malformed input', () => {
    expect(() => analyzeSnapshot(snapshot({ '../escape.ts': '' }))).toThrow(
      SnapshotValidationError,
    );
    expect(() => analyzeSnapshot(snapshot({ '/absolute.ts': '' }))).toThrow(
      SnapshotValidationError,
    );
    const duplicate = snapshot({ 'a.ts': '', './a.ts': '' });
    expect(() => analyzeSnapshot(duplicate)).toThrow(/Duplicate/);
    expect(() => analyzeSnapshot(snapshot({ 'README.md': '' }))).toThrow(
      /Unsupported/,
    );
    expect(() =>
      analyzeSnapshot(snapshot({ 'a.ts': '\u00e9' }), { maxFileBytes: 1 }),
    ).toThrow(/limit/);
    expect(() =>
      analyzeSnapshot(snapshot({ 'a.ts': '' }), { maxFiles: 0 }),
    ).toThrow(/limit/);
    expect(() =>
      analyzeSnapshot({
        ...snapshot({}),
        schemaVersion: '2.0',
      } as unknown as RepositorySnapshot),
    ).toThrow(SnapshotValidationError);
  });
  it('is deterministic independent of input order', () => {
    const input = snapshot({
      'z.ts': `import './a';`,
      'a.ts': `import x from 'pkg/sub';`,
    });
    const reversed = { ...input, files: [...input.files].reverse() };
    expect(analyzeSnapshot(input)).toEqual(analyzeSnapshot(reversed));
  });
  it('handles a medium repository within a generous performance budget', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++)
      files[`src/f${i}.ts`] =
        `import './f${(i + 1) % 500}'; export const value${i} = ${i};`;
    const start = Date.now();
    const result = analyzeSnapshot(snapshot(files));
    expect(result.dependencyGraph.edges).toHaveLength(500);
    expect(result.diagnostics).toHaveLength(0);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);
});
