'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QaLiveRun, QaRunRequest, RepoBundle } from '@codedna/shared';

/**
 * Runs QA flows from the page, through the CodeDNA server on the learner's own computer (only
 * when CodeDNA was opened with `codedna`). The hosted site never drives a browser: there,
 * `available` stays false and the page shows the command and the CI set-up instead.
 */
export interface LiveQa {
  available: boolean;
  run?: QaLiveRun;
  running: boolean;
  start: (request: QaRunRequest) => Promise<string | undefined>;
  stop: () => void;
  send: (url: string, body: unknown) => Promise<{ value?: unknown; error?: string }>;
}

const POLL_MS = 1000;

export function useLiveQa(bundle: RepoBundle, onFinished: () => void): LiveQa {
  const [token, setToken] = useState<string>();
  const [run, setRun] = useState<QaLiveRun>();
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const base = `/api/local/qa-run/${encodeURIComponent(bundle.id)}`;

  useEffect(() => {
    if (bundle.source !== 'local') return;
    let active = true;
    void (async () => {
      const session = await fetch(`/api/local/qa-session/${encodeURIComponent(bundle.id)}`, { cache: 'no-store' }).catch(() => undefined);
      if (!session?.ok || !active) return;
      const body = (await session.json().catch(() => ({}))) as { token?: unknown };
      if (typeof body.token === 'string' && active) setToken(body.token);
      const now = await fetch(base, { cache: 'no-store' }).catch(() => undefined);
      if (now?.ok && active) setRun((await now.json()) as QaLiveRun);
    })();
    return () => {
      active = false;
    };
  }, [bundle.id, bundle.source, base]);

  const running = run?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void fetch(base, { cache: 'no-store' })
        .then((response) => (response.ok ? (response.json() as Promise<QaLiveRun>) : undefined))
        .then((next) => {
          if (!next) return;
          setRun(next);
          if (next.state !== 'running') finished.current();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [running, base]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      if (!token) return 'Open this project with “codedna” on your computer to run tests from here.';
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-codedna-token': token }, body: JSON.stringify(body ?? {}) }).catch(() => undefined);
      if (!response) return 'CodeDNA on your computer isn’t answering. Is “codedna” still running?';
      const value = (await response.json().catch(() => ({}))) as QaLiveRun & { error?: string };
      if (!response.ok) return value.error ?? 'The run couldn’t start.';
      setRun(value);
      return undefined;
    },
    [token, base],
  );

  /** Another call to the local server with this page's token (journeys, test account). */
  const send = useCallback(
    async (url: string, body: unknown): Promise<{ value?: unknown; error?: string }> => {
      if (!token) return { error: 'Open this project with “codedna” on your computer to change this.' };
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-codedna-token': token }, body: JSON.stringify(body) }).catch(() => undefined);
      if (!response) return { error: 'CodeDNA on your computer isn’t answering. Is “codedna” still running?' };
      const value = (await response.json().catch(() => ({}))) as { error?: string };
      return response.ok ? { value } : { error: value.error ?? 'That couldn’t be saved.' };
    },
    [token],
  );

  return {
    available: !!token,
    ...(run ? { run } : {}),
    running,
    start: (request) => post('', request),
    stop: () => void post('/stop'),
    send,
  };
}

const URL_KEY = (id: string) => `codedna:qa-url:${id}`;
/** The app address last used for this project, kept in this browser only. */
export function savedAppUrl(id: string): string | undefined {
  try {
    return window.localStorage.getItem(URL_KEY(id)) ?? undefined;
  } catch {
    return undefined;
  }
}
export function saveAppUrl(id: string, url: string) {
  try {
    window.localStorage.setItem(URL_KEY(id), url);
  } catch {
    // Remembered for this visit only.
  }
}
