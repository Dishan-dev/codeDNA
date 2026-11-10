/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Parts of this file run inside the page (page.evaluate), so they use the browser's types.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Locator, Page, Request } from 'playwright-core';
import {
  JOURNEYS_FILE,
  destinationsOf,
  expectationsOf,
  isDestructiveFlow,
  isSignInFeature,
  journeyIsDestructive,
  journeyStations,
  journeysFor,
  qaTriggerOf,
  readJourneyEdits,
  samePage,
  worstStatus,
  type Journey,
  type JourneyEdits,
  type JourneyNode,
  type JourneyStation,
  type QaCheck,
  type QaHttp,
  type QaStatus,
  type QaStepResult,
  type QaSuite,
} from '@codedna/shared';
import { findTrigger, launchBrowser, openSession, pause, watchPage } from './browser.js';
import { FIELDS, feedbackOn, matches, pathOf, readFields, valueFor } from './flows-runner.js';
import type { QaAccount, QaContext, QaRunner } from './types.js';

/** The project's journey edits, if it has a valid `codedna.journeys.json`. Read as JSON, never run. */
export async function readJourneysFile(root: string): Promise<JourneyEdits | undefined> {
  const text = await readFile(join(root, JOURNEYS_FILE), 'utf8').catch(() => undefined);
  if (!text || text.length > 1_000_000) return undefined;
  try {
    const edits = readJourneyEdits(JSON.parse(text));
    return 'problem' in edits ? undefined : edits;
  } catch {
    return undefined;
  }
}

export async function writeJourneysFile(root: string, edits: JourneyEdits): Promise<void> {
  await writeFile(join(root, JOURNEYS_FILE), `${JSON.stringify(edits, null, 2)}\n`, 'utf8');
}

export const ACCOUNT_FILE = 'qa-account.json';

/**
 * The test account: from CODEDNA_QA_EMAIL / CODEDNA_QA_PASSWORD (CI secrets), or the file the QA
 * flows page saves in the project's git-ignored `.codedna` folder.
 */
export async function readAccount(root: string, env: Record<string, string | undefined> = {}): Promise<QaAccount | undefined> {
  if (env.CODEDNA_QA_EMAIL && env.CODEDNA_QA_PASSWORD) return { email: env.CODEDNA_QA_EMAIL, password: env.CODEDNA_QA_PASSWORD };
  try {
    const saved = JSON.parse(await readFile(join(root, '.codedna', ACCOUNT_FILE), 'utf8')) as Partial<QaAccount>;
    return typeof saved.email === 'string' && typeof saved.password === 'string' && saved.email && saved.password ? { email: saved.email, password: saved.password } : undefined;
  } catch {
    return undefined;
  }
}

export async function saveAccount(root: string, account: QaAccount | undefined): Promise<void> {
  const folder = join(root, '.codedna');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, '.gitignore'), '*\n', 'utf8');
  if (account) await writeFile(join(folder, ACCOUNT_FILE), JSON.stringify(account), { encoding: 'utf8', mode: 0o600 });
  else await writeFile(join(folder, ACCOUNT_FILE), '{}', 'utf8');
}

/** Every request the page makes to the app itself: method, address, answer and time taken. */
function recordRequests(page: Page, origin: string) {
  const seen: (QaHttp & { kind: string; at: number })[] = [];
  const started = new Map<Request, number>();
  const own = (request: Request) => {
    try {
      return new URL(request.url()).origin === origin;
    } catch {
      return false;
    }
  };
  page.on('request', (request) => {
    if (own(request)) started.set(request, Date.now());
  });
  page.on('requestfinished', (request) => {
    const at = started.get(request);
    if (at === undefined) return;
    void request.response().then((response) => {
      seen.push({ method: request.method(), url: request.url(), ...(response ? { status: response.status() } : {}), durationMs: Date.now() - at, kind: request.resourceType(), at });
    });
  });
  page.on('requestfailed', (request) => {
    const at = started.get(request);
    if (at === undefined) return;
    const error = request.failure()?.errorText ?? 'no answer';
    if (/abort/i.test(error) && !/blocked/i.test(error)) return;
    seen.push({ method: request.method(), url: request.url(), error, durationMs: Date.now() - at, kind: request.resourceType(), at });
  });
  return seen;
}

