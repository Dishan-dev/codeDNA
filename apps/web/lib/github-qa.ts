'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QA_WORKFLOW_FILE, type QaMode } from '@codedna/shared';

/**
 * Runs the repo's CodeDNA QA workflow on GitHub Actions from the hosted QA flows page, and loads
 * its results when it finishes. The browser talks to GitHub directly with the visitor's own token
 * (kept in this browser only); the run happens on GitHub's machines for that repo, never on
 * CodeDNA's servers. Only the finished results zip goes through CodeDNA's server, because GitHub
 * doesn't let browsers download it.
 */
/** `failed` means the set-up check failed; a run that fails goes back to `ready` with `error`. */
export type GithubQaPhase = 'disconnected' | 'checking' | 'missing' | 'ready' | 'starting' | 'queued' | 'running' | 'fetching' | 'done' | 'failed';

export interface GithubQaState {
  phase: GithubQaPhase;
  /** The run on GitHub, to open it there. */
  runUrl?: string;
  error?: string;
  remembered: boolean;
  /** How the page is connected: through the CodeDNA GitHub App, or a pasted token. */
  via?: 'app' | 'token';
  connect: (token: string, remember: boolean) => Promise<void>;
  disconnect: () => void;
  recheck: () => void;
  start: (request: { url: string; mode: QaMode }) => Promise<void>;
}

type Json = Record<string, unknown>;
const API = 'https://api.github.com';
const TOKEN_KEY = (repo: string) => `codedna:github-token:${repo.toLowerCase()}`;
const RUN_KEY = (repo: string) => `codedna:github-run:${repo.toLowerCase()}`;
const APP_KEY = 'codedna:github-app';
const POLL_MS = 5000;
const AUTH_ERRORS: Record<string, string> = {
  denied: 'GitHub wasn’t connected: the request was cancelled on GitHub.',
  expired: 'Connecting took too long or came from another tab. Press Connect GitHub again.',
  failed: 'GitHub didn’t finish connecting. Press Connect GitHub again.',
  off: 'Connect GitHub isn’t set up on this server. Paste a token instead.',
};

/** Takes the token GitHub's sign-in handed back in the address fragment, and clears it from the address. */
function takeAuthFragment(): { error?: string } {
  if (typeof window === 'undefined' || !window.location.hash.includes('codedna-github')) return {};
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const token = params.get('codedna-github');
  if (token && /^[A-Za-z0-9_]{20,255}$/.test(token)) {
    const seconds = Number(params.get('expires')) || 8 * 3600;
    write('local', APP_KEY, JSON.stringify({ token, expiresAt: Date.now() + seconds * 1000 - 60_000 }));
    return {};
  }
  const error = AUTH_ERRORS[params.get('codedna-github-error') ?? ''];
  return error ? { error } : {};
}

function appToken(): string | undefined {
  try {
    const saved = JSON.parse(read('local', APP_KEY) ?? 'null') as { token?: string; expiresAt?: number } | null;
    if (saved?.token && (saved.expiresAt ?? 0) > Date.now()) return saved.token;
  } catch {
    // Unreadable: connect again.
  }
  write('local', APP_KEY);
  return undefined;
}

