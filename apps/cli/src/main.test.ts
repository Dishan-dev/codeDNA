import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LearningPlan, RepoAnalysis, RepoBundle } from '@codedna/shared';
import { main, type Io } from './main.js';
import type { LocalServer } from './server.js';
import { loadWebUi } from './web-ui.js';

const fixture = fileURLToPath(new URL('../../../packages/core/fixtures/shop-app', import.meta.url));
// Tests run from source, so point at the built worker of @codedna/node.
const workerUrl = new URL('../../../packages/node/dist/worker.js', import.meta.url);

async function run(argv: string[], cwd = process.cwd(), extra: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (text) => out.push(text), err: (text) => err.push(text), cwd, workerUrl, ...extra });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('codedna analyze', () => {
  it('prints a plain summary of the features it found', async () => {
    const result = await run(['analyze', fixture]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('CodeDNA · shop-app');
    expect(result.out).toContain('Next.js (App Router) · 19 files · 3 pages');
    expect(result.out).toMatch(/\/checkout\s+Place order\s+18 steps · 3 checks · 1 unknown part/);
    expect(result.out).toContain('2 parts can only be known while the app runs.');
    expect(result.out).toContain('Learning path: 4 lessons, easiest first.');
    expect(result.out).toContain('• “Save to favorites” changes data without a sign-in check');
    expect(result.out).toContain('never left it');
  });

  it('prints the full analysis as JSON', async () => {
    const result = await run(['analyze', fixture, '--json']);
    const analysis = JSON.parse(result.out) as RepoAnalysis;
    expect(analysis.schemaVersion).toBe('2.0');
    expect(analysis.features.map((feature) => feature.title)).toContain('Apply coupon');
  });

  it('prints the learning plan as JSON', async () => {
    const result = await run(['analyze', fixture, '--plan']);
    const plan = JSON.parse(result.out) as LearningPlan;
    expect(plan.path).toHaveLength(4);
  });

  it('saves JSON to a file when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codedna-cli-'));
    const result = await run(['analyze', fixture, '--out', 'analysis.json'], dir);
    expect(result.code).toBe(0);
    expect(result.err).toBe('Saved the analysis to analysis.json.');
    expect(JSON.parse(readFileSync(join(dir, 'analysis.json'), 'utf8')).framework.id).toBe('next-app-router');
    rmSync(dir, { recursive: true, force: true });
  });

  it('explains wrong usage and missing folders kindly', async () => {
    expect(await run(['explode'])).toMatchObject({ code: 1, err: expect.stringContaining('Unknown command “explode”') });
    expect(await run(['analyze', '--nope'])).toMatchObject({ code: 2, err: expect.stringContaining('Unknown option “--nope”') });
    expect(await run(['analyze', '--out'])).toMatchObject({ code: 2 });
    expect(await run(['--port', '80'])).toMatchObject({ code: 2, err: expect.stringContaining('between 1024 and 65535') });
    expect(await run(['--json'])).toMatchObject({ code: 2, err: expect.stringContaining('go with “codedna analyze”') });
    expect(await run(['analyze', join(tmpdir(), 'codedna-does-not-exist')])).toMatchObject({ code: 1, err: expect.stringContaining('There is no folder') });
    const empty = mkdtempSync(join(tmpdir(), 'codedna-empty-'));
    expect(await run(['analyze', empty])).toMatchObject({ code: 1, err: expect.stringContaining('no TypeScript or JavaScript files') });
    rmSync(empty, { recursive: true, force: true });
    expect((await run(['--help'])).out).toContain('codedna [folder]');
  });
});

describe('codedna (learn)', () => {
  it('reads the app, builds lessons and serves them on localhost', async () => {
    const opened: string[] = [];
    let server: LocalServer | undefined;
    const result = await run([fixture, '--port', '4790'], process.cwd(), {
      loadUi: async () => (_request, response) => response.end('learning UI'),
      open: (url) => opened.push(url),
      onServer: (started) => (server = started),
    });
    try {
      expect(result.code).toBe(0);
      expect(result.out).toContain('Reading your files… (19 files)');
      expect(result.out).toContain('4 lessons ready for Snackshop.');
      expect(opened).toEqual([`${server!.url}/r/local-snackshop`]);
      const bundle = (await (await fetch(`${server!.url}/api/local/bundle/local-snackshop`)).json()) as RepoBundle;
      expect(bundle).toMatchObject({ id: 'local-snackshop', name: 'Snackshop', source: 'local' });
      expect(bundle.plan.path).toHaveLength(4);
      expect(await (await fetch(`${server!.url}/r/local-snackshop`)).text()).toBe('learning UI');
    } finally {
      await server?.close();
    }
  });

  it('does not open the browser with --no-open', async () => {
    const opened: string[] = [];
    let server: LocalServer | undefined;
    await run([fixture, '--no-open', '--port', '4795'], process.cwd(), {
      loadUi: async () => (_request, response) => response.end(),
      open: (url) => opened.push(url),
      onServer: (started) => (server = started),
    });
    await server?.close();
    expect(opened).toEqual([]);
  });

  it('says how to build the learning app when it is missing', async () => {
    const result = await run([fixture, '--no-open'], process.cwd(), { loadUi: () => loadWebUi(join(tmpdir(), 'codedna-no-web-build')) });
    expect(result.code).toBe(1);
    expect(result.err).toContain('Run “pnpm build”');
  });
});
