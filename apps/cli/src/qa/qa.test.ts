import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOURNEYS_FILE, buildJourneys, isDestructiveFlow, qaPlanFor, qaTriggerOf, validateQaReport, type Feature, type QaCheck, type QaLiveRun, type QaReport, type RepoBundle } from '@codedna/shared';
import { main, type Io } from '../main.js';
import type { LocalServer } from '../server.js';
import { checkOwnership } from './browser.js';
import { valueFor, wrongFormatOf, type FormField } from './flows-runner.js';
import { formatMarkdown, mergeFlowReport, newRunId } from './index.js';
import { createProjectStore } from './live.js';
import { parseTestOutput } from './tests-runner.js';
import { isLocalUrl, walkTargets } from './walk-runner.js';

const fixture = fileURLToPath(new URL('../../../../packages/core/fixtures/shop-app', import.meta.url));
const workerUrl = new URL('../../../../packages/node/dist/worker.js', import.meta.url);

function project(testScript?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'codedna-qa-'));
  cpSync(fixture, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, scripts: testScript ? { test: testScript } : {} }));
  return dir;
}

async function run(argv: string[], confirm: boolean, extra: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const code = await main(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    cwd: process.cwd(),
    workerUrl,
    confirm: async (question) => {
      asked.push(question);
      return confirm;
    },
    env: {},
    ...extra,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), asked };
}

const feature = (title: string, first: string, extra: Partial<Feature> = {}) => ({ id: title, title, entryKind: 'event-handler', page: '/', steps: [{ id: 's0', title: first, stage: 'click' }], effects: [], branches: [], ...extra }) as unknown as Feature;
const field = (extra: Partial<FormField>): FormField => ({ index: 0, tag: 'input', type: 'text', name: '', label: '', required: false, ...extra });

describe('reading test output', () => {
  it('reads Vitest, Jest, Mocha and node:test summaries', () => {
    expect(parseTestOutput(' Test Files  1 failed | 3 passed (4)\n      Tests  2 failed | 10 passed (12)\n FAIL  src/a.test.ts > adds')).toEqual({ passed: 10, failed: 2, skipped: 0, failures: ['src/a.test.ts > adds'] });
    expect(parseTestOutput('Tests:       1 failed, 3 skipped, 9 passed, 13 total')).toMatchObject({ passed: 9, failed: 1, skipped: 3 });
    expect(parseTestOutput('  12 passing (40ms)\n  1 failing\n')).toMatchObject({ passed: 12, failed: 1 });
    expect(parseTestOutput('# tests 4\n# pass 3\n# fail 1\nnot ok 2 - divides')).toMatchObject({ passed: 3, failed: 1, failures: ['divides'] });
    expect(parseTestOutput('\u001b[32mTests  5 passed (5)\u001b[39m')).toMatchObject({ passed: 5, failed: 0 });
    expect(parseTestOutput('done')).toBeUndefined();
  });
});

