import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';
import { QA_OWNER_LINE, QA_OWNER_PATH, ownerFileAllows, qaTargetOf, type QaTrigger } from '@codedna/shared';
import type { QaContext } from './types.js';

/** An address on this computer (localhost). */
export function isLocalUrl(value: string): boolean {
  const target = qaTargetOf(value);
  return 'kind' in target && target.kind === 'local';
}

/** Says who is visiting, on the app's own requests, so a site's owner can spot QA traffic in their logs. */
export const QA_HEADER = 'x-codedna-qa';
/** Between pages of a deployed site, so a real site is never rushed. */
export const DEPLOYED_PACE_MS = 800;
export const pause = (context: QaContext) => (context.target === 'deployed' ? new Promise((resolve) => setTimeout(resolve, DEPLOYED_PACE_MS)) : Promise.resolve());

/**
 * A fresh browser session for one check. Extra headers go to the app's own address only, never to
 * third parties. A look-only run blocks every request that would send data, so nothing is sent
 * even when a page tries to on its own — except, while `allowSend()` says so, the app's own
 * sign-in with the learner's test account.
 */
export async function openSession(browser: Browser, context: QaContext, viewport = { width: 1280, height: 800 }, allowSend: () => boolean = () => false): Promise<BrowserContext> {
  const session = await browser.newContext({ viewport });
  const origin = context.appUrl ? new URL(context.appUrl).origin : undefined;
  await session.route('**/*', async (route) => {
    const request = route.request();
    let own = false;
    try {
      own = new URL(request.url()).origin === origin;
    } catch {
      // data: and blob: addresses are never the app's.
    }
    if (!context.interact && !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !(own && allowSend())) return route.abort('blockedbyclient');
    return own ? route.continue({ headers: { ...request.headers(), ...context.headers, [QA_HEADER]: context.runId } }) : route.continue();
  });
  return session;
}

/**
 * Whether a deployed site has agreed to full testing: it publishes /.well-known/codedna.txt with
 * the agreement line. Returns true, or the reason it hasn't, in plain words.
 */
export async function checkOwnership(origin: string, headers: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<true | string> {
  const address = `${origin}${QA_OWNER_PATH}`;
  const howTo = `To allow it, publish ${address} containing the line “${QA_OWNER_LINE}” (in Next.js: public${QA_OWNER_PATH}). Only do this on a test or preview copy of your app.`;
  try {
    const response = await fetcher(address, { headers, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (new URL(response.url || address).origin !== origin) return `${address} sends the browser to another site. ${howTo}`;
    if (!response.ok) return `${origin} hasn’t agreed to be tested with data (${QA_OWNER_PATH} answered ${response.status}). ${howTo}`;
    const text = (await response.text()).slice(0, 10_000);
    return ownerFileAllows(text) ? true : `${address} doesn’t contain “${QA_OWNER_LINE}”. ${howTo}`;
  } catch (error) {
    return `CodeDNA couldn’t read ${address}: ${(error as Error).message}. ${howTo}`;
  }
}

/** A browser already on this machine (Chrome, then Edge), or Playwright's own if it is installed. */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch(channel ? { channel, headless: true } : { headless: true });
    } catch {
      // Try the next one.
    }
  }
  throw new Error('No browser found. Install Google Chrome or Microsoft Edge, or run “npx playwright install chromium”, then try again.');
}

export interface SentRequest {
  method: string;
  url: string;
  status?: number;
}

/** Problems a page shows while it runs, and the requests it sends. */
export function watchPage(page: Page) {
  // A missing favicon is the browser asking, not the app failing.
  const noise = (url: string) => /\/favicon\.ico(?:$|\?)/.test(url);
  const seen = { consoleErrors: [] as string[], pageErrors: [] as string[], serverErrors: [] as string[], failedRequests: [] as string[], sent: [] as SentRequest[] };
  page.on('console', (message) => {
    if (message.type() === 'error' && !noise(message.location().url)) seen.consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => seen.pageErrors.push(error.message.slice(0, 300)));
  page.on('response', (response) => {
    const request = response.request();
    if (response.status() >= 500 && !noise(response.url())) seen.serverErrors.push(`${response.status()} ${request.method()} ${response.url()}`.slice(0, 300));
    const sent = seen.sent.find((item) => item.url === request.url() && item.method === request.method() && item.status === undefined);
    if (sent) sent.status = response.status();
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? '';
    // Aborted by the page, or blocked on purpose by a look-only run: not the app failing.
    if (!/abort|blocked_by_client/i.test(reason) && !noise(request.url())) seen.failedRequests.push(`${request.method()} ${request.url()} — ${reason}`.slice(0, 300));
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) seen.sent.push({ method: request.method(), url: request.url() });
  });
  return seen;
}
export type PageWatch = ReturnType<typeof watchPage>;
export const mark = (seen: PageWatch) => ({ console: seen.consoleErrors.length, page: seen.pageErrors.length, server: seen.serverErrors.length, failed: seen.failedRequests.length, sent: seen.sent.length });
export type WatchMark = ReturnType<typeof mark>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Match a traced label even when it was shortened with "…". */
export const nameMatcher = (label: string) => (label.endsWith('…') ? new RegExp(`^\\s*${escape(label.slice(0, -1).trim())}`, 'i') : new RegExp(`^\\s*${escape(label)}\\s*$`, 'i'));

/**
 * Find what the person uses, the way they would: by its name, then its label, placeholder,
 * tooltip or visible text. The traced label can be any of these.
 */
export async function findTrigger(page: Page, trigger: QaTrigger): Promise<Locator | undefined> {
  const name = nameMatcher(trigger.label);
  const candidates = [page.getByRole(trigger.role, { name }), page.getByLabel(name), page.getByPlaceholder(name), page.getByTitle(name), page.getByText(name, { exact: false })].map((locator) => locator.first());
  // The first try waits for the page to settle; the rest only look.
  for (const [index, locator] of candidates.entries()) if (await locator.isVisible({ timeout: index === 0 ? 2_500 : 300 }).catch(() => false)) return locator;
  return undefined;
}
