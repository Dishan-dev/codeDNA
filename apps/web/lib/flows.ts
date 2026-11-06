import type { Effect, EntryKind, Feature, LearningArea, RepoBundle, Step } from '@codedna/shared';
import type { IconName } from '@codedna/learn-ui';

/** The app's parts, in path order. Bundles saved before parts existed get one part for everything. */
export function areasOf(bundle: RepoBundle): LearningArea[] {
  if (bundle.plan.areas?.length) return bundle.plan.areas;
  return [{ title: 'Your app', summary: 'Everything people can do in this app.', lessonIds: bundle.plan.path, featureIds: bundle.features.map((feature) => feature.id) }];
}

/** One big part of the app ("Admin"), made of areas ("Branch management", "Audit logs"). */
export interface AppPart {
  title: string;
  areas: LearningArea[];
  lessonIds: string[];
  featureIds: string[];
}

/**
 * The app's big parts, in path order. An area with no bigger part is a part of its own, so small
 * apps keep one level and big apps get two.
 */
export function partsOf(bundle: RepoBundle): AppPart[] {
  const parts: AppPart[] = [];
  for (const area of areasOf(bundle)) {
    const title = area.section ?? area.title;
    let part = parts.find((item) => item.title === title);
    if (!part) parts.push((part = { title, areas: [], lessonIds: [], featureIds: [] }));
    part.areas.push(area);
    part.lessonIds.push(...area.lessonIds);
    part.featureIds.push(...area.featureIds);
  }
  // The /admin page inside a bigger Admin part reads better as "Admin home" than as "Admin" again.
  for (const part of parts) if (part.areas.length > 1) part.areas = part.areas.map((area) => (area.title === part.title ? { ...area, title: `${area.title} home` } : area));
  return parts;
}

/** Something a person sets out to do. Bundles from before this was known count everything. */
export const isMain = (feature: Feature) => feature.importance !== 'detail' && feature.entryKind !== 'link';

/** Icons for the general parts; every other part is a set of screens. */
export function partIcon(title: string): IconName {
  if (title === 'Signing in') return 'lock';
  if (title === 'Behind the scenes') return 'server';
  return 'screen';
}

const PART_HUES = ['teal', 'violet', 'sky', 'rose', 'emerald'] as const;

/**
 * A part's colour, as a CSS value for `--part` (RGB channels). Sign-in is amber and the general
 * parts are calm; the app's own parts take turns through a small palette, in path order.
 */
export function partHue(parts: readonly { title: string }[], title: string): string {
  if (title === 'Signing in') return 'var(--hue-amber)';
  if (title === 'Behind the scenes' || title === 'Home page' || title === 'Other') return 'var(--hue-slate)';
  const own = parts.filter((part) => !['Signing in', 'Behind the scenes', 'Home page', 'Other'].includes(part.title));
  return `var(--hue-${PART_HUES[Math.max(0, own.findIndex((part) => part.title === title)) % PART_HUES.length]})`;
}

/** What a part holds, in words: "4 areas · 9 main tasks · 40 small details". */
export function partCounts(part: AppPart, features: ReadonlyMap<string, Feature>): { areas: number; main: number; details: number; pages: number } {
  const all = part.featureIds.map((id) => features.get(id)).filter((feature): feature is Feature => !!feature && feature.entryKind !== 'link');
  const pages = new Set(all.map((feature) => feature.pageTitle ?? feature.page).filter(Boolean));
  const main = all.filter(isMain).length;
  return { areas: part.areas.length, main, details: all.length - main, pages: pages.size };
}

/**
 * The same button drawn twice (a desktop and a mobile menu) is one thing to a person: keep the
 * first of each name on each page, with how many places it is in.
 */
export function uniqueFlows(features: readonly Feature[]): { feature: Feature; count: number }[] {
  const seen = new Map<string, { feature: Feature; count: number }>();
  for (const feature of features) {
    const key = `${feature.title}|${feature.pageTitle ?? feature.page ?? ''}`;
    const found = seen.get(key);
    if (found) found.count++;
    else seen.set(key, { feature, count: 1 });
  }
  return [...seen.values()];
}

/** "On the Add bank officer page", falling back to the route for bundles without page names. */
export function pageText(feature: Feature): string | undefined {
  if (feature.entryKind === 'route-handler') return undefined;
  if (feature.pageTitle) return feature.pageTitle === 'Home page' ? 'On the home page' : `On the ${feature.pageTitle} page`;
  return feature.page ? `On ${feature.page}` : undefined;
}

/** How a flow starts, in a few words. */
export const ENTRY: Record<EntryKind, { label: string; icon: IconName }> = {
  'event-handler': { label: 'Button or input', icon: 'click' },
  'form-action': { label: 'Form', icon: 'form' },
  link: { label: 'Link', icon: 'next' },
  'route-handler': { label: 'API route', icon: 'request' },
  'server-action': { label: 'Server function', icon: 'server' },
};

