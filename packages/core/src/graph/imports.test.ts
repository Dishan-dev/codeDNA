import { describe, expect, it } from 'vitest';
import type { RepositoryText } from '@codedna/shared';
import { parseFile } from '../snapshot/parse.js';
import { languageOf } from '../snapshot/validate.js';
import { buildImportGraph, packageName } from './imports.js';

const graph = (files: Record<string, string>, manifests: RepositoryText[] = [], options = {}) =>
  buildImportGraph(
    Object.entries(files)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, content]) => parseFile({ path, content, language: languageOf(path)! })),
    manifests,
    options,
  );
const edge = (result: ReturnType<typeof graph>, from: string, specifier: string) => result.edges.find((item) => item.from === from && item.specifier === specifier);

describe('buildImportGraph', () => {
  it('resolves relative imports with extension and index inference', () => {
    const result = graph({
      'app/page.tsx': "import { Form } from '../components/form';\nimport db from '../lib';",
      'components/form.tsx': 'export function Form() {}',
      'lib/index.ts': 'export default {}',
    });
    expect(edge(result, 'app/page.tsx', '../components/form')).toMatchObject({ target: 'components/form.tsx', kind: 'static', line: 1, confidence: 'resolved' });
    expect(edge(result, 'app/page.tsx', '../lib')).toMatchObject({ target: 'lib/index.ts' });
    expect(result.diagnostics).toEqual([]);
  });

  it('follows tsconfig path aliases, including in nested monorepo apps', () => {
    const result = graph({
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["src/*"] } } }',
      'src/a.ts': "import { b } from '~/b';",
      'src/b.ts': 'export const b = 1;',
      'apps/web/tsconfig.json': '{ // comments are fine\n "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'apps/web/app/page.tsx': "import { prisma } from '@/lib/db';",
      'apps/web/lib/db.ts': 'export const prisma = {};',
    });
    expect(edge(result, 'src/a.ts', '~/b')?.target).toBe('src/b.ts');
    expect(edge(result, 'apps/web/app/page.tsx', '@/lib/db')?.target).toBe('apps/web/lib/db.ts');
  });

  it('records packages by name, including scoped packages and subpaths', () => {
    const result = graph({ 'a.ts': "import { z } from 'zod';\nimport { redirect } from 'next/navigation';\nimport { PrismaClient } from '@prisma/client/edge';" });
    expect(result.edges.map((item) => item.package)).toEqual(['zod', 'next', '@prisma/client']);
    expect(result.edges.every((item) => item.confidence === 'resolved' && !item.target)).toBe(true);
    expect(packageName('@scope/pkg/sub')).toBe('@scope/pkg');
  });

  it('distinguishes type-only imports, re-exports, require and dynamic import', () => {
    const result = graph({
      'a.ts': "import type { T } from './t';\nexport { x } from './x';\nconst y = require('./y');\nconst z = await import('./z');\nimport w = require('./w');",
      't.ts': '',
      'x.ts': '',
      'y.js': '',
      'z.ts': '',
      'w.ts': '',
    });
    expect(result.edges.map((item) => [item.specifier, item.kind, item.target])).toEqual([
      ['./t', 'type', 't.ts'],
      ['./x', 'reexport', 'x.ts'],
      ['./y', 'require', 'y.js'],
      ['./z', 'dynamic', 'z.ts'],
      ['./w', 'require', 'w.ts'],
    ]);
  });

  it('marks computed imports and missing files as unknown instead of skipping them', () => {
    const result = graph({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
      'a.ts': "const mod = await import(`./plugins/${name}`);\nimport { gone } from './missing';\nimport { alias } from '@/lib/missing';",
    });
    expect(result.edges.map((item) => [item.kind, item.confidence, item.package])).toEqual([
      ['dynamic', 'gap', undefined],
      ['static', 'gap', undefined],
      ['static', 'gap', undefined],
    ]);
    expect(result.diagnostics.map((item) => item.id)).toEqual(['diag:import-unresolved:a.ts:2', 'diag:import-unresolved:a.ts:3']);
  });

  it('reads only aliases from configs and never follows extends or plugins', () => {
    const result = graph({
      'tsconfig.json': '{ "extends": "./node_modules/evil/tsconfig.json", "compilerOptions": { "plugins": [{ "name": "evil" }], "paths": { "@/*": ["./*"] } } }',
      'jsconfig.json': '{ "compilerOptions": { "paths": { "#/*": ["./*"] } } }',
      'a.ts': "import { b } from '@/b';\nimport { c } from '#/b';",
      'b.ts': '',
    });
    expect(edge(result, 'a.ts', '@/b')?.target).toBe('b.ts');
    // The jsconfig next to a tsconfig is ignored, so `#/b` is treated as a package.
    expect(edge(result, 'a.ts', '#/b')?.package).toBe('#');
    expect(result.diagnostics.map((item) => item.id)).toContain('diag:config-extends:tsconfig.json:1');
  });

  it('survives an unreadable config', () => {
    const result = graph({ 'tsconfig.json': '{ not json', 'a.ts': "import './b';", 'b.ts': '' });
    expect(edge(result, 'a.ts', './b')?.target).toBe('b.ts');
  });

  it('stops at the deadline and reports a partial graph', () => {
    let time = 0;
    const result = graph({ 'a.ts': "import './b';", 'b.ts': "import './a';" }, [], { deadline: 0, now: () => time++ });
    expect(result.partial).toBe(true);
    expect(result.edges.map((item) => item.from)).toEqual(['a.ts']);
  });

  it('is deterministic', () => {
    const files = { 'a.ts': "import './b';\nimport 'react';", 'b.ts': "import './a';" };
    expect(graph(files).edges).toEqual(graph(files).edges);
  });
});
