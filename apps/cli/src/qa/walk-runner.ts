import type { Browser } from 'playwright-core';
import type { Feature, QaCheck, QaStatus, QaSuite } from '@codedna/shared';
import { worstStatus } from '@codedna/shared';
import { launchBrowser, openSession, pause, watchPage } from './browser.js';
import type { QaContext, QaRunner } from './types.js';

export { isLocalUrl } from './browser.js';

/** Pages the walk can open by themselves: real pages, without [id]-style parts it can't fill in. */
export function walkTargets(features: readonly Feature[]): string[] {
  const pages = new Set<string>();
  for (const feature of features) {
    if (!feature.page || feature.entryKind === 'route-handler' || feature.entryKind === 'server-action') continue;
    if (/[[(]/.test(feature.page)) continue;
    pages.add(feature.page);
  }
  return [...pages];
}

const MAX_PAGES = 60;

async function checkPage(browser: Browser, context: QaContext, path: string): Promise<QaCheck> {
  // Opening a page never needs to send anything, so the walk always looks only.
  const session = await openSession(browser, { ...context, interact: false });
  const page = await session.newPage();
  const seen = watchPage(page);
  const started = Date.now();
  try {
    const response = await page.goto(new URL(path, context.appUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    const landed = new URL(page.url()).pathname;
    const status = response?.status() ?? 0;
    let outcome: QaStatus = 'passed';
    let detail = `Opened in ${((Date.now() - started) / 1000).toFixed(1)} s.`;
    if (status >= 400) [outcome, detail] = ['failed', `The page answered ${status}.`];
    else if (landed !== path && landed !== `${path}/`) [outcome, detail] = ['warning', `It sent the browser to ${landed} instead — it may need you to sign in first.`];
    else if (seen.pageErrors.length || seen.serverErrors.length) [outcome, detail] = ['failed', 'The page crashed or a server request failed while it loaded.'];
    else if (seen.consoleErrors.length || seen.failedRequests.length) [outcome, detail] = ['warning', 'The page opened, but logged errors while loading.'];
    const evidence = [...seen.pageErrors, ...seen.serverErrors, ...seen.failedRequests, ...seen.consoleErrors].slice(0, 8);
    return { id: `walk:${path}:opens`, title: `${path} opens without errors`, status: outcome, page: path, detail, ...(evidence.length ? { evidence } : {}), durationMs: Date.now() - started };
  } catch (error) {
    return { id: `walk:${path}:opens`, title: `${path} opens without errors`, status: 'failed', page: path, detail: `It didn’t open: ${(error as Error).message.split('\n')[0]}`, durationMs: Date.now() - started };
  } finally {
    await session.close().catch(() => undefined);
  }
}

/** Opens each page of the learner's running app in a real browser and checks it loads cleanly. */
export const walkRunner: QaRunner = {
  id: 'walk',
  title: 'Pages',
  unavailable: async (context) => {
    if (!context.appUrl) return 'Give your running app’s address with --url, for example --url http://localhost:3000.';
    if (!walkTargets(context.bundle.features).length) return 'CodeDNA found no pages it can open by itself.';
    return undefined;
  },
  plan: async (context) => {
    const pages = walkTargets(context.bundle.features).slice(0, MAX_PAGES);
    return [{ text: `Open ${pages.length} page${pages.length === 1 ? '' : 's'} of ${context.appUrl} in a hidden browser and look for errors, sending nothing (${pages.slice(0, 4).join(', ')}${pages.length > 4 ? '…' : ''})`, runsProjectCode: false }];
  },
  run: async (context): Promise<QaSuite> => {
    const startedAt = new Date();
    const browser = await launchBrowser();
    const checks: QaCheck[] = [];
    const deadline = Date.now() + context.timeoutMs;
    try {
      for (const path of walkTargets(context.bundle.features).slice(0, MAX_PAGES)) {
        if (Date.now() > deadline) {
          checks.push({ id: `walk:${path}:opens`, title: `${path} opens without errors`, status: 'skipped', page: path, detail: 'Skipped: ran out of time.' });
          continue;
        }
        context.log(`  Opening ${path}…`);
        checks.push(await checkPage(browser, context, path));
        await pause(context);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return { runner: 'walk', title: 'Pages', status: worstStatus(checks.map((check) => check.status)), note: context.appUrl ?? '', checks, startedAt: startedAt.toISOString(), durationMs: Date.now() - startedAt.getTime() };
  },
};
