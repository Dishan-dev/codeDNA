import type { RepositorySnapshot, RepositoryText, SourceFile } from '@codedna/shared';

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
const documentPath = /(?:^|\/)readme(?:\.[\w.-]+)?\.md$|(?:^|\/)docs\/(?:[^/]+\/)*[^/]+\.md$|^(?:apps|packages)\/[^/]+\/[^/]+\.md$/i;
const manifestPath = /(?:^|\/)package\.json$/;
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
  const normalizeTexts = (
    value: RepositoryText[] | undefined,
    kind: 'documents' | 'manifests',
    pattern: RegExp,
    maxCount: number,
    maxBytes: number,
  ): RepositoryText[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > maxCount)
      throw new SnapshotValidationError(`Invalid ${kind} count`);
    let bytes = 0;
    return value.map((item) => {
      if (!item || typeof item.path !== 'string' || typeof item.content !== 'string')
        throw new SnapshotValidationError(`Malformed ${kind} entry`);
      const path = normalizePath(item.path);
      if (!pattern.test(path) || paths.has(path))
        throw new SnapshotValidationError(`Invalid or duplicate ${kind} path: ${path}`);
      paths.add(path);
      const size = byteLength(item.content);
      bytes += size;
      total += size;
      if (size > maxFileBytes || bytes > maxBytes || total > maxTotalBytes)
        throw new SnapshotValidationError(`Content size limit exceeded: ${path}`);
      return { path, content: item.content };
    }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  };
  const documents = normalizeTexts(input.documents, 'documents', documentPath, 100, 2 * 1024 * 1024);
  const manifests = normalizeTexts(input.manifests, 'manifests', manifestPath, 50, 1024 * 1024);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ...input, files, ...(documents ? { documents } : {}), ...(manifests ? { manifests } : {}) };
}
