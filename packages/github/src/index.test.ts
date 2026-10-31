import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from '@codedna/core';
import {
  acquireRepository,
  AcquisitionError,
  parseRepositoryUrl,
} from './index.js';
const commit = 'a'.repeat(40);
const tree = 'b'.repeat(40);
function blob(content: string) {
  const bytes = Buffer.from(content);
  return {
    sha: createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex'),
    size: bytes.length,
    encoding: 'base64',
    content: bytes.toString('base64'),
  };
}
function setup(
  config: {
    truncated?: boolean;
    missingBlob?: boolean;
    binary?: boolean;
    private?: boolean;
    status?: number;
    mismatch?: boolean;
    lfs?: boolean;
    links?: boolean;
    duplicate?: boolean;
    inconsistent?: boolean;
  } = {},
) {
  const a = blob(`import './util';`);
  const b = blob('export const n = 1;');
  const binary = blob('hi\0');
  const lfs = blob(
    'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n',
  );
  const entries = [
    {
      path: 'src/util.ts',
      type: 'blob',
      mode: '100644',
      sha: b.sha,
      size: b.size,
    },
    {
      path: 'src/main.ts',
      type: 'blob',
      mode: '100644',
      sha: a.sha,
      size: a.size,
    },
    {
      path: 'node_modules/lib/index.js',
      type: 'blob',
      mode: '100644',
      sha: a.sha,
      size: a.size,
    },
    {
      path: 'README.md',
      type: 'blob',
      mode: '100644',
      sha: a.sha,
      size: a.size,
    },
    ...(config.duplicate || config.inconsistent
      ? [
          {
            path: 'src/copy.ts',
            type: 'blob',
            mode: '100644',
            sha: b.sha,
            size: config.inconsistent ? b.size + 1 : b.size,
          },
        ]
      : []),
    ...(config.lfs
      ? [
          {
            path: 'src/asset.ts',
            type: 'blob',
            mode: '100644',
            sha: lfs.sha,
            size: lfs.size,
          },
        ]
      : []),
    ...(config.links
      ? [
          { path: 'module', type: 'commit', mode: '160000', sha: commit },
          { path: 'src/link.js', type: 'blob', mode: '120000', sha: a.sha },
        ]
      : []),
    ...(config.binary
      ? [
          {
            path: 'src/binary.js',
            type: 'blob',
            mode: '100644',
            sha: binary.sha,
            size: binary.size,
          },
        ]
      : []),
  ];
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (config.status)
      return new Response('', {
        status: config.status,
        headers: config.status === 403 ? { 'x-ratelimit-remaining': '0' } : {},
      });
    if (url.endsWith('/repos/test/repo'))
      return Response.json({
        private: config.private ?? false,
        default_branch: 'main/branch',
      });
    if (url.endsWith('/commits/main%2Fbranch'))
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    if (url.endsWith(`/git/trees/${tree}?recursive=1`))
      return Response.json({
        sha: tree,
        truncated: config.truncated ?? false,
        tree: entries,
      });
    if (url.includes('/git/blobs/')) {
      if (config.missingBlob) return new Response('', { status: 404 });
      const id = url.split('/').at(-1);
      const found = [a, b, binary, lfs].find((x) => x.sha === id);
      return found
        ? Response.json(
            config.mismatch
              ? {
                  ...found,
                  content: Buffer.from('tampered').toString('base64'),
                }
              : found,
          )
        : new Response('', { status: 404 });
    }
    throw new Error('unexpected URL');
  };
  return { fetcher, calls };
}
describe('GitHub acquisition', () => {
  it('strictly parses canonical URLs', () => {
    expect(parseRepositoryUrl('https://github.com/Owner/Repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      url: 'https://github.com/owner/repo',
    });
    for (const url of [
      'http://github.com/a/b',
      'https://github.com/a/b/',
      'https://github.com/a/b.git',
      'https://github.com/a/../b',
      'https://github.com/a/%2e%2e',
      'https://github.com/a/b?x=1',
      'https://x@github.com/a/b',
      'https://github.com:443/a/b',
      'https://github.com.evil/a/b',
      'https://github.com/a/b/c',
      'https://github.com/a//b',
    ])
      expect(() => parseRepositoryUrl(url)).toThrow(AcquisitionError);
  });
  it('pins a commit, filters files, verifies blob content and produces a core-valid ordered snapshot', async () => {
    const { fetcher, calls } = setup();
    const result = await acquireRepository('https://github.com/Test/Repo', {
      fetch: fetcher,
      token: 'secret',
    });
    expect(result.commitSha).toBe(commit);
    expect(result.snapshot.revision).toBe(commit);
    expect(result.snapshot.files.map((f) => f.path)).toEqual([
      'src/main.ts',
      'src/util.ts',
    ]);
    expect(result.completeness.complete).toBe(true);
    expect(analyzeSnapshot(result.snapshot).dependencyGraph.edges).toHaveLength(
      1,
    );
    expect(
      calls.some((call) => call.url.endsWith(`/git/trees/${tree}?recursive=1`)),
    ).toBe(true);
    expect(
      calls.every((call) =>
        call.url.startsWith('https://api.github.com/repos/test/repo'),
      ),
    ).toBe(true);
    expect(
      calls.every(
        (call) =>
          call.init?.redirect === 'manual' &&
          (call.init.headers as Record<string, string>).Authorization ===
            'Bearer secret',
      ),
    ).toBe(true);
  });
  it('fetches identical blobs once while preserving every source path', async () => {
    const { fetcher, calls } = setup({ duplicate: true });
    const result = await acquireRepository('https://github.com/test/repo', {
      fetch: fetcher,
      limits: { maxRequests: 5 },
    });
    expect(result.snapshot.files.map((file) => file.path)).toEqual([
      'src/copy.ts',
      'src/main.ts',
      'src/util.ts',
    ]);
    expect(
      calls.filter((call) => call.url.includes('/git/blobs/')),
    ).toHaveLength(2);
    expect(result.snapshot.files[0]?.content).toBe(
      result.snapshot.files[2]?.content,
    );
  });
  it('rejects inconsistent sizes for the same blob before downloading content', async () => {
    const { fetcher, calls } = setup({ inconsistent: true });
    await expect(
      acquireRepository('https://github.com/test/repo', { fetch: fetcher }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(calls).toHaveLength(3);
  });
  it('reports binary files as explicitly partial', async () => {
    const { fetcher } = setup({ binary: true });
    const result = await acquireRepository('https://github.com/test/repo', {
      fetch: fetcher,
    });
    expect(result.completeness).toEqual({ complete: false, skippedFiles: 1 });
    expect(result.diagnostics[0]?.path).toBe('src/binary.js');
  });
  it.each([
    { config: { truncated: true }, code: 'truncated_tree' },
    { config: { missingBlob: true }, code: 'not_found' },
    { config: { private: true }, code: 'private_repository' },
    { config: { status: 403 }, code: 'rate_limited' },
    { config: { status: 429 }, code: 'rate_limited' },
    { config: { status: 302 }, code: 'upstream_error' },
    { config: { status: 500 }, code: 'upstream_error' },
    { config: { mismatch: true }, code: 'invalid_response' },
  ])('fails closed for $code', async ({ config, code }) => {
    const { fetcher } = setup(config);
    await expect(
      acquireRepository('https://github.com/test/repo', { fetch: fetcher }),
    ).rejects.toMatchObject({ code });
  });
  it('reports submodules, links, and LFS pointers without pretending completeness', async () => {
    const { fetcher, calls } = setup({ lfs: true, links: true });
    const result = await acquireRepository('https://github.com/test/repo', {
      fetch: fetcher,
    });
    expect(result.completeness).toEqual({ complete: false, skippedFiles: 3 });
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'submodule_skipped',
      'lfs_pointer_skipped',
      'symlink_skipped',
    ]);
    expect(result.snapshot.files.map((f) => f.path)).toEqual([
      'src/main.ts',
      'src/util.ts',
    ]);
    expect(calls).toHaveLength(6);
  });
  it('enforces limits before downloading blobs', async () => {
    const { fetcher, calls } = setup();
    await expect(
      acquireRepository('https://github.com/test/repo', {
        fetch: fetcher,
        limits: { maxFiles: 1 },
      }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    expect(calls).toHaveLength(3);
    const again = setup();
    await expect(
      acquireRepository('https://github.com/test/repo', {
        fetch: again.fetcher,
        limits: { maxFileBytes: 1 },
      }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
    const last = setup();
    await expect(
      acquireRepository('https://github.com/test/repo', {
        fetch: last.fetcher,
        limits: { maxRequests: 3 },
      }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
  it('aborts in-flight requests on cancellation and timeout', async () => {
    const fetcher: typeof fetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(new Error('aborted'));
        else
          signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
      });
    const controller = new AbortController();
    const pending = acquireRepository('https://github.com/test/repo', {
      fetch: fetcher,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(
      acquireRepository('https://github.com/test/repo', {
        fetch: fetcher,
        limits: { timeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});