const clean = ({ method, url, status, durationMs, error }: QaHttp): QaHttp => ({ method, url, ...(status !== undefined ? { status } : {}), ...(durationMs !== undefined ? { durationMs } : {}), ...(error ? { error } : {}) });
const describeHttp = (http: QaHttp) => `${http.method} ${pathOf(http.url)} → ${http.status ?? http.error ?? 'no answer'}${http.durationMs !== undefined ? ` (${http.durationMs} ms)` : ''}`;
const slug = (text: string) => text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50) || 'x';
const settle = async (page: Page) => {
  await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
};

/** The sign-in form on this page: its account field, password field and button. */
async function signInForm(page: Page): Promise<{ user: Locator; password: Locator; submit: Locator } | undefined> {
  const password = page.locator('input[type=password]').first();
  if (!(await password.isVisible({ timeout: 1_500 }).catch(() => false))) return undefined;
  const form = password.locator('xpath=ancestor::form[1]');
  const scope = (await form.count().catch(() => 0)) ? form : page.locator('body');
  const candidates = ['input[type=email]', 'input[autocomplete=username]', 'input[name*=email i]', 'input[name*=user i]', 'input[id*=email i]', 'input[id*=user i]', 'input[name*=login i]', 'input[type=text]', 'input[type=tel]'];
  let user: Locator | undefined;
  for (const selector of candidates) {
    const box = scope.locator(selector).first();
    if (await box.isVisible({ timeout: 200 }).catch(() => false)) {
      user = box;
      break;
    }
  }
  const submit = scope.locator('button[type=submit], input[type=submit]').first();
  const named = scope.getByRole('button', { name: /sign ?in|log ?in|continue|submit/i }).first();
  const button = (await submit.isVisible({ timeout: 200 }).catch(() => false)) ? submit : named;
  return user ? { user, password, submit: button } : undefined;
}

interface JourneyRun {
  steps: QaStepResult[];
  detail: string;
  screenshot?: string;
}

