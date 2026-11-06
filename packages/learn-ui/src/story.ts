import type { Branch, BranchOutcome, Feature, Step } from '@codedna/shared';

/** Which answer the learner picked at each branch: branch id → outcome id. */
export type Choices = Record<string, string>;

/**
 * The answer most runs take at each branch: the one that leads to more steps. This is the path
 * the story plays when the learner hasn't chosen.
 */
export function defaultChoices(feature: Feature): Choices {
  const reached = new Map<string, number>();
  for (const step of feature.steps) for (const item of step.when ?? []) reached.set(item.outcomeId, (reached.get(item.outcomeId) ?? 0) + 1);
  const choices: Choices = {};
  for (const branch of feature.branches) {
    const [first, second] = branch.outcomes;
    if (!first || !second) continue;
    choices[branch.id] = (reached.get(first.id) ?? 0) > (reached.get(second.id) ?? 0) ? first.id : second.id;
  }
  return choices;
}

/** The steps shown for the learner's choices, in order. */
export function visibleSteps(feature: Feature, choices: Choices): Step[] {
  const defaults = defaultChoices(feature);
  return feature.steps.filter((step) => (step.when ?? []).every((item) => (choices[item.branchId] ?? defaults[item.branchId]) === item.outcomeId));
}

export function branchAt(feature: Feature, stepId: string): Branch | undefined {
  return feature.branches.find((branch) => branch.stepId === stepId);
}

/** Each answer of a branch with the step it leads to, for "which way?" buttons. */
export function outcomesOf(feature: Feature, branch: Branch): { outcome: BranchOutcome; next?: Step }[] {
  return branch.outcomes.map((outcome) => {
    const next = feature.steps.find((step) => step.id === outcome.nextStepId);
    return next ? { outcome, next } : { outcome };
  });
}

/** "if (!session)" → "!session". */
export const conditionText = (branch: Branch) => branch.condition.replace(/^if \((.*)\)$/, '$1');

/** The places a feature's journey moves between, left to right on the journey map. */
export type Zone = 'browser' | 'server' | 'database' | 'service';
export const ZONE_ORDER: readonly Zone[] = ['browser', 'server', 'database', 'service'];

/** Where one step happens: in a zone, or on the way between two. */
export type Place = { zone: Zone } | { from: Zone; to: Zone };

/**
 * Where each step happens. Requests and answers travel between browser and server; checks and
 * logic happen wherever the story currently is (a check can run in the browser or on the server).
 */
export function placesOf(steps: readonly Step[]): Place[] {
  let side: Zone = 'browser';
  return steps.map((step): Place => {
    switch (step.stage) {
      case 'click':
      case 'form':
      case 'client':
      case 'screen':
        side = 'browser';
        return { zone: 'browser' };
      case 'request':
        side = 'server';
        return { from: 'browser', to: 'server' };
      case 'response':
        side = 'browser';
        return { from: 'server', to: 'browser' };
      case 'server':
        side = 'server';
        return { zone: 'server' };
      case 'database':
        return { zone: 'database' };
      case 'external':
        return { zone: 'service' };
      default:
        return { zone: side };
    }
  });
}

/** The zones a journey visits, in map order. The browser is always shown. */
export function zonesOf(places: readonly Place[]): Zone[] {
  const used = new Set<Zone>(['browser']);
  for (const place of places) for (const zone of 'zone' in place ? [place.zone] : [place.from, place.to]) used.add(zone);
  return ZONE_ORDER.filter((zone) => used.has(zone));
}

/** "On the server", "On the way to the server" — the place in words. */
export function placeText(place: Place): string {
  if ('zone' in place) return { browser: 'In the browser', server: 'On the server', database: 'In the database', service: 'At another service' }[place.zone];
  return place.to === 'server' ? 'On the way to the server' : 'On the way back to the browser';
}