/** "Form on /checkout", "API route /api/seed", "Button or input". */
export function whereText(feature: Feature): string {
  const entry = ENTRY[feature.entryKind].label;
  if (feature.entryKind === 'route-handler') return entry;
  return feature.page ? `${entry} on ${feature.page}` : entry;
}

export type HopKind = 'start' | 'check' | 'logic' | 'server' | 'data' | 'service' | 'unknown' | 'end';
/** One piece of evidence behind a stop: a traced step, with where it is in the code. */
export interface HopDetail {
  /** What the code does here, e.g. "Checks !formData.firstName.trim()". */
  label: string;
  /** The plain-words caption CodeDNA wrote for it. */
  note?: string;
  /** "app/checkout/actions.ts:14" */
  where: string;
  /** True when the label is code (a condition), so it is shown in a code font. */
  code?: boolean;
}

export interface Hop {
  kind: HopKind;
  label: string;
  icon: IconName;
  /** What this kind of stop means, in one sentence. */
  about: string;
  /** The traced steps behind it. Empty only when the stop is implied by how the flow starts. */
  details: HopDetail[];
}

/** How sure the evidence is: every stop is read from the code; none of it was run. */
export const HOP_SOURCE: Record<HopKind, string> = {
  start: 'Read from the code: the handler that this click or form runs.',
  check: 'Read from the code, not run: these are the conditions on the way. CodeDNA doesn’t test that they work.',
  logic: 'Read from the code: a function in your app that this flow calls.',
  server: 'Read from the code: the part that runs on the server.',
  data: 'Read from the code: the database call it makes.',
  service: 'Read from the code: a request to a service outside this app. The other side isn’t followed.',
  unknown: 'Only known while the app runs, so CodeDNA can’t follow it by reading.',
  end: 'Read from the code: the last thing it changes on screen.',
};

const unique = <T,>(items: T[], key: (item: T) => string) => items.filter((item, index) => items.findIndex((other) => key(other) === key(item)) === index);
const isInternal = (label: string) => /^(?:[A-Z]+ )?\//.test(label);
/** Helpers that only shuffle values around; the rest say what the flow does ("validateOfficerForm"). */
const PLUMBING = /^(?:set|handle|on|to|is|has|get|format|parse|normalize|map|use)(?=[A-Z]|$)/;
/** "validateOfficerEditForm" → "Validate officer edit form". */
const readable = (name: string) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The line a flow takes through the app, from what starts it to where it ends: browser, a check,
 * the server, the data it reads or saves, other services, and what the person sees at the end.
 * Built only from the steps and effects CodeDNA traced.
 */
