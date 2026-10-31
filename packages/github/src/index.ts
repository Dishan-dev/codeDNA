import { createHash } from 'node:crypto';
import type { RepositorySnapshot, SourceFile } from '@codedna/shared';
import { readArchive } from './archive.js';

export interface RepositoryIdentity {
  owner: string;
  repo: string;
  url: string;
}
export type AcquisitionErrorCode =
  | 'invalid_url'
  | 'not_found'
  | 'private_repository'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response'
  | 'truncated_tree'
  | 'limit_exceeded'
  | 'timeout'
  | 'cancelled';
export class AcquisitionError extends Error {
  constructor(
    public readonly code: AcquisitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AcquisitionError';
  }
}
export interface AcquisitionResult {
  repository: RepositoryIdentity;
  commitSha: string;
  snapshot: RepositorySnapshot;
  diagnostics: { code: string; path: string; message: string }[];
  completeness: { complete: boolean; skippedFiles: number };
}
export interface AcquisitionOptions {
  token?: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  limits?: Partial<AcquisitionLimits>;
  strategy?: 'blobs' | 'archive';
}
export interface AcquisitionLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxRequests: number;
  timeoutMs: number;
  concurrency: number;
}
const defaults: AcquisitionLimits = {
  maxFiles: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxRequests: 1003,
  timeoutMs: 30000,
  concurrency: 4,
};
const maximums: AcquisitionLimits = {
  ...defaults,
  timeoutMs: 60000,
  concurrency: 8,
};
const shaPattern = /^[0-9a-f]{40}$/;
const ignored = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'vendor',
  '.output',
  'out',
]);

/** Accept only an unambiguous canonical HTTPS GitHub repository URL. */
export function parseRepositoryUrl(value: string): RepositoryIdentity {
  if (typeof value !== 'string')
    throw new AcquisitionError(
      'invalid_url',
      'Enter a valid GitHub repository URL.',
    );
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]{1,100})$/.exec(
      value,
    );
  if (
    !match ||
    !match[1] ||
    !match[2] ||
    match[1].includes('--') ||
    match[2] === '.' ||
    match[2] === '..' ||
    match[2].includes('..') ||
    match[2].toLowerCase().endsWith('.git')
  )
    throw new AcquisitionError(
      'invalid_url',
      'Use a canonical URL like https://github.com/owner/repository.',
    );
  const owner = match[1].toLowerCase();
  const repo = match[2].toLowerCase();
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}
const fail = (code: AcquisitionErrorCode, message: string): never => {
  throw new AcquisitionError(code, message);
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('invalid_response', 'GitHub returned an invalid response.');
  return value as Record<string, unknown>;
};
const sha = (value: unknown): string =>
  typeof value === 'string' && shaPattern.test(value)
    ? value
    : fail('invalid_response', 'GitHub returned an invalid object identifier.');
const safePath = (path: string) =>
  !!path &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !path.includes('\0') &&
  !/^[A-Za-z]:/.test(path) &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const included = (path: string) =>
  /\.(?:ts|tsx|js|jsx)$/.test(path) ||
  /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(path);
const excluded = (path: string) =>
  path.split('/').some((part) => ignored.has(part)) ||
  /(?:\.min|\.bundle)\.(?:js|jsx|ts|tsx)$/.test(path);

