import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoBundle } from '@codedna/shared';
import { areasOf, hopsOf, isMain, pageText, partsOf, uniqueFlows, whereText } from './flows';

const bundle = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'starters', 'snackshop.json'), 'utf8')) as RepoBundle;
const feature = (title: string) => bundle.features.find((item) => item.title === title)!;
const line = (title: string) => hopsOf(feature(title)).map((hop) => `${hop.kind}: ${hop.label}`);

describe('flow lines', () => {
  it('follows Place order from the form to the data and the next page', () => {
    expect(line('Place order')).toEqual(['start: Send a form', 'check: Checks the data', 'server: Server', 'data: Reads session', 'data: Saves order', 'unknown: An unknown part', 'end: Goes to /orders/${…}']);
    expect(whereText(feature('Place order'))).toBe('Form on /checkout');
  });

  it('shows an unknown part instead of stopping short', () => {
    expect(line('Export orders')).toEqual(['start: Click', 'unknown: An unknown part']);
  });

  it('ends a typing flow on the screen, with no server', () => {
    expect(line('Type in “Coupon code”')).toEqual(['start: Type', 'end: Updates the screen']);
  });

  it('keeps the app parts from the plan, and falls back to one part for old bundles', () => {
    expect(areasOf(bundle).map((area) => area.title)).toEqual(['Orders', 'Home page', 'Checkout']);
    const old = { ...bundle, plan: { ...bundle.plan, areas: undefined } } as unknown as RepoBundle;
    expect(areasOf(old)).toEqual([expect.objectContaining({ title: 'Your app', lessonIds: bundle.plan.path })]);
  });

  it('groups areas into bigger parts, and names a part’s own page “home”', () => {
    const area = (title: string, section: string) => ({ title, section, summary: '', lessonIds: [title], featureIds: [] });
    const big = { ...bundle, plan: { ...bundle.plan, areas: [area('Signing in', 'Signing in'), area('Branch management', 'Admin'), area('Admin', 'Admin'), area('Transfer', 'Bank customer')] } } as RepoBundle;
    expect(partsOf(big).map((part) => [part.title, part.areas.map((item) => item.title), part.lessonIds])).toEqual([
      ['Signing in', ['Signing in'], ['Signing in']],
      ['Admin', ['Branch management', 'Admin home'], ['Branch management', 'Admin']],
      ['Bank customer', ['Transfer'], ['Transfer']],
    ]);
    // Small apps keep one level: each area is its own part.
    expect(partsOf(bundle).map((part) => part.areas.length)).toEqual([1, 1, 1]);
  });

  it('counts the checks and names the app’s own helpers on the way to an API', () => {
    const base = feature('Apply coupon');
    const step = (stage: string, depth: number, title: string) => ({ ...base.steps[0]!, id: title, stage, depth, title }) as (typeof base.steps)[number];
    const save = {
      ...base,
      entryKind: 'event-handler' as const,
      steps: [step('click', 0, 'You click the button'), step('client', 1, 'Runs handleSave'), step('check', 2, 'Checks !name'), step('client', 2, 'Runs validateOfficerForm'), step('check', 3, 'Checks !email'), step('client', 2, 'Runs setSaving'), step('client', 2, 'Runs me'), step('client', 2, 'Runs updateOfficer'), step('check', 3, 'Tries the next steps, ready for errors')],
      effects: [{ kind: 'api-call' as const, label: 'API PUT bank officers', stepId: 'x', confidence: 'conventional' as const }, { kind: 'local-state' as const, label: 'updates saving', stepId: 'y', confidence: 'conventional' as const }],
    };
    expect(hopsOf(save).map((hop) => `${hop.kind}: ${hop.label}`)).toEqual(['start: Click', 'check: Makes 2 checks', 'logic: Validate officer form', 'logic: Update officer', 'service: API: PUT bank officers', 'end: Updates the screen']);
    // Each stop keeps the traced steps behind it, with file and line, for its hover card.
    const checks = hopsOf(save).find((hop) => hop.kind === 'check')!;
    expect(checks.details.map((detail) => [detail.label, detail.code])).toEqual([
      ['!name', true],
      ['!email', true],
    ]);
    expect(checks.details[0]!.where).toBe(`${base.steps[0]!.code.path}:${base.steps[0]!.code.highlightLine}`);
  });

  it('shows the evidence for every stop of a real flow', () => {
    for (const hop of hopsOf(feature('Place order'))) {
      expect(hop.about.length).toBeGreaterThan(10);
      if (hop.kind !== 'start') expect(hop.details.length, hop.label).toBeGreaterThan(0);
      for (const detail of hop.details) expect(detail.where).toMatch(/:\d+$/);
    }
  });

  it('tells main tasks from small details, and merges the same button drawn twice', () => {
    expect(isMain(feature('Place order'))).toBe(true);
    expect(isMain(feature('Type in “Coupon code”'))).toBe(false);
    expect(pageText(feature('Place order'))).toBe('On the Checkout page');
    const twice = [feature('Apply coupon'), { ...feature('Apply coupon'), id: 'copy' }, feature('Place order')];
    expect(uniqueFlows(twice).map(({ feature: item, count }) => [item.title, count])).toEqual([['Apply coupon', 2], ['Place order', 1]]);
  });
});
