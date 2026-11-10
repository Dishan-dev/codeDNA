import type { Feature, Step } from './analysis.js';
import type { QaCaseKind, QaStepKind } from './qa.js';

/**
 * The QA plan for one feature, worked out from the traced code alone (pure and deterministic, so
 * the CLI that runs it and the page that shows it always agree). It says how a person starts the
 * flow, which cases to try, and what the code says should happen in each.
 */
export interface QaTrigger {
  verb: 'click' | 'press' | 'type';
  /** The label as traced; may end in "…" when it was shortened. */
  label: string;
  role: 'button' | 'link' | 'textbox';
}

export interface QaCasePlan {
  kind: QaCaseKind;
  title: string;
  /** What should happen, from the code, in plain words. */
  expected: string;
  /** True when the case sends data or clicks, so it only runs with the learner's say-so. */
  acts: boolean;
}

export interface QaExpectations {
  /** A request the flow should send, from a traced API call, e.g. POST /api/coupons. */
  request?: { method?: string; path?: string };
  /** The flow sends data to the server (server action, API call, database write). */
  sendsData: boolean;
  /** Pages the flow may end on: redirects and navigations in the code. `*` stands for a value. */
  destinations: string[];
  /** Checks the code makes on the data, e.g. "if (!parsed.success)". */
  checks: string[];
}

export interface QaPlan {
  featureId: string;
  /** Why this flow can't be tested in a browser by itself; absent when it can. */
  unavailable?: string;
  page?: string;
  trigger?: QaTrigger;
  /** form: has fields to fill; click: a button; link: goes somewhere. */
  shape: 'form' | 'click' | 'link' | 'type' | 'none';
  expectations: QaExpectations;
  cases: QaCasePlan[];
}

/** What the person uses to start a feature, read from its first step ("You press “Save”"). */
export function qaTriggerOf(feature: Pick<Feature, 'steps' | 'entryKind'>): QaTrigger | undefined {
  const first = feature.steps[0]?.title ?? '';
  const match = /^You (click|press|double-click|type in) “(.+)”$/.exec(first);
  if (!match) return undefined;
  const verb = match[1] === 'press' ? 'press' : match[1] === 'type in' ? 'type' : 'click';
  return { verb, label: match[2]!, role: verb === 'type' ? 'textbox' : feature.entryKind === 'link' ? 'link' : 'button' };
}

/** Actions a run never takes: they can't be undone or end the session. */
const DESTRUCTIVE = /\b(?:delete|remove|erase|destroy|pay|purchase|checkout|transfer|withdraw|send money|log ?out|sign ?out|deactivate|suspend|cancel|approve|reject|reset)\b/i;
/** A link only opens a page, so it is never destructive, even one called "Go to checkout". */
export const isDestructiveFlow = (feature: Pick<Feature, 'title'> & Partial<Pick<Feature, 'entryKind'>>, trigger?: QaTrigger) => feature.entryKind !== 'link' && DESTRUCTIVE.test(`${feature.title} ${trigger?.label ?? ''}`);

/** "/orders/${…}" → "/orders/*": a destination with a value the code fills in. */
const pattern = (target: string) => target.replace(/\$\{[^}]*\}|\[[^\]]+\]/g, '*').replace(/\s.*$/, '');

