import type { Feature } from './analysis.js';
import { expectationsOf, featureStepFor, isDestructiveFlow, qaTriggerOf } from './qa-plan.js';
import type { QaStepKind } from './qa.js';

/**
 * User journeys: the features of an app joined in the order a person uses them, e.g.
 * Home → “Bank officers” → “Add officer” → POST /api/officers → back on the list.
 *
 * They are worked out from the traced code alone: links and redirects connect pages, and each
 * main task becomes the end of a journey that starts where a person starts. Pure and
 * deterministic, so the CLI that runs a journey and the page that draws it always agree.
 * The developer can rename, reorder, remove and add steps; those edits are kept in
 * `codedna.journeys.json` at the project's root (plain JSON, read but never run).
 */
export const JOURNEYS_FILE = 'codedna.journeys.json';
export const JOURNEYS_VERSION = 1 as const;

export type JourneyStep =
  /** Open a page by its address. */
  | { kind: 'open'; page: string }
  /** Use a traced feature: follow a link, press a button, send a form. By the feature's stable key. */
  | { kind: 'feature'; featureKey: string };

export interface Journey {
  /** Stable across commits: from the last feature's key, or `custom-…` for one the developer made. */
  id: string;
  title: string;
  section?: string;
  area?: string;
  steps: JourneyStep[];
  /** Changed or made by the developer. */
  edited?: boolean;
  hidden?: boolean;
}

/** One point on the journey map: what the browser does, in order. */
export interface JourneyNode {
  /** `<step index>.<kind>`, e.g. `2.request`; extra sign-in points add `<step>.signin-<kind>`. */
  id: string;
  step: number;
  kind: QaStepKind;
  label: string;
  featureId?: string;
  /** The traced step in the code, so a broken point links to its line. */
  featureStepId?: string;
}

/** A station on the map: one journey step and its points. */
export interface JourneyStation {
  step: number;
  title: string;
  /** The page it happens on, when known. */
  page?: string;
  featureId?: string;
  nodes: JourneyNode[];
  /** Why this step can't be run (the feature is gone from the code, for example). */
  problem?: string;
}

const MAX_JOURNEYS = 80;
const MAX_LINKS = 5;

/** "/orders/[id]", "/orders/${…}" and "/orders/*" are the same page shape. */
export const pageShape = (page: string) => page.replace(/\$\{[^}]*\}|\[[^\]]+\]/g, '*').replace(/\s.*$/, '').replace(/(.)\/+$/, '$1');
export const samePage = (a: string, b: string) => {
  const left = pageShape(a).split('/');
  const right = pageShape(b).split('/');
  return left.length === right.length && left.every((part, index) => part === right[index] || part === '*' || right[index] === '*');
};

const SIGN_IN_PAGE = /\/(?:log-?in|sign-?in|auth(?:\/[a-z-]+)?)$/i;
const SIGN_IN_TASK = /\b(?:log|sign) ?in\b/i;

/** The feature that signs a person in: a form whose name says so. */
export function isSignInFeature(feature: Pick<Feature, 'title' | 'entryKind' | 'steps'>): boolean {
  const trigger = qaTriggerOf(feature);
  return feature.entryKind !== 'link' && trigger?.verb === 'press' && SIGN_IN_TASK.test(`${feature.title} ${trigger.label}`);
}

/** Pages the code sends people to: links, router pushes and redirects, without the sign-in redirect. */
export function destinationsOf(feature: Feature): string[] {
  return expectationsOf(feature).destinations.filter((page) => !SIGN_IN_PAGE.test(page));
}

/** The sign-in page, when the code has one: a sign-in form's page, or where it redirects to sign in. */
export function signInPageOf(features: readonly Feature[]): string | undefined {
  const form = features.find((feature) => isSignInFeature(feature) && feature.page);
  if (form?.page) return form.page;
  for (const feature of features) for (const page of expectationsOf(feature).destinations) if (SIGN_IN_PAGE.test(page)) return page;
  return undefined;
}

/** Can the browser start this feature by itself (a button, a link, a form on a known page)? */
const runnable = (feature: Feature) => !!feature.page && feature.entryKind !== 'route-handler' && feature.entryKind !== 'server-action' && qaTriggerOf(feature)?.verb !== undefined && qaTriggerOf(feature)?.verb !== 'type';

