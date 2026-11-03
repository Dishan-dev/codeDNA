import { describe, expect, it } from 'vitest';
import type { UserAction } from '@codedna/shared';
import { filterActions, groupByComponent, moveStep, readFlowLocation, screenTab, tracePermalink, writeFlowLocation } from './flow-state';
import { pageStatus, tierCount } from './tiers';

const action = (id: string, extra: Partial<UserAction> = {}): UserAction => ({
  id, pageId: 'page:/', pageRoute: '/', component: 'Form', file: 'app/form.tsx', line: 1, triggerKind: 'event-handler', triggerCode: '<button onClick={x}>',
  label: id, effects: [], worstTier: 'resolved', gapCount: 0, changesData: false, traceId: `trace:${id}`, ...extra,
});

describe('flow location', () => {
  it('round-trips a trace location and keeps unrelated parameters', () => {
    const search = writeFlowLocation('?example=roomly', { screen: 'trace', action: 'action:page:/:a.tsx:1:2:onClick', step: 'step:x', commit: 'abc123' });
    expect(search).toContain('example=roomly');
    expect(readFlowLocation(search)).toEqual({ screen: 'trace', action: 'action:page:/:a.tsx:1:2:onClick', step: 'step:x', commit: 'abc123' });
  });
  it('defaults to the overview and ignores unknown screens and oversized values', () => {
    expect(readFlowLocation('?view=nope')).toEqual({ screen: 'overview' });
    expect(readFlowLocation(`?view=page&page=${'x'.repeat(600)}`)).toEqual({ screen: 'page' });
    expect(writeFlowLocation('?example=next&view=trace&step=s', { screen: 'overview' })).toBe('?example=next');
  });
  it('builds a permalink with repository source, commit, trace and step', () => {
    const link = tracePermalink('https://codedna.test/explorer', '?source=github&view=page', 'action:1', 'step:2', 'deadbeef');
    const url = new URL(link);
    expect(url.searchParams.get('source')).toBe('github');
    expect(url.searchParams.get('view')).toBe('trace');
    expect(url.searchParams.get('action')).toBe('action:1');
    expect(url.searchParams.get('step')).toBe('step:2');
    expect(url.searchParams.get('commit')).toBe('deadbeef');
  });
  it('maps screens to header tabs', () => {
    expect(screenTab('reach')).toBe('Overview');
    expect(screenTab('trace')).toBe('Pages');
    expect(screenTab('advanced')).toBeNull();
  });
});

describe('step navigation', () => {
  it('moves within bounds and starts at the first step', () => {
    expect(moveStep(['a', 'b', 'c'], 'b', 1)).toBe('c');
    expect(moveStep(['a', 'b', 'c'], 'c', 1)).toBe('c');
    expect(moveStep(['a', 'b', 'c'], 'a', -1)).toBe('a');
    expect(moveStep(['a', 'b'], 'hidden', 1)).toBe('a');
    expect(moveStep([], undefined, 1)).toBeUndefined();
  });
});

describe('action filters and grouping', () => {
  const actions = [action('a', { changesData: true }), action('b', { gapCount: 2, worstTier: 'gap' }), action('c', { component: 'Header', file: 'app/header.tsx' })];
  it('filters by data changes and gaps', () => {
    expect(filterActions(actions, 'all')).toHaveLength(3);
    expect(filterActions(actions, 'data').map((item) => item.id)).toEqual(['a']);
    expect(filterActions(actions, 'gap').map((item) => item.id)).toEqual(['b']);
  });
  it('groups by component in source order', () => {
    expect(groupByComponent(actions).map((group) => [group.component, group.actions.length])).toEqual([['Form', 2], ['Header', 1]]);
  });
});

describe('tier text', () => {
  it('summarises a page by its weakest actions, in words', () => {
    expect(pageStatus({ resolved: 2, conventional: 1, heuristic: 0, gap: 0 }, 3)).toEqual({ text: 'All followed', tier: 'resolved' });
    expect(pageStatus({ resolved: 0, conventional: 1, heuristic: 2, gap: 0 }, 3)).toEqual({ text: '2 best guesses', tier: 'heuristic' });
    expect(pageStatus({ resolved: 0, conventional: 0, heuristic: 1, gap: 1 }, 2)).toEqual({ text: '1 with gaps', tier: 'gap' });
    expect(pageStatus({ resolved: 0, conventional: 0, heuristic: 0, gap: 0 }, 0).text).toBe('No actions found');
    expect(tierCount('gap', 1)).toBe('1 gap');
  });
});
