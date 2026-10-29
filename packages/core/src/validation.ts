import type { RepositorySnapshot, SourceFile } from '@codedna/shared';

export interface AnalysisOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
export class SnapshotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotValidationError';
  }
}
const supported =
  /(?:\.(?:ts|tsx|js|jsx)|(?:^|\/)(?:tsconfig|jsconfig)\.json)$/;
export function normalizePath(path: string): string {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\0')
  )
    throw new SnapshotValidationError(`Invalid relative path: ${path}`);
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..')
      throw new SnapshotValidationError(`Path traversal: ${path}`);
    if (part && part !== '.') parts.push(part);
  }
  if (!parts.length)
    throw new SnapshotValidationError(`Invalid relative path: ${path}`);
  return parts.join('/');
}
function byteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const c = char.codePointAt(0)!;
    bytes += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export function validateSnapshot(
  input: RepositorySnapshot,
  options: AnalysisOptions,
): RepositorySnapshot {
  const limit = (value: number | undefined, fallback: number, name: string) => {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 0)
      throw new SnapshotValidationError(`Invalid ${name}`);
    return result;
  };
  const maxFiles = limit(options.maxFiles, 10000, 'maxFiles');
  const maxFileBytes = limit(
    options.maxFileBytes,
    2 * 1024 * 1024,
    'maxFileBytes',
  );
  const maxTotalBytes = limit(
    options.maxTotalBytes,
    50 * 1024 * 1024,
    'maxTotalBytes',
  );
  if (
    !input ||
    typeof input !== 'object' ||
    input.schemaVersion !== '1.0' ||
    typeof input.id !== 'string' ||
    !input.id.trim() ||
    !Array.isArray(input.files) ||
    (input.revision !== undefined && typeof input.revision !== 'string')
  )
    throw new SnapshotValidationError(
      'Malformed snapshot or unsupported schema version',
    );
  if (input.files.length > maxFiles)
    throw new SnapshotValidationError('File count limit exceeded');
  const paths = new Set<string>();
  const ids = new Set<string>();
  let total = 0;
  const files: SourceFile[] = input.files.map((file: SourceFile) => {
    if (
      !file ||
      typeof file !== 'object' ||
      typeof file.id !== 'string' ||
      !file.id.trim() ||
      typeof file.path !== 'string' ||
      typeof file.content !== 'string' ||
      (file.language !== undefined && typeof file.language !== 'string')
    )
      throw new SnapshotValidationError('Malformed source file');
    const path = normalizePath(file.path);
    if (!supported.test(path))
      throw new SnapshotValidationError(`Unsupported file: ${path}`);
    if (paths.has(path) || ids.has(file.id))
      throw new SnapshotValidationError(`Duplicate path or file ID: ${path}`);
    paths.add(path);
    ids.add(file.id);
    const size = byteLength(file.content);
    total += size;
    if (size > maxFileBytes || total > maxTotalBytes)
      throw new SnapshotValidationError(`Content size limit exceeded: ${path}`);
    return { ...file, path };
  });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ...input, files };
}
