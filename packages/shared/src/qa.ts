import type { StableId } from './index.js';

/**
 * A QA report: what `codedna qa` checked on the learner's own machine, and what happened.
 *
 * It is the one format every checker writes and every screen reads. A new checker (an AI
 * reviewer, a CI import, a load test) adds a suite with its own `runner` id; nothing else changes.
 * Reports are plain JSON so they can be saved, shared and loaded into the Quality page.
 */
export const QA_REPORT_VERSION = 1 as const;

export type QaStatus = 'passed' | 'failed' | 'warning' | 'skipped';

/** The kinds of test case a flow is put through. */
export type QaCaseKind = 'reach' | 'happy-path' | 'empty' | 'too-long' | 'emoji-unicode' | 'wrong-format' | 'double-submit';

/** One step of a flow as the browser did it, in the order a person would. */
export type QaStepKind = 'open' | 'find' | 'fill' | 'press' | 'request' | 'server' | 'result';

export interface QaStepResult {
  kind: QaStepKind;
  /** e.g. "Open /checkout", "Press “Place order”", "Server answered". */
  label: string;
  /** `skipped` means the flow stopped before this step. */
  status: QaStatus;
  detail?: string;
  /** The traced step in the code this matches, so a failure points at the code. */
  featureStepId?: StableId;
  /** For journeys: the point on the journey map, e.g. `2.request`. */
  nodeId?: string;
  /** The HTTP request seen at this point: what was asked, what came back and how long it took. */
  http?: QaHttp;
  /** A screenshot taken at this point, relative to `.codedna/qa/`. */
  screenshot?: string;
}

export interface QaHttp {
  method: string;
  url: string;
  /** Absent when no answer came back. */
  status?: number;
  durationMs?: number;
  /** Why there was no answer, e.g. "net::ERR_CONNECTION_REFUSED". */
  error?: string;
}

export interface QaCheck {
  /** Stable within a report, e.g. `walk:feature-abc:loads`. */
  id: string;
  title: string;
  status: QaStatus;
  /** For flow checks: which case this was. */
  caseKind?: QaCaseKind;
  /** For flow checks: each step, so the one that failed is easy to see. */
  steps?: QaStepResult[];
  /** What the code says should happen, in plain words. */
  expected?: string;
  /** What was typed, field by field. Never real personal data. */
  inputs?: Record<string, string>;
  /** A screenshot after the last step, relative to the project's `.codedna/qa/` folder. */
  screenshot?: string;
  /** The traced feature this check is about, when there is one. */
  featureId?: StableId;
  /** For journey checks: which journey. */
  journeyId?: string;
  /** The page it ran on, e.g. "/orders". */
  page?: string;
  /** One or two plain sentences: what was seen. */
  detail?: string;
  /** Raw lines for whoever fixes it: console errors, failed requests, test output. Short. */
  evidence?: string[];
  durationMs?: number;
}

export interface QaSuite {
  /** Which checker wrote it, e.g. "tests" or "walk". */
  runner: string;
  title: string;
  status: QaStatus;
  /** Why a whole suite was skipped or what it ran, e.g. "pnpm test". */
  note?: string;
  checks: QaCheck[];
  startedAt: string;
  durationMs: number;
}

export interface QaReport {
  version: typeof QA_REPORT_VERSION;
  /** The CodeDNA repo id the report belongs to, e.g. `local-my-app`. */
  repoId: string;
  repoName: string;
  /** The app address the browser checks used: a local address or a deployed site. */
  appUrl?: string;
  /** `look`: pages opened and links followed, nothing sent. `full`: forms filled with test data. */
  mode?: 'look' | 'full';
  /** Names the run's folder of screenshots, `.codedna/qa/<runId>/`. */
  runId?: string;
  createdAt: string;
  tool: { name: 'codedna'; version: string };
  suites: QaSuite[];
}

export interface QaTotals {
  passed: number;
  failed: number;
  warning: number;
  skipped: number;
  total: number;
}

/** Counts across every suite. */
export function qaTotals(report: Pick<QaReport, 'suites'>): QaTotals {
  const totals: QaTotals = { passed: 0, failed: 0, warning: 0, skipped: 0, total: 0 };
  for (const suite of report.suites)
    for (const check of suite.checks) {
      totals[check.status]++;
      totals.total++;
    }
  return totals;
}

/** The worst status in a list: failed beats warning beats passed; all skipped is skipped. */
export function worstStatus(statuses: readonly QaStatus[]): QaStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('warning')) return 'warning';
  if (statuses.includes('passed')) return 'passed';
  return 'skipped';
}

/** Check that unknown JSON is a report this version can read; returns a reason when it isn't. */
export function validateQaReport(value: unknown): { report: QaReport } | { problem: string } {
  if (!value || typeof value !== 'object') return { problem: 'This isn’t a CodeDNA QA report.' };
  const report = value as Partial<QaReport>;
  if (report.version !== QA_REPORT_VERSION) return { problem: report.version ? `This report is from a different CodeDNA version (${String(report.version)}).` : 'This isn’t a CodeDNA QA report.' };
  if (typeof report.repoId !== 'string' || !Array.isArray(report.suites)) return { problem: 'This QA report is incomplete.' };
  const statuses = new Set<QaStatus>(['passed', 'failed', 'warning', 'skipped']);
  for (const suite of report.suites) {
    if (!suite || typeof suite.runner !== 'string' || !Array.isArray(suite.checks) || !statuses.has(suite.status)) return { problem: 'This QA report has a damaged section.' };
    for (const check of suite.checks) if (!check || typeof check.id !== 'string' || typeof check.title !== 'string' || !statuses.has(check.status)) return { problem: 'This QA report has a damaged check.' };
  }
  return { report: report as QaReport };
}
