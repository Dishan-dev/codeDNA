import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeRepository } from '@codedna/core';
import { AcquisitionError, type AcquisitionResult } from '@codedna/github';
import type { RepositorySnapshot } from '@codedna/shared';
import { loadFixture } from '../../../../packages/core/fixtures/load';
import { createImporter, githubImportEnabled, toImportError, type ImportEvent } from './github-import';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function setup(options: { env?: Record<string, string | undefined>; fail?: Error; cache?: boolean } = {}) {
  let downloads = 0;
  let clock = 1_000_000;
  const cacheDir = options.cache === false ? undefined : mkdtempSync(join(tmpdir(), 'codedna-import-'));
  if (cacheDir) dirs.push(cacheDir);
  const importer = createImporter({
    acquire: async (url) => {
      downloads++;
      if (options.fail) throw options.fail;
      const snapshot = loadFixture('shop-app') as RepositorySnapshot;
      return { repository: { owner: 'acme', repo: 'shop', url }, commitSha: 'a'.repeat(40), snapshot, diagnostics: [], completeness: { complete: true, skippedFiles: 0 }, otherLanguages: [{ language: 'PHP', files: 2 }] } as AcquisitionResult;
    },
    analyze: async (snapshot) => analyzeRepository(snapshot),
    now: () => clock,
    cacheDir,
    env: options.env ?? { NODE_ENV: 'development' },
  });
  return { importer, downloads: () => downloads, advance: (ms: number) => (clock += ms), cacheDir };
}
const run = async (importer: ReturnType<typeof createImporter>, url: string, client = 'me') => {
  const events: ImportEvent[] = [];
  const prepared = await importer.prepare(url, client);
  const id = prepared.cachedId ?? (await importer.run(prepared.identity, (event) => events.push(event)));
  return { id, events, cached: !!prepared.cachedId };
};

describe('GitHub import', () => {
  it('downloads, analyses and keeps a lesson bundle under a gh- id', async () => {
    const { importer } = setup();
    const result = await run(importer, 'https://github.com/Acme/Shop');
    expect(result.id).toBe('gh-acme-shop');
    expect(result.events.map((event) => event.stage)).toEqual(['downloading', 'analysing']);
    expect(result.events[1]).toEqual({ stage: 'analysing', files: 19 });
    const bundle = await importer.load('gh-acme-shop');
    expect(bundle).toMatchObject({ id: 'gh-acme-shop', name: 'acme/shop', source: 'github', otherLanguages: [{ language: 'PHP', files: 2 }] });
    expect(bundle!.plan.path).toHaveLength(4);
  });

  it('reuses a recent import instead of downloading again, and keeps it across restarts', async () => {
    const { importer, downloads, advance, cacheDir } = setup();
    await run(importer, 'https://github.com/acme/shop');
    expect((await run(importer, 'https://github.com/acme/shop/')).cached).toBe(true);
    expect(downloads()).toBe(1);
    advance(11 * 60_000);
    expect((await run(importer, 'https://github.com/acme/shop')).cached).toBe(false);
    expect(downloads()).toBe(2);
    const restarted = createImporter({ cacheDir, env: { NODE_ENV: 'development' } });
    expect((await restarted.load('gh-acme-shop'))?.name).toBe('acme/shop');
  });

  it('shares one download between identical imports running at the same time', async () => {
    const { importer, downloads } = setup();
    const first = await importer.prepare('https://github.com/acme/shop', 'a');
    const second = await importer.prepare('https://github.com/acme/shop', 'b');
    const [one, two] = await Promise.all([importer.run(first.identity, () => undefined), importer.run(second.identity, () => undefined)]);
    expect(one).toBe(two);
    expect(downloads()).toBe(1);
  });

  it('limits how many repos one visitor can import in a row', async () => {
    const { importer } = setup({ cache: false });
    for (let index = 0; index < 5; index++) await run(importer, `https://github.com/acme/shop${index}`);
    await expect(importer.prepare('https://github.com/acme/shop9', 'me')).rejects.toMatchObject({ code: 'too_many', status: 429 });
    await expect(importer.prepare('https://github.com/acme/shop9', 'someone-else')).resolves.toBeTruthy();
  });

  it('is off in production unless switched on', async () => {
    expect(githubImportEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(githubImportEnabled({ NODE_ENV: 'production', CODEDNA_GITHUB_IMPORT: 'on' })).toBe(true);
    expect(githubImportEnabled({ NODE_ENV: 'development' })).toBe(true);
    const { importer } = setup({ env: { NODE_ENV: 'production' } });
    await expect(importer.prepare('https://github.com/acme/shop', 'me')).rejects.toMatchObject({ code: 'disabled', status: 403 });
  });

  it('explains bad links and GitHub failures in plain words', async () => {
    const { importer } = setup();
    await expect(importer.prepare('https://gitlab.com/acme/shop', 'me')).rejects.toMatchObject({ code: 'invalid_url', status: 400 });
    await expect(importer.prepare(42, 'me')).rejects.toMatchObject({ code: 'invalid_url' });
    const missing = setup({ fail: new AcquisitionError('not_found', 'x') });
    const prepared = await missing.importer.prepare('https://github.com/acme/nope', 'me');
    const failure = await missing.importer.run(prepared.identity, () => undefined).catch(toImportError);
    expect(failure).toMatchObject({ code: 'not_found', status: 404, message: expect.stringContaining('may be private') });
    expect(toImportError(new AcquisitionError('rate_limited', 'x'))).toMatchObject({ status: 429, message: expect.stringContaining('hourly limit') });
    expect(toImportError(new Error('boom'))).toMatchObject({ status: 500 });
  });

  it('only serves bundle ids it could have made', async () => {
    const { importer } = setup();
    expect(await importer.load('../../etc/passwd')).toBeUndefined();
    expect(await importer.load('snackshop')).toBeUndefined();
  });
});