/** Fetch a pinned public snapshot. All network destinations are fixed GitHub API endpoints. */
export async function acquireRepository(
  url: string,
  options: AcquisitionOptions = {},
): Promise<AcquisitionResult> {
  const repository = parseRepositoryUrl(url);
  const limits = { ...defaults, ...options.limits };
  for (const key of Object.keys(defaults) as (keyof AcquisitionLimits)[])
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > maximums[key]
    )
      fail('limit_exceeded', `Invalid acquisition limit: ${key}.`);
  const controller = new AbortController();
  let timedOut = false;
  let requests = 0;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, limits.timeoutMs);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const fetcher = options.fetch ?? fetch;
  const base = `https://api.github.com/repos/${repository.owner}/${repository.repo}`;
  async function request(
    path: string,
    maxResponseBytes: number,
  ): Promise<Record<string, unknown>> {
    if (controller.signal.aborted)
      fail(
        timedOut ? 'timeout' : 'cancelled',
        timedOut
          ? 'Repository acquisition timed out.'
          : 'Repository acquisition was cancelled.',
      );
    if (++requests > limits.maxRequests)
      fail('limit_exceeded', 'GitHub request limit exceeded.');
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        headers,
        signal: controller.signal,
        redirect: 'manual',
        cache: 'no-store',
      });
    } catch {
      if (controller.signal.aborted)
        fail(
          timedOut ? 'timeout' : 'cancelled',
          timedOut
            ? 'Repository acquisition timed out.'
            : 'Repository acquisition was cancelled.',
        );
      return fail('upstream_error', 'Could not reach GitHub.');
    }
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' ||
          response.headers.has('retry-after')))
    )
      fail('rate_limited', 'GitHub rate limit reached. Try again later.');
    if (response.status === 404)
      fail(
        'not_found',
        'The public repository or a required Git object was not found.',
      );
    if (!response.ok)
      fail('upstream_error', 'GitHub could not complete the request.');
    if (!response.body)
      fail('invalid_response', 'GitHub returned an empty response.');
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxResponseBytes) {
          await reader.cancel();
          fail('limit_exceeded', 'GitHub response exceeds the allowed size.');
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AcquisitionError) throw error;
      if (controller.signal.aborted)
        fail(
          timedOut ? 'timeout' : 'cancelled',
          timedOut
            ? 'Repository acquisition timed out.'
            : 'Repository acquisition was cancelled.',
        );
      return fail('upstream_error', 'GitHub response could not be read.');
    }
    try {
      return record(
        JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        ) as unknown,
      );
    } catch (error) {
      if (error instanceof AcquisitionError) throw error;
      return fail('invalid_response', 'GitHub returned invalid JSON.');
    }
  }
  try {
    const meta = await request('', 1024 * 1024);
    if (typeof meta.private !== 'boolean')
      fail('invalid_response', 'GitHub returned invalid repository metadata.');
    if (meta.private !== false)
      fail('private_repository', 'Only public repositories are supported.');
    if (
      typeof meta.default_branch !== 'string' ||
      !meta.default_branch ||
      meta.default_branch.length > 255
    )
      fail('invalid_response', 'GitHub returned an invalid default branch.');
    const commit = await request(
      `/commits/${encodeURIComponent(meta.default_branch as string)}`,
      1024 * 1024,
    );
    const commitSha = sha(commit.sha);
    const treeSha = sha(record(record(commit.commit).tree).sha);
    const tree = await request(
      `/git/trees/${treeSha}?recursive=1`,
      8 * 1024 * 1024,
    );
    if (tree.truncated !== false)
      fail('truncated_tree', 'GitHub returned an incomplete file tree.');
    if (sha(tree.sha) !== treeSha || !Array.isArray(tree.tree))
      fail('invalid_response', 'GitHub returned an invalid file tree.');
    const skipped: { code: string; path: string; message: string }[] = [];
    const entries: { path: string; sha: string; size: number }[] = [];
    const seen = new Set<string>();
    let total = 0;
    for (const item of tree.tree as unknown[]) {
      const entry = record(item);
      if (!['tree', 'blob', 'commit'].includes(String(entry.type)))
        fail('invalid_response', 'GitHub returned an invalid tree entry.');
      sha(entry.sha);
      if (typeof entry.path !== 'string' || !safePath(entry.path))
        fail('invalid_response', 'GitHub returned an invalid file path.');
      const path = entry.path as string;
      if (seen.has(path))
        fail('invalid_response', 'GitHub returned duplicate file paths.');
      seen.add(path);
      if (excluded(path)) continue;
      if (entry.type === 'commit' || entry.mode === '120000') {
        skipped.push({
          code:
            entry.type === 'commit' ? 'submodule_skipped' : 'symlink_skipped',
          path,
          message: 'Submodule or symbolic link was not acquired.',
        });
        continue;
      }
      if (!included(path) || entry.type === 'tree') continue;
      if (
        entry.type !== 'blob' ||
        (entry.mode !== '100644' && entry.mode !== '100755')
      )
        fail(
          'invalid_response',
          'A supported source entry is not a regular file.',
        );
      if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0)
        fail('invalid_response', 'GitHub returned an invalid file size.');
      const size = entry.size as number;
      total += size;
      if (
        size > limits.maxFileBytes ||
        total > limits.maxTotalBytes ||
        entries.length + 1 > limits.maxFiles
      )
        fail('limit_exceeded', 'Repository source exceeds acquisition limits.');
      entries.push({ path, sha: sha(entry.sha), size });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const blobSizes = new Map<string, number>();
    for (const entry of entries) {
      const size = blobSizes.get(entry.sha);
      if (size !== undefined && size !== entry.size)
        fail('invalid_response', 'GitHub returned inconsistent blob sizes.');
      blobSizes.set(entry.sha, entry.size);
    }
    if (
      (options.strategy === 'archive' ? 1 : blobSizes.size) + requests >
      limits.maxRequests
    )
      fail('limit_exceeded', 'Repository exceeds the GitHub request limit.');
    let archive: Map<string, Uint8Array> | undefined;
    if (options.strategy === 'archive') {
      if (controller.signal.aborted)
        fail(
          timedOut ? 'timeout' : 'cancelled',
          timedOut
            ? 'Repository acquisition timed out.'
            : 'Repository acquisition was cancelled.',
        );
      requests++;
      let response: Response;
      try {
        response = await fetcher(
          `https://codeload.github.com/${repository.owner}/${repository.repo}/tar.gz/${commitSha}`,
          { signal: controller.signal, redirect: 'manual', cache: 'no-store' },
        );
        if (!response.ok)
          fail(
            'upstream_error',
            'GitHub could not download the repository archive.',
          );
        archive = await readArchive(response, entries, controller.signal);
      } catch (error) {
        if (controller.signal.aborted)
          fail(
            timedOut ? 'timeout' : 'cancelled',
            timedOut
              ? 'Repository acquisition timed out.'
              : 'Repository acquisition was cancelled.',
          );
        if (error instanceof AcquisitionError) throw error;
        fail('upstream_error', 'Could not download the repository archive.');
      }
    }
    const blobs = new Map<string, Promise<Record<string, unknown>>>();
    const results: (
      | { file: SourceFile }
      | { binary: string }
      | { lfs: string }
    )[] = new Array(entries.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        const entry = entries[index];
        if (!entry) return;
        let bytes: Buffer;
        if (archive) {
          bytes = Buffer.from(archive.get(entry.path)!);
        } else {
          let pending = blobs.get(entry.sha);
          if (!pending) {
            pending = request(
              `/git/blobs/${entry.sha}`,
              Math.ceil(limits.maxFileBytes * 1.5) + 65536,
            );
            blobs.set(entry.sha, pending);
          }
          const blob = await pending;
          if (
            sha(blob.sha) !== entry.sha ||
            blob.encoding !== 'base64' ||
            typeof blob.content !== 'string' ||
            blob.size !== entry.size
          )
            fail('invalid_response', 'GitHub returned an invalid file blob.');
          const encoded = (blob.content as string).replace(/\n/g, '');
          if (
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              encoded,
            )
          )
            fail('invalid_response', 'GitHub returned invalid blob content.');
          const decoded = Buffer.from(encoded, 'base64');
          const calculated = createHash('sha1')
            .update(`blob ${decoded.length}\0`)
            .update(decoded)
            .digest('hex');
          if (decoded.length !== entry.size || calculated !== entry.sha)
            fail(
              'invalid_response',
              'GitHub returned a blob that does not match its tree.',
            );
          bytes = decoded;
        }
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          results[index] = { binary: entry.path };
          continue;
        }
        if (content.includes('\0')) {
          results[index] = { binary: entry.path };
          continue;
        }
        if (
          /^version https:\/\/git-lfs\.github\.com\/spec\/v1\r?\n/.test(content)
        ) {
          results[index] = { lfs: entry.path };
          continue;
        }
        results[index] = {
          file: { id: entry.path, path: entry.path, content },
        };
      }
    }
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(limits.concurrency, entries.length) },
          () => worker(),
        ),
      );
    } catch (error) {
      controller.abort();
      throw error;
    }
    const files = results.flatMap((item) =>
      'file' in item ? [item.file] : [],
    );
    const diagnostics = [
      ...skipped,
      ...results.flatMap((item) =>
        'binary' in item
          ? [
              {
                code: 'binary_file_skipped',
                path: item.binary,
                message: 'Non-text source entry was skipped.',
              },
            ]
          : 'lfs' in item
            ? [
                {
                  code: 'lfs_pointer_skipped',
                  path: item.lfs,
                  message: 'Git LFS content was not acquired.',
                },
              ]
            : [],
      ),
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {
      repository,
      commitSha,
      snapshot: {
        schemaVersion: '1.0',
        id: `${repository.owner}/${repository.repo}@${commitSha}`,
        revision: commitSha,
        files,
      },
      diagnostics,
      completeness: {
        complete: diagnostics.length === 0,
        skippedFiles: diagnostics.length,
      },
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
