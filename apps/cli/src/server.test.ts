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
