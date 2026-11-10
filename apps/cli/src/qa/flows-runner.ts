/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Parts of this file run inside the page (page.evaluate), so they use the browser's types.
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator, Page } from 'playwright-core';
import { featureStepFor, isDestructiveFlow, qaPlanFor, worstStatus, type Feature, type QaCasePlan, type QaCheck, type QaPlan, type QaStatus, type QaStepKind, type QaStepResult, type QaSuite } from '@codedna/shared';
import { findTrigger, launchBrowser, mark, openSession, pause, watchPage, type WatchMark } from './browser.js';
import type { QaContext, QaRunner } from './types.js';

/** A field of the form the trigger sits in, read from the live page. */
export interface FormField {
  index: number;
  tag: 'input' | 'textarea' | 'select';
  type: string;
  name: string;
  label: string;
  required: boolean;
  maxLength?: number;
  min?: string;
  max?: string;
}

export const FIELDS = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=image]), textarea, select';
const LONG = 5_000;

/** The wrong value for a field with a format (email, link, phone, a number typed as text). */
export function wrongFormatOf(field: FormField): string | undefined {
  const hint = `${field.type} ${field.name} ${field.label}`.toLowerCase();
  if (field.type === 'email' || /e-?mail/.test(hint)) return 'not-an-email';
  if (field.type === 'url') return 'not a link';
  if (field.type === 'tel' || /phone|mobile/.test(hint)) return 'abc';
  if (field.type !== 'number' && /\b(?:amount|age|qty|quantity|price|count)\b/.test(hint)) return 'abc';
  return undefined;
}

/**
 * The value to type for one field in one case. Made-up test data only: never a real person,
 * email address or card. Shaped by the field's type, name and limits.
 */
export function valueFor(field: FormField, kind: QaCasePlan['kind'], serial: number): string | undefined {
  const hint = `${field.type} ${field.name} ${field.label}`.toLowerCase();
  const isEmail = field.type === 'email' || /e-?mail/.test(hint);
  const isNumber = field.type === 'number' || field.type === 'range' || /\b(?:amount|age|qty|quantity|price|count)\b/.test(hint);
  // A select gets a real option, except when the form is sent empty.
  if (field.tag === 'select') return kind === 'empty' ? undefined : '';
  if (kind === 'empty') return '';
  if (kind === 'too-long') return isNumber && field.type === 'number' ? '9'.repeat(40) : 'x'.repeat(LONG);
  if (kind === 'emoji-unicode') return isEmail ? `qa😀${serial}@example.test` : isNumber && field.type === 'number' ? undefined : 'Ünïcødé 测试 😀 مرحبا';
  // Wrong formats: only the format fields are wrong and the rest stay valid, so the format is what's tested.
  if (kind === 'wrong-format') return wrongFormatOf(field) ?? valueFor(field, 'happy-path', serial);
  // A normal, valid value.
  let value = 'QA test';
  if (isEmail) value = `qa+${serial}@example.test`;
  else if (field.type === 'password' || /password/.test(hint)) value = 'Qa-Test-1234!';
  else if (isNumber) value = field.min && Number(field.min) > 0 ? field.min : '1';
  else if (field.type === 'tel' || /phone|mobile/.test(hint)) value = '+15550100';
  else if (field.type === 'url' || /website|url/.test(hint)) value = 'https://example.test';
  else if (field.type === 'date') value = '2030-01-15';
  else if (/\bname\b|first|last|full/.test(hint)) value = 'QA Tester';
  else if (/zip|postal/.test(hint)) value = '12345';
  else if (/nic|id ?number/.test(hint)) value = '200012345678';
  else if (field.tag === 'textarea' || /message|comment|description|note/.test(hint)) value = 'This is a QA test message.';
  return field.maxLength && field.maxLength > 0 ? value.slice(0, field.maxLength) : value;
}

