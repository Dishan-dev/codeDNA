import { describe, expect, it } from 'vitest';
import type { Feature } from './analysis.js';
import { applyJourneyEdits, buildJourneys, editsBetween, isSignInFeature, journeyIsDestructive, journeyStations, readJourneyEdits, samePage, signInPageOf } from './qa-journey.js';

const feature = (key: string, page: string, first: string, extra: Partial<Feature> = {}): Feature =>
  ({ id: `f-${key}`, key, title: key, page, entryKind: 'event-handler', importance: 'main', steps: [{ id: `${key}-s0`, title: first, stage: 'click' }, { id: `${key}-s1`, title: 'Sends it', stage: 'request' }, { id: `${key}-s2`, title: 'Shows it', stage: 'screen' }], effects: [], branches: [], ...extra }) as unknown as Feature;
const link = (key: string, page: string, label: string, to: string) => feature(key, page, `You click “${label}”`, { entryKind: 'link', importance: 'detail', title: `Open “${label}”`, effects: [{ kind: 'navigation', label: `opens ${to}`, stepId: 'x', confidence: 'conventional' }] });

const features = [
  link('to-admin', '/', 'Admin', '/admin'),
  link('to-officers', '/admin', 'Bank officers', '/admin/officers'),
  feature('add-officer', '/admin/officers', 'You press “Add officer”', { entryKind: 'form-action', title: 'Add officer', area: 'Officers', section: 'Admin', effects: [{ kind: 'api-call', label: 'POST /api/officers', stepId: 'x', confidence: 'resolved' }, { kind: 'redirect', label: 'redirects to /login', stepId: 'x', confidence: 'resolved' }, { kind: 'redirect', label: 'redirects to /admin/officers', stepId: 'x', confidence: 'resolved' }] }),
  feature('sign-in', '/login', 'You press “Sign in”', { entryKind: 'form-action', title: 'Sign in' }),
  feature('delete-officer', '/admin/officers/[id]', 'You click “Delete”', { title: 'Delete officer' }),
  feature('typing', '/', 'You type in “Search”', { importance: 'detail' }),
];

describe('user journeys', () => {
  it('joins features into journeys by following the app’s own links from the home page', () => {
    const journeys = buildJourneys(features);
    expect(journeys.map((journey) => journey.title)).toEqual(['Sign in', 'Add officer', 'Delete officer']);
    const add = journeys.find((journey) => journey.title === 'Add officer')!;
    expect(add.steps).toEqual([{ kind: 'open', page: '/' }, { kind: 'feature', featureKey: 'to-admin' }, { kind: 'feature', featureKey: 'to-officers' }, { kind: 'feature', featureKey: 'add-officer' }]);
    expect(add).toMatchObject({ section: 'Admin', area: 'Officers' });
    // Sign-in starts on its own page; a page with an id and no link to it is opened by address.
    expect(journeys[0]!.steps).toEqual([{ kind: 'open', page: '/login' }, { kind: 'feature', featureKey: 'sign-in' }]);
    expect(journeys[2]!.steps[0]).toEqual({ kind: 'open', page: '/admin/officers/[id]' });
    // Ids come from the feature's key, so edits survive new commits.
    expect(buildJourneys(features).map((journey) => journey.id)).toEqual(journeys.map((journey) => journey.id));
  });

  it('draws each step as points, with the request the code sends and where it should land', () => {
    const add = buildJourneys(features).find((journey) => journey.title === 'Add officer')!;
    const stations = journeyStations(add, features);
    expect(stations.map((station) => station.nodes.map((node) => `${node.id} ${node.label}`))).toEqual([
      ['0.open Open /'],
      ['1.find Find “Admin”', '1.press Click “Admin”', '1.result Opens /admin'],
      ['2.find Find “Bank officers”', '2.press Click “Bank officers”', '2.result Opens /admin/officers'],
      ['3.find Find “Add officer”', '3.fill Fill in the form', '3.press Press “Add officer”', '3.request POST /api/officers', '3.server Server answers', '3.result Shows /admin/officers'],
    ]);
    // Each point links to its traced step in the code.
    expect(stations[3]!.nodes.find((node) => node.kind === 'request')?.featureStepId).toBe('add-officer-s1');
    expect(journeyStations({ id: 'x', title: 'x', steps: [{ kind: 'feature', featureKey: 'gone' }] }, features)[0]!.problem).toMatch(/no longer in the code/);
  });

  it('knows the sign-in form, the sign-in page and destructive steps', () => {
    expect(isSignInFeature(features[3]!)).toBe(true);
    expect(isSignInFeature(features[2]!)).toBe(false);
    expect(signInPageOf(features)).toBe('/login');
    expect(signInPageOf(features.filter((item) => item.key !== 'sign-in'))).toBe('/login');
    const journeys = buildJourneys(features);
    expect(journeyIsDestructive(journeys[2]!, features)).toBe(true);
    expect(journeyIsDestructive(journeys[1]!, features)).toBe(false);
    expect(samePage('/orders/[id]', '/orders/${…}')).toBe(true);
    expect(samePage('/orders/123', '/orders/*')).toBe(true);
    expect(samePage('/orders', '/orders/123')).toBe(false);
  });

  it('keeps only what the developer changed, and reads the file safely', () => {
    const journeys = buildJourneys(features);
    const renamed = journeys.map((journey) => (journey.title === 'Sign in' ? { ...journey, title: 'Log in as staff' } : journey));
    const custom = { id: 'custom-1', title: 'Mine', steps: [{ kind: 'open' as const, page: '/admin' }] };
    const edits = editsBetween(journeys, [...renamed, custom]);
    expect(edits.journeys.map((journey) => journey.title)).toEqual(['Log in as staff', 'Mine']);
    const read = readJourneyEdits(JSON.parse(JSON.stringify(edits)));
    if ('problem' in read) throw new Error(read.problem);
    const applied = applyJourneyEdits(journeys, read);
    expect(applied.map((journey) => journey.title)).toEqual(['Log in as staff', 'Add officer', 'Delete officer', 'Mine']);
    expect(applied[0]!.edited).toBe(true);
    expect(readJourneyEdits({ version: 2, journeys: [] })).toHaveProperty('problem');
    expect(readJourneyEdits({ version: 1, journeys: [{ id: '../x', title: 'x', steps: [] }] })).toHaveProperty('problem');
    expect(readJourneyEdits({ version: 1, journeys: [{ id: 'a', title: 'x', steps: [{ kind: 'open', page: 'https://evil.example' }] }] })).toHaveProperty('problem');
  });
});
