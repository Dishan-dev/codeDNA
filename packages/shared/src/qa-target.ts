import type { QaCaseKind, QaCheck, QaStepResult } from './qa.js';

/**
 * Where a QA run points: the learner's own machine, or a deployed site. Pure, so the CLI, the
 * local server and the page all apply the same rules.
 *
 * - A local address (localhost) can be tested fully: it is the learner's own copy.
 * - A deployed site can always be *looked at* (pages opened, links followed, nothing sent).
 *   Filling in its forms needs the site's owner to have agreed, by publishing the ownership file.
 */
export type QaTarget = { kind: 'local' | 'deployed'; url: string; origin: string } | { problem: string };

/** The file a site publishes to agree to full testing, and the line it must contain. */
export const QA_OWNER_PATH = '/.well-known/codedna.txt';
export const QA_OWNER_LINE = 'codedna: allow-testing';
/** True when the file's text holds the agreement line (on a line of its own). */
export const ownerFileAllows = (text: string) => text.split(/\r?\n/).some((line) => line.trim().toLowerCase() === QA_OWNER_LINE);

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
/** Addresses on a private network (office, home, a dev VM): plain http is fine there. */
const PRIVATE = /^(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+|.+\.(?:local|internal|lan|test))$/i;

export function qaTargetOf(value: string): QaTarget {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { problem: 'That isn’t a web address. It looks like https://my-app.vercel.app or http://localhost:3000.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { problem: 'Only http and https addresses can be tested.' };
  if (url.username || url.password) return { problem: 'Leave the sign-in details out of the address.' };
  const clean = `${url.origin}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`;
  if (LOCAL_HOSTS.includes(url.hostname)) return { kind: 'local', url: clean, origin: url.origin };
  if (url.protocol === 'http:' && !PRIVATE.test(url.hostname)) return { problem: 'A site on the internet must use https.' };
  return { kind: 'deployed', url: clean, origin: url.origin };
}

/** How a run treats the app: `look` opens pages and follows links only; `full` also sends test data. */
export type QaMode = 'look' | 'full';

/** What the QA flows page asks the local CodeDNA server to run. */
export interface QaRunRequest {
  url: string;
  mode: QaMode;
  /** Only these features; all when absent. */
  featureIds?: string[];
  /** `journeys` runs user journeys end to end; `flows` (the default) runs each feature's cases. */
  kind?: 'flows' | 'journeys';
  /** Only these journeys; all when absent. */
  journeyIds?: string[];
}

/** A run in progress (or just finished), as the local server reports it to the page. */
export interface QaLiveRun {
  state: 'idle' | 'running' | 'done' | 'stopped' | 'failed';
  runId?: string;
  appUrl?: string;
  mode?: QaMode;
  featureIds?: string[];
  kind?: 'flows' | 'journeys';
  journeyIds?: string[];
  /** What is being tried right now: a flow's case, or a journey's point (with its points so far). */
  current?: { featureId?: string; caseKind?: QaCaseKind; journeyId?: string; nodeId?: string; steps?: QaStepResult[] };
  /** Flow checks finished so far in this run. */
  checks: QaCheck[];
  /** The last lines of the run's log. */
  log: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}
