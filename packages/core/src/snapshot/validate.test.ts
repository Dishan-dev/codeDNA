import { describe, expect, it } from 'vitest';
import { codeRef, fileDirective, parseFile, redactSecrets } from './parse.js';
import { isAnalyzablePath, languageOf, normalizePath, SnapshotError, utf8Length, validateSnapshot } from './validate.js';

const snap = (files: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  schemaVersion: '1.0',
  id: 'demo@1',
  files: Object.entries(files).map(([path, content]) => ({ id: path, path, content })),
  ...extra,
});

describe('normalizePath', () => {
  it('accepts repository-relative paths and tidies dot segments', () => {
    expect(normalizePath('app/./page.tsx')).toBe('app/page.tsx');
    expect(normalizePath('a//b.ts')).toBe('a/b.ts');
  });
  it.each(['', '/etc/passwd', '../secret.ts', 'a/../../b.ts', 'C:/x.ts', 'a\\b.ts', 'a\0b.ts', 42])('rejects %j', (path) => {
    expect(normalizePath(path)).toBeNull();
  });
});

describe('languageOf / isAnalyzablePath', () => {
  it('reads TS/JS sources and tsconfig/jsconfig only', () => {
    expect(languageOf('a.tsx')).toBe('tsx');
    expect(languageOf('a.mts')).toBe('ts');
    expect(languageOf('a.cjs')).toBe('js');
    expect(languageOf('tsconfig.json')).toBe('json');
    expect(languageOf('package.json')).toBeNull();
    expect(languageOf('.env')).toBeNull();
    expect(languageOf('.env.local')).toBeNull();
    expect(languageOf('logo.png')).toBeNull();
  });
  it('skips dependencies, build output and bundles', () => {
    for (const path of ['node_modules/x/index.js', 'apps/web/.next/server.js', 'dist/index.js', 'public/vendor.min.js', 'build/a.ts'])
      expect(isAnalyzablePath(path), path).toBe(false);
    expect(isAnalyzablePath('src/app/page.tsx')).toBe(true);
  });
});

describe('validateSnapshot', () => {
  it('throws only for a malformed snapshot', () => {
    expect(() => validateSnapshot(null)).toThrow(SnapshotError);
    expect(() => validateSnapshot({ id: '', files: [] })).toThrow(SnapshotError);
    expect(() => validateSnapshot({ id: 'x' })).toThrow(SnapshotError);
    expect(() => validateSnapshot(snap({}), { maxFiles: 0, maxFileBytes: 1, maxTotalBytes: 1 })).toThrow(RangeError);
  });

  it('keeps analyzable files sorted, whatever the input order', () => {
    const a = validateSnapshot(snap({ 'b.ts': 'b', 'a.ts': 'a', 'README.md': '# hi', 'node_modules/x.js': '' }));
    const b = validateSnapshot(snap({ 'node_modules/x.js': '', 'a.ts': 'a', 'README.md': '# hi', 'b.ts': 'b' }));
    expect(a.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(a).toEqual(b);
    expect(a.skippedFiles).toBe(2);
    expect(a.partial).toBe(false);
  });

  it('skips unsafe, duplicate, binary and oversized files with friendly diagnostics', () => {
    const result = validateSnapshot(
      { id: 'x', files: [{ path: '../evil.ts', content: '' }, { path: 'a.ts', content: '1' }, { path: './a.ts', content: '2' }, { path: 'bin.js', content: 'a\0b' }, { path: 'big.ts', content: 'x'.repeat(20) }] },
      { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 100 },
    );
    expect(result.files).toEqual([{ path: 'a.ts', content: '1', language: 'ts' }]);
    expect(result.diagnostics.map((item) => item.id)).toEqual(
      expect.arrayContaining(['diag:invalid-file', 'diag:duplicate-path:a.ts:1', 'diag:binary-file:bin.js:1', 'diag:file-too-large:big.ts:1']),
    );
  });

  it('marks the result partial when count or size limits drop files', () => {
    const byCount = validateSnapshot(snap({ 'a.ts': '', 'b.ts': '', 'c.ts': '' }), { maxFiles: 2, maxFileBytes: 10, maxTotalBytes: 100 });
    expect(byCount.files).toHaveLength(2);
    expect(byCount.partial).toBe(true);
    const bySize = validateSnapshot(snap({ 'a.ts': '12345', 'b.ts': '12345' }), { maxFiles: 10, maxFileBytes: 10, maxTotalBytes: 8 });
    expect(bySize.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(bySize.partial).toBe(true);
    expect(bySize.diagnostics.filter((item) => item.id === 'diag:snapshot-limit')).toHaveLength(1);
  });

  it('keeps bounded manifests and documents with safe paths', () => {
    const result = validateSnapshot(snap({}, { manifests: [{ path: 'package.json', content: '{}' }, { path: '/abs/package.json', content: '{}' }], documents: 'nope' }));
    expect(result.manifests).toEqual([{ path: 'package.json', content: '{}' }]);
    expect(result.documents).toEqual([]);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4);
  });
});

describe('parse helpers', () => {
  it('detects file directives', () => {
    const client = parseFile({ path: 'a.tsx', content: "'use client';\nexport default 1;", language: 'tsx' });
    const server = parseFile({ path: 'b.ts', content: '"use strict";\n"use server";\nexport async function x() {}', language: 'ts' });
    const none = parseFile({ path: 'c.ts', content: "import x from 'y';\n'use client';", language: 'ts' });
    expect(fileDirective(client.source)).toBe('use client');
    expect(fileDirective(server.source)).toBe('use server');
    expect(fileDirective(none.source)).toBeUndefined();
  });

  it('builds a bounded code reference around a node', () => {
    const content = ['// 1', 'const a = 1;', 'if (!session) {', '  redirect("/login");', '}', '// 6'].join('\n');
    const file = parseFile({ path: 'x.ts', content, language: 'ts' });
    const ifStatement = file.source.statements[1]!;
    expect(codeRef(file.source, ifStatement)).toEqual({
      path: 'x.ts',
      startLine: 2,
      endLine: 6,
      highlightLine: 3,
      highlightEndLine: 5,
      excerpt: ['const a = 1;', 'if (!session) {', '  redirect("/login");', '}', '// 6'].join('\n'),
    });
    expect(codeRef(file.source, ifStatement, { context: 0, maxLines: 2 }).endLine).toBe(4);
  });

  it('hides likely secrets in excerpts', () => {
    const text = 'const key = "sk_live_abcdefghijklmnop";\nconst password = "hunter2hunter2";\nconst name = "Ada Lovelace";';
    const result = redactSecrets(text);
    expect(result).not.toContain('sk_live_abcdefghijklmnop');
    expect(result).not.toContain('hunter2hunter2');
    expect(result).toContain('Ada Lovelace');
  });
});