export async function readFields(form: Locator): Promise<FormField[]> {
  return form.evaluate((element, selector) => {
    const items = [...element.querySelectorAll(selector)] as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    return items.map((item, index) => {
      const label = (item.labels?.[0]?.innerText ?? item.getAttribute('aria-label') ?? item.getAttribute('placeholder') ?? item.name ?? '').trim();
      const maxLength = 'maxLength' in item && item.maxLength > 0 ? item.maxLength : undefined;
      return {
        index,
        tag: item.tagName.toLowerCase() as 'input' | 'textarea' | 'select',
        type: item instanceof HTMLInputElement ? item.type : item.tagName.toLowerCase(),
        name: item.name || item.id || '',
        label: label.slice(0, 60),
        required: item.required,
        ...(maxLength ? { maxLength } : {}),
        ...(item.getAttribute('min') ? { min: item.getAttribute('min')! } : {}),
        ...(item.getAttribute('max') ? { max: item.getAttribute('max')! } : {}),
      };
    });
  }, FIELDS);
}

/** Text that looks like the app telling the person what's wrong, which wasn't there before. */
export async function feedbackOn(page: Page, before: string[]): Promise<string | undefined> {
  return page
    .evaluate((earlier) => {
      const invalid = document.querySelector<HTMLInputElement>('input:invalid, textarea:invalid, select:invalid');
      if (invalid?.validationMessage) return `The browser stopped it: “${invalid.validationMessage}”`;
      const alerts = [...document.querySelectorAll<HTMLElement>('[role=alert], [aria-live]')].filter((element) => !element.id.includes('route-announcer') && element.tagName !== 'NEXT-ROUTE-ANNOUNCER').map((element) => element.innerText.trim()).filter(Boolean);
      if (alerts.length) return `It said: “${alerts[0]!.slice(0, 140)}”`;
      const known = new Set(earlier);
      const fresh = document.body.innerText.split('\n').map((line) => line.trim()).filter((line) => line && !known.has(line));
      const message = fresh.find((line) => line.length < 160 && /\b(?:required|invalid|must|please|error|enter a|enter your|too (?:long|short)|at least|not valid|incorrect|failed|missing)\b/i.test(line));
      if (message) return `It said: “${message}”`;
      if (document.querySelector('[aria-invalid=true]')) return 'A field was marked as wrong.';
      return undefined;
    }, before)
    .catch(() => undefined);
}

