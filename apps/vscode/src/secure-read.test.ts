import {
  mkdtemp,
  rm,
  writeFile,
  rename,
  open,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readWorkspaceFile } from './secure-read.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'codedna-read-'));
  roots.push(root);
  await writeFile(join(root, 'a.ts'), 'safe');
  return root;
}
describe('race-resistant workspace reads', () => {
  it('reads regular files while rejecting traversal and oversize files', async () => {
    const root = await setup();
    const signal = new AbortController().signal;
    expect(
      Buffer.from(await readWorkspaceFile(root, 'a.ts', 10, signal)).toString(),
    ).toBe('safe');
    await expect(
      readWorkspaceFile(root, '../a.ts', 10, signal),
    ).rejects.toThrow('Unsafe');
    await expect(readWorkspaceFile(root, 'a.ts', 3, signal)).rejects.toThrow(
      'too large',
    );
  });
  it('rejects a file replaced between validation and opening', async () => {
    const root = await setup();
    const replacement = join(root, 'replacement');
    await writeFile(replacement, 'evil');
    const racingOpen: typeof open = async (
      ...args: Parameters<typeof open>
    ) => {
      await rename(join(root, 'a.ts'), join(root, 'old'));
      await rename(replacement, join(root, 'a.ts'));
      return open(...args);
    };
    await expect(
      readWorkspaceFile(
        root,
        'a.ts',
        10,
        new AbortController().signal,
        racingOpen,
      ),
    ).rejects.toThrow('Unsafe');
  });
  it.skipIf(process.platform === 'win32')(
    'rejects a symlink to a file outside the workspace',
    async () => {
      const root = await setup();
      const outside = await setup();
      await symlink(join(outside, 'a.ts'), join(root, 'link.ts'));
      await expect(
        readWorkspaceFile(root, 'link.ts', 10, new AbortController().signal),
      ).rejects.toThrow('Unsafe');
    },
  );
});