/** Runs one journey end to end in one browser session, point by point. */
async function runJourney(browser: Browser, context: QaContext, journey: Journey, stations: JourneyStation[], folder: string): Promise<JourneyRun> {
  const features = new Map(context.bundle.features.map((feature) => [feature.id, feature]));
  const steps: QaStepResult[] = [];
  let sending = false;
  const session = await openSession(browser, context, undefined, () => sending);
  const page = await session.newPage();
  const watch = watchPage(page);
  const origin = new URL(context.appUrl!).origin;
  const http = recordRequests(page, origin);
  let shots = 0;
  const shoot = async () => {
    const file = `${slug(journey.title)}-${journey.id.replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()}-${++shots}.jpg`;
    await page.screenshot({ path: join(folder, file), type: 'jpeg', quality: 60 }).catch(() => undefined);
    return (await access(join(folder, file)).then(() => true, () => false)) ? `${context.runId}/${file}` : undefined;
  };
  const emit = () => context.onJourney?.(journey.id, [...steps]);
  const add = (node: Pick<JourneyNode, 'id' | 'kind' | 'label' | 'featureStepId'>, status: QaStatus, detail?: string, extra: Partial<QaStepResult> = {}) => {
    steps.push({ kind: node.kind, label: node.label, status, nodeId: node.id, ...(detail ? { detail } : {}), ...(node.featureStepId ? { featureStepId: node.featureStepId } : {}), ...extra });
    emit();
  };
  const rest = (from: number, nodeIndex = 0) => {
    for (const station of stations.slice(from)) for (const node of station.nodes.slice(station.step === from ? nodeIndex : 0)) add(node, 'skipped', 'Not reached.');
  };
  const breakHere = async (node: JourneyNode | Pick<JourneyNode, 'id' | 'kind' | 'label'>, status: QaStatus, detail: string, station: number, nodeIndex: number, extra: Partial<QaStepResult> = {}): Promise<JourneyRun> => {
    const screenshot = await shoot();
    add(node, status, detail, { ...extra, ...(screenshot ? { screenshot } : {}) });
    rest(station, nodeIndex + 1);
    return { steps, detail: `${node.label}: ${detail}`, ...(screenshot ? { screenshot } : {}) };
  };
  const since = () => ({ at: Date.now(), page: watch.pageErrors.length, server: watch.serverErrors.length });

  /** Sign in with the test account on the page the browser is on. */
  const signIn = async (prefix: string): Promise<string | undefined> => {
    const account = context.account;
    const node = (kind: QaStepResult['kind'], label: string) => ({ id: `${prefix}.signin-${kind}`, kind, label });
    if (!account) return 'This page needs you to sign in. Add a test account on the QA flows page (or the CODEDNA_QA_EMAIL and CODEDNA_QA_PASSWORD secrets in CI).';
    const form = await signInForm(page);
    if (!form) return `It went to ${pathOf(page.url())} but CodeDNA couldn’t find a sign-in form there.`;
    await form.user.fill(account.email, { timeout: 3_000 }).catch(() => undefined);
    await form.password.fill(account.password, { timeout: 3_000 }).catch(() => undefined);
    add(node('fill', 'Fill in the test account'), 'passed', account.email);
    const mark = since();
    const before = pathOf(page.url());
    sending = true;
    try {
      await form.submit.click({ timeout: 3_000 });
      await settle(page);
    } catch (error) {
      sending = false;
      return `The sign-in button couldn’t be pressed: ${(error as Error).message.split('\n')[0]}`;
    }
    sending = false;
    add(node('press', 'Press sign in'), 'passed');
    const sent = http.filter((item) => item.at >= mark.at && item.method !== 'GET');
    const answer = sent.find((item) => item.error || (item.status ?? 0) >= 400) ?? sent[0];
    if (answer) add(node('request', `${answer.method} ${pathOf(answer.url)}`), answer.error || (answer.status ?? 0) >= 500 ? 'failed' : 'passed', describeHttp(answer), { http: clean(answer) });
    const still = (await signInForm(page)) && pathOf(page.url()) === before;
    if (still) {
      const feedback = await feedbackOn(page, []);
      return `Still on the sign-in page after signing in${feedback ? `. ${feedback}` : ''}. Check the test account’s email and password.`;
    }
    add(node('result', 'Signed in'), 'passed', `Signed in as ${account.email}; now on ${pathOf(page.url())}.`);
    return undefined;
  };

  /** Opens a page by address, signing in first when the page sends the browser to sign in. */
  const open = async (target: string, node: JourneyNode | Pick<JourneyNode, 'id' | 'kind' | 'label'>, station: number, extraPoint = false): Promise<JourneyRun | undefined> => {
    // A page opened on the way to a feature isn't one of the station's points, so all of them are still to come.
    const at = extraPoint ? -1 : 0;
    const url = new URL(target, context.appUrl).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const mark = since();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch((error: Error) => error);
      const document: QaHttp = response instanceof Error ? { method: 'GET', url, error: response.message.split('\n')[0]! } : { method: 'GET', url, ...(response ? { status: response.status() } : {}), durationMs: Date.now() - mark.at };
      if (response instanceof Error || (response && response.status() >= 400)) return breakHere(node, 'failed', response instanceof Error ? `It didn’t open: ${document.error}` : `The page answered ${response!.status()}.`, station, at, { http: document });
      await settle(page);
      const landed = pathOf(page.url());
      const crashed = watch.pageErrors.slice(mark.page)[0] ?? watch.serverErrors.slice(mark.server)[0];
      if (crashed) return breakHere(node, 'failed', crashed, station, at, { http: document });
      if (!samePage(landed, target) && attempt === 0 && (await signInForm(page))) {
        const problem = await signIn(node.id.split('.')[0]!);
        if (problem) return breakHere({ id: `${node.id.split('.')[0]}.signin-result`, kind: 'result', label: 'Sign in' }, context.account ? 'failed' : 'warning', problem, station, -1);
        continue;
      }
      add(node, 'passed', samePage(landed, target) ? `Opened in ${document.durationMs ?? 0} ms.` : `It went on to ${landed}.`, { http: document });
      return undefined;
    }
    return breakHere(node, 'failed', `It kept sending the browser to sign in, even after signing in.`, station, at);
  };

  try {
    for (const station of stations) {
      if (station.problem) return await breakHere({ id: `${station.step}.find`, kind: 'find', label: station.title }, 'failed', station.problem, station.step, -1);
      const nodes = station.nodes;
      if (journey.steps[station.step]!.kind === 'open') {
        const stopped = await open(station.page!, nodes[0]!, station.step);
        if (stopped) return stopped;
        continue;
      }
      const feature = features.get(station.featureId!)!;
      const trigger = qaTriggerOf(feature)!;
      const nodeOf = (kind: QaStepResult['kind']) => nodes.find((node) => node.kind === kind)!;
      const index = (kind: QaStepResult['kind']) => nodes.findIndex((node) => node.kind === kind);

      // Be on the feature's page: reached by the steps before, or opened by address.
      const here = pathOf(page.url());
      if (!feature.page || !samePage(here, feature.page)) {
        if (feature.page && !/[*[]|\$\{/.test(feature.page)) {
          const stopped = await open(feature.page, { id: `${station.step}.open`, kind: 'open', label: `Open ${feature.page}` }, station.step, true);
          if (stopped) return stopped;
        } else return await breakHere(nodeOf('find'), 'failed', `The journey is on ${here}, not on ${feature.page ?? 'this feature’s page'}, and that page needs a value (like an id) to open by itself. Add a step before it that leads there.`, station.step, 0);
      }

      // Find it.
      const control = await findTrigger(page, trigger);
      if (!control) return await breakHere(nodeOf('find'), 'failed', `“${trigger.label}” isn’t on ${pathOf(page.url())}. It may be hidden, renamed, or shown only to some people.`, station.step, 0);
      add(nodeOf('find'), 'passed');

      // A link: click it and check where it goes.
      if (feature.entryKind === 'link') {
        const mark = since();
        const before = pathOf(page.url());
        const href = await control.getAttribute('href', { timeout: 500 }).catch(() => null);
        try {
          await control.click({ timeout: 3_000 });
        } catch (error) {
          return await breakHere(nodeOf('press'), 'failed', `It couldn’t be clicked: ${(error as Error).message.split('\n')[0]}`, station.step, index('press'));
        }
        add(nodeOf('press'), 'passed');
        await settle(page);
        let after = pathOf(page.url());
        // The link's page asked to sign in first: sign in, then open where the link pointed.
        const destination = destinationsOf(feature)[0];
        if (destination && !samePage(after, destination) && (await signInForm(page))) {
          const problem = await signIn(String(station.step));
          if (problem) return await breakHere({ id: `${station.step}.signin-result`, kind: 'result', label: 'Sign in' }, context.account ? 'failed' : 'warning', problem, station.step, index('result') - 1);
          const target = href && !href.startsWith('#') ? href : !/[*[]|\$\{/.test(destination) ? destination : undefined;
          if (target) {
            await page.goto(new URL(target, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
            await settle(page);
          }
          after = pathOf(page.url());
        }
        const loaded = http.filter((item) => item.at >= mark.at && item.method === 'GET' && (item.kind === 'document' || item.kind === 'fetch')).at(-1);
        const crashed = watch.pageErrors.slice(mark.page)[0] ?? watch.serverErrors.slice(mark.server)[0];
        const extra = loaded ? { http: clean(loaded) } : {};
        if (crashed) return await breakHere(nodeOf('result'), 'failed', crashed, station.step, index('result'), extra);
        if (after === before) return await breakHere(nodeOf('result'), 'failed', 'Clicking it didn’t open another page.', station.step, index('result'), extra);
        if (loaded && (loaded.status ?? 0) >= 400) return await breakHere(nodeOf('result'), 'failed', `The next page answered ${loaded.status}.`, station.step, index('result'), extra);
        const wanted = destinationsOf(feature);
        const screenshot = station.step === stations.length - 1 ? await shoot() : undefined;
        add(nodeOf('result'), wanted.length && !wanted.some((page) => matches(after, page.replace(/\$\{[^}]*\}|\[[^\]]+\]/g, '*'))) ? 'warning' : 'passed', `Now on ${after}.`, { ...extra, ...(screenshot ? { screenshot } : {}) });
        await pause(context);
        continue;
      }

      // A task: only signing in is done in a look-only run, and destructive tasks never are.
      const signingIn = isSignInFeature(feature);
      if (isDestructiveFlow(feature, trigger)) {
        for (const node of nodes.slice(1)) add(node, 'skipped', 'Skipped on purpose: it could change data in a way that can’t be undone.');
        rest(station.step + 1);
        return { steps, detail: `Stopped before “${feature.title}”: it could change data in a way that can’t be undone.` };
      }
      if (!context.interact && !(signingIn && context.account)) {
        for (const node of nodes.slice(1)) add(node, 'skipped', 'Look only: not pressed. Choose Full test to run it.');
        rest(station.step + 1);
        return { steps, detail: `Looked only: stopped before pressing “${trigger.label}”.` };
      }

      // Fill it in.
      const before = await page.evaluate(() => document.body.innerText.split('\n').map((line) => line.trim()).filter(Boolean)).catch(() => [] as string[]);
      if (trigger.verb === 'press') {
        if (signingIn) {
          const form = await signInForm(page);
          if (!context.account) return await breakHere(nodeOf('fill'), 'warning', 'Add a test account on the QA flows page to sign in.', station.step, index('fill'));
          if (!form) return await breakHere(nodeOf('fill'), 'failed', 'No email and password fields were found next to the button.', station.step, index('fill'));
          await form.user.fill(context.account.email).catch(() => undefined);
          await form.password.fill(context.account.password).catch(() => undefined);
          add(nodeOf('fill'), 'passed', context.account.email);
        } else {
          const form = control.locator('xpath=ancestor::form[1]');
          const fields = (await form.count().catch(() => 0)) ? await readFields(form).catch(() => []) : [];
          const boxes = form.locator(FIELDS);
          const typed: Record<string, string> = {};
          for (const field of fields) {
            const value = valueFor(field, 'happy-path', Date.now() % 100_000);
            if (value === undefined) continue;
            const box = boxes.nth(field.index);
            try {
              if (field.tag === 'select') {
                const options = await box.locator('option').evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).filter(Boolean));
                if (options[0]) await box.selectOption(options[0], { timeout: 2_000 });
                typed[field.label || field.name] = options[0] ?? '';
              } else {
                await box.fill(value, { timeout: 2_000 });
                typed[field.label || field.name] = value;
              }
            } catch {
              // A field that refuses the value is reported by what happens next.
            }
          }
          const names = Object.entries(typed).map(([name, value]) => `${name || 'field'}: ${value}`);
          add(nodeOf('fill'), fields.length ? 'passed' : 'warning', fields.length ? names.join(' · ').slice(0, 200) : 'No fields were found around the button.');
        }
      }

      // Press it.
      const mark = since();
      const from = pathOf(page.url());
      sending = signingIn;
      try {
        await control.click({ timeout: 3_000 });
      } catch (error) {
        sending = false;
        return await breakHere(nodeOf('press'), 'failed', `It couldn’t be pressed: ${(error as Error).message.split('\n')[0]}`, station.step, index('press'));
      }
      add(nodeOf('press'), 'passed');
      await settle(page);
      sending = false;

      // The request and the server's answer.
      const expected = expectationsOf(feature);
      const after = http.filter((item) => item.at >= mark.at);
      const wanted = expected.request;
      const requestNode = nodes.find((node) => node.kind === 'request');
      const feedback = await feedbackOn(page, before);
      if (requestNode) {
        const candidates = after.filter((item) => item.method !== 'GET' || (wanted?.path && matches(pathOf(item.url), wanted.path)));
        const sent = (wanted ? candidates.find((item) => (!wanted.method || item.method === wanted.method) && (!wanted.path || matches(pathOf(item.url), wanted.path))) : undefined) ?? candidates[0];
        if (!sent) return await breakHere(requestNode, 'failed', feedback ? `Nothing was sent. ${feedback}` : `Nothing was sent${wanted?.path ? ` to ${wanted.path}` : ''} — the button didn’t reach the server.`, station.step, index('request'));
        add(requestNode, 'passed', describeHttp(sent), { http: clean(sent) });
        const serverNode = nodeOf('server');
        if (sent.error) return await breakHere(serverNode, 'failed', `No answer came back: ${sent.error}`, station.step, index('server'), { http: clean(sent) });
        if ((sent.status ?? 0) >= 500) return await breakHere(serverNode, 'failed', `The server failed: it answered ${sent.status}.`, station.step, index('server'), { http: clean(sent) });
        if ((sent.status ?? 0) >= 400) return await breakHere(serverNode, 'failed', `The server refused it: it answered ${sent.status}${feedback ? `. ${feedback}` : '.'}`, station.step, index('server'), { http: clean(sent) });
        add(serverNode, 'passed', `Answered ${sent.status} in ${sent.durationMs ?? 0} ms.`, { http: clean(sent) });
      }

      // What happened next.
      const resultNode = nodeOf('result');
      const crashed = watch.pageErrors.slice(mark.page)[0] ?? watch.serverErrors.slice(mark.server)[0];
      if (crashed) return await breakHere(resultNode, 'failed', crashed, station.step, index('result'));
      const now = pathOf(page.url());
      const destinations = destinationsOf(feature);
      let status: QaStatus = 'passed';
      let detail = now !== from ? `Now on ${now}.` : 'It stayed on the page without errors.';
      if (destinations.length && now !== from && !destinations.some((page) => matches(now, page.replace(/\$\{[^}]*\}|\[[^\]]+\]/g, '*')))) [status, detail] = ['warning', `It went to ${now}; the code sends people to ${destinations.join(' or ')}.`];
      else if (destinations.length && now === from) [status, detail] = ['failed', `It stayed on ${now}; the code should then show ${destinations.join(' or ')}.${feedback ? ` ${feedback}` : ''}`];
      else if (now === from && feedback && /\b(?:error|failed|invalid|wrong|required)\b/i.test(feedback)) [status, detail] = ['warning', `${feedback} Our test values may not fit this form.`];
      if (status === 'failed') return await breakHere(resultNode, status, detail, station.step, index('result'));
      const screenshot = station.step === stations.length - 1 || status !== 'passed' ? await shoot() : undefined;
      add(resultNode, status, detail, screenshot ? { screenshot } : {});
      await pause(context);
    }
    const last = [...steps].reverse().find((step) => step.screenshot)?.screenshot;
    return { steps, detail: 'Every step worked.', ...(last ? { screenshot: last } : {}) };
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** The journeys a run covers: the project's own (with its edits), without hidden ones. */
export async function journeyTargets(context: QaContext): Promise<Journey[]> {
  const all = journeysFor(context.bundle.features, await readJourneysFile(context.root)).filter((journey) => !journey.hidden);
  return context.journeyIds ? all.filter((journey) => context.journeyIds!.includes(journey.id)) : all;
}

/** Runs every user journey end to end in a real browser, and says exactly which point broke. */
export const journeysRunner: QaRunner = {
  id: 'journeys',
  title: 'User journeys',
  unavailable: async (context) => {
    if (!context.appUrl) return 'Give your running app’s address with --url, for example --url http://localhost:3000.';
    if (!(await journeyTargets(context)).length) return 'CodeDNA found no journeys it can run in a browser.';
    return undefined;
  },
  plan: async (context) => {
    const journeys = await journeyTargets(context);
    const count = `${journeys.length} user journey${journeys.length === 1 ? '' : 's'}`;
    const account = context.account ? ` Signs in as ${context.account.email} when a page asks.` : '';
    return context.interact
      ? [{ text: `Run ${count} on ${context.appUrl} end to end, as a person would: follow links, fill in forms with test data and press their buttons.${account} This sends data to that app — use a test copy. Deleting, paying, transferring and signing out are always skipped.`, runsProjectCode: true }]
      : [{ text: `Walk ${count} on ${context.appUrl}: open each page and follow the links, stopping before any button that sends data.${account ? `${account} (signing in is the only thing it sends)` : ''}`, runsProjectCode: !!context.account }];
  },
  run: async (context): Promise<QaSuite> => {
    const startedAt = new Date();
    const folder = join(context.root, '.codedna', 'qa', context.runId);
    await mkdir(folder, { recursive: true });
    const journeys = await journeyTargets(context);
    const browser = await launchBrowser();
    const checks: QaCheck[] = [];
    const deadline = Date.now() + context.timeoutMs;
    try {
      for (const journey of journeys) {
        const stations = journeyStations(journey, context.bundle.features);
        const base = { id: `journey:${journey.id}`, title: journey.title, journeyId: journey.id };
        const last = stations.at(-1);
        const extra = { ...(last?.featureId ? { featureId: last.featureId } : {}), ...(last?.page ? { page: last.page } : {}) };
        if (context.signal?.aborted || Date.now() > deadline) {
          const check: QaCheck = { ...base, ...extra, status: 'skipped', detail: context.signal?.aborted ? 'Skipped: the run was stopped.' : 'Skipped: the run ran out of time.' };
          checks.push(check);
          context.onCheck?.(check);
          continue;
        }
        context.log(`  ${journey.title}…`);
        context.onJourney?.(journey.id, []);
        const started = Date.now();
        const outcome = await runJourney(browser, context, journey, stations, folder);
        const statuses = outcome.steps.map((step) => step.status).filter((status) => status !== 'skipped');
        const check: QaCheck = {
          ...base,
          ...extra,
          status: statuses.length ? worstStatus(statuses) : 'skipped',
          detail: outcome.detail,
          steps: outcome.steps,
          ...(outcome.screenshot ? { screenshot: outcome.screenshot } : {}),
          ...(journeyIsDestructive(journey, context.bundle.features) ? { evidence: ['This journey has a step that could change data for good; it stops before that step.'] } : {}),
          durationMs: Date.now() - started,
        };
        checks.push(check);
        context.onCheck?.(check);
        await pause(context);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return { runner: 'journeys', title: 'User journeys', status: worstStatus(checks.map((check) => check.status)), note: context.appUrl ?? '', checks, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime() };
  },
};

