import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { isAnalyzablePath } from '@codedna/core';
import ignore, { type Ignore } from 'ignore';
import type { RepositorySnapshot, RepositoryText } from '@codedna/shared';

export interface LocalSnapshotLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Directory entries looked at, so huge folders cannot stall the walk. */
  maxEntries: number;
  maxDepth: number;
}
export const DEFAULT_LOCAL_LIMITS: LocalSnapshotLimits = {
  maxFiles: 2000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
  maxEntries: 100_000,
  maxDepth: 24,
};
export interface LocalSnapshot {
  snapshot: RepositorySnapshot;
  /** False when a limit stopped the walk early. */
  complete: boolean;
  skipped: number;
}

/** Folders that never hold the learner's own source. Dot-folders are skipped too. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '.git', '.next', '.turbo', '.vercel', '.output', '.expo']);
const MANIFEST = /(?:^|\/)package\.json$/;
const DOCUMENT = /^(?:[^/]+\/)?readme(?:\.[\w-]+)?\.md$/i;
const MAX_TEXTS = 50;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
interface GitIgnore {
  /** Folder the .gitignore lives in, relative to the root ('' for the root). */
  base: string;
  matcher: Ignore;
}
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Read one regular file without following symlinks, refusing anything outside the root. */
async function readInside(root: string, path: string, maxBytes: number): Promise<string | undefined> {
  const full = join(root, ...path.split('/'));
  const real = await realpath(full).catch(() => undefined);
  if (!real || relative(root, real).startsWith('..') || relative(root, real) !== path.split('/').join(sep)) return undefined;
  // O_NOFOLLOW is not available on Windows; the realpath check above covers that case.
  const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) return undefined;
    const buffer = Buffer.alloc(stats.size);
    const { bytesRead } = await handle.read(buffer, 0, stats.size, 0);
    return decoder.decode(buffer.subarray(0, bytesRead));
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/**
 * Snapshot a local folder for analysis. Only TypeScript/JavaScript sources, tsconfig/jsconfig,
 * package.json and READMEs are read; `.env*` files, binaries, symlinks, build output and anything
 * in a `.gitignore` never are.
 * Code stays on this machine: the result is only handed to the local analysis worker.
 */
export async function readLocalSnapshot(folder: string, limits: LocalSnapshotLimits = DEFAULT_LOCAL_LIMITS): Promise<LocalSnapshot> {
  const root = await realpath(folder);
  const sources: string[] = [];
  const texts: string[] = [];
  let entries = 0;
  let complete = true;
  let skipped = 0;

  /** `.gitignore` rules apply to their own folder and below, like git. */
  const ignoredBy = (rules: readonly GitIgnore[], path: string, isDirectory: boolean) =>
    rules.some(({ base, matcher }) => {
      const local = base ? path.slice(base.length + 1) : path;
      return matcher.ignores(isDirectory ? `${local}/` : local);
    });
  const walk = async (dir: string, depth: number, inherited: readonly GitIgnore[]): Promise<void> => {
    if (depth > limits.maxDepth) {
      complete = false;
      return;
    }
    const children = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => compare(a.name, b.name));
    const base = relative(root, dir).split(sep).join('/');
    const gitignore = children.some((child) => child.isFile() && child.name === '.gitignore') ? await readInside(root, base ? `${base}/.gitignore` : '.gitignore', 256 * 1024) : undefined;
    const rules = gitignore === undefined ? inherited : [...inherited, { base, matcher: ignore().add(gitignore) }];
    for (const child of children) {
      if (++entries > limits.maxEntries) {
        complete = false;
        return;
      }
      if (child.isSymbolicLink()) continue;
      const full = join(dir, child.name);
      const path = relative(root, full).split(sep).join('/');
      if (ignoredBy(rules, path, child.isDirectory())) {
        if (child.isFile() && isAnalyzablePath(path)) skipped++;
        continue;
      }
      if (child.isDirectory()) {
        if (!SKIPPED_DIRS.has(child.name) && !child.name.startsWith('.')) await walk(full, depth + 1, rules);
      } else if (child.isFile()) {
        if (isAnalyzablePath(path)) sources.push(path);
        else if ((MANIFEST.test(path) || DOCUMENT.test(path)) && texts.length < MAX_TEXTS) texts.push(path);
      }
    }
  };
  await walk(root, 0, []);

  const files: RepositorySnapshot['files'] = [];
  const hash = createHash('sha256');
  let total = 0;
  for (const path of sources.sort(compare)) {
    if (files.length >= limits.maxFiles) {
      complete = false;
      skipped++;
      continue;
    }
    const content = await readInside(root, path, limits.maxFileBytes);
    if (content === undefined || total + content.length > limits.maxTotalBytes) {
      skipped++;
      continue;
    }
    total += content.length;
    files.push({ id: path, path, content });
    hash.update(path).update('\0').update(content).update('\0');
  }
  const manifests: RepositoryText[] = [];
  const documents: RepositoryText[] = [];
  for (const path of texts.sort(compare)) {
    const content = await readInside(root, path, 256 * 1024);
    if (content === undefined) continue;
    (MANIFEST.test(path) ? manifests : documents).push({ path, content });
    hash.update(path).update('\0').update(content).update('\0');
  }
  const revision = hash.digest('hex').slice(0, 12);
  return {
    snapshot: { schemaVersion: '1.0', id: `local:${basename(root)}@${revision}`, revision, files, manifests, documents },
    complete,
    skipped,
  };
}
