import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCAL_LIMITS, readLocalSnapshot } from './local-snapshot.js';

let root: string;
const write = (path: string, content: string) => {
  const full = join(root, ...path.split('/'));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codedna-local-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('readLocalSnapshot', () => {
  it('reads sources, configs, manifests and READMEs only', async () => {
    write('app/page.tsx', 'export default function Page() {}');
    write('tsconfig.json', '{}');
    write('package.json', '{ "dependencies": { "next": "15" } }');
    write('README.md', '# Demo');
    write('.env', 'SECRET=1');
    write('.env.local', 'SECRET=2');
    write('node_modules/next/index.js', 'x');
    write('.next/server.js', 'x');
    write('public/logo.png', 'png');
    write('.github/workflows/ci.ts', 'x');
    const { snapshot, complete } = await readLocalSnapshot(root);
    expect(snapshot.files.map((file) => file.path)).toEqual(['app/page.tsx', 'tsconfig.json']);
    expect(snapshot.manifests?.map((file) => file.path)).toEqual(['package.json']);
    expect(snapshot.documents?.map((file) => file.path)).toEqual(['README.md']);
    expect(JSON.stringify(snapshot)).not.toContain('SECRET');
    expect(complete).toBe(true);
  });

  it('skips what .gitignore files ignore, at the root and in sub-folders', async () => {
    write('.gitignore', 'generated/\n*.local.ts\n');
    write('app/page.tsx', 'export default 1;');
    write('generated/client.ts', 'export const huge = 1;');
    write('app/secret.local.ts', 'export const x = 1;');
    write('packages/ui/.gitignore', 'stories/\n');
    write('packages/ui/button.tsx', 'export const Button = 1;');
    write('packages/ui/stories/button.tsx', 'export const Story = 1;');
    write('stories/kept.ts', 'export const kept = 1;');
    const { snapshot, skipped } = await readLocalSnapshot(root);
    expect(snapshot.files.map((file) => file.path)).toEqual(['app/page.tsx', 'packages/ui/button.tsx', 'stories/kept.ts']);
    expect(skipped).toBe(1);
  });

  it('gives the same id for the same content and a new one when content changes', async () => {
    write('a.ts', 'export const a = 1;');
    const first = await readLocalSnapshot(root);
    const again = await readLocalSnapshot(root);
    write('a.ts', 'export const a = 2;');
    const changed = await readLocalSnapshot(root);
    expect(again.snapshot.id).toBe(first.snapshot.id);
    expect(changed.snapshot.revision).not.toBe(first.snapshot.revision);
  });

  it('skips oversized and non-UTF-8 files and stops at the file limit', async () => {
    write('big.ts', 'x'.repeat(100));
    writeFileSync(join(root, 'binary.js'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    write('a.ts', '1');
    write('b.ts', '2');
    const result = await readLocalSnapshot(root, { ...DEFAULT_LOCAL_LIMITS, maxFileBytes: 50, maxFiles: 1 });
    expect(result.snapshot.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(result.complete).toBe(false);
  });

  it('never follows symlinks out of the folder', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codedna-outside-'));
    writeFileSync(join(outside, 'secret.ts'), 'export const secret = 1;');
    write('a.ts', '1');
    try {
      symlinkSync(outside, join(root, 'linked-dir'), 'junction');
      symlinkSync(join(outside, 'secret.ts'), join(root, 'link.ts'));
    } catch {
      // File symlinks can need extra rights on Windows; the junction above still covers the folder case.
    }
    const { snapshot } = await readLocalSnapshot(root);
    expect(snapshot.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    rmSync(outside, { recursive: true, force: true });
  });
});
