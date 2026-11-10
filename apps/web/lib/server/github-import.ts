import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRepoBundle, githubRepoId } from '@codedna/core';
import { acquireRepository, AcquisitionError, parseRepositoryUrl, type AcquisitionResult, type RepositoryIdentity } from '@codedna/github';
import { AnalysisWorkerError, runAnalysis } from '@codedna/node';
import type { RepoAnalysis, RepoBundle, RepositorySnapshot } from '@codedna/shared';

/**
 * Import a public GitHub repo: download it at its current commit (never running its code),
 * analyse it in a worker, and keep the lesson bundle so it opens at /r/gh-<owner>-<repo>.
 *
 * This is the one feature where the server works for visitors, so it is bounded: on by default
 * only outside production, rate-limited per visitor and overall, at most two at once, and
 * de-duplicated so the same repo is downloaded once every few minutes.
 */
export type ImportEvent =
  | { stage: 'downloading'; repo: string }
  | { stage: 'analysing'; files: number }
  | { stage: 'done'; id: string; cached: boolean }
  | { stage: 'error'; code: string; message: string };

export class ImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImporterDeps {
  acquire: (url: string, options: { token?: string; signal?: AbortSignal }) => Promise<AcquisitionResult>;
  analyze: (snapshot: RepositorySnapshot) => Promise<RepoAnalysis>;
  now: () => number;
  /** Where bundles are kept between restarts; undefined keeps them in memory only. */
  cacheDir: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}

const MINUTE = 60_000;
const REUSE_MS = 10 * MINUTE;
const PER_CLIENT = { max: 5, windowMs: 10 * MINUTE };
const OVERALL = { max: 60, windowMs: 60 * MINUTE };
const MAX_RUNNING = 2;
const BUNDLE_ID = /^gh-[a-z0-9][a-z0-9-]{0,56}$/;

const ACQUISITION_MESSAGES: Record<string, [number, string]> = {
  invalid_url: [400, 'Paste a public repo link like https://github.com/owner/repo.'],
  not_found: [404, 'We couldn’t find that repo. It may be private, or the link may have a typo.'],
  private_repository: [404, 'We couldn’t find that repo. It may be private, or the link may have a typo.'],
  rate_limited: [429, 'GitHub’s hourly limit for this server has been reached. Try again later.'],
  limit_exceeded: [413, 'This repo is too big to read here. Run CodeDNA on your own computer to learn it.'],
  truncated_tree: [413, 'This repo is too big to read here. Run CodeDNA on your own computer to learn it.'],
  timeout: [504, 'GitHub took too long to answer. Try again in a moment.'],
  cancelled: [499, 'The import was cancelled.'],
};

/** Turn any failure into a short, friendly message and an HTTP status. */
export function toImportError(error: unknown): ImportError {
  if (error instanceof ImportError) return error;
  if (error instanceof AcquisitionError) {
    const [status, message] = ACQUISITION_MESSAGES[error.code] ?? [502, 'GitHub sent something unexpected. Try again in a moment.'];
    return new ImportError(error.code, message, status);
  }
  if (error instanceof AnalysisWorkerError)
    return error.code === 'timeout'
      ? new ImportError('analysis_timeout', 'Reading this repo took too long. Run CodeDNA on your own computer to learn it.', 504)
      : new ImportError('analysis_failed', 'CodeDNA couldn’t read this repo.', 500);
  return new ImportError('failed', 'Something went wrong while importing this repo.', 500);
}

export const githubImportEnabled = (env: Readonly<Record<string, string | undefined>>) => env.NODE_ENV !== 'production' || env.CODEDNA_GITHUB_IMPORT === 'on';

const defaults = (): ImporterDeps => ({
  acquire: (url, options) => acquireRepository(url, { ...options, strategy: 'auto' }),
  analyze: (snapshot) => runAnalysis(snapshot, { timeoutMs: 60_000 }),
  now: Date.now,
  cacheDir: join(tmpdir(), 'codedna-github'),
  env: process.env,
});