export function expectationsOf(feature: Feature): QaExpectations {
  const api = feature.effects.find((effect) => effect.kind === 'api-call');
  const apiMatch = api ? /^(?:API\s+)?(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i.exec(api.label) : null;
  const sendsData = feature.entryKind === 'form-action' || feature.effects.some((effect) => effect.kind === 'db-write' || effect.kind === 'email' || effect.kind === 'payment' || (effect.kind === 'api-call' && !/^(?:API\s+)?GET\b/i.test(effect.label))) || feature.steps.some((step) => step.stage === 'request');
  const destinations = feature.effects.filter((effect) => effect.kind === 'redirect' || effect.kind === 'navigation').map((effect) => pattern(effect.label.replace(/^(?:redirects to|opens|goes to)\s+/i, '')));
  const checks = feature.branches.map((branch) => branch.condition.replace(/^if\s*\(|\)\s*$/g, '').trim()).filter((condition) => condition.length <= 80);
  return {
    ...(apiMatch ? { request: { method: apiMatch[1]!.toUpperCase(), ...(apiMatch[2]!.startsWith('/') ? { path: pattern(apiMatch[2]!) } : {}) } } : {}),
    sendsData,
    destinations: [...new Set(destinations)],
    checks,
  };
}

/** Conditions that check the data: a schema, a required field, a length, a missing value. */
const VALIDATES = /safeParse|\bparse\b|\.success\b|validat|required|isValid|\.length|\.test\(|^!|\berrors?\b/;
/** Checks about who is signed in, not about the form's data. */
const SIGN_IN = /token|session|user|auth|logged|signed/i;

/** The plan for one feature: start page, trigger, cases and what each should do. */
export function qaPlanFor(feature: Feature): QaPlan {
  const trigger = qaTriggerOf(feature);
  const expectations = expectationsOf(feature);
  const base = { featureId: feature.id, expectations, ...(trigger ? { trigger } : {}), ...(feature.page ? { page: feature.page } : {}) };
  const none = (unavailable: string): QaPlan => ({ ...base, unavailable, shape: 'none', cases: [] });
  if (feature.entryKind === 'route-handler' || feature.entryKind === 'server-action') return none('It runs on the server with no button of its own; it is tested through the flows that call it.');
  if (!feature.page) return none('CodeDNA doesn’t know which page it is on.');
  if (/[[(]/.test(feature.page)) return none(`Its page (${feature.page}) needs a value, like an id, that a test can’t pick by itself yet.`);
  if (!trigger) return none('CodeDNA couldn’t tell which button or link starts it.');
  if (trigger.verb === 'type') return { ...base, shape: 'type', cases: [{ kind: 'reach', title: 'The field is there', expected: `The “${trigger.label}” field is on ${feature.page}.`, acts: false }] };

  const reach: QaCasePlan = { kind: 'reach', title: 'It can be reached', expected: `“${trigger.label}” is on ${feature.page}.`, acts: false };
  if (feature.entryKind === 'link') {
    const to = expectations.destinations[0];
    // Following a link only opens a page, so even a look-only run tries it.
    return { ...base, shape: 'link', cases: [reach, { kind: 'happy-path', title: 'The link works', expected: to ? `It opens ${to} without errors.` : 'It opens a page without errors.', acts: false }] };
  }
  const outcome = expectations.request
    ? `It sends ${expectations.request.method ?? 'a request'}${expectations.request.path ? ` to ${expectations.request.path}` : ''} and the server answers without an error`
    : expectations.sendsData
      ? 'It sends the data to the server and the server answers without an error'
      : 'It runs without errors';
  const lands = expectations.destinations.length ? `, then shows ${expectations.destinations.join(' or ')}` : '';
  if (trigger.verb !== 'press') return { ...base, shape: 'click', cases: [reach, { kind: 'happy-path', title: 'Clicking it works', expected: `${outcome}${lands}.`, acts: true }] };

  // Prefer checks on the data itself; a bare "!value" counts only when it isn't about sign-in.
  const strong = expectations.checks.filter((check) => VALIDATES.test(check) && !/^!/.test(check));
  const checked = strong.length ? strong : expectations.checks.filter((check) => /^!/.test(check) && !SIGN_IN.test(check));
  const because = checked.length ? ` The code checks ${checked.slice(0, 2).map((check) => `“${check}”`).join(' and ')}.` : '';
  return {
    ...base,
    shape: 'form',
    cases: [
      reach,
      { kind: 'happy-path', title: 'Filled in properly', expected: `${outcome}${lands}.`, acts: true },
      { kind: 'empty', title: 'Sent empty', expected: `It should stop and say what’s missing, not send empty data.${because}`, acts: true },
      { kind: 'wrong-format', title: 'Wrong formats', expected: 'Fields like email or number should refuse a wrong format and say why.', acts: true },
      { kind: 'too-long', title: 'Very long text', expected: 'Very long text should be refused or handled — never crash the page or the server.', acts: true },
      { kind: 'emoji-unicode', title: 'Emoji and other alphabets', expected: 'Emoji and non-English letters should be handled without errors.', acts: true },
      { kind: 'double-submit', title: 'Pressed twice', expected: 'Pressing twice quickly should send once.', acts: true },
    ],
  };
}

/** The traced step a browser step matches: where to look in the code when that step fails. */
export function featureStepFor(feature: Pick<Feature, 'steps'>, kind: QaStepKind): Step | undefined {
  const find = (...stages: Step['stage'][]) => feature.steps.find((step) => stages.includes(step.stage));
  switch (kind) {
    case 'find':
    case 'press':
    case 'fill':
      return feature.steps[0];
    case 'request':
      return find('request', 'external');
    case 'server':
      return find('server', 'database', 'external');
    case 'result':
      return [...feature.steps].reverse().find((step) => step.stage === 'screen' || step.stage === 'response');
    default:
      return undefined;
  }
}
