import { createHash } from 'node:crypto';
import type { RepositorySnapshot } from '@codedna/shared';
export interface SnapshotLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxTimeMs: number;
}
export const DEFAULT_LIMITS: SnapshotLimits = {
  maxFiles: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxTimeMs: 30000,
};
export interface SnapshotProvider {
  list(
    max: number,
    signal: AbortSignal,
  ): Promise<{ paths: string[]; limited: boolean }>;
  read(path: string, signal: AbortSignal): Promise<Uint8Array>;
  safe(path: string): Promise<boolean>;
}
export interface AcquisitionDiagnostic {
  path: string;
  message: string;
}
export interface LocalSnapshot {
  snapshot: RepositorySnapshot;
  complete: boolean;
  diagnostics: AcquisitionDiagnostic[];
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function normalizeRelative(path: string): string | null {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.includes('\0')
  )
    return null;
  const parts = path.split('/');
  if (parts.some((p) => p === '..')) return null;
  const normalized = parts.filter((p) => p && p !== '.').join('/');
  return normalized || null;
}
export function supportedPath(path: string): boolean {
  if (
    /(?:^|\/)(?:node_modules|\.git|\.next|\.turbo|dist|build|coverage|vendor|out|\.output|\.expo)(?:\/|$)/i.test(
      path,
    )
  )
    return false;
  if (/\.(?:min|bundle)\.(?:ts|tsx|js|jsx)$/i.test(path)) return false;
  return /(?:\.(?:ts|tsx|js|jsx)|(?:^|\/)(?:tsconfig|jsconfig)\.json)$/.test(
    path,
  );
}
export async function acquireSnapshot(
  provider: SnapshotProvider,
  identity: string,
  signal: AbortSignal,
  limits: SnapshotLimits = DEFAULT_LIMITS,
): Promise<LocalSnapshot> {
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError('Invalid snapshot limit');
  const started = Date.now(),
    diagnostics: AcquisitionDiagnostic[] = [],
    files: RepositorySnapshot['files'] = [];
  let total = 0,
    complete = true;
  const stop = () => {
    if (signal.aborted) throw new Error('Analysis cancelled');
    if (Date.now() - started > limits.maxTimeMs)
      throw new Error('Workspace acquisition timed out');
  };
  const listed = await provider.list(limits.maxFiles + 1, signal);
  stop();
  if (listed.limited) {
    complete = false;
    diagnostics.push({
      path: '',
      message: 'File search reached its limit; results are partial.',
    });
  }
  const seen = new Set<string>();
  for (const raw of [...listed.paths].sort(cmp)) {
    stop();
    const path = normalizeRelative(raw);
    if (!path) {
      complete = false;
      diagnostics.push({
        path: raw,
        message: 'Invalid relative path was skipped.',
      });
      continue;
    }
    if (!supportedPath(path)) continue;
    if (seen.has(path)) {
      complete = false;
      diagnostics.push({ path, message: 'Duplicate path was skipped.' });
      continue;
    }
    seen.add(path);
    if (files.length >= limits.maxFiles) {
      complete = false;
      diagnostics.push({ path, message: 'File count limit reached.' });
      break;
    }
    try {
      if (!(await provider.safe(path))) {
        complete = false;
        diagnostics.push({
          path,
          message: 'Symlink or unsafe path was skipped.',
        });
        continue;
      }
      stop();
      const bytes = await provider.read(path, signal);
      stop();
      if (
        bytes.byteLength > limits.maxFileBytes ||
        total + bytes.byteLength > limits.maxTotalBytes
      ) {
        complete = false;
        diagnostics.push({
          path,
          message: 'Content size limit exceeded; file skipped.',
        });
        continue;
      }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) {
        complete = false;
        diagnostics.push({ path, message: 'Binary content was skipped.' });
        continue;
      }
      total += bytes.byteLength;
      files.push({ id: path, path, content });
    } catch (error) {
      stop();
      complete = false;
      diagnostics.push({
        path,
        message:
          error instanceof Error && error.message === 'File too large'
            ? 'File size limit exceeded.'
            : 'File could not be read as UTF-8.',
      });
    }
  }
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  const revision = hash.digest('hex');
  return {
    snapshot: {
      schemaVersion: '1.0',
      id: `local:${identity}@${revision}`,
      revision,
      files,
    },
    complete,
    diagnostics,
  };
}
