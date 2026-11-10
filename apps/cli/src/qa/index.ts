import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { QA_REPORT_VERSION, qaTotals, validateQaReport, worstStatus, type QaCheck, type QaReport, type QaSuite, type RepoBundle } from '@codedna/shared';
import { flowsRunner } from './flows-runner.js';
import { journeysRunner } from './journeys-runner.js';
import { testsRunner } from './tests-runner.js';
import type { QaContext, QaRunner } from './types.js';
import { walkRunner } from './walk-runner.js';

export { checkOwnership, isLocalUrl } from './browser.js';
export type { QaContext, QaRunner } from './types.js';

/** Every checker `codedna qa` knows. Add a runner here to add a kind of check. */
export const RUNNERS: readonly QaRunner[] = [testsRunner, walkRunner, journeysRunner, flowsRunner];

/** A run id that sorts by time, e.g. run-20261107-153012. */
export const newRunId = (date = new Date()) => `run-${date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;

/**
 * Screenshot folders of the last few runs are kept; older ones are removed, except folders the
 * current report still points at (a one-flow run keeps the others' screenshots). Only CodeDNA's own folders.
 */
export async function pruneRuns(root: string, keep = 5, report?: QaReport): Promise<void> {
  const folder = join(root, '.codedna', 'qa');
  const used = new Set(report?.suites.flatMap((suite) => suite.checks.flatMap((check) => [check.screenshot, ...(check.steps ?? []).map((step) => step.screenshot)].map((shot) => shot?.split('/')[0]))) ?? []);
  const runs = (await readdir(folder).catch(() => [] as string[])).filter((name) => /^run-\d{8}-\d{6}$/.test(name)).sort();
  for (const name of runs.slice(0, Math.max(0, runs.length - keep))) if (!used.has(name)) await rm(join(folder, name), { recursive: true, force: true });
}

/**
 * A run of only some features, folded into the last report: their flow checks are replaced and
 * every other result is kept, so testing one flow doesn't wipe the rest.
 */
export function mergeFlowReport(previous: QaReport | undefined, next: QaReport, featureIds?: readonly string[]): QaReport {
  if (!previous || !featureIds?.length || previous.repoId !== next.repoId) return next;
  const fresh = next.suites.find((suite) => suite.runner === 'flows');
  if (!fresh) return next;
  const old = previous.suites.find((suite) => suite.runner === 'flows');
  const kept: QaCheck[] = (old?.checks ?? []).filter((check) => !check.featureId || !featureIds.includes(check.featureId));
  const checks = [...kept, ...fresh.checks];
  const flows: QaSuite = { ...fresh, checks, status: worstStatus(checks.map((check) => check.status)) };
  return { ...next, suites: [flows, ...previous.suites.filter((suite) => suite.runner !== 'flows')] };
}

/**
 * A journeys run folded into the last report: those journeys' results are replaced (all of them
 * when no ids are given) and every other suite is kept, so journeys and flows live side by side.
 */
export function mergeJourneyReport(previous: QaReport | undefined, next: QaReport, journeyIds?: readonly string[]): QaReport {
  const fresh = next.suites.find((suite) => suite.runner === 'journeys');
  if (!previous || previous.repoId !== next.repoId || !fresh) return next;
  const old = previous.suites.find((suite) => suite.runner === 'journeys');
  const kept: QaCheck[] = journeyIds?.length ? (old?.checks ?? []).filter((check) => !check.journeyId || !journeyIds.includes(check.journeyId)) : [];
  const checks = [...kept, ...fresh.checks];
  const journeys: QaSuite = { ...fresh, checks, status: worstStatus(checks.map((check) => check.status)) };
  return { ...next, suites: [journeys, ...previous.suites.filter((suite) => suite.runner !== 'journeys')] };
}

/** Where a project's last report is kept: inside the project, next to its code, never uploaded. */
export const reportPath = (root: string) => join(root, '.codedna', 'qa-report.json');

export async function readReport(path: string): Promise<QaReport | undefined> {
  try {
    const result = validateQaReport(JSON.parse(await readFile(path, 'utf8')));
    return 'report' in result ? result.report : undefined;
  } catch {
    return undefined;
  }
}

export interface QaRunOptions {
  runners: readonly QaRunner[];
  context: QaContext;
  version: string;
  /** Asked once, after the plan is shown. Returning false stops before anything runs. */
  confirm: (question: string) => Promise<boolean>;
}

export type QaOutcome = { kind: 'done'; report: QaReport } | { kind: 'declined' } | { kind: 'nothing'; reasons: string[] };

/** Plan, ask, run: nothing runs until the learner has seen the plan and said yes. */
export async function runQa({ runners, context, version, confirm }: QaRunOptions): Promise<QaOutcome> {
  const ready: QaRunner[] = [];
  const skipped: QaSuite[] = [];
  const reasons: string[] = [];
  for (const runner of runners) {
    const reason = await runner.unavailable(context);
    if (reason) {
      reasons.push(`${runner.title}: ${reason}`);
      skipped.push({ runner: runner.id, title: runner.title, status: 'skipped', note: reason, checks: [], startedAt: new Date().toISOString(), durationMs: 0 });
    } else ready.push(runner);
  }
  if (!ready.length) return { kind: 'nothing', reasons };

  context.log('CodeDNA will:');
  for (const runner of ready) for (const action of await runner.plan(context)) context.log(`  • ${action.text}${action.runsProjectCode ? '  ⚠ runs your project’s code' : ''}`);
  for (const reason of reasons) context.log(`  (skipped) ${reason}`);
  if (!(await confirm('Go ahead?'))) return { kind: 'declined' };

  const suites: QaSuite[] = [];
  for (const runner of ready) {
    context.log('');
    context.log(`${runner.title}…`);
    try {
      suites.push(await runner.run(context));
    } catch (error) {
      suites.push({ runner: runner.id, title: runner.title, status: 'failed', note: (error as Error).message, checks: [{ id: `${runner.id}:error`, title: `${runner.title} couldn’t run`, status: 'failed', detail: (error as Error).message }], startedAt: new Date().toISOString(), durationMs: 0 });
    }
  }
  const report: QaReport = {
    version: QA_REPORT_VERSION,
    repoId: context.bundle.id,
    repoName: context.bundle.name,
    ...(context.appUrl ? { appUrl: context.appUrl, mode: context.interact ? ('full' as const) : ('look' as const) } : {}),
    runId: context.runId,
    createdAt: new Date().toISOString(),
    tool: { name: 'codedna', version },
    suites: [...suites, ...skipped],
  };
  return { kind: 'done', report };
}

export async function saveReport(report: QaReport, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // Reports are for this machine: keep the default folder out of the project's git history.
  if (path === reportPath(dirname(dirname(path)))) await writeFile(join(dirname(path), '.gitignore'), '*\n', 'utf8');
}

/** The report in a few lines for the terminal. */
export function formatReport(report: QaReport, bundle: RepoBundle): string {
  const totals = qaTotals(report);
  const titles = new Map(bundle.features.map((feature) => [feature.id, feature.title]));
  const lines = [`QA results for ${report.repoName}: ${totals.passed} passed · ${totals.failed} failed · ${totals.warning} to look at · ${totals.skipped} skipped`];
  for (const suite of report.suites) {
    lines.push('');
    lines.push(`${suite.title}${suite.note ? ` (${suite.note})` : ''}`);
    const shown = suite.checks.filter((check) => check.status === 'failed' || check.status === 'warning');
    if (!suite.checks.length) lines.push(`  ${suite.status === 'skipped' ? 'Skipped.' : 'Nothing to check.'}`);
    else if (!shown.length) {
      const passed = suite.checks.filter((check) => check.status === 'passed');
      lines.push(passed.length === 1 ? `  ✓ ${passed[0]!.title}` : `  All ${passed.length} checks passed.`);
    }
    for (const check of shown.slice(0, 20)) {
      const feature = check.featureId ? titles.get(check.featureId) : undefined;
      lines.push(`  ${check.status === 'failed' ? '✗' : '!'} ${check.title}${feature && !check.title.includes(feature) ? ` — ${feature}` : ''}`);
      if (check.detail) lines.push(`      ${check.detail}`);
    }
    if (shown.length > 20) lines.push(`  …and ${shown.length - 20} more in the report.`);
  }
  return lines.join('\n');
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * The report as Markdown, for a CI job summary or a pull-request comment: what broke first, with
 * the step it broke at, then what to look at, with everything that passed folded away.
 */
export function formatMarkdown(report: QaReport, bundle: RepoBundle, runUrl?: string): string {
  const totals = qaTotals(report);
  const titles = new Map(bundle.features.map((feature) => [feature.id, feature.title]));
  const checks = report.suites.flatMap((suite) => suite.checks.map((check) => ({ suite, check })));
  const where = report.appUrl ? ` on ${report.appUrl}${report.mode === 'look' ? ' (looked only, sent nothing)' : ''}` : '';
  const lines = [
    `## ${totals.failed ? '❌' : totals.warning ? '⚠️' : '✅'} CodeDNA QA — ${report.repoName}`,
    '',
    `**${totals.failed} broke** · ${totals.warning} to look at · ${totals.passed} passed · ${totals.skipped} skipped${where}.`,
  ];
  const table = (status: 'failed' | 'warning', heading: string) => {
    const rows = checks.filter(({ check }) => check.status === status);
    if (!rows.length) return;
    lines.push('', `### ${heading}`, '', '| What | Step | What happened |', '| --- | --- | --- |');
    for (const { suite, check } of rows.slice(0, 30)) {
      const step = check.steps?.find((item) => item.status === status);
      const feature = check.featureId ? titles.get(check.featureId) : undefined;
      const what = feature && !check.title.includes(feature) ? `${check.title} — ${feature}` : check.title;
      lines.push(`| ${cell(what)}${check.page ? ` <br><sub>${cell(check.page)}</sub>` : ''} | ${step ? cell(step.label) : cell(suite.title)} | ${cell(step?.detail ?? check.detail ?? '')} |`);
    }
    if (rows.length > 30) lines.push('', `…and ${rows.length - 30} more in the report.`);
  };
  table('failed', 'Broke');
  table('warning', 'To look at');
  const passed = checks.filter(({ check }) => check.status === 'passed');
  if (passed.length) {
    lines.push('', `<details><summary>Passed (${passed.length})</summary>`, '');
    for (const { check } of passed.slice(0, 100)) lines.push(`- ${cell(check.title)}`);
    lines.push('', '</details>');
  }
  lines.push('', `Each flow step by step, with screenshots: download the **codedna-qa** artifact${runUrl ? ` from [this run](${runUrl})` : ''} and load \`qa-report.json\` on the QA flows page of this repo in CodeDNA.`);
  return `${lines.join('\n')}\n`;
}
