import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeSnapshot, analyzeUIFlows } from '@codedna/core';
import { analyzeActions } from '@codedna/core/actions';
import { hydrateTrace } from '@codedna/core/trace-view';
import fixture from '../../../packages/core/fixtures/next-actions-app.snapshot.json';
import { TierBadge } from './tier-badge';
import { TraceCodePanel } from './trace-code-panel';
import { ActionTrace } from './action-trace';
import { PageInventory } from './page-inventory';

const snapshot = fixture as RepositorySnapshot;
const index = analyzeActions(snapshot, analyzeSnapshot(snapshot), analyzeUIFlows(snapshot).graph);
const booking = index.actions.find((item) => item.label === 'Create booking')!;
const noop = () => undefined;

describe('TierBadge', () => {
  it('names every tier in text, not only colour', () => {
    const html = (['resolved', 'conventional', 'heuristic', 'inferred', 'gap'] as const).map((tier) => renderToStaticMarkup(createElement(TierBadge, { tier }))).join('');
    for (const text of ['PROVEN', 'FRAMEWORK', 'BEST GUESS', 'AI READING', 'GAP']) expect(html).toContain(`>${text}<`);
    expect(renderToStaticMarkup(createElement(TierBadge, { tier: 'heuristic', count: 2 }))).toContain('2 best guesses');
    expect(renderToStaticMarkup(createElement(TierBadge, { tier: 'resolved' }))).toContain('not type-checked');
  });
});

describe('trace step and code panel', () => {
  const trace = hydrateTrace(index, booking.traceId, snapshot.files)!;
  it('highlights the selected step line with its file, tier and why', () => {
    const step = trace.steps.find((item) => item.kind === 'gap')!;
    const html = renderToStaticMarkup(createElement(TraceCodePanel, { step, onReach: noop }));
    expect(html).toContain(`${step.file} · line ${step.line}`);
    expect(html).toContain('>GAP<');
    expect(html).toMatch(new RegExp(`is-current" aria-current="true"><i aria-hidden="true">${step.line}</i>`));
    expect(html).toContain('Possible targets');
  });
  it('offers reverse reach only for steps with a symbol', () => {
    const call = trace.steps.find((item) => item.symbol?.name === 'quotePrice')!;
    expect(renderToStaticMarkup(createElement(TraceCodePanel, { step: call, onReach: noop }))).toContain('Who else reaches quotePrice?');
    const decision = trace.steps.find((item) => item.kind === 'decision')!;
    expect(renderToStaticMarkup(createElement(TraceCodePanel, { step: decision, onReach: noop }))).not.toContain('Who else reaches');
  });
  it('keeps the selected step and the code panel in sync', () => {
    const selected = trace.steps.find((item) => item.symbol?.name === 'quotePrice')!;
    const html = renderToStaticMarkup(createElement(ActionTrace, { index, snapshot, actionId: booking.id, stepId: selected.id, onStep: noop, onPage: noop, onPages: noop, onReach: noop, permalink: () => '' }));
    const position = trace.steps.indexOf(selected) + 1;
    expect(html).toContain(`Step ${position} of ${trace.steps.length}`);
    expect(html).toMatch(/aria-current="step"[^>]*>.*?<b>Calls quotePrice<\/b>/);
    expect(html).toContain('lib/pricing.ts · line 3');
    expect(html).toContain('if (!session)');
    expect(html).toContain('Static analysis of this snapshot (no commit recorded) — nothing was executed.');
  });
});

describe('page inventory', () => {
  it('groups a page’s actions by component with filters, tiers and trace buttons', () => {
    const html = renderToStaticMarkup(createElement(PageInventory, { index, pageId: 'page:/book/[roomId]', onPage: noop, onPages: noop, onTrace: noop }));
    expect(html).toContain('&lt;BookingForm&gt;');
    expect(html).toContain('aria-pressed="true">All 4');
    expect(html).toContain('Changes data 1');
    expect(html).toContain('Has gaps 1');
    expect(html).toContain('aria-label="Trace Create booking"');
    expect(html).toContain('writes Booking');
  });
});