function hashKey(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/** The shortest chain of links from `from` to `to`, by following the app's own links. */
function linkPath(links: readonly Feature[], from: string, to: string): Feature[] | undefined {
  if (samePage(from, to)) return [];
  const queue: { page: string; path: Feature[] }[] = [{ page: from, path: [] }];
  const seen = new Set([pageShape(from)]);
  while (queue.length) {
    const { page, path } = queue.shift()!;
    if (path.length >= MAX_LINKS) continue;
    for (const link of links) {
      if (!samePage(link.page!, page)) continue;
      for (const next of destinationsOf(link)) {
        if (seen.has(pageShape(next))) continue;
        const route = [...path, link];
        if (samePage(next, to)) return route;
        seen.add(pageShape(next));
        queue.push({ page: next, path: route });
      }
    }
  }
  return undefined;
}

/**
 * The journeys CodeDNA works out from the code: one per main task, starting where a person
 * starts (the home page, or the task's own page when no link leads there) and following the
 * app's links to the task's page. Sign-in comes first when the journey needs it (the runner signs
 * in whenever a page sends it to the sign-in page).
 */
export function buildJourneys(features: readonly Feature[]): Journey[] {
  const links = features.filter((feature) => feature.entryKind === 'link' && runnable(feature) && destinationsOf(feature).length);
  const pages = [...new Set(features.map((feature) => feature.page).filter((page): page is string => !!page))];
  const start = pages.includes('/') ? '/' : pages.sort((a, b) => a.length - b.length)[0];
  const signIn = features.find((feature) => isSignInFeature(feature) && runnable(feature));
  const tasks = features.filter((feature) => runnable(feature) && feature.entryKind !== 'link' && feature.importance !== 'detail');
  // Sign-in first, then the rest in the order the app is laid out.
  tasks.sort((a, b) => Number(b === signIn) - Number(a === signIn));
  const journeys: Journey[] = [];
  for (const task of tasks) {
    const from = start && !(task === signIn) ? start : task.page!;
    const path = start ? linkPath(links, from, task.page!) : undefined;
    const steps: JourneyStep[] = path ? [{ kind: 'open', page: from }, ...path.map((link): JourneyStep => ({ kind: 'feature', featureKey: link.key }))] : [{ kind: 'open', page: task.page! }];
    steps.push({ kind: 'feature', featureKey: task.key });
    journeys.push({ id: `j-${hashKey(task.key)}`, title: task.title, ...(task.section ? { section: task.section } : {}), ...(task.area ? { area: task.area } : {}), steps });
    if (journeys.length >= MAX_JOURNEYS) break;
  }
  return journeys;
}

/** The developer's changes, as kept in `codedna.journeys.json`. */
export interface JourneyEdits {
  version: typeof JOURNEYS_VERSION;
  /** Journeys that replace CodeDNA's (same id) or are new (`custom-…`). */
  journeys: Journey[];
}

/** Check unknown JSON is a journeys file this version can read. */
export function readJourneyEdits(value: unknown): JourneyEdits | { problem: string } {
  if (!value || typeof value !== 'object') return { problem: `${JOURNEYS_FILE} isn’t a journeys file.` };
  const edits = value as Partial<JourneyEdits>;
  if (edits.version !== JOURNEYS_VERSION || !Array.isArray(edits.journeys)) return { problem: `${JOURNEYS_FILE} is from a different CodeDNA version.` };
  if (edits.journeys.length > 300) return { problem: `${JOURNEYS_FILE} has too many journeys.` };
  const journeys: Journey[] = [];
  for (const item of edits.journeys) {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || typeof item.title !== 'string' || !Array.isArray(item.steps) || item.steps.length > 40) return { problem: `${JOURNEYS_FILE} has a damaged journey.` };
    const steps: JourneyStep[] = [];
    for (const step of item.steps as unknown[]) {
      const value = step as Partial<{ kind: string; page: string; featureKey: string }>;
      if (value?.kind === 'open' && typeof value.page === 'string' && value.page.startsWith('/') && value.page.length <= 300) steps.push({ kind: 'open', page: value.page });
      else if (value?.kind === 'feature' && typeof value.featureKey === 'string' && value.featureKey.length <= 600) steps.push({ kind: 'feature', featureKey: value.featureKey });
      else return { problem: `${JOURNEYS_FILE} has a damaged step in “${item.title}”.` };
    }
    journeys.push({ id: item.id, title: item.title.slice(0, 120), ...(typeof item.section === 'string' ? { section: item.section.slice(0, 80) } : {}), ...(typeof item.area === 'string' ? { area: item.area.slice(0, 80) } : {}), steps, edited: true, ...(item.hidden === true ? { hidden: true } : {}) });
  }
  return { version: JOURNEYS_VERSION, journeys };
}