export function createImporter(overrides: Partial<ImporterDeps> = {}) {
  const deps: ImporterDeps = { ...defaults(), ...overrides };
  const bundles = new Map<string, RepoBundle>();
  const recent = new Map<string, { id: string; at: number }>();
  const clientHits = new Map<string, number[]>();
  const allHits: number[] = [];
  const inFlight = new Map<string, Promise<string>>();
  let running = 0;

  const prune = (hits: number[], windowMs: number) => {
    const since = deps.now() - windowMs;
    while (hits.length && hits[0]! <= since) hits.shift();
    return hits;
  };

  async function load(id: string): Promise<RepoBundle | undefined> {
    if (!BUNDLE_ID.test(id)) return undefined;
    const inMemory = bundles.get(id);
    if (inMemory || !deps.cacheDir) return inMemory;
    try {
      const bundle = JSON.parse(await readFile(join(deps.cacheDir, `${id}.json`), 'utf8')) as RepoBundle;
      bundles.set(id, bundle);
      return bundle;
    } catch {
      return undefined;
    }
  }

  async function save(bundle: RepoBundle) {
    bundles.set(bundle.id, bundle);
    if (!deps.cacheDir) return;
    try {
      await mkdir(deps.cacheDir, { recursive: true });
      await writeFile(join(deps.cacheDir, `${bundle.id}.json`), JSON.stringify(bundle));
    } catch {
      // The in-memory copy is enough to open the lessons now.
    }
  }

  /** Validate and admit a request. Throws ImportError with a friendly message. */
  async function prepare(url: unknown, client: string): Promise<{ identity: RepositoryIdentity; cachedId?: string }> {
    if (!githubImportEnabled(deps.env)) throw new ImportError('disabled', 'Importing from GitHub is switched off on this server. Run CodeDNA on your own computer to learn any repo.', 403);
    if (typeof url !== 'string' || url.length > 300) throw toImportError(new AcquisitionError('invalid_url', 'invalid'));
    let identity: RepositoryIdentity;
    try {
      identity = parseRepositoryUrl(url.trim().replace(/\/$/, ''));
    } catch (error) {
      throw toImportError(error);
    }
    const reused = recent.get(identity.url);
    if (reused && deps.now() - reused.at < REUSE_MS && (await load(reused.id))) return { identity, cachedId: reused.id };
    if (inFlight.has(identity.url)) return { identity };
    const hits = prune(clientHits.get(client) ?? [], PER_CLIENT.windowMs);
    if (hits.length >= PER_CLIENT.max) throw new ImportError('too_many', 'You’ve imported several repos in a row. Wait a few minutes, then try again.', 429);
    if (prune(allHits, OVERALL.windowMs).length >= OVERALL.max) throw new ImportError('too_many', 'This server has imported a lot of repos this hour. Try again later, or run CodeDNA on your own computer.', 429);
    if (running >= MAX_RUNNING) throw new ImportError('busy', 'CodeDNA is reading other repos right now. Try again in a minute.', 503);
    hits.push(deps.now());
    clientHits.set(client, hits);
    allHits.push(deps.now());
    return { identity };
  }

  /** Download, analyse and save. Identical imports running at the same time share one download. */
  function run(identity: RepositoryIdentity, onEvent: (event: ImportEvent) => void, signal?: AbortSignal): Promise<string> {
    const existing = inFlight.get(identity.url);
    if (existing) {
      onEvent({ stage: 'downloading', repo: `${identity.owner}/${identity.repo}` });
      return existing;
    }
    running++;
    const task = (async () => {
      onEvent({ stage: 'downloading', repo: `${identity.owner}/${identity.repo}` });
      const token = deps.env.GITHUB_TOKEN;
      const result = await deps.acquire(identity.url, { ...(token ? { token } : {}), ...(signal ? { signal } : {}) });
      onEvent({ stage: 'analysing', files: result.snapshot.files.length });
      const analysis = await deps.analyze(result.snapshot);
      if (!result.completeness.complete) analysis.limitations.push('This repo is bigger than CodeDNA downloads at once; some files were left out.');
      const id = githubRepoId(identity.owner, identity.repo);
      const bundle = buildRepoBundle(id, analysis, 'github', `${identity.owner}/${identity.repo}`);
      if (result.otherLanguages?.length) bundle.otherLanguages = result.otherLanguages;
      await save(bundle);
      recent.set(identity.url, { id, at: deps.now() });
      return id;
    })().finally(() => {
      running--;
      inFlight.delete(identity.url);
    });
    inFlight.set(identity.url, task);
    return task;
  }

  return { prepare, run, load, enabled: () => githubImportEnabled(deps.env) };
}

/** One importer per server process, so limits and the cache are shared by every request. */
export const githubImporter = createImporter();
