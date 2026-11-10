import { QA_ARTIFACT_NAME, validateQaReport, type QaReport, type QaStatus } from '@codedna/shared';
import { readZip } from './zip';

/**
 * Fetches the results of a CodeDNA QA run on GitHub Actions (the `codedna-qa` artifact) for the
 * QA flows page. Browsers can't download artifacts themselves (GitHub's download links don't allow
 * it), so this server fetches the zip with the visitor's own token, reads the report and the
 * screenshots of what broke, and forgets everything. The token is never stored or logged, and
 * nothing from the zip is run.
 */
export class GithubQaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface GithubQaResults {
  report: QaReport;
  /** Screenshots of broken and "look at" cases, by the path the report uses, as data URLs. */
  shots: Record<string, string>;
}

export const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_REPORT_BYTES = 2_000_000;
const MAX_SHOT_BYTES = 1_500_000;
/** Keeps the answer under the hosting platform's response limit (about 4.5 MB on Vercel). */
const MAX_ANSWER_CHARS = 4_000_000;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

function githubHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'CodeDNA' };
}

async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > limit) throw new GithubQaError('This run’s results are too big to show here. Download them from GitHub instead.', 413);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new GithubQaError('This run’s results are too big to show here. Download them from GitHub instead.', 413);
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export async function fetchGithubQaResults(input: { repo: unknown; runId: unknown; token: unknown }, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<GithubQaResults> {
  const { repo, runId, token } = input;
  if (typeof repo !== 'string' || !REPO_PATTERN.test(repo)) throw new GithubQaError('That isn’t a GitHub repo name.', 400);
  if (typeof runId !== 'number' || !Number.isSafeInteger(runId) || runId <= 0) throw new GithubQaError('That isn’t a GitHub run.', 400);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new GithubQaError('Connect GitHub first.', 401);

  const timeout = AbortSignal.timeout(45_000);
  const both = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const listed = await fetcher(`https://api.github.com/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`, { headers: githubHeaders(token), signal: both, cache: 'no-store' }).catch(() => {
    throw new GithubQaError('GitHub couldn’t be reached. Try again in a moment.', 502);
  });
  if (listed.status === 401) throw new GithubQaError('GitHub didn’t accept the token. Connect GitHub again with a new one.', 401);
  if (listed.status === 403 || listed.status === 404) throw new GithubQaError('This token can’t read that repo’s Actions. It needs “Actions: Read and write” on this repo.', 403);
  if (!listed.ok) throw new GithubQaError('GitHub couldn’t list this run’s results. Try again in a moment.', 502);
  const { artifacts = [] } = (await listed.json()) as { artifacts?: { name: string; expired: boolean; size_in_bytes: number; archive_download_url: string }[] };
  const artifact = artifacts.find((item) => item.name === QA_ARTIFACT_NAME);
  if (!artifact) throw new GithubQaError('This run kept no results. It may have stopped before testing — open it on GitHub to see why.', 404);
  if (artifact.expired) throw new GithubQaError('GitHub has deleted this run’s results (they’re kept for 14 days).', 410);
  if (artifact.size_in_bytes > MAX_ZIP_BYTES) throw new GithubQaError('This run’s results are too big to show here. Download them from GitHub instead.', 413);
  if (!artifact.archive_download_url.startsWith(`https://api.github.com/repos/${repo}/actions/artifacts/`)) throw new GithubQaError('GitHub sent an unexpected download link.', 502);

  // GitHub answers with a redirect to short-lived storage; fetch drops the token when it follows it.
  const download = await fetcher(artifact.archive_download_url, { headers: githubHeaders(token), signal: both, redirect: 'follow', cache: 'no-store' }).catch(() => {
    throw new GithubQaError('The results couldn’t be downloaded from GitHub. Try again in a moment.', 502);
  });
  if (!download.ok) throw new GithubQaError('The results couldn’t be downloaded from GitHub. Try again in a moment.', 502);
  const zip = await readCapped(download, MAX_ZIP_BYTES);

  let entries;
  try {
    entries = readZip(zip, MAX_REPORT_BYTES);
  } catch {
    throw new GithubQaError('The results file from GitHub couldn’t be read.', 502);
  }
  const reportEntry = entries.filter((entry) => entry.name === 'qa-report.json' || entry.name.endsWith('/qa-report.json')).sort((a, b) => a.name.length - b.name.length)[0];
  if (!reportEntry) throw new GithubQaError('This run’s results have no report. It may have stopped before testing — open it on GitHub to see why.', 404);
  let text: string;
  let value: unknown;
  try {
    text = reportEntry.read().toString('utf8');
    value = JSON.parse(text);
  } catch {
    throw new GithubQaError('The report from GitHub couldn’t be read.', 502);
  }
  const result = validateQaReport(value);
  if ('problem' in result) throw new GithubQaError(result.problem, 422);

  // Screenshots of what broke first, then what to look at, while they fit.
  const shots: Record<string, string> = {};
  let room = MAX_ANSWER_CHARS - text.length;
  // A check's own screenshot, and for journeys the one taken at the point that broke.
  const bad = (status: string) => status === 'failed' || status === 'warning';
  const wanted = result.report.suites
    .flatMap((suite) => suite.checks)
    .filter((check) => bad(check.status))
    .flatMap((check) => [check.screenshot ? { path: check.screenshot, status: check.status } : undefined, ...(check.steps ?? []).filter((step) => step.screenshot && bad(step.status)).map((step) => ({ path: step.screenshot!, status: step.status }))])
    .filter((item): item is { path: string; status: QaStatus } => !!item)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'failed' ? -1 : 1));
  for (const { path } of wanted) {
    if (shots[path]) continue;
    const type = MIME[path.split('.').pop()?.toLowerCase() ?? ''];
    const entry = entries.find((item) => item.name === `qa/${path}` || item.name.endsWith(`/qa/${path}`));
    if (!type || !entry || entry.size > MAX_SHOT_BYTES) continue;
    const size = Math.ceil(entry.size / 3) * 4 + type.length + 13;
    if (size > room) continue;
    try {
      shots[path] = `data:${type};base64,${entry.read().toString('base64')}`;
      room -= size;
    } catch {
      // A broken image is left out; the step-by-step result still shows.
    }
  }
  return { report: result.report, shots };
}