describe('QA safety and planning', () => {
  it('only visits addresses on this computer', () => {
    expect(isLocalUrl('http://localhost:3000')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:5173/app')).toBe(true);
    expect(isLocalUrl('https://example.com')).toBe(false);
    expect(isLocalUrl('http://localhost.evil.com')).toBe(false);
    expect(isLocalUrl('http://user:pw@localhost:3000')).toBe(false);
    expect(isLocalUrl('file:///etc/passwd')).toBe(false);
  });

  it('reads the trigger from the first step and never acts on destructive flows', () => {
    expect(qaTriggerOf(feature('Place order', 'You press “Place order”'))).toEqual({ verb: 'press', label: 'Place order', role: 'button' });
    expect(qaTriggerOf(feature('Open checkout', 'You click “Go to checkout”', { entryKind: 'link' }))).toMatchObject({ role: 'link' });
    expect(qaTriggerOf(feature('Load', 'Runs when the page opens'))).toBeUndefined();
    expect(isDestructiveFlow({ title: 'Delete a product' })).toBe(true);
    expect(isDestructiveFlow({ title: 'Save to favorites' })).toBe(false);
    expect(isDestructiveFlow({ title: 'Open “Go to checkout”', entryKind: 'link' })).toBe(false);
    expect(isDestructiveFlow({ title: 'Checkout', entryKind: 'form-action' })).toBe(true);
  });

  it('plans form cases from the code, with what should happen', () => {
    const plan = qaPlanFor(
      feature('Place order', 'You press “Place order”', {
        entryKind: 'form-action',
        page: '/checkout',
        effects: [{ kind: 'redirect', label: 'redirects to /orders/${…}' }, { kind: 'db-write', label: 'writes order' }] as Feature['effects'],
        branches: [{ condition: 'if (!parsed.success)' }] as Feature['branches'],
      }),
    );
    expect(plan.shape).toBe('form');
    expect(plan.cases.map((item) => item.kind)).toEqual(['reach', 'happy-path', 'empty', 'wrong-format', 'too-long', 'emoji-unicode', 'double-submit']);
    expect(plan.expectations).toMatchObject({ sendsData: true, destinations: ['/orders/*'] });
    expect(plan.cases.find((item) => item.kind === 'empty')?.expected).toContain('“!parsed.success”');
    expect(qaPlanFor(feature('Show order', 'You click “Show”', { page: '/orders/[id]' })).unavailable).toContain('needs a value');
  });

  it('opens only pages it can fill in by itself', () => {
    expect(walkTargets([feature('A', 'You click “A”', { page: '/orders' }), feature('B', 'You click “B”', { page: '/orders/[id]' }), feature('C', 'x', { page: '/api/x', entryKind: 'route-handler' })])).toEqual(['/orders']);
  });

  it('types made-up test data shaped by each field', () => {
    expect(valueFor(field({ type: 'email' }), 'happy-path', 3)).toBe('qa+3@example.test');
    expect(valueFor(field({ type: 'password' }), 'happy-path', 1)).toBe('Qa-Test-1234!');
    expect(valueFor(field({ maxLength: 4, label: 'Code' }), 'happy-path', 1)).toBe('QA t');
    expect(valueFor(field({ type: 'text' }), 'too-long', 1)).toHaveLength(5_000);
    expect(valueFor(field({ type: 'email' }), 'wrong-format', 1)).toBe('not-an-email');
    expect(valueFor(field({ label: 'Full name' }), 'wrong-format', 1)).toBe('QA Tester');
    expect(wrongFormatOf(field({ label: 'Coupon' }))).toBeUndefined();
    expect(valueFor(field({}), 'empty', 1)).toBe('');
  });

  it('names runs so they sort by time', () => {
    expect(newRunId(new Date('2026-11-07T15:30:12Z'))).toBe('run-20261107-153012');
  });

  it('fills in a deployed site only when it publishes the ownership file', async () => {
    const site = (status: number, body: string, url = 'https://shop.example/.well-known/codedna.txt') => (async () => ({ ok: status < 400, status, url, text: async () => body })) as unknown as typeof fetch;
    expect(await checkOwnership('https://shop.example', {}, site(200, '# QA\ncodedna: allow-testing\n'))).toBe(true);
    expect(await checkOwnership('https://shop.example', {}, site(404, ''))).toContain('answered 404');
    expect(await checkOwnership('https://shop.example', {}, site(200, 'hello'))).toContain('doesn’t contain “codedna: allow-testing”');
    expect(await checkOwnership('https://shop.example', {}, site(200, 'codedna: allow-testing', 'https://other.example/x'))).toContain('another site');
  });
});

describe('reports', () => {
  const report = (checks: QaCheck[]): QaReport => ({ version: 1, repoId: 'r', repoName: 'Shop', createdAt: '2026-11-08T00:00:00Z', tool: { name: 'codedna', version: '0' }, appUrl: 'https://shop.example', mode: 'look', suites: [{ runner: 'flows', title: 'Flows', status: 'passed', checks, startedAt: '', durationMs: 0 }] });
  const check = (featureId: string, status: QaCheck['status'], extra: Partial<QaCheck> = {}): QaCheck => ({ id: `flow:${featureId}:reach`, title: `${featureId} — It can be reached`, status, featureId, ...extra });

  it('folds a one-flow run into the last report, keeping the other flows', () => {
    const merged = mergeFlowReport(report([check('a', 'passed'), check('b', 'passed')]), report([check('b', 'failed')]), ['b']);
    expect(merged.suites[0]!.checks.map((item) => [item.featureId, item.status])).toEqual([
      ['a', 'passed'],
      ['b', 'failed'],
    ]);
    expect(merged.suites[0]!.status).toBe('failed');
    // A full run replaces everything.
    expect(mergeFlowReport(report([check('a', 'passed')]), report([check('b', 'passed')])).suites[0]!.checks).toHaveLength(1);
  });

  it('writes a Markdown summary with the step each flow broke at', () => {
    const steps = [
      { kind: 'open' as const, label: 'Open /checkout', status: 'passed' as const },
      { kind: 'server' as const, label: 'Server answers', status: 'failed' as const, detail: 'The server answered with an error: 500 POST /order | x' },
    ];
    const text = formatMarkdown(report([check('a', 'failed', { steps, page: '/checkout' }), check('b', 'passed')]), { features: [] } as never, 'https://github.com/acme/shop/actions/runs/1');
    expect(text).toContain('## ❌ CodeDNA QA — Shop');
    expect(text).toContain('(looked only, sent nothing)');
    expect(text).toContain('| a — It can be reached <br><sub>/checkout</sub> | Server answers | The server answered with an error: 500 POST /order \\| x |');
    expect(text).toContain('<summary>Passed (1)</summary>');
    expect(text).toContain('[this run](https://github.com/acme/shop/actions/runs/1)');
  });
});

describe('codedna qa', () => {
  it('shows the plan and runs nothing when the answer is no', async () => {
    const dir = project('node -e "require(\'fs\').writeFileSync(\'ran.txt\', \'yes\')"');
    try {
      const result = await run(['qa', dir], false);
      expect(result.out).toContain('CodeDNA will:');
      expect(result.out).toContain('runs your project’s code');
      expect(result.asked).toEqual(['Go ahead?']);
      expect(result.out).toContain('Nothing ran.');
      expect(existsSync(join(dir, 'ran.txt'))).toBe(false);
      expect(existsSync(join(dir, '.codedna'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs the tests after a yes and saves a report the Quality page can read', async () => {
    const dir = project('node -e "console.log(\'Tests  1 failed | 4 passed (5)\'); process.exit(1)"');
    try {
      const result = await run(['qa', dir], true);
      expect(result.code).toBe(1);
      expect(result.out).toContain('1 test failed');
      expect(result.out).toContain('Pages: Give your running app’s address with --url');
      const saved = validateQaReport(JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')));
      expect('report' in saved).toBe(true);
      const report = (saved as { report: QaReport }).report;
      expect(report.repoId).toBe('local-snackshop');
      expect(report.runId).toMatch(/^run-\d{8}-\d{6}$/);
      expect(readFileSync(join(dir, '.codedna', '.gitignore'), 'utf8')).toBe('*\n');
      expect(report.suites.map((suite) => [suite.runner, suite.status])).toEqual([
        ['tests', 'failed'],
        ['walk', 'skipped'],
        ['journeys', 'skipped'],
        ['flows', 'skipped'],
      ]);
      expect(report.suites[0]!.checks[0]).toMatchObject({ status: 'failed', detail: '4 passed, 1 failed.' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('says what is missing when there is nothing to check', async () => {
    const dir = project();
    try {
      const result = await run(['qa', dir], true);
      expect(result.code).toBe(1);
      expect(result.err).toContain('no test script');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('refuses plain-http internet addresses, --interact without an address, and unagreed deployed sites', async () => {
    expect((await run(['qa', fixture, '--url', 'http://example.com'], true)).err).toContain('must use https');
    expect((await run(['qa', fixture, '--interact'], true)).err).toContain('needs your app’s address');
    const notFound = (async () => ({ ok: false, status: 404, url: 'https://shop.example/.well-known/codedna.txt', text: async () => '' })) as unknown as typeof fetch;
    const denied = await run(['qa', fixture, '--url', 'https://shop.example', '--interact', '--only', 'flows'], true, { fetch: notFound });
    expect(denied.code).toBe(1);
    expect(denied.err).toContain('Nothing ran.');
    expect(denied.err).toContain('codedna: allow-testing');
    expect(denied.asked).toEqual([]);
  }, 60_000);

  it('checks its options', async () => {
    expect((await run(['qa', fixture, '--only', 'walk,nope'], true)).err).toContain('a list like walk,flows');
    expect((await run(['qa', fixture, '--header', 'cookie: a=1'], true)).err).toContain('takes one header');
    expect((await run(['qa', fixture, '--github', 'not a repo'], true)).err).toContain('owner/name');
    expect((await run(['analyze', fixture, '--header', 'x: y'], true)).err).toContain('go with “codedna qa”');
  });
});

describe('codedna ci', () => {
  it('adds the GitHub Actions workflow once, and replaces it only with --force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codedna-ci-'));
    try {
      const first = await run(['ci', dir], true);
      expect(first.code).toBe(0);
      const workflow = readFileSync(join(dir, '.github', 'workflows', 'codedna-qa.yml'), 'utf8');
      expect(workflow).toContain('deployment_status:');
      expect(workflow).toContain('--only journeys,flows --yes --github "$GITHUB_REPOSITORY"');
      expect(workflow).toContain('include-hidden-files: true');
      expect((await run(['ci', dir], true)).err).toContain('Add --force');
      expect((await run(['ci', dir, '--force'], true)).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A stand-in for the learner's running app, with planted bugs: the order form accepts empty data
 * without a message, and crashes on very long text. /orders is broken.
 */
describe('running flows on a real browser', () => {
  let server: Server;
  let url = '';
  const posts: string[] = [];
  const html = (body: string) => `<!doctype html><title>Shop</title>${body}`;
  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = (request.url ?? '/').split('?')[0]!;
      if (request.method === 'POST') {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          posts.push(`${path} ${body.length}`);
          if (path === '/api/coupons' || path === '/api/favorites') return void response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
          if (body.length > 1000) return void response.writeHead(500).end('boom');
          if (/coupon=QA/.test(body)) return void response.writeHead(303, { Location: '/orders/123' }).end();
          response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('<p>Thanks!</p>'));
        });
        return;
      }
      const pages: Record<string, string> = {
        '/': '<a href="/checkout">Go to checkout</a><button onclick="fetch(\'/api/favorites\',{method:\'POST\'})">Save to favorites</button><input aria-label="Search snacks">',
        '/checkout': '<form method="post" action="/order"><label>Coupon code <input name="coupon"></label><button type="button" onclick="fetch(\'/api/coupons\',{method:\'POST\'})">Apply coupon</button><button type="submit">Place order</button></form>',
        '/orders/123': '<h1>Order 123</h1>',
      };
      const body = pages[path];
      if (!body) return void response.writeHead(500, { 'Content-Type': 'text/html' }).end('<p>Server error</p>');
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(html(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    url = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('runs each flow step by step, finds the planted bugs at the right step, and keeps screenshots', async () => {
    const dir = project();
    try {
      const result = await run(['qa', dir, '--url', url, '--interact', '--only', 'flows'], true);
      if (/No browser found/.test(result.out + result.err)) return; // No browser on this machine.
      const report = JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')) as QaReport;
      const checks = report.suites[0]!.checks;
      const check = (title: string) => checks.find((item) => item.title === title) as QaCheck;
      const failedStep = (item: QaCheck) => item.steps?.find((step) => step.status === 'failed')?.kind;

      // The normal run goes through every step and lands where the code says.
      const happy = check('Place order — Filled in properly');
      expect(happy.status, JSON.stringify(happy)).toBe('passed');
      expect(happy.steps?.map((step) => [step.kind, step.status])).toEqual([
        ['open', 'passed'],
        ['find', 'passed'],
        ['fill', 'passed'],
        ['press', 'passed'],
        ['request', 'passed'],
        ['server', 'passed'],
        ['result', 'passed'],
      ]);
      expect(happy.inputs).toEqual({ 'Coupon code': 'QA test' });
      expect(happy.steps?.find((step) => step.kind === 'request')?.featureStepId).toBeDefined();

      // Bug 1: empty data is accepted with no message — the result step fails.
      const empty = check('Place order — Sent empty');
      expect(empty.status).toBe('failed');
      expect(failedStep(empty)).toBe('result');
      expect(empty.detail).toContain('accepted empty data');

      // Bug 2: very long text crashes the server — the server step fails.
      const long = check('Place order — Very long text');
      expect(long.status).toBe('failed');
      expect(failedStep(long)).toBe('server');

      // No field here has a format, so that case doesn't apply.
      expect(check('Place order — Wrong formats').status).toBe('skipped');
      // Emoji are handled; a click that calls the API passes; the link opens its page.
      expect(check('Place order — Emoji and other alphabets').status).toBe('passed');
      expect(check('Apply coupon — Clicking it works').status).toBe('passed');
      expect(check('Open “Go to checkout” — The link works').status).toBe('passed');
      // A broken page stops the flow at its first step.
      const broken = check('Export orders — It can be reached');
      expect(failedStep(broken)).toBe('open');
      expect(broken.steps?.find((step) => step.kind === 'find')?.status).toBe('skipped');

      // Every run case has a screenshot on disk, under the run's folder.
      expect(happy.screenshot).toMatch(new RegExp(`^${report.runId}/[a-z0-9-]+\\.jpg$`));
      expect(existsSync(join(dir, '.codedna', 'qa', happy.screenshot!))).toBe(true);
      expect(posts.some((post) => post.startsWith('/order '))).toBe(true);
      expect(result.code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('without --interact only checks each flow can be reached, and sends nothing', async () => {
    const dir = project();
    const before = posts.length;
    try {
      const result = await run(['qa', dir, '--url', url, '--only', 'flows'], true);
      if (/No browser found/.test(result.out + result.err)) return;
      const report = JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')) as QaReport;
      const checks = report.suites[0]!.checks;
      // It only looks: each flow is reached, and links are followed, but nothing is pressed or sent.
      expect(new Set(checks.map((item) => item.caseKind))).toEqual(new Set(['reach', 'happy-path']));
      expect(checks.filter((item) => item.caseKind === 'happy-path').map((item) => item.title)).toEqual(['Open “Go to checkout” — The link works']);
      expect(report.mode).toBe('look');
      expect(posts.length).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('runs one flow from the QA flows page through the local server, live, keeping the other results', async () => {
    const dir = project();
    let server: LocalServer | undefined;
    try {
      const learn = await run([dir, '--no-open', '--port', String(4700 + Math.floor(Math.random() * 200))], true, { loadUi: async () => (_request, response) => response.end('ui'), onServer: (started) => (server = started) });
      expect(learn.code).toBe(0);
      const base = server!.url;
      const id = /\/r\/([a-z0-9-]+)/.exec(learn.out)![1]!;
      const bundle = (await (await fetch(`${base}/api/local/bundle/${id}`)).json()) as { features: Feature[] };
      const placeOrder = bundle.features.find((item) => item.title === 'Place order')!;
      mkdirSync(join(dir, '.codedna'), { recursive: true });
      writeFileSync(join(dir, '.codedna', 'qa-report.json'), JSON.stringify({ version: 1, repoId: id, repoName: 'x', createdAt: '', tool: { name: 'codedna', version: '0' }, suites: [{ runner: 'flows', title: 'Flows', status: 'passed', startedAt: '', durationMs: 0, checks: [{ id: 'flow:other:reach', title: 'Other', status: 'passed', featureId: 'other' }] }] }));

      const body = JSON.stringify({ url, mode: 'full', featureIds: [placeOrder.id] });
      // Without the page's token, nothing starts.
      expect((await fetch(`${base}/api/local/qa-run/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(403);
      const { token } = (await (await fetch(`${base}/api/local/qa-session/${id}`)).json()) as { token: string };
      const started = await fetch(`${base}/api/local/qa-run/${id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-codedna-token': token }, body });
      expect(started.status).toBe(202);
      let status = (await started.json()) as QaLiveRun;
      for (let i = 0; i < 240 && status.state === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        status = (await (await fetch(`${base}/api/local/qa-run/${id}`)).json()) as QaLiveRun;
      }
      if (status.state === 'failed' && /No browser found/.test(status.error ?? '')) return;
      expect(status.state, status.error).toBe('done');
      expect(status.checks.every((item) => item.featureId === placeOrder.id)).toBe(true);
      expect(status.checks.find((item) => item.caseKind === 'empty')?.status).toBe('failed');

      const report = JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')) as QaReport;
      const ids = report.suites[0]!.checks.map((item) => item.featureId);
      expect(ids).toContain('other');
      expect(ids).toContain(placeOrder.id);
      expect(report.mode).toBe('full');
    } finally {
      await server?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});

describe('user journeys on a real browser', () => {
  let server: Server;
  let url = '';
  const posts: string[] = [];
  const html = (body: string) => `<!doctype html><title>Shop</title>${body}`;
  beforeAll(async () => {
    // Checkout needs a signed-in session; applying a coupon is broken on the server.
    server = createServer((request, response) => {
      const path = (request.url ?? '/').split('?')[0]!;
      const signedIn = /session=1/.test(request.headers.cookie ?? '');
      if (request.method === 'POST') {
        let body = '';
        request.on('data', (chunk) => (body += chunk));
        request.on('end', () => {
          posts.push(`${path} ${body}`);
          if (path === '/login') {
            if (/email=qa%40test\.dev/.test(body) && /password=secret/.test(body)) return void response.writeHead(303, { Location: '/', 'Set-Cookie': 'session=1; Path=/' }).end();
            return void response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('<form method="post" action="/login"><p role="alert">Wrong password</p><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>'));
          }
          if (path === '/api/coupons') return void response.writeHead(500).end('boom');
          if (path === '/api/favorites') return void response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
          if (/coupon=QA/.test(body)) return void response.writeHead(303, { Location: '/orders/123' }).end();
          response.writeHead(200, { 'Content-Type': 'text/html' }).end(html('<p>Thanks!</p>'));
        });
        return;
      }
      if ((path === '/checkout' || path.startsWith('/orders')) && !signedIn) return void response.writeHead(302, { Location: '/login' }).end();
      const pages: Record<string, string> = {
        '/': '<a href="/checkout">Go to checkout</a><button onclick="fetch(\'/api/favorites\',{method:\'POST\'})">Save to favorites</button><input aria-label="Search snacks">',
        '/login': '<form method="post" action="/login"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form>',
        '/checkout': '<form method="post" action="/order"><label>Coupon code <input name="coupon"></label><button type="button" onclick="fetch(\'/api/coupons\',{method:\'POST\'})">Apply coupon</button><button type="submit">Place order</button></form>',
        '/orders/123': '<h1>Order 123</h1>',
      };
      const body = pages[path];
      if (!body) return void response.writeHead(500, { 'Content-Type': 'text/html' }).end('<p>Server error</p>');
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(html(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    url = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const account = { CODEDNA_QA_EMAIL: 'qa@test.dev', CODEDNA_QA_PASSWORD: 'secret' };

  it('runs each journey end to end, signs in when asked, and names the broken point with its HTTP answer', async () => {
    const dir = project();
    try {
      const result = await run(['qa', dir, '--url', url, '--interact', '--only', 'journeys'], true, { env: account });
      if (/No browser found/.test(result.out + result.err)) return;
      expect(result.out).toContain('Signs in as qa@test.dev');
      expect(result.out).not.toContain('secret');
      const report = JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')) as QaReport;
      const suite = report.suites.find((item) => item.runner === 'journeys')!;
      const journey = (title: string) => suite.checks.find((item) => item.title === title) as QaCheck;

      // Home → “Go to checkout” → (sign in) → Place order → POST /order → its order page.
      const order = journey('Place order');
      expect(order.status, JSON.stringify(order.steps, null, 1)).toBe('passed');
      const ids = order.steps!.map((step) => step.nodeId);
      expect(ids.slice(0, 3)).toEqual(['0.open', '1.find', '1.press']);
      expect(ids).toContain('1.signin-fill');
      expect(order.steps!.find((step) => step.nodeId === '1.signin-result')?.detail).toContain('qa@test.dev');
      const sent = order.steps!.find((step) => step.nodeId === '2.request')!;
      expect(sent.http).toMatchObject({ method: 'POST', status: 303 });
      expect(order.steps!.at(-1)).toMatchObject({ nodeId: '2.result', status: 'passed' });
      expect(order.steps!.at(-1)!.detail).toContain('/orders/123');
      expect(existsSync(join(dir, '.codedna', 'qa', order.screenshot!))).toBe(true);

      // The coupon request answers 500: that point is red, with the request, and the rest isn't reached.
      const coupon = journey('Apply coupon');
      expect(coupon.status).toBe('failed');
      const broken = coupon.steps!.find((step) => step.status === 'failed')!;
      expect(broken).toMatchObject({ nodeId: '2.server', kind: 'server' });
      expect(broken.http).toMatchObject({ method: 'POST', status: 500 });
      expect(broken.screenshot).toBeDefined();
      expect(coupon.steps!.find((step) => step.nodeId === '2.result')?.status).toBe('skipped');
      // The report never holds the password.
      expect(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')).not.toContain('secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('looking only, it stops at sign-in without an account and sends nothing', async () => {
    const dir = project();
    const before = posts.length;
    try {
      const result = await run(['qa', dir, '--url', url, '--only', 'journeys'], true);
      if (/No browser found/.test(result.out + result.err)) return;
      const report = JSON.parse(readFileSync(join(dir, '.codedna', 'qa-report.json'), 'utf8')) as QaReport;
      const order = report.suites[0]!.checks.find((item) => item.title === 'Place order')!;
      expect(order.status).toBe('warning');
      expect(order.detail).toContain('needs you to sign in');
      expect(posts.length).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it('keeps journey edits in codedna.journeys.json and the test account out of git, without sending the password back', async () => {
    const dir = project();
    try {
      const learn = await run(['analyze', dir, '--json'], true);
      const analysis = JSON.parse(learn.out) as { features: Feature[] };
      const store = createProjectStore(dir, { features: analysis.features } as unknown as RepoBundle);
      const original = buildJourneys(analysis.features);
      const placeOrder = original.find((item) => item.title === 'Place order')!;
      expect(await store.saveJourneys({ version: 1, journeys: [{ ...placeOrder, steps: [{ kind: 'feature', featureKey: 'nope' }] }] })).toMatch(/doesn’t have/);
      expect(await store.saveJourneys({ version: 1, journeys: [{ ...placeOrder, title: 'Buy snacks' }] })).toBeUndefined();
      expect(JSON.parse(readFileSync(join(dir, JOURNEYS_FILE), 'utf8')).journeys[0].title).toBe('Buy snacks');
      expect(await store.saveAccount({ email: 'qa@test.dev', password: 'secret' })).toBeUndefined();
      expect(readFileSync(join(dir, '.codedna', '.gitignore'), 'utf8')).toBe('*\n');
      const read = await store.read();
      expect(read.account).toEqual({ email: 'qa@test.dev' });
      expect(JSON.stringify(read)).not.toContain('secret');
      expect(read.edits?.journeys[0]?.title).toBe('Buy snacks');
      await store.saveAccount({});
      expect((await store.read()).account).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
