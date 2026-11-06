import type { Feature, RepoBundle } from '@codedna/shared';

/**
 * Quality scan, first version: findings read from the traced code, plus edge cases to try, made
 * from the real conditions on each flow. Nothing is run: it says where to look and what to try,
 * and the person (or, later, a test run on their machine) checks it.
 */

export type Severity = 'high' | 'medium' | 'low';
export type FindingKind = 'missing-auth-check' | 'missing-validation' | 'unhandled-request' | 'unchecked-send' | 'unknown-part' | 'duplicated-logic' | 'hard-to-follow';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  plain: string;
  featureId?: string;
  /** "app/checkout/actions.ts:14" */
  where?: string;
}

export interface QualityReport {
  findings: Finding[];
  /** Edge cases to try, per feature id, from the conditions in its code. */
  edgeCases: Map<string, string[]>;
  scanned: number;
  counts: Record<Severity, number>;
}

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];
export const KIND_LABEL: Record<FindingKind, string> = {
  'missing-auth-check': 'No sign-in check',
  'missing-validation': 'No data check',
  'unhandled-request': 'Errors not handled',
  'unchecked-send': 'Sends without checking',
  'unknown-part': 'Depends on a setting',
  'duplicated-logic': 'Copied code',
  'hard-to-follow': 'Hard to follow',
};

/** Names that hold values rather than describe them, skipped when naming a field. */
const PLUMBING = new Set([
  'formData',
  'form',
  'payload',
  'data',
  'values',
  'state',
  'trim',
  'test',
  'length',
  'Number',
  'isNaN',
  'isFinite',
  'parseFloat',
  'parseInt',
  'axiosError',
  'error',
  'err',
  'response',
  'status',
  'code',
  'Object',
  'keys',
  'event',
  'e',
  'target',
  'value',
  'toLowerCase',
  'toUpperCase',
  'includes',
  'match',
]);
const humanize = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