export const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};
export const matches = (path: string, pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}/?$`).test(path);

interface CaseRun {
  /** The case didn't apply here (e.g. no field with a format to get wrong). */
  skipped?: boolean;
  steps: QaStepResult[];
  inputs: Record<string, string>;
  evidence: string[];
  detail: string;
}

/** Run one case of one feature as a person would, step by step, and judge each step. */
async function runCase(browser: Browser, context: QaContext, feature: Feature, plan: QaPlan, testCase: QaCasePlan, shotPath: string, serial: number): Promise<CaseRun> {
  const steps: QaStepResult[] = [];
  const inputs: Record<string, string> = {};
  const evidence: string[] = [];
  const add = (kind: QaStepKind, label: string, status: QaStatus, detail?: string) => {
    const traced = featureStepFor(feature, kind);
    steps.push({ kind, label, status, ...(detail ? { detail } : {}), ...(traced ? { featureStepId: traced.id } : {}) });
  };
  const stopHere = (rest: [QaStepKind, string][]) => rest.forEach(([kind, label]) => add(kind, label, 'skipped', 'Not reached.'));
  const trigger = plan.trigger!;
  const triggerName = `“${trigger.label}”`;
  const later: [QaStepKind, string][] = [
    ...(plan.shape === 'form' ? ([['fill', 'Fill in the form']] as [QaStepKind, string][]) : []),
    ['press', `${trigger.verb === 'press' ? 'Press' : 'Click'} ${triggerName}`],
    ...(plan.expectations.sendsData || plan.expectations.request ? ([['request', 'Send to the server'], ['server', 'Server answers']] as [QaStepKind, string][]) : []),
    ['result', 'What happens next'],
  ];
  // Each case starts fresh: no cookies or storage from the last one.
  const session = await openSession(browser, context);
  const page = await session.newPage();
  const seen = watchPage(page);
  const shoot = () => page.screenshot({ path: shotPath, type: 'jpeg', quality: 60 }).catch(() => undefined);
  try {
    // 1. Open the page.
    const url = new URL(plan.page!, context.appUrl).toString();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((error: Error) => error);
    if (response instanceof Error || (response && response.status() >= 400)) {
      add('open', `Open ${plan.page}`, 'failed', response instanceof Error ? `It didn’t open: ${response.message.split('\n')[0]}` : `The page answered ${response.status()}.`);
      stopHere([['find', `Find ${triggerName}`], ...(testCase.kind === 'reach' ? [] : later)]);
      await shoot();
      return { steps, inputs, evidence, detail: 'The page didn’t open.' };
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    const landed = pathOf(page.url());
    if (landed !== plan.page && landed !== `${plan.page}/`) {
      add('open', `Open ${plan.page}`, 'warning', `It sent the browser to ${landed} — this page probably needs you to sign in.`);
      stopHere([['find', `Find ${triggerName}`], ...(testCase.kind === 'reach' ? [] : later)]);
      await shoot();
      return { steps, inputs, evidence, detail: `Sent to ${landed}: it probably needs sign-in, which QA can’t do yet.` };
    }
    add('open', `Open ${plan.page}`, seen.pageErrors.length || seen.serverErrors.length ? 'failed' : 'passed', seen.pageErrors[0] ?? seen.serverErrors[0]);

    // 2. Find what starts the flow.
    const control = await findTrigger(page, trigger);
    if (!control) {
      add('find', `Find ${triggerName}`, 'warning', 'Not visible. It may show only after signing in, picking something, or opening a menu.');
      if (testCase.kind !== 'reach') stopHere(later);
      await shoot();
      return { steps, inputs, evidence, detail: `${triggerName} wasn’t visible on ${plan.page}.` };
    }
    add('find', `Find ${triggerName}`, 'passed');
    if (testCase.kind === 'reach') {
      await shoot();
      return { steps, inputs, evidence, detail: `${triggerName} is on ${plan.page}.` };
    }

    // 3. Fill in the form.
    let fields: FormField[] = [];
    const form = control.locator('xpath=ancestor::form[1]');
    const inForm = (await form.count().catch(() => 0)) > 0;
    if (plan.shape === 'form') {
      if (inForm) fields = await readFields(form).catch(() => []);
      const boxes = inForm ? form.locator(FIELDS) : undefined;
      let filled = 0;
      for (const field of fields) {
        const value = valueFor(field, testCase.kind, serial);
        if (value === undefined || !boxes) continue;
        const box = boxes.nth(field.index);
        try {
          if (field.tag === 'select') {
            const options = await box.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).filter(Boolean));
            if (options[0]) await box.selectOption(options[0], { timeout: 2_000 });
            inputs[field.label || field.name || `field ${field.index + 1}`] = options[0] ?? '';
          } else {
            await box.fill(value, { timeout: 2_000 });
            inputs[field.label || field.name || `field ${field.index + 1}`] = value.length > 60 ? `${value.slice(0, 20)}… (${value.length} characters)` : value;
          }
          filled++;
        } catch {
          // A field that refuses this value (a number box and letters) is itself the browser saying no.
        }
      }
      if (testCase.kind === 'wrong-format' && !fields.some((field) => wrongFormatOf(field))) {
        add('fill', 'Fill in the form', 'skipped', 'No field here has a format to get wrong (email, number, phone, link).');
        return { steps, inputs, evidence, detail: 'No fields with a format to test.', skipped: true };
      }
      add('fill', fields.length ? `Fill in ${filled} of ${fields.length} field${fields.length === 1 ? '' : 's'}` : 'Fill in the form', fields.length ? 'passed' : 'warning', fields.length ? undefined : 'No fields were found around the button.');
    }

    // 4. Press it.
    const before: WatchMark = mark(seen);
    const pageText = await page.evaluate(() => document.body.innerText.split('\n').map((line) => line.trim()).filter(Boolean)).catch(() => [] as string[]);
    const urlBefore = pathOf(page.url());
    try {
      if (testCase.kind === 'double-submit') await control.dblclick({ timeout: 3_000 });
      else await control.click({ timeout: 3_000 });
      add('press', `${trigger.verb === 'press' ? 'Press' : 'Click'} ${triggerName}`, 'passed');
    } catch (error) {
      add('press', `${trigger.verb === 'press' ? 'Press' : 'Click'} ${triggerName}`, 'failed', `It couldn’t be pressed: ${(error as Error).message.split('\n')[0]}`);
      stopHere(later.filter(([kind]) => kind !== 'fill' && kind !== 'press'));
      await shoot();
      return { steps, inputs, evidence, detail: `${triggerName} couldn’t be pressed.` };
    }
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(500);

    // 5–7. Judge what happened.
    const sent = seen.sent.slice(before.sent);
    const serverErrors = seen.serverErrors.slice(before.server);
    const crashes = seen.pageErrors.slice(before.page);
    const failed = seen.failedRequests.slice(before.failed);
    evidence.push(...crashes, ...serverErrors, ...failed, ...seen.consoleErrors.slice(before.console));
    const feedback = await feedbackOn(page, pageText);
    const landedAfter = pathOf(page.url());
    const moved = landedAfter !== urlBefore;
    const wanted = plan.expectations.request;
    const matching = wanted ? sent.filter((item) => (!wanted.method || item.method === wanted.method) && (!wanted.path || matches(pathOf(item.url), wanted.path))) : sent;
    const accepted = matching.some((item) => item.status !== undefined && item.status < 400);
    const shouldRefuse = testCase.kind === 'empty' || testCase.kind === 'wrong-format';
    let detail = '';

    if (plan.expectations.sendsData || wanted) {
      if (matching.length) add('request', 'Send to the server', shouldRefuse && accepted && !feedback ? 'warning' : 'passed', `${matching[0]!.method} ${pathOf(matching[0]!.url)}${matching.length > 1 ? ` (sent ${matching.length} times)` : ''}`);
      else if (shouldRefuse) add('request', 'Send to the server', 'passed', 'Nothing was sent — good, the data was stopped first.');
      else add('request', 'Send to the server', feedback ? 'warning' : 'failed', feedback ? `Nothing was sent. ${feedback}` : `Nothing was sent${wanted?.path ? ` to ${wanted.path}` : ''}, and no message said why.`);
      if (serverErrors.length) add('server', 'Server answers', 'failed', `The server answered with an error: ${serverErrors[0]}`);
      else if (failed.length) add('server', 'Server answers', 'failed', `The request didn’t get an answer: ${failed[0]}`);
      else if (matching.length) add('server', 'Server answers', 'passed', `Answered ${matching.map((item) => item.status ?? '…').join(', ')}.`);
      else add('server', 'Server answers', 'skipped', 'Nothing was sent.');
    }

    let result: QaStatus = 'passed';
    if (crashes.length) [result, detail] = ['failed', `The page crashed: ${crashes[0]}`];
    else if (serverErrors.length || failed.length) [result, detail] = ['failed', 'The server failed on this input.'];
    else if (testCase.kind === 'double-submit') {
      const count = matching.length;
      [result, detail] = count > 1 ? ['warning', `Pressing twice sent ${count} requests. Disable the button while it sends.`] : ['passed', count ? 'Sent once.' : 'Nothing was sent, so double sending couldn’t happen here.'];
    } else if (shouldRefuse) {
      if (feedback) detail = `Refused with a message. ${feedback}`;
      else if (accepted) [result, detail] = ['failed', `It accepted ${testCase.kind === 'empty' ? 'empty' : 'wrongly formatted'} data: the server said OK and no message was shown.`];
      else if (!sent.length && !moved) [result, detail] = ['warning', 'Nothing happened and no message said what was wrong.'];
      else detail = 'Nothing bad was accepted.';
    } else if (testCase.kind === 'happy-path') {
      const allowed = plan.expectations.destinations;
      if (moved && allowed.length && !allowed.some((target) => matches(landedAfter, target))) [result, detail] = ['warning', `It went to ${landedAfter}; the code sends people to ${allowed.join(' or ')}.`];
      else if (moved) detail = `It went on to ${landedAfter}.`;
      else if (feedback) [result, detail] = ['warning', `It stayed on the page. ${feedback} Our test values may not fit this form.`];
      else detail = matching.length ? 'Sent and answered without errors.' : 'Ran without errors.';
    } else detail = 'Handled without errors.';
    add('result', 'What happens next', result, detail);
    await shoot();
    return { steps, inputs, evidence: evidence.slice(0, 8), detail };
  } finally {
    await session.close().catch(() => undefined);
  }
}

const MAX_FEATURES = 60;

/** The flows a run covers: main tasks first, then the small details (or only the ones asked for). */
export function flowTargets(features: readonly Feature[], only?: readonly string[]): Feature[] {
  if (only) features = features.filter((feature) => only.includes(feature.id));
  const main = features.filter((feature) => feature.importance !== 'detail');
  const details = features.filter((feature) => feature.importance === 'detail');
  return [...main, ...details].slice(0, MAX_FEATURES);
}

const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'x';

/** Runs every traced flow in a real browser, case by case, step by step. */
export const flowsRunner: QaRunner = {
  id: 'flows',
  title: 'Flows',
  unavailable: async (context) => {
    if (!context.appUrl) return 'Give your running app’s address with --url, for example --url http://localhost:3000.';
    if (!flowTargets(context.bundle.features, context.featureIds).some((feature) => !qaPlanFor(feature).unavailable)) return 'CodeDNA found no flows it can start by itself.';
    return undefined;
  },
  plan: async (context) => {
    const runnable = flowTargets(context.bundle.features, context.featureIds).filter((feature) => !qaPlanFor(feature).unavailable);
    const flows = `${runnable.length} flow${runnable.length === 1 ? '' : 's'}`;
    return context.interact
      ? [{ text: `Run ${flows} on ${context.appUrl} as a person would: fill forms with test data, press their buttons, then try them empty, with wrong formats, very long text, emoji and a double press. This sends data to that app — use a test copy. Deleting, paying, transferring and signing out are always skipped.`, runsProjectCode: true }]
      : [{ text: `Check that ${flows} on ${context.appUrl} can be reached and their links work. Nothing is sent (add --interact to run them fully)`, runsProjectCode: false }];
  },
  run: async (context): Promise<QaSuite> => {
    const startedAt = new Date();
    const folder = join(context.root, '.codedna', 'qa', context.runId);
    await mkdir(folder, { recursive: true });
    const browser = await launchBrowser();
    const checks: QaCheck[] = [];
    const deadline = Date.now() + context.timeoutMs;
    let serial = 0;
    const record = (check: QaCheck) => {
      checks.push(check);
      context.onCheck?.(check);
    };
    try {
      for (const feature of flowTargets(context.bundle.features, context.featureIds)) {
        const plan = qaPlanFor(feature);
        if (plan.unavailable) {
          record({ id: `flow:${feature.id}:reach`, title: feature.title, status: 'skipped', caseKind: 'reach', featureId: feature.id, ...(feature.page ? { page: feature.page } : {}), detail: plan.unavailable });
          continue;
        }
        context.log(`  ${feature.title}…`);
        const destructive = isDestructiveFlow(feature, plan.trigger);
        for (const testCase of plan.cases) {
          const id = `flow:${feature.id}:${testCase.kind}`;
          const base = { id, title: `${feature.title} — ${testCase.title}`, caseKind: testCase.kind, featureId: feature.id, page: plan.page!, expected: testCase.expected };
          if (testCase.acts && !context.interact) continue;
          if (testCase.acts && destructive) {
            record({ ...base, status: 'skipped', detail: 'Skipped on purpose: it could change data in a way that can’t be undone.' });
            continue;
          }
          if (context.signal?.aborted || Date.now() > deadline) {
            record({ ...base, status: 'skipped', detail: context.signal?.aborted ? 'Skipped: the run was stopped.' : 'Skipped: the run ran out of time.' });
            continue;
          }
          context.onCase?.(feature.id, testCase.kind);
          const file = `${slug(feature.title)}-${feature.id.slice(-6).replace(/[^a-z0-9]/gi, '')}-${testCase.kind}.jpg`;
          const started = Date.now();
          const outcome = await runCase(browser, context, feature, plan, testCase, join(folder, file), ++serial);
          record({
            ...base,
            status: outcome.skipped ? 'skipped' : worstStatus(outcome.steps.map((step) => step.status).filter((status) => status !== 'skipped')),
            detail: outcome.detail,
            steps: outcome.steps,
            ...(Object.keys(outcome.inputs).length ? { inputs: outcome.inputs } : {}),
            ...(outcome.evidence.length ? { evidence: outcome.evidence } : {}),
            // Only point at a screenshot that was really saved.
            ...((await access(join(folder, file)).then(() => true, () => false)) ? { screenshot: `${context.runId}/${file}` } : {}),
            durationMs: Date.now() - started,
          });
          await pause(context);
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return { runner: 'flows', title: 'Flows', status: worstStatus(checks.map((check) => check.status)), note: context.appUrl ?? '', checks, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime() };
  },
};
