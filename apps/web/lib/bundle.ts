'use client';
import { useEffect, useState } from 'react';
import type { RepoBundle } from '@codedna/shared';

export interface StarterSummary {
  id: string;
  name: string;
  sentence: string;
  lessons: number;
  framework: string;
}

export type Loadable<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'missing' } | { status: 'error'; message: string };

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

/**
 * Where a repository's bundle comes from. Starter repos are built ahead of time; `local-*` repos
 * are served by the CodeDNA CLI from the learner's own machine; `gh-*` repos were imported from
 * GitHub by this server.
 */
async function fetchBundle(repo: string, signal: AbortSignal): Promise<RepoBundle | undefined> {
  if (!SAFE_ID.test(repo)) return undefined;
  const source = repo.startsWith('local-') ? `/api/local/bundle/${repo}` : repo.startsWith('gh-') ? `/api/github/bundle/${repo}` : `/starters/${repo}.json`;
  const response = await fetch(source, { signal });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`The lessons for this app could not be loaded (${response.status}).`);
  return (await response.json()) as RepoBundle;
}

export function useBundle(repo: string): Loadable<RepoBundle> {
  const [state, setState] = useState<Loadable<RepoBundle>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchBundle(repo, controller.signal).then(
      (bundle) => setState(bundle ? { status: 'ready', value: bundle } : { status: 'missing' }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
      },
    );
    return () => controller.abort();
  }, [repo]);
  return state;
}

export function useStarters(): Loadable<StarterSummary[]> {
  const [state, setState] = useState<Loadable<StarterSummary[]>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/starters/index.json', { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<StarterSummary[]>) : Promise.reject(new Error('Starter repos are not available right now.'))))
      .then(
        (value) => setState({ status: 'ready', value }),
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
        },
      );
    return () => controller.abort();
  }, []);
  return state;
}
