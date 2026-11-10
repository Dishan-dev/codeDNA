import type { QaCaseKind, QaCheck, QaStepResult, QaSuite, RepoBundle } from '@codedna/shared';

/** A test account for the app (never a real person's), used to sign in during journeys. */
export interface QaAccount {
  email: string;
  password: string;
}

/** What every QA runner gets: the project, what CodeDNA traced in it, and how to talk to the learner. */
export interface QaContext {
  /** The project folder on this machine. */
  root: string;
  bundle: RepoBundle;
  /** The app the browser checks use: a local address, or a deployed site. */
  appUrl?: string;
  /** `deployed` runs go slower between pages, so a real site isn't rushed. */
  target?: 'local' | 'deployed';
  /** Allow runners to click and type in the app (can change its data). */
  interact: boolean;
  /** Extra headers for the app's own requests only (e.g. a preview's protection bypass). */
  headers?: Record<string, string>;
  /** Only these features' flows; all when absent. */
  featureIds?: readonly string[];
  /** Names this run's folder of screenshots: `.codedna/qa/<runId>/`. */
  runId: string;
  /** Longest a runner may take, in milliseconds. */
  timeoutMs: number;
  log: (text: string) => void;
  /** Progress for a live view: the case starting now, and each check as it finishes. */
  onCase?: (featureId: string, caseKind: QaCaseKind) => void;
  onCheck?: (check: QaCheck) => void;
  /** Only these journeys; all when absent. */
  journeyIds?: readonly string[];
  /** The test account journeys sign in with. Never logged, never saved in a report. */
  account?: QaAccount;
  /** A journey's points so far, after each one, so the map lights up live. */
  onJourney?: (journeyId: string, steps: QaStepResult[]) => void;
  /** Stops the run between cases. */
  signal?: AbortSignal;
}

/** A step a runner will take, shown to the learner before anything runs. */
export interface PlannedAction {
  /** e.g. "Run your tests: pnpm test" */
  text: string;
  /** True when it runs code from the project (tests) or acts in the app (clicks, form sends). */
  runsProjectCode: boolean;
}

/**
 * One kind of QA check. Runners are independent: each decides if it can run, says up front
 * what it will do, and returns one suite for the shared report. Add a runner to add a check.
 */
export interface QaRunner {
  id: string;
  title: string;
  /** Why it can't run here (no test script, no app address…), or undefined when it can. */
  unavailable: (context: QaContext) => Promise<string | undefined>;
  plan: (context: QaContext) => Promise<PlannedAction[]>;
  run: (context: QaContext) => Promise<QaSuite>;
}