/** The field a condition is about: `!formData.email.trim()` → "email", `!accountNumber.trim()` → "account number". */
function fieldOf(condition: string): string | undefined {
  const names = (condition.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((name) => !PLUMBING.has(name) && !/regex$/i.test(name) && !/^(?:true|false|null|undefined|new|typeof)$/.test(name));
  const last = names[names.length - 1];
  return last ? humanize(last) : undefined;
}

/**
 * An edge case for one condition in the code, in words a tester can follow. Only patterns that
 * are clear from the condition itself; anything else is left out rather than guessed.
 */
export function edgeCaseFor(condition: string): string | undefined {
  const text = condition.replace(/…$/, '').trim();
  // Counting the errors the code collected is not an input a tester can change.
  if (/Object\.keys|\berrors?\b|Errors\b/.test(text)) return undefined;
  const field = fieldOf(text);
  const status = /status\s*===?\s*(\d{3})/.exec(text)?.[1];
  if (status === '401') return 'Let the session expire, then try again (the server answers 401)';
  if (status === '403') return 'Try it with an account that isn’t allowed to (403)';
  if (status === '404') return 'Try it on something that was just deleted (404)';
  if (status === '409') return 'Try to create something that already exists (409)';
  if (status === '400' || status === '422') return 'Send data the server rejects (400/422)';
  if (/status\s*(?:&&\s*status\s*)?>=\s*500/.test(text)) return 'Make the server fail, e.g. stop the back-end (500)';
  if (/ECONNABORTED|timeout/i.test(text)) return 'Try on a very slow connection, so the request times out';
  if (/^!\s*axiosError\.response$|^!\s*\w*\.?response$/.test(text)) return 'Try with the network turned off';
  if (/^!\s*(?:session|user|token|currentUser|auth)\b/.test(text)) return 'Try it while signed out';
  if (/\.length\s*<\s*(\d+)/.test(text) && field) return `Enter fewer than ${/\.length\s*<\s*(\d+)/.exec(text)![1]} characters in ${field}`;
  if (/\.length\s*>\s*(\d+)/.test(text) && field) return `Enter more than ${/\.length\s*>\s*(\d+)/.exec(text)![1]} characters in ${field}`;
  if (/\.test\(/.test(text) && field) return `Enter a badly formatted ${field}`;
  if (/isNaN|isFinite/.test(text) && field) return `Type letters instead of a number in ${field}`;
  if (/(?:<=\s*0\b|<\s*1\b)/.test(text) && field) return `Enter 0 or a negative ${field}`;
  if (/^!\s*[\w$.?]+(?:\.trim\(\))?$/.test(text) && field) {
    if (/^(?:is|has)[A-Z]/.test(field.replace(/ (\w)/g, (_, c: string) => c.toUpperCase()))) return undefined;
    return `Leave ${field} empty`;
  }
  if (/^(?:is(?:Submitting|Saving|Loading|Pending)\w*)$/.test(text)) return 'Click the button twice, quickly';
  return undefined;
}

/** Edge cases for one flow, from every check on its path, without repeats. */
export function edgeCasesOf(feature: Feature): string[] {
  const cases = feature.steps.filter((step) => step.stage === 'check' && /^Checks /.test(step.title)).flatMap((step) => edgeCaseFor(step.title.slice('Checks '.length)) ?? []);
  return [...new Set(cases)].slice(0, 12);
}

const where = (feature: Feature, stepId?: string) => {
  const step = (stepId && feature.steps.find((item) => item.id === stepId)) || feature.steps[0];
  return step ? `${step.code.path}:${step.code.highlightLine}` : undefined;
};

/** Scan every flow: CodeDNA's own hidden-lesson findings, plus checks made here from the traced steps. */
export function scanQuality(bundle: RepoBundle): QualityReport {
  const flows = bundle.features.filter((feature) => feature.entryKind !== 'link');
  const findings: Finding[] = [];
  const kindOf: Record<string, { kind: FindingKind; severity: Severity }> = {
    'missing-auth-check': { kind: 'missing-auth-check', severity: 'high' },
    'missing-validation': { kind: 'missing-validation', severity: 'medium' },
    'unknown-part': { kind: 'unknown-part', severity: 'low' },
    'duplicated-logic': { kind: 'duplicated-logic', severity: 'low' },
  };
  for (const hidden of bundle.plan.hiddenLessons) {
    const known = kindOf[hidden.kind];
    if (!known) continue;
    findings.push({
      id: hidden.id,
      ...known,
      title: hidden.title,
      plain: hidden.plain,
      ...(hidden.featureId ? { featureId: hidden.featureId } : {}),
      where: `${hidden.code.path}:${hidden.code.highlightLine}`,
    });
  }
  for (const feature of flows) {
    const requests = feature.effects.filter((effect) => effect.kind === 'api-call');
    const handled = feature.steps.some((step) => /^Tries the next steps/.test(step.title) || /catch/i.test(step.title));
    if (requests.length && !handled)
      findings.push({
        id: `scan:unhandled-request:${feature.id}`,
        kind: 'unhandled-request',
        severity: 'medium',
        title: `“${feature.title}” doesn’t handle a failed request`,
        plain: 'It calls the server, but CodeDNA found no try/catch around the call. If the network drops or the server fails, the screen may get stuck or show nothing.',
        featureId: feature.id,
        ...(where(feature, requests[0]!.stepId) ? { where: where(feature, requests[0]!.stepId)! } : {}),
      });
    const sends = requests.filter((effect) => /\b(?:POST|PUT|PATCH)\b/.test(effect.label));
    const writes = feature.effects.filter((effect) => effect.kind === 'db-write');
    const checks = feature.steps.filter((step) => step.stage === 'check').length;
    if ((sends.length || writes.length) && !checks && !feature.effects.some((effect) => effect.kind === 'validation'))
      findings.push({
        id: `scan:unchecked-send:${feature.id}`,
        kind: 'unchecked-send',
        severity: 'medium',
        title: `“${feature.title}” sends data without checking it first`,
        plain: 'It saves or sends data, but no check runs before it. Empty or wrong values would go straight through.',
        featureId: feature.id,
        ...(where(feature, (sends[0] ?? writes[0])!.stepId) ? { where: where(feature, (sends[0] ?? writes[0])!.stepId)! } : {}),
      });
    const gaps = feature.steps.filter((step) => step.confidence === 'gap');
    if (gaps.length >= 2)
      findings.push({
        id: `scan:hard-to-follow:${feature.id}`,
        kind: 'hard-to-follow',
        severity: 'low',
        title: `Parts of “${feature.title}” are only known while it runs`,
        plain: `${gaps.length} steps depend on values decided at runtime, so reading the code can’t show where they go. These are the first places to test by hand.`,
        featureId: feature.id,
        ...(where(feature, gaps[0]!.id) ? { where: where(feature, gaps[0]!.id)! } : {}),
      });
  }
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const edgeCases = new Map(flows.map((feature) => [feature.id, edgeCasesOf(feature)] as const).filter(([, cases]) => cases.length));
  const counts = { high: 0, medium: 0, low: 0 } as Record<Severity, number>;
  for (const finding of findings) counts[finding.severity]++;
  return { findings, edgeCases, scanned: flows.length, counts };
}
