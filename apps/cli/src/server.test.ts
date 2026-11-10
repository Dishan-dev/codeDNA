import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { RepoBundle } from '@codedna/shared';
import { allowedHost, startLocalServer, type LocalServer } from './server.js';

const bundle = { id: 'local-demo', name: 'Demo', plan: { path: ['lesson-1'] } } as unknown as RepoBundle;
const servers: LocalServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const start = async (port = 0) => {
  const server = await startLocalServer({ bundle, ui: (_request, response) => response.end('learning UI'), port });
  servers.push(server);
  return server;
};

/** A raw request, so tests can send any Host header and method. */
function get(port: number, path: string, options: { host?: string; method?: string } = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host: options.host ?? `localhost:${port}` } }, (response) => {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('local server', () => {
  it('serves the bundle and the learning UI on localhost', async () => {
    const server = await start();
    expect(server.url).toBe(`http://localhost:${server.port}`);
    const api = await get(server.port, '/api/local/bundle/local-demo');
    expect(api.status).toBe(200);
    expect(JSON.parse(api.body)).toMatchObject({ id: 'local-demo', name: 'Demo' });
    expect(api.headers['cache-control']).toBe('no-store');
    expect((await get(server.port, '/r/local-demo')).body).toBe('learning UI');
  });

  it('answers only for its own bundle and only reads', async () => {
    const server = await start();
    expect((await get(server.port, '/api/local/bundle/local-other')).status).toBe(404);
    expect((await get(server.port, '/api/local/anything')).status).toBe(404);
    expect((await get(server.port, '/api/local/bundle/local-demo', { method: 'POST' })).status).toBe(405);
  });

  it('refuses requests addressed to another host name (DNS rebinding)', async () => {
    const server = await start();
    const response = await get(server.port, '/api/local/bundle/local-demo', { host: 'evil.example:80' });
    expect(response.status).toBe(421);
    expect(response.body).not.toContain('Demo');
    expect(allowedHost(`127.0.0.1:${server.port}`, server.port)).toBe(true);
    expect(allowedHost(`[::1]:${server.port}`, server.port)).toBe(true);
    expect(allowedHost(undefined, server.port)).toBe(false);
    expect(allowedHost(`localhost:${server.port + 1}`, server.port)).toBe(false);
  });

  it('moves to the next port when the preferred one is busy', async () => {
    const first = await start(0);
    const second = await start(first.port);
    expect(second.port).toBe(first.port + 1);
  });
});

describe('QA report', () => {
  it('serves the latest report fresh on each request, and 404 before the first run', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'codedna-report-'));
    const qaReportPath = join(dir, 'qa-report.json');
    const server = await startLocalServer({ bundle, ui: (_request, response) => response.end('ui'), port: 0, qaReportPath });
    servers.push(server);
    try {
      expect((await get(server.port, '/api/local/qa/local-demo')).status).toBe(404);
      writeFileSync(qaReportPath, JSON.stringify({ version: 1, repoId: 'local-demo', suites: [] }));
      const first = await get(server.port, '/api/local/qa/local-demo');
      expect(first.status).toBe(200);
      expect(JSON.parse(first.body)).toMatchObject({ repoId: 'local-demo' });
      expect((await get(server.port, '/api/local/qa/someone-else')).status).toBe(404);
      expect((await get(server.port, '/api/local/qa/local-demo', { host: 'evil.example:80' })).status).toBe(421);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QA screenshots', () => {
  it('serves screenshots from the run folder only', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const qaDir = mkdtempSync(join(tmpdir(), 'codedna-shots-'));
    mkdirSync(join(qaDir, 'run-20261107-100000'));
    writeFileSync(join(qaDir, 'run-20261107-100000', 'place-order-empty.jpg'), 'jpeg-bytes');
    writeFileSync(join(qaDir, 'secret.txt'), 'no');
    const server = await startLocalServer({ bundle, ui: (_request, response) => response.end('ui'), port: 0, qaDir });
    servers.push(server);
    try {
      const shot = await get(server.port, '/api/local/qa-shot/local-demo/run-20261107-100000/place-order-empty.jpg');
      expect(shot.status).toBe(200);
      expect(shot.headers['content-type']).toBe('image/jpeg');
      expect(shot.body).toBe('jpeg-bytes');
      expect((await get(server.port, '/api/local/qa-shot/local-demo/run-20261107-100000/missing.jpg')).status).toBe(404);
      // Anything that isn't run-folder/name.jpg is never read.
      expect((await get(server.port, '/api/local/qa-shot/local-demo/../secret.txt')).status).toBe(404);
      expect((await get(server.port, '/api/local/qa-shot/local-demo/run-20261107-100000/..%2F..%2Fsecret.jpg')).status).toBe(404);
      expect((await get(server.port, '/api/local/qa-shot/other-repo/run-20261107-100000/place-order-empty.jpg')).status).toBe(404);
    } finally {
      rmSync(qaDir, { recursive: true, force: true });
    }
  });
});

