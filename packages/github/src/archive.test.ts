import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pack } from 'tar-stream';
import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from '@codedna/core';
import { acquireRepository } from './index.js';
const commit = 'a'.repeat(40),
  tree = 'b'.repeat(40);
const source = "import './b';";
const hash = (text: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');
async function archive(files: Record<string, string>) {
  const tar = pack();
  const chunks: Buffer[] = [];
  tar.on('data', (chunk) => chunks.push(chunk));
  for (const [name, content] of Object.entries(files))
    tar.entry({ name }, content);
  tar.finalize();
  await new Promise<void>((resolve, reject) => {
    tar.on('end', resolve);
    tar.on('error', reject);
  });
  return gzipSync(Buffer.concat(chunks));
}
async function setup(files: Record<string, string>) {
  const bytes = await archive(files);
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === 'https://api.github.com/repos/test/repo')
      return Response.json({ private: false, default_branch: 'main' });
    if (url.endsWith('/commits/main'))
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    if (url.endsWith(`/git/trees/${tree}?recursive=1`))
      return Response.json({
        sha: tree,
        truncated: false,
        tree: [
          {
            path: 'a.ts',
            type: 'blob',
            mode: '100644',
            sha: hash(source),
            size: Buffer.byteLength(source),
          },
          {
            path: 'b.ts',
            type: 'blob',
            mode: '100644',
            sha: hash('export {}'),
            size: 9,
          },
        ],
      });
    if (url === `https://codeload.github.com/test/repo/tar.gz/${commit}`)
      return new Response(new Uint8Array(bytes));
    throw new Error('unexpected request');
  };
  return { fetcher, calls };
}
describe('archive acquisition', () => {
  it('uses four requests, pins the commit, verifies files, and produces a valid graph', async () => {
    const { fetcher, calls } = await setup({
      'repo/a.ts': source,
      'repo/b.ts': 'export {}',
      'repo/README.md': 'ignored',
    });
    const result = await acquireRepository('https://github.com/test/repo', {
      fetch: fetcher,
      token: 'secret',
      strategy: 'archive',
      limits: { maxRequests: 4 },
    });
    expect(result.commitSha).toBe(commit);
    expect(result.snapshot.files.map((file) => file.path)).toEqual([
      'a.ts',
      'b.ts',
    ]);
    expect(analyzeSnapshot(result.snapshot).dependencyGraph.edges).toHaveLength(
      1,
    );
    expect(calls).toHaveLength(4);
    expect(calls[3]?.init?.redirect).toBe('manual');
    expect(calls[3]?.init?.headers).toBeUndefined();
  });
  it.each([
    [{ 'repo/a.ts': 'tampered', 'repo/b.ts': 'export {}' }],
    [{ 'repo/a.ts': source }],
    [
      {
        'repo/../escape.ts': 'x',
        'repo/a.ts': source,
        'repo/b.ts': 'export {}',
      },
    ],
  ])('rejects tampered, incomplete or unsafe archives', async (files) => {
    const { fetcher } = await setup(files);
    await expect(
      acquireRepository('https://github.com/test/repo', {
        fetch: fetcher,
        strategy: 'archive',
      }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});
