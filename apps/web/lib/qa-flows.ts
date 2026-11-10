import { qaPlanFor, worstStatus, type Feature, type QaCaseKind, type QaCheck, type QaLiveRun, type QaPlan, type QaReport, type QaStatus, type QaStepKind } from '@codedna/shared';

/**
 * Joins the QA plan (what should be tried, from the code) with the last report (what happened),
 * per feature and per case. Pure, so the page and tests agree.
 */
export type FlowState = QaStatus | 'untested' | 'unavailable' | 'running';

export interface CaseView {
  kind: QaCaseKind;
  title: string;
  expected: string;
  acts: boolean;
  check?: QaCheck;
  state: FlowState;
}

export interface FlowView {
  feature: Feature;
  plan: QaPlan;
  cases: CaseView[];
  state: FlowState;
}

/** The steps a case goes through, before it has run: what the browser will do, in order. */
export function plannedSteps(plan: QaPlan, kind: QaCaseKind): { kind: QaStepKind; label: string }[] {
  const trigger = plan.trigger ? `“${plan.trigger.label}”` : 'it';
  const steps: { kind: QaStepKind; label: string }[] = [
    { kind: 'open', label: `Open ${plan.page ?? 'the page'}` },
    { kind: 'find', label: `Find ${trigger}` },
  ];
  if (kind === 'reach') return steps;
  if (plan.shape === 'form') steps.push({ kind: 'fill', label: 'Fill in the form' });
  steps.push({ kind: 'press', label: `${plan.trigger?.verb === 'press' ? 'Press' : 'Click'} ${trigger}` });
  if (plan.expectations.sendsData || plan.expectations.request) steps.push({ kind: 'request', label: 'Send to the server' }, { kind: 'server', label: 'Server answers' });
  steps.push({ kind: 'result', label: 'What happens next' });
  return steps;
}

/**
 * `live` is a run going on now: its finished checks replace the report's, and the case being
 * tried shows as running, so the page fills in as the browser works.
 */
export function flowViews(features: readonly Feature[], report?: QaReport, live?: QaLiveRun): Map<string, FlowView> {
  const checks = new Map<string, QaCheck>();
  for (const suite of report?.suites ?? []) if (suite.runner === 'flows') for (const check of suite.checks) checks.set(check.id, check);
  const ongoing = live?.state === 'running';
  if (ongoing) for (const check of live.checks) checks.set(check.id, check);
  const now = ongoing && live.current ? `flow:${live.current.featureId}:${live.current.caseKind}` : undefined;
  const views = new Map<string, FlowView>();
  for (const feature of features) {
    const plan = qaPlanFor(feature);
    const cases: CaseView[] = plan.cases.map((item) => {
      const check = checks.get(`flow:${feature.id}:${item.kind}`);
      const id = `flow:${feature.id}:${item.kind}`;
      if (id === now) return { ...item, state: 'running' as const };
      return { ...item, ...(check ? { check } : {}), state: check ? check.status : 'untested' };
    });
    const ran = cases.map((item) => item.state).filter((state): state is QaStatus => state !== 'untested' && state !== 'unavailable' && state !== 'running');
    const state: FlowState = plan.unavailable ? 'unavailable' : cases.some((item) => item.state === 'running') ? 'running' : ran.some((value) => value !== 'skipped') ? worstStatus(ran) : ran.length ? 'skipped' : 'untested';
    views.set(feature.id, { feature, plan, cases, state });
  }
  return views;
}

export function flowCounts(views: Iterable<FlowView>): Record<FlowState, number> {
  const counts: Record<FlowState, number> = { passed: 0, failed: 0, warning: 0, skipped: 0, untested: 0, unavailable: 0, running: 0 };
  for (const view of views) counts[view.state]++;
  return counts;
}
