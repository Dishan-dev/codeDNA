import type { AnalysisDiagnostic, RepositoryText, SourceLanguage } from '@codedna/shared';

export interface SnapshotLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}
export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxFiles: 2000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 40 * 1024 * 1024,
};
const MAX_TEXTS = 50;
const MAX_TEXT_BYTES = 1024 * 1024;

/** Thrown when the snapshot itself is malformed; per-file problems become diagnostics instead. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface ReadyFile {
  path: string;
  content: string;
  language: SourceLanguage;
}
export interface ValidatedSnapshot {
  id: string;
  revision?: string;
  /** Analyzable files, sorted by path. */
  files: ReadyFile[];
  manifests: RepositoryText[];
  documents: RepositoryText[];
  diagnostics: AnalysisDiagnostic[];
  skippedFiles: number;
  /** True when a count or size limit dropped files. */
  partial: boolean;
}

const IGNORED_DIR = /(?:^|\/)(?:node_modules|\.git|\.next|\.turbo|\.vercel|\.output|\.expo|dist|build|out|coverage|vendor)(?:\/|$)/i;
const BUNDLED = /\.(?:min|bundle)\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Repository-relative, forward-slash path without `.`/`..` segments; null when unsafe. */
export function normalizePath(path: unknown): string | null {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => part === '..')) return null;
  const normalized = parts.filter((part) => part && part !== '.').join('/');
  return normalized || null;
}

export function languageOf(path: string): SourceLanguage | null {
  if (/(?:^|\/)(?:tsconfig|jsconfig)(?:\.[\w-]+)?\.json$/.test(path)) return 'json';
  const match = /\.([cm]?[jt]sx?)$/.exec(path);
  if (!match) return null;
  const extension = match[1]!;
  if (extension.endsWith('tsx')) return 'tsx';
  if (extension.endsWith('jsx')) return 'jsx';
  return extension.endsWith('ts') ? 'ts' : 'js';
}

/** Whether CodeDNA reads this path at all. `.env*`, binaries and build output never qualify. */
export function isAnalyzablePath(path: string): boolean {
  return !IGNORED_DIR.test(path) && !BUNDLED.test(path) && languageOf(path) !== null;
}

/** UTF-8 byte length without platform APIs, so core stays runtime-independent. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

export const diagnostic = (code: string, severity: AnalysisDiagnostic['severity'], message: string, path?: string, line = 1): AnalysisDiagnostic => ({
  id: `diag:${code}${path ? `:${path}:${line}` : ''}`,
  severity,
  message,
  ...(path ? { location: { path, start: { line, column: 1 }, end: { line, column: 1 } } } : {}),
});

function validLimits(limits: SnapshotLimits): SnapshotLimits {
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid snapshot limit: ${name}`);
  return limits;
}

function texts(value: unknown): RepositoryText[] {
  if (!Array.isArray(value)) return [];
  const result: RepositoryText[] = [];
  let bytes = 0;
  const seen = new Set<string>();
  for (const item of value) {
    if (result.length >= MAX_TEXTS || !item || typeof item !== 'object') continue;
    const { path, content } = item as Record<string, unknown>;
    const normalized = normalizePath(path);
    if (!normalized || typeof content !== 'string' || seen.has(normalized)) continue;
    bytes += utf8Length(content);
    if (bytes > MAX_TEXT_BYTES) break;
    seen.add(normalized);
    result.push({ path: normalized, content });
  }
  return result.sort((a, b) => compare(a.path, b.path));
}

/**
 * Normalise an untrusted snapshot: safe paths only, analyzable languages only, bounded sizes.
 * Output is sorted, so the same files in any order give the same result.
 */
export function validateSnapshot(snapshot: unknown, limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS): ValidatedSnapshot {
  validLimits(limits);
  if (!snapshot || typeof snapshot !== 'object') throw new SnapshotError('The snapshot must be an object.');
  const { id, revision, files, manifests, documents } = snapshot as Record<string, unknown>;
  if (typeof id !== 'string' || !id) throw new SnapshotError('The snapshot needs an id.');
  if (!Array.isArray(files)) throw new SnapshotError('The snapshot needs a list of files.');

  const diagnostics: AnalysisDiagnostic[] = [];
  const candidates: { path: string; content: string }[] = [];
  let skippedFiles = 0;
  for (const file of files) {
    const record = file && typeof file === 'object' ? (file as Record<string, unknown>) : {};
    const path = normalizePath(record.path);
    if (!path || typeof record.content !== 'string') {
      skippedFiles++;
      diagnostics.push(diagnostic('invalid-file', 'warning', 'A file with an unsafe path or no text was skipped.', undefined));
      continue;
    }
    if (!isAnalyzablePath(path)) {
      skippedFiles++;
      continue;
    }
    candidates.push({ path, content: record.content });
  }
  candidates.sort((a, b) => compare(a.path, b.path));

  const ready: ReadyFile[] = [];
  let totalBytes = 0;
  let partial = false;
  let previous: string | undefined;
  for (const { path, content } of candidates) {
    if (path === previous) {
      skippedFiles++;
      diagnostics.push(diagnostic('duplicate-path', 'warning', `${path} appears more than once; the first copy was used.`, path));
      continue;
    }
    previous = path;
    if (content.includes('\0')) {
      skippedFiles++;
      diagnostics.push(diagnostic('binary-file', 'info', `${path} looks like a binary file and was skipped.`, path));
      continue;
    }
    const bytes = utf8Length(content);
    if (bytes > limits.maxFileBytes) {
      skippedFiles++;
      diagnostics.push(diagnostic('file-too-large', 'info', `${path} is too big to read and was skipped.`, path));
      continue;
    }
    if (ready.length >= limits.maxFiles || totalBytes + bytes > limits.maxTotalBytes) {
      skippedFiles++;
      if (!partial) diagnostics.push(diagnostic('snapshot-limit', 'warning', 'The repository is bigger than CodeDNA reads at once; some files were left out.'));
      partial = true;
      continue;
    }
    totalBytes += bytes;
    ready.push({ path, content, language: languageOf(path)! });
  }

  // Diagnostics without a path would otherwise repeat; keep one of each.
  const unique = [...new Map(diagnostics.map((item) => [item.id, item])).values()];
  return {
    id,
    ...(typeof revision === 'string' && revision ? { revision } : {}),
    files: ready,
    manifests: texts(manifests),
    documents: texts(documents),
    diagnostics: unique,
    skippedFiles,
    partial,
  };
}