describe('QA runs from the page', () => {
  const live = () => {
    const started: unknown[] = [];
    let stopped = 0;
    return { started, stops: () => stopped, qa: { status: () => ({ state: 'idle' as const, checks: [], log: [] }), start: async (value: unknown) => void started.push(value), stop: () => void stopped++ } };
  };
  const post = (port: number, path: string, headers: Record<string, string>, body = '{"url":"http://localhost:3000","mode":"look"}') =>
    fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

  it('starts a run only with the page’s token, from the page’s own origin', async () => {
    const { qa, started, stops } = live();
    const server = await startLocalServer({ bundle, ui: (_request, response) => response.end('ui'), port: 0, qa });
    servers.push(server);
    const { token } = (await (await fetch(`${server.url}/api/local/qa-session/local-demo`)).json()) as { token: string };
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect((await post(server.port, '/api/local/qa-run/local-demo', {})).status).toBe(403);
    expect((await post(server.port, '/api/local/qa-run/local-demo', { 'x-codedna-token': 'nope' })).status).toBe(403);
    expect((await post(server.port, '/api/local/qa-run/local-demo', { 'x-codedna-token': token, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(server.port, '/api/local/qa-run/local-demo', { 'x-codedna-token': token, 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(server.port, '/api/local/qa-run/local-demo', { 'x-codedna-token': token }, 'not json')).status).toBe(400);
    expect(started).toEqual([]);
    expect((await post(server.port, '/api/local/qa-run/local-demo', { 'x-codedna-token': token, origin: server.url })).status).toBe(202);
    expect(started).toEqual([{ url: 'http://localhost:3000', mode: 'look' }]);
    expect((await post(server.port, '/api/local/qa-run/local-demo/stop', { 'x-codedna-token': token })).status).toBe(202);
    expect(stops()).toBe(1);
    expect((await get(server.port, '/api/local/qa-run/local-demo')).body).toContain('"state":"idle"');
  });

  it('changes journeys and the test account only with the page’s token, and never sends the password back', async () => {
    const { qa } = live();
    const saved: unknown[] = [];
    const project = {
      read: async () => ({ account: { email: 'qa@test.dev' } }),
      saveJourneys: async (value: unknown) => void saved.push(['journeys', value]),
      saveAccount: async (value: unknown) => ((value as { password?: string }).password === 'bad' ? 'Give the test account’s password.' : void saved.push(['account', value])),
    };
    const server = await startLocalServer({ bundle, ui: (_request, response) => response.end('ui'), port: 0, qa, project });
    servers.push(server);
    const { token } = (await (await fetch(`${server.url}/api/local/qa-session/local-demo`)).json()) as { token: string };
    const body = '{"email":"qa@test.dev","password":"secret"}';
    expect((await post(server.port, '/api/local/qa-account/local-demo', {}, body)).status).toBe(403);
    expect((await post(server.port, '/api/local/journeys/local-demo', { 'x-codedna-token': token, origin: 'https://evil.example' }, '{"version":1,"journeys":[]}')).status).toBe(403);
    expect(saved).toEqual([]);
    const ok = await post(server.port, '/api/local/qa-account/local-demo', { 'x-codedna-token': token }, body);
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain('secret');
    expect((await post(server.port, '/api/local/qa-account/local-demo', { 'x-codedna-token': token }, '{"email":"a","password":"bad"}')).status).toBe(400);
    expect((await post(server.port, '/api/local/journeys/local-demo', { 'x-codedna-token': token }, '{"version":1,"journeys":[]}')).status).toBe(200);
    expect(saved.map((item) => (item as string[])[0])).toEqual(['account', 'journeys']);
    expect((await get(server.port, '/api/local/journeys/local-demo')).body).toBe('{"account":{"email":"qa@test.dev"}}');
  });

  it('has no run endpoints when it serves without a runner', async () => {
    const server = await start();
    expect((await get(server.port, '/api/local/qa-session/local-demo')).status).toBe(404);
    expect((await get(server.port, '/api/local/qa-run/local-demo', { method: 'POST' })).status).toBe(405);
  });
});
