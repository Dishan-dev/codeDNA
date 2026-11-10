import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { QaReport } from '@codedna/shared';
import { fetchGithubQaResults } from './github-qa';
import { readZip } from './zip';

/** A minimal zip writer for the tests: stored or deflated entries, no CRC checks needed. */
function makeZip(files: Record<string, Buffer | string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content) : content;
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuffer = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuffer, data);
    centrals.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const report: QaReport = {
  version: 1,
  repoId: 'gh-acme-shop',
  repoName: 'acme/shop',
  runId: 'run1',
  createdAt: '2026-11-08T10:00:00.000Z',
  tool: { name: 'codedna', version: '0.0.0' },
  appUrl: 'https://shop.example.com',
  mode: 'look',
  suites: [
    {
      runner: 'flows',
      title: 'Flows',
      status: 'failed',
      checks: [
        { id: 'a', title: 'Place order — reach', status: 'failed', screenshot: 'run1/a.png' },
        { id: 'b', title: 'Sign in — reach', status: 'passed', screenshot: 'run1/b.png' },
      ],
    },
  ],
} as unknown as QaReport;

const token = 'github_pat_abcdefghijklmnopqrstuvwxyz';

function fakeGithub(zip: Buffer, artifact: Partial<{ name: string; expired: boolean; size_in_bytes: number; archive_download_url: string }> = {}) {
  const calls: { url: string; auth: string | undefined }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    if (url.includes('/runs/7/artifacts'))
      return Response.json({
        artifacts: [{ name: 'codedna-qa', expired: false, size_in_bytes: zip.length, archive_download_url: 'https://api.github.com/repos/acme/shop/actions/artifacts/99/zip', ...artifact }],
      });
    if (url.endsWith('/artifacts/99/zip')) return new Response(new Uint8Array(zip));
    return new Response('nope', { status: 404 });
  };
  return { fetcher, calls };
}

describe('reading GitHub QA results', () => {
  it('reads stored and deflated zip entries', () => {
    for (const deflate of [true, false]) {
      const entries = readZip(makeZip({ 'qa-report.json': '{"x":1}', 'qa/run1/a.png': 'png' }, deflate), 1000);
      expect(entries.map((entry) => entry.name)).toEqual(['qa-report.json', 'qa/run1/a.png']);
      expect(entries[0]!.read().toString()).toBe('{"x":1}');
    }
    expect(() => readZip(Buffer.from('not a zip at all, sorry'), 1000)).toThrow();
    const big = readZip(makeZip({ 'qa-report.json': 'x'.repeat(5000) }), 100);
    expect(() => big[0]!.read()).toThrow();
  });

  it('fetches the report and the screenshots of what broke', async () => {
    const zip = makeZip({ 'qa-report.json': JSON.stringify(report), 'qa/run1/a.png': 'broken-shot', 'qa/run1/b.png': 'passed-shot' });
    const { fetcher, calls } = fakeGithub(zip);
    const results = await fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fetcher);
    expect(results.report.repoId).toBe('gh-acme-shop');
    expect(Object.keys(results.shots)).toEqual(['run1/a.png']);
    expect(results.shots['run1/a.png']).toBe(`data:image/png;base64,${Buffer.from('broken-shot').toString('base64')}`);
    expect(calls.every((call) => call.auth === `Bearer ${token}`)).toBe(true);
  });

  it('refuses bad input and explains missing or odd results', async () => {
    const zip = makeZip({ 'qa-report.json': JSON.stringify(report) });
    const { fetcher } = fakeGithub(zip);
    await expect(fetchGithubQaResults({ repo: '../etc', runId: 7, token }, fetcher)).rejects.toMatchObject({ status: 400 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: '7', token }, fetcher)).rejects.toMatchObject({ status: 400 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token: 'short' }, fetcher)).rejects.toMatchObject({ status: 401 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fakeGithub(zip, { expired: true }).fetcher)).rejects.toMatchObject({ status: 410 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fakeGithub(zip, { name: 'other' }).fetcher)).rejects.toMatchObject({ status: 404 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fakeGithub(zip, { archive_download_url: 'https://evil.example.com/zip' }).fetcher)).rejects.toMatchObject({ status: 502 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fakeGithub(makeZip({ 'other.txt': 'hi' })).fetcher)).rejects.toMatchObject({ status: 404 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, fakeGithub(makeZip({ 'qa-report.json': '{"version":99}' })).fetcher)).rejects.toMatchObject({ status: 422 });
    const denied = async () => new Response('', { status: 404 });
    await expect(fetchGithubQaResults({ repo: 'acme/shop', runId: 7, token }, denied)).rejects.toMatchObject({ status: 403 });
  });
});