/** CodeDNA's journeys with the developer's changes on top. Hidden ones stay listed, marked hidden. */
export function applyJourneyEdits(journeys: readonly Journey[], edits?: JourneyEdits): Journey[] {
  if (!edits) return [...journeys];
  const changed = new Map(edits.journeys.map((journey) => [journey.id, journey]));
  const merged = journeys.map((journey) => changed.get(journey.id) ?? journey);
  const known = new Set(journeys.map((journey) => journey.id));
  return [...merged, ...edits.journeys.filter((journey) => !known.has(journey.id))];
}

/** The journeys a project uses: from the code, with its edits file applied. */
export const journeysFor = (features: readonly Feature[], edits?: JourneyEdits) => applyJourneyEdits(buildJourneys(features), edits);

/** Only what changed compared with CodeDNA's own journeys, for the edits file. */
export function editsBetween(original: readonly Journey[], current: readonly Journey[]): JourneyEdits {
  const before = new Map(original.map((journey) => [journey.id, JSON.stringify({ ...journey, edited: undefined })]));
  const journeys = current.filter((journey) => before.get(journey.id) !== JSON.stringify({ ...journey, edited: undefined })).map((journey) => ({ ...journey, edited: true }));
  return { version: JOURNEYS_VERSION, journeys };
}

const quote = (text: string) => `“${text}”`;

/**
 * The map of a journey before it runs: each step as a station with the points the browser goes
 * through. The runner reports results by the same node ids, so the map lights up in place.
 */
export function journeyStations(journey: Journey, features: readonly Feature[]): JourneyStation[] {
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  return journey.steps.map((step, index): JourneyStation => {
    if (step.kind === 'open') return { step: index, title: `Open ${step.page}`, page: step.page, nodes: [{ id: `${index}.open`, step: index, kind: 'open', label: `Open ${step.page}` }] };
    const feature = byKey.get(step.featureKey);
    if (!feature) return { step: index, title: 'A feature that’s gone', nodes: [], problem: 'This feature is no longer in the code. Remove the step or pick another.' };
    const trigger = qaTriggerOf(feature);
    const node = (kind: QaStepKind, label: string): JourneyNode => {
      const traced = featureStepFor(feature, kind);
      return { id: `${index}.${kind}`, step: index, kind, label, featureId: feature.id, ...(traced ? { featureStepId: traced.id } : {}) };
    };
    const base = { step: index, title: feature.title, ...(feature.page ? { page: feature.page } : {}), featureId: feature.id };
    if (!trigger || trigger.verb === 'type') return { ...base, nodes: [], problem: 'CodeDNA couldn’t tell which button or link starts it.' };
    const name = quote(trigger.label);
    if (feature.entryKind === 'link') {
      const to = destinationsOf(feature)[0];
      return { ...base, nodes: [node('find', `Find ${name}`), node('press', `Click ${name}`), node('result', to ? `Opens ${to}` : 'Opens the next page')] };
    }
    const expectations = expectationsOf(feature);
    const nodes = [node('find', `Find ${name}`)];
    if (trigger.verb === 'press') nodes.push(node('fill', isSignInFeature(feature) ? 'Fill in the test account' : 'Fill in the form'));
    nodes.push(node('press', `${trigger.verb === 'press' ? 'Press' : 'Click'} ${name}`));
    if (expectations.sendsData || expectations.request) {
      const request = expectations.request;
      nodes.push(node('request', request ? `${request.method ?? 'Send'} ${request.path ?? 'to the server'}` : 'Send to the server'), node('server', 'Server answers'));
    }
    const to = destinationsOf(feature);
    nodes.push(node('result', to.length ? `Shows ${to.join(' or ')}` : 'What happens next'));
    return { ...base, nodes };
  });
}

/** Will this journey change data that can't be put back (delete, pay, transfer, sign out)? */
export function journeyIsDestructive(journey: Journey, features: readonly Feature[]): boolean {
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  return journey.steps.some((step) => {
    if (step.kind !== 'feature') return false;
    const feature = byKey.get(step.featureKey);
    return !!feature && isDestructiveFlow(feature, qaTriggerOf(feature));
  });
}