export function hopsOf(feature: Feature): Hop[] {
  const typing = /^Type in /.test(feature.title);
  const where = (step: Step) => `${step.code.path}:${step.code.highlightLine}`;
  const detail = (step: Step, code = false): HopDetail => ({ label: step.title, note: step.plain, where: where(step), ...(code ? { code: true } : {}) });
  const stepOf = (stepId: string) => feature.steps.find((step) => step.id === stepId);
  const fromEffects = (effects: readonly Effect[]) => effects.flatMap((effect) => stepOf(effect.stepId) ?? []).map((step) => detail(step));
  const hops: Hop[] = [
    {
      kind: 'start',
      icon: ENTRY[feature.entryKind].icon,
      label: feature.entryKind === 'route-handler' ? 'A request arrives' : feature.entryKind === 'server-action' ? 'Something calls it' : feature.entryKind === 'link' ? 'Click a link' : feature.entryKind === 'form-action' ? 'Send a form' : typing ? 'Type' : 'Click',
      about: 'What the person does to start this flow.',
      details: feature.steps.filter((step) => step.depth <= 1).slice(0, 2).map((step) => detail(step)),
    },
  ];

  // Checks: a validation library says "checks the data"; otherwise every decision made on the way.
  const checkSteps = feature.steps.filter((step) => step.stage === 'check' && step.depth <= 3 && !/^Tries /.test(step.title) && !/sign/i.test(step.title));
  const validation = feature.effects.filter((effect) => effect.kind === 'validation');
  if (validation.length) hops.push({ kind: 'check', icon: 'check', label: 'Checks the data', about: 'It checks the data has the right shape before using it.', details: fromEffects(validation) });
  else if (checkSteps.length)
    hops.push({
      kind: 'check',
      icon: 'check',
      label: checkSteps.length === 1 ? 'Makes 1 check' : `Makes ${checkSteps.length} checks`,
      about: 'Decisions the code makes on the way: if one fails, the flow usually stops early or shows an error.',
      details: checkSteps.map((step) => ({ label: step.title.replace(/^Checks /, ''), note: step.plain, where: where(step), code: true })),
    });

  // The app's own helpers that do the work, in plain words (at most two, in the order they run).
  const helperSteps = unique(
    feature.steps.filter((step) => {
      if (step.depth !== 2 || (step.stage !== 'client' && step.stage !== 'server')) return false;
      const name = /^Runs ([A-Za-z_$][\w$]*)$/.exec(step.title)?.[1];
      // A name of two letters ("me") says nothing to a newcomer.
      return !!name && name.length > 3 && !PLUMBING.test(name);
    }),
    (step) => step.title,
  ).slice(0, 2);
  for (const step of helperSteps) {
    const name = step.title.slice('Runs '.length);
    const inside = feature.steps.filter((other) => other.parentId === step.id).slice(0, 6);
    hops.push({ kind: 'logic', icon: 'logic', label: readable(name), about: `A function in this app: ${name}().`, details: [detail(step), ...inside.map((other) => detail(other, other.stage === 'check'))] });
  }

  const server = feature.entryKind === 'route-handler' || feature.entryKind === 'server-action' || feature.steps.some((step) => step.stage === 'request' || step.stage === 'server');
  if (server && feature.entryKind !== 'route-handler' && feature.entryKind !== 'server-action') {
    const serverSteps = feature.steps.filter((step) => step.stage === 'request' || step.stage === 'server').slice(0, 4);
    hops.push({ kind: 'server', icon: 'server', label: 'Server', about: 'This part runs on the server, not in the browser.', details: serverSteps.map((step) => detail(step)) });
  }
  const dataEffects = feature.effects.filter((effect) => effect.kind === 'db-read' || effect.kind === 'db-write');
  for (const effect of unique(dataEffects, (item) => item.label))
    hops.push({
      kind: 'data',
      icon: 'database',
      label: effect.label.replace(/^writes /, 'Saves ').replace(/^reads /, 'Reads '),
      about: effect.kind === 'db-write' ? 'It saves or changes data in the database.' : 'It reads data from the database.',
      details: fromEffects(dataEffects.filter((item) => item.label === effect.label)),
    });
  for (const effect of feature.effects) {
    const details = fromEffects([effect]);
    if (effect.kind === 'email') hops.push({ kind: 'service', icon: 'external', label: 'Sends an email', about: 'It sends an email through an email service.', details });
    else if (effect.kind === 'payment') hops.push({ kind: 'service', icon: 'external', label: 'Takes a payment', about: 'It talks to a payment service.', details });
    else if (effect.kind === 'api-call' && !isInternal(effect.label)) hops.push({ kind: 'service', icon: 'external', label: effect.label.replace(/^API (\w+) (.+)$/, 'API: $1 $2'), about: 'It sends a request to a back-end API and waits for the answer.', details });
  }
  const signIn = feature.steps.filter((step) => step.stage === 'external' && /sign/i.test(step.title));
  if (signIn.length) hops.push({ kind: 'service', icon: 'external', label: 'Sign-in service', about: 'It hands over to a sign-in provider to check who you are.', details: signIn.map((step) => detail(step)) });

  // Where CodeDNA couldn't follow the code, the line says so instead of stopping short.
  const gaps = feature.steps.filter((step) => step.confidence === 'gap');
  if (gaps.length)
    hops.push({
      kind: 'unknown',
      icon: 'unknown',
      label: gaps.length === 1 ? 'An unknown part' : `${gaps.length} unknown parts`,
      about: 'Parts that are decided while the app runs, so reading the code can’t tell where they go.',
      details: gaps.map((step) => ({ label: step.title, note: step.unknownReason ?? step.plain, where: where(step) })),
    });

  // Where it ends, as the person sees it.
  const last = [...feature.effects].reverse().find((effect) => ['redirect', 'navigation', 'local-state', 'revalidate'].includes(effect.kind));
  const screen = feature.effects.filter((effect) => effect.kind === 'local-state');
  if (last?.kind === 'redirect') hops.push({ kind: 'end', icon: 'screen', label: last.label.replace(/^redirects to /, 'Goes to '), about: 'It sends the person to another page.', details: fromEffects([last]) });
  else if (last?.kind === 'navigation') hops.push({ kind: 'end', icon: 'screen', label: last.label.replace(/^(?:opens|navigates to) /, 'Opens '), about: 'It moves the person to another page.', details: fromEffects([last]) });
  else if (last?.kind === 'local-state') hops.push({ kind: 'end', icon: 'screen', label: 'Updates the screen', about: 'It changes values the page shows, so React redraws those parts.', details: fromEffects(unique(screen, (item) => item.label)) });
  else if (last?.kind === 'revalidate') hops.push({ kind: 'end', icon: 'screen', label: 'Shows the new data', about: 'It tells Next.js the data changed, so the page loads it fresh.', details: fromEffects([last]) });
  else {
    const answers = feature.steps.filter((step) => step.stage === 'response');
    if (answers.length) hops.push({ kind: 'end', icon: 'response', label: 'Sends back an answer', about: 'It ends by answering whoever asked.', details: answers.slice(0, 3).map((step) => detail(step)) });
  }
  return unique(hops, (hop) => `${hop.kind}|${hop.label}`);
}
