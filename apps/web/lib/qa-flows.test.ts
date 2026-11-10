import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { qaPlanFor, type QaReport, type RepoBundle } from '@codedna/shared';
import { flowCounts, flowViews, plannedSteps } from './qa-flows';

const bundle = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'starters', 'snackshop.json'), 'utf8')) as RepoBundle;
const placeOrder = bundle.features.find((feature) => feature.title === 'Place order')!;

describe('QA flows', () => {
  it('plans the order form from its code, quoting the data check rather than sign-in checks', () => {
    const plan = qaPlanFor(placeOrder);
    expect(plan.shape).toBe('form');
    expect(plan.page).toBe('/checkout');
    expect(plan.expectations.destinations).toEqual(['/login', '/orders/*']);
    const empty = plan.cases.find((item) => item.kind === 'empty')!;
    expect(empty.expected).toContain('“!parsed.success”');
    expect(empty.expected).not.toContain('!session');
  });

  it('lists the browser steps a case will take before it has run', () => {
    const plan = qaPlanFor(placeOrder);
    expect(plannedSteps(plan, 'reach').map((step) => step.kind)).toEqual(['open', 'find']);
    expect(plannedSteps(plan, 'empty').map((step) => step.kind)).toEqual(['open', 'find', 'fill', 'press', 'request', 'server', 'result']);
  });

  it('joins the plan with the last run, feature by feature', () => {
    const untested = flowViews(bundle.features);
    expect(untested.get(placeOrder.id)!.state).toBe('untested');
    const report = {
      version: 1,
      repoId: 'snackshop',
      repoName: 'Snackshop',
      createdAt: '2026-11-07T10:00:00Z',
      tool: { name: 'codedna', version: '0.0.0' },
      suites: [
        {
          runner: 'flows',
          title: 'Flows',
          status: 'failed',
          startedAt: '2026-11-07T10:00:00Z',
          durationMs: 1,
          checks: [
            { id: `flow:${placeOrder.id}:happy-path`, title: 'x', status: 'passed' },
            { id: `flow:${placeOrder.id}:empty`, title: 'y', status: 'failed' },
          ],
        },
      ],
    } as QaReport;
    const views = flowViews(bundle.features, report);
    const view = views.get(placeOrder.id)!;
    expect(view.state).toBe('failed');
    expect(view.cases.find((item) => item.kind === 'empty')!.state).toBe('failed');
    expect(view.cases.find((item) => item.kind === 'too-long')!.state).toBe('untested');
    expect(flowCounts(views.values()).failed).toBe(1);
  });

  it('fills in as a live run goes: finished cases show, the current one is running', () => {
    const live = {
      state: 'running' as const,
      checks: [{ id: `flow:${placeOrder.id}:reach`, title: 'x', status: 'passed' as const }],
      current: { featureId: placeOrder.id, caseKind: 'happy-path' as const },
      log: [],
    };
    const view = flowViews(bundle.features, undefined, live).get(placeOrder.id)!;
    expect(view.state).toBe('running');
    expect(view.cases.find((item) => item.kind === 'reach')!.state).toBe('passed');
    expect(view.cases.find((item) => item.kind === 'happy-path')!.state).toBe('running');
    // Once it has finished, the saved report is what counts.
    expect(flowViews(bundle.features, undefined, { ...live, state: 'done' }).get(placeOrder.id)!.state).toBe('untested');
  });
});
