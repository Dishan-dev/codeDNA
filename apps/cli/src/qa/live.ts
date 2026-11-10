import { qaTargetOf, readJourneyEdits, type JourneyEdits, type QaLiveRun, type QaRunRequest, type RepoBundle } from '@codedna/shared';
import { checkOwnership } from './browser.js';
import { flowsRunner } from './flows-runner.js';
import { mergeFlowReport, mergeJourneyReport, newRunId, pruneRuns, readReport, reportPath, runQa, saveReport } from './index.js';
import { journeysRunner, readAccount, readJourneysFile, saveAccount, writeJourneysFile } from './journeys-runner.js';
import type { QaContext } from './types.js';

export interface LiveQa {
  status: () => QaLiveRun;
  /** Starts a run in the background; returns a reason when it can't start. */
  start: (request: unknown) => Promise<string | undefined>;
  stop: () => void;
}

const MAX_LOG = 80;

/** Checks a run request from the page: the shape, the address, and that the features exist. */
export function readRunRequest(value: unknown, bundle: RepoBundle): QaRunRequest | string {
  if (!value || typeof value !== 'object') return 'Send { url, mode }.';
  const { url, mode, featureIds, kind, journeyIds } = value as Partial<QaRunRequest>;
  if (typeof url !== 'string' || url.length > 2_000) return 'Give the address of the app to test.';
  if (mode !== 'look' && mode !== 'full') return 'Choose “look” or “full”.';
  if (kind !== undefined && kind !== 'flows' && kind !== 'journeys') return 'Choose “flows” or “journeys”.';
  if (featureIds !== undefined && (!Array.isArray(featureIds) || featureIds.length > 500 || featureIds.some((id) => typeof id !== 'string' || !bundle.features.some((feature) => feature.id === id)))) return 'Some of those features aren’t in this project.';
  if (journeyIds !== undefined && (!Array.isArray(journeyIds) || journeyIds.length > 500 || journeyIds.some((id) => typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)))) return 'Those journeys aren’t valid.';
  return { url, mode, ...(kind ? { kind } : {}), ...(featureIds ? { featureIds } : {}), ...(journeyIds ? { journeyIds } : {}) };
}

/**
 * Runs flows when the QA flows page asks, on this machine, one run at a time. The page is the
 * learner's say-so (it warns before sending data); a deployed site must have agreed to full runs.
 */
export function createLiveQa({ root, bundle, version, timeoutMs = 600_000 }: { root: string; bundle: RepoBundle; version: string; timeoutMs?: number }): LiveQa {
  let run: QaLiveRun = { state: 'idle', checks: [], log: [] };
  let controller: AbortController | undefined;
  const log = (line: string) => {
    run.log.push(line);
    if (run.log.length > MAX_LOG) run.log.splice(0, run.log.length - MAX_LOG);
  };

  return {
    status: () => run,
    stop: () => controller?.abort(),
    start: async (value) => {
      if (run.state === 'running') return 'A run is already going. Stop it or wait for it to finish.';
      const request = readRunRequest(value, bundle);
      if (typeof request === 'string') return request;
      const target = qaTargetOf(request.url);
      if ('problem' in target) return target.problem;
      if (request.mode === 'full' && target.kind === 'deployed') {
        const owner = await checkOwnership(target.origin);
        if (owner !== true) return owner;
      }
      controller = new AbortController();
      const runId = newRunId();
      const journeys = request.kind === 'journeys';
      run = { state: 'running', runId, appUrl: target.url, mode: request.mode, kind: journeys ? 'journeys' : 'flows', ...(request.featureIds ? { featureIds: request.featureIds } : {}), ...(request.journeyIds ? { journeyIds: request.journeyIds } : {}), checks: [], log: [], startedAt: new Date().toISOString() };
      const current = run;
      const account = journeys ? await readAccount(root) : undefined;
      const context: QaContext = {
        root,
        bundle,
        appUrl: target.url,
        target: target.kind,
        interact: request.mode === 'full',
        ...(request.featureIds ? { featureIds: request.featureIds } : {}),
        ...(request.journeyIds ? { journeyIds: request.journeyIds } : {}),
        ...(account ? { account } : {}),
        runId,
        timeoutMs,
        log,
        onCase: (featureId, caseKind) => (current.current = { featureId, caseKind }),
        onCheck: (check) => current.checks.push(check),
        onJourney: (journeyId, steps) => (current.current = { journeyId, steps }),
        signal: controller.signal,
      };
      const signal = controller.signal;
      void (async () => {
        try {
          const outcome = await runQa({ runners: [journeys ? journeysRunner : flowsRunner], context, version, confirm: async () => true });
          if (outcome.kind !== 'done') throw new Error(outcome.kind === 'nothing' ? outcome.reasons.join(' ') : 'Nothing ran.');
          const path = reportPath(root);
          const previous = await readReport(path);
          const report = journeys ? mergeJourneyReport(previous, outcome.report, request.journeyIds) : mergeFlowReport(previous, outcome.report, request.featureIds);
          await saveReport(report, path);
          await pruneRuns(root, 5, report);
          current.state = signal.aborted ? 'stopped' : 'done';
        } catch (error) {
          current.state = 'failed';
          current.error = (error as Error).message;
        } finally {
          delete current.current;
          current.finishedAt = new Date().toISOString();
        }
      })();
      return undefined;
    },
  };
}

const EMAIL_LIKE = /^[^\s]{1,200}$/;

/**
 * The project's journey edits (`codedna.journeys.json`, meant to be committed so CI uses them too)
 * and its test account (in the git-ignored `.codedna` folder; the password is never sent back).
 */
export function createProjectStore(root: string, bundle: RepoBundle) {
  return {
    read: async (): Promise<{ edits?: JourneyEdits; account?: { email: string } }> => {
      const edits = await readJourneysFile(root);
      const account = await readAccount(root);
      return { ...(edits ? { edits } : {}), ...(account ? { account: { email: account.email } } : {}) };
    },
    saveJourneys: async (value: unknown) => {
      const edits = readJourneyEdits(value);
      if ('problem' in edits) return edits.problem;
      // Journeys may only use features this project has.
      const keys = new Set(bundle.features.map((feature) => feature.key));
      if (edits.journeys.some((journey) => journey.steps.some((step) => step.kind === 'feature' && !keys.has(step.featureKey)))) return 'Some steps use features this project doesn’t have.';
      await writeJourneysFile(root, edits);
      return undefined;
    },
    saveAccount: async (value: unknown) => {
      if (!value || typeof value !== 'object') return 'Send { email, password }, or {} to remove the account.';
      const { email, password } = value as { email?: unknown; password?: unknown };
      if (email === undefined && password === undefined) {
        await saveAccount(root, undefined);
        return undefined;
      }
      if (typeof email !== 'string' || !EMAIL_LIKE.test(email.trim())) return 'Give the test account’s email or user name.';
      if (typeof password !== 'string' || !password || password.length > 500) return 'Give the test account’s password.';
      await saveAccount(root, { email: email.trim(), password });
      return undefined;
    },
  };
}