function storage(kind: 'local' | 'session'): Storage | undefined {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}
function read(kind: 'local' | 'session', key: string): string | undefined {
  try {
    return storage(kind)?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function write(kind: 'local' | 'session', key: string, value?: string) {
  try {
    if (value === undefined) storage(kind)?.removeItem(key);
    else storage(kind)?.setItem(key, value);
  } catch {
    // Kept for this visit only.
  }
}

export class GithubProblem extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export async function github(token: string, path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const response = await fetcher(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  }).catch(() => {
    throw new GithubProblem('GitHub couldn’t be reached. Check your connection and try again.');
  });
  if (response.status === 401) throw new GithubProblem('GitHub didn’t accept this token. Check it was copied whole and hasn’t expired.', 401);
  return response;
}

/** Is the token good for this repo, and does the repo have the CodeDNA QA workflow? */
export async function checkSetup(repo: string, token: string, fetcher: typeof fetch = fetch): Promise<{ branch: string } | { missing: true }> {
  const info = await github(token, `/repos/${repo}`, {}, fetcher);
  if (info.status === 404 || info.status === 403) throw new GithubProblem(`This token can’t see ${repo}. Make one for this repo (or give it access) with “Actions: Read and write”.`, info.status);
  if (!info.ok) throw new GithubProblem('GitHub couldn’t check the repo. Try again in a moment.', info.status);
  const branch = String(((await info.json()) as Json).default_branch ?? 'main');
  const workflow = await github(token, `/repos/${repo}/actions/workflows/${QA_WORKFLOW_FILE}`, {}, fetcher);
  if (workflow.status === 404) return { missing: true };
  if (workflow.status === 403) throw new GithubProblem('This token can’t use the repo’s Actions. It needs “Actions: Read and write”.', 403);
  if (!workflow.ok) throw new GithubProblem('GitHub couldn’t check the workflow. Try again in a moment.', workflow.status);
  const state = String(((await workflow.json()) as Json).state ?? 'active');
  if (state !== 'active') throw new GithubProblem('The CodeDNA QA workflow is turned off in this repo. Turn it on in the repo’s Actions tab.');
  return { branch };
}

/** Starts the workflow. `request` marks the run so it can be found; older workflows don't take it. */
export async function dispatchRun(repo: string, token: string, input: { branch: string; url: string; interact: boolean; request: string }, fetcher: typeof fetch = fetch): Promise<{ marked: boolean }> {
  const send = (inputs: Json) => github(token, `/repos/${repo}/actions/workflows/${QA_WORKFLOW_FILE}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: input.branch, inputs }) }, fetcher);
  const base = { url: input.url, interact: input.interact ? 'true' : 'false' };
  let response = await send({ ...base, request: input.request });
  let marked = true;
  if (response.status === 422) {
    const message = String(((await response.json().catch(() => ({}))) as Json).message ?? '');
    if (!/unexpected inputs/i.test(message)) throw new GithubProblem(`GitHub wouldn’t start the run: ${message || 'unknown reason'}.`, 422);
    response = await send(base);
    marked = false;
  }
  if (response.status === 403 || response.status === 404) throw new GithubProblem('This token can’t start workflows. It needs “Actions: Read and write” on this repo.', response.status);
  if (!response.ok) throw new GithubProblem('GitHub wouldn’t start the run. Try again in a moment.', response.status);
  return { marked };
}

export interface RunInfo {
  id: number;
  status: string;
  conclusion?: string;
  url: string;
}
const runInfo = (run: Json): RunInfo => ({ id: Number(run.id), status: String(run.status), ...(run.conclusion ? { conclusion: String(run.conclusion) } : {}), url: String(run.html_url) });

/** The run this page started: by its mark, or (for older workflows) the first one after it was started. */
export async function findRun(repo: string, token: string, mark: { request: string; since: number; marked: boolean }, fetcher: typeof fetch = fetch): Promise<RunInfo | undefined> {
  const response = await github(token, `/repos/${repo}/actions/workflows/${QA_WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=20`, {}, fetcher);
  if (!response.ok) return undefined;
  const runs = (((await response.json()) as Json).workflow_runs ?? []) as Json[];
  const run = mark.marked
    ? runs.find((item) => String(item.display_title ?? item.name ?? '').includes(mark.request))
    : runs.filter((item) => Date.parse(String(item.created_at)) >= mark.since - 10_000).sort((a, b) => Date.parse(String(a.created_at)) - Date.parse(String(b.created_at)))[0];
  return run ? runInfo(run) : undefined;
}

export async function getRun(repo: string, token: string, id: number, fetcher: typeof fetch = fetch): Promise<RunInfo> {
  const response = await github(token, `/repos/${repo}/actions/runs/${id}`, {}, fetcher);
  if (!response.ok) throw new GithubProblem('GitHub couldn’t show the run. Try again in a moment.', response.status);
  return runInfo((await response.json()) as Json);
}

export async function fetchResults(repo: string, token: string, runId: number): Promise<{ report: unknown; shots: Record<string, string> }> {
  const response = await fetch('/api/github/qa-results', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-github-token': token }, body: JSON.stringify({ repo, runId }) }).catch(() => {
    throw new GithubProblem('CodeDNA couldn’t be reached to fetch the results.');
  });
  const body = (await response.json().catch(() => ({}))) as { report?: unknown; shots?: Record<string, string>; error?: { message?: string } };
  if (!response.ok || !body.report) throw new GithubProblem(body.error?.message ?? 'The results couldn’t be fetched. Try again in a moment.', response.status);
  return { report: body.report, shots: body.shots ?? {} };
}

/** A link that opens GitHub's form for a fine-grained token limited to this repo and to Actions. */
export function tokenLink(repo: string): string {
  const [owner] = repo.split('/');
  const params = new URLSearchParams({ name: `CodeDNA QA – ${repo}`.slice(0, 40), description: 'Lets the CodeDNA QA flows page start the codedna-qa workflow and read its results.', target_name: owner ?? '', expires_in: '30', actions: 'write' });
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

interface SavedRun {
  branch: string;
  request: string;
  since: number;
  marked: boolean;
  runId?: number;
}

/**
 * The hosted page's GitHub runner. `onResults` gets the report (still to be checked) and the
 * screenshots of what broke; it returns a reason when the report can't be used.
 */
export function useGithubQa(repo: string | undefined, onResults: (report: unknown, shots: Record<string, string>) => string | undefined): GithubQaState {
  const [token, setToken] = useState<string>();
  const [remembered, setRemembered] = useState(false);
  const [phase, setPhase] = useState<GithubQaPhase>('disconnected');
  const [branch, setBranch] = useState('main');
  const [runUrl, setRunUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<SavedRun>();
  const [via, setVia] = useState<'app' | 'token'>();
  const results = useRef(onResults);
  results.current = onResults;

  const check = useCallback(
    async (value: string, how?: 'app' | 'token') => {
      if (!repo) return;
      setPhase('checking');
      setError(undefined);
      try {
        const setup = await checkSetup(repo, value);
        if ('missing' in setup) setPhase('missing');
        else {
          setBranch(setup.branch);
          setPhase('ready');
        }
      } catch (problem) {
        const status = problem instanceof GithubProblem ? problem.status : 0;
        if (how === 'app' && status === 401) write('local', APP_KEY);
        setError(
          how === 'app' && (status === 403 || status === 404)
            ? `CodeDNA can’t see ${repo} yet. Install the CodeDNA GitHub App on it (for an organisation’s repo, an owner may need to), then press Check again.`
            : how === 'app' && status === 401
              ? 'The GitHub connection has expired. Press Connect GitHub again.'
              : problem instanceof Error
                ? problem.message
                : 'GitHub couldn’t be checked.',
        );
        setPhase(status === 401 ? 'disconnected' : 'failed');
      }
    },
    [repo],
  );

  // A token kept from before, and a run still going when the page was left.
  useEffect(() => {
    if (!repo) return;
    const { error: authError } = takeAuthFragment();
    if (authError) setError(authError);
    const kept = read('local', TOKEN_KEY(repo));
    const pasted = kept ?? read('session', TOKEN_KEY(repo));
    const value = pasted ?? appToken();
    const how = pasted ? 'token' : 'app';
    setRemembered(!!kept);
    if (!value) return;
    setToken(value);
    setVia(how);
    const run = read('session', RUN_KEY(repo));
    if (run) {
      try {
        const parsed = JSON.parse(run) as SavedRun;
        setBranch(parsed.branch);
        setSaved(parsed);
        setPhase('queued');
        return;
      } catch {
        write('session', RUN_KEY(repo));
      }
    }
    void check(value, how);
  }, [repo, check]);

  // Follows the run until it finishes, then loads its results.
  useEffect(() => {
    if (!repo || !token || !saved) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = saved;
    const finish = (next: GithubQaPhase, message?: string) => {
      write('session', RUN_KEY(repo));
      setSaved(undefined);
      setError(message);
      setPhase(next);
    };
    const tick = async () => {
      try {
        let run: RunInfo | undefined;
        if (current.runId) run = await getRun(repo, token, current.runId);
        else {
          run = await findRun(repo, token, current);
          if (run) {
            current = { ...current, runId: run.id };
            write('session', RUN_KEY(repo), JSON.stringify(current));
          } else if (Date.now() - current.since > 3 * 60_000) return finish('ready', 'GitHub hasn’t started the run after 3 minutes. Open the repo’s Actions tab to see why.');
        }
        if (!active) return;
        if (run) {
          setRunUrl(run.url);
          if (run.status !== 'completed') setPhase(run.status === 'in_progress' ? 'running' : 'queued');
          else {
            if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') return finish('ready', 'The run was cancelled on GitHub before it finished.');
            setPhase('fetching');
            const { report, shots } = await fetchResults(repo, token, run.id);
            if (!active) return;
            const problem = results.current(report, shots);
            return finish(problem ? 'ready' : 'done', problem);
          }
        }
      } catch (problem) {
        if (!active) return;
        if (problem instanceof GithubProblem && problem.status !== 0 && problem.status < 500) return finish(problem.status === 401 ? 'disconnected' : 'ready', problem.message);
        // A hiccup: keep trying.
      }
      if (active) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [repo, token, saved]);

  return {
    phase,
    ...(runUrl ? { runUrl } : {}),
    ...(error ? { error } : {}),
    remembered,
    ...(via ? { via } : {}),
    connect: async (value, remember) => {
      if (!repo) return;
      const clean = value.trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(clean)) {
        setError('That doesn’t look like a GitHub token. It starts with github_pat_ or ghp_.');
        return;
      }
      write(remember ? 'local' : 'session', TOKEN_KEY(repo), clean);
      write(remember ? 'session' : 'local', TOKEN_KEY(repo));
      setRemembered(remember);
      setToken(clean);
      setVia('token');
      await check(clean, 'token');
    },
    disconnect: () => {
      if (!repo) return;
      write('local', TOKEN_KEY(repo));
      write('session', TOKEN_KEY(repo));
      write('session', RUN_KEY(repo));
      write('local', APP_KEY);
      setToken(undefined);
      setVia(undefined);
      setSaved(undefined);
      setRunUrl(undefined);
      setError(undefined);
      setPhase('disconnected');
    },
    recheck: () => {
      if (token) void check(token, via);
    },
    start: async ({ url, mode }) => {
      if (!repo || !token) return;
      setPhase('starting');
      setError(undefined);
      setRunUrl(undefined);
      const request = `#${Math.random().toString(36).slice(2, 10)}`;
      const since = Date.now();
      try {
        const { marked } = await dispatchRun(repo, token, { branch, url, interact: mode === 'full', request });
        const next: SavedRun = { branch, request, since, marked };
        write('session', RUN_KEY(repo), JSON.stringify(next));
        setPhase('queued');
        setSaved(next);
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : 'GitHub wouldn’t start the run.');
        setPhase(problem instanceof GithubProblem && problem.status === 401 ? 'disconnected' : 'ready');
      }
    },
  };
}
