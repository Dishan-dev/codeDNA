import { describe, expect, it } from 'vitest';
import { buildJourneys, type Feature, type QaLiveRun, type QaReport } from '@codedna/shared';
import { firstNodeOf, journeyCounts, journeyViews } from './qa-journeys';

const features = [
  { id: 'f-link', key: 'link', title: 'Open “Checkout”', page: '/', entryKind: 'link', importance: 'detail', steps: [{ id: 'l0', title: 'You click “Checkout”', stage: 'click' }], effects: [{ kind: 'navigation', label: 'opens /checkout', stepId: 'l0', confidence: 'conventional' }], branches: [] },
  { id: 'f-coupon', key: 'coupon', title: 'Apply coupon', page: '/checkout', entryKind: 'event-handler', importance: 'main', steps: [{ id: 'c0', title: 'You click “Apply coupon”', stage: 'click' }, { id: 'c1', title: 'Calls the API', stage: 'request' }], effects: [{ kind: 'api-call', label: 'POST /api/coupons', stepId: 'c1', confidence: 'resolved' }], branches: [] },
] as unknown as Feature[];
const journeys = buildJourneys(features);
const coupon = journeys[0]!;

describe('journey views', () => {
  it('shows each point as not tested before any run', () => {
    const [view] = journeyViews(journeys, features, undefined);
    expect(view!.state).toBe('untested');
    expect(view!.stations.map((station) => station.nodes.length)).toEqual([1, 3, 5]);
    expect(firstNodeOf(view!)?.id).toBe('0.open');
  });

  it('lights up live: points done so far, sign-in added on the way, and the next point running', () => {
    const live: QaLiveRun = {
      state: 'running',
      kind: 'journeys',
      checks: [],
      log: [],
      current: {
        journeyId: coupon.id,
        steps: [
          { nodeId: '0.open', kind: 'open', label: 'Open /', status: 'passed' },
          { nodeId: '1.find', kind: 'find', label: 'Find “Checkout”', status: 'passed' },
          { nodeId: '1.press', kind: 'press', label: 'Click “Checkout”', status: 'passed' },
          { nodeId: '1.signin-fill', kind: 'fill', label: 'Fill in the test account', status: 'passed' },
        ],
      },
    };
    const [view] = journeyViews(journeys, features, undefined, live);
    expect(view!.state).toBe('running');
    const nodes = view!.stations[1]!.nodes;
    expect(nodes.map((node) => [node.id, node.state, node.extra ?? false])).toEqual([
      ['1.find', 'passed', false],
      ['1.press', 'passed', false],
      ['1.signin-fill', 'passed', true],
      ['1.result', 'running', false],
    ]);
    expect(firstNodeOf(view!)?.id).toBe('1.result');
  });

  it('shows where the last run broke, with its HTTP answer', () => {
    const report = {
      version: 1,
      repoId: 'x',
      repoName: 'x',
      createdAt: '',
      tool: { name: 'codedna', version: '0' },
      suites: [{ runner: 'journeys', title: 'User journeys', status: 'failed', startedAt: '', durationMs: 0, checks: [{ id: `journey:${coupon.id}`, journeyId: coupon.id, title: 'Apply coupon', status: 'failed', steps: [{ nodeId: '2.server', kind: 'server', label: 'Server answers', status: 'failed', http: { method: 'POST', url: 'http://localhost/api/coupons', status: 500 } }] }] }],
    } as QaReport;
    const views = journeyViews(journeys, features, report);
    expect(views[0]!.state).toBe('failed');
    expect(firstNodeOf(views[0]!)).toMatchObject({ id: '2.server', state: 'failed' });
    expect(journeyCounts(views).failed).toBe(1);
  });
});
