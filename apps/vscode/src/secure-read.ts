import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { normalizeRelative } from './snapshot.js';

/** Best-effort race-resistant local read. Ancestor swaps cannot be eliminated portably. */
export async function readWorkspaceFile(
  rootPath: string,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
  openFile: typeof open = open,
): Promise<Uint8Array> {
  if (normalizeRelative(path) !== path || signal.aborted)
    throw new Error('Unsafe file');
  const target = resolve(rootPath, ...path.split('/'));
  const root = await realpath(rootPath);
  const inside = async () => {
    const resolved = relative(root, await realpath(target));
    return (
      !!resolved &&
      !isAbsolute(resolved) &&
      resolved !== '..' &&
      !resolved.startsWith(`..${sep}`)
    );
  };
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || !(await inside()))
    throw new Error('Unsafe file');
  if (before.size > maxBytes) throw new Error('File too large');
  const flags =
    constants.O_RDONLY |
    (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
  const file = await openFile(target, flags);
  try {
    const same = (a: typeof before, b: typeof before) =>
      a.dev === b.dev &&
      a.ino === b.ino &&
      a.size === b.size &&
      a.mtimeMs === b.mtimeMs;
    const opened = await file.stat();
    if (!opened.isFile() || !same(before, opened) || !(await inside()))
      throw new Error('Unsafe file');
    const bytes = Buffer.alloc(opened.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      if (signal.aborted) throw new Error('Analysis cancelled');
      const result = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const [after, current] = await Promise.all([file.stat(), lstat(target)]);
    if (
      offset !== opened.size ||
      !same(opened, after) ||
      !same(opened, current) ||
      current.isSymbolicLink() ||
      !(await inside())
    )
      throw new Error('File changed during read');
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}
