import { describe, expect, it } from 'vitest';
import { checkSetup, dispatchRun, findRun, tokenLink } from './github-qa';

const token = 'github_pat_abcdefghijklmnopqrstuvwxyz';
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fake = (handler: Handler) => (async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch;

describe('running QA on GitHub from the page', () => {
  it('checks the token, the repo and the workflow', async () => {
    const ready = fake((url) => (url.endsWith('/repos/acme/shop') ? Response.json({ default_branch: 'trunk' }) : Response.json({ state: 'active' })));
    expect(await checkSetup('acme/shop', token, ready)).toEqual({ branch: 'trunk' });

    const missing = fake((url) => (url.endsWith('/repos/acme/shop') ? Response.json({ default_branch: 'main' }) : new Response('', { status: 404 })));
    expect(await checkSetup('acme/shop', token, missing)).toEqual({ missing: true });

    await expect(checkSetup('acme/shop', token, fake(() => new Response('', { status: 401 })))).rejects.toMatchObject({ status: 401 });
    await expect(checkSetup('acme/shop', token, fake(() => new Response('', { status: 404 })))).rejects.toThrow(/can’t see acme\/shop/);
    const off = fake((url) => (url.endsWith('/repos/acme/shop') ? Response.json({}) : Response.json({ state: 'disabled_manually' })));
    await expect(checkSetup('acme/shop', token, off)).rejects.toThrow(/turned off/);
  });

  it('starts the workflow, and falls back for workflows made before the run mark', async () => {
    const bodies: unknown[] = [];
    const modern = fake((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    });
    expect(await dispatchRun('acme/shop', token, { branch: 'main', url: 'https://shop.example.com', interact: true, request: '#abc' }, modern)).toEqual({ marked: true });
    expect(bodies[0]).toEqual({ ref: 'main', inputs: { url: 'https://shop.example.com', interact: 'true', request: '#abc' } });

    const sent: unknown[] = [];
    const old = fake((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { inputs: Record<string, string> };
      sent.push(body);
      return body.inputs.request ? Response.json({ message: 'Unexpected inputs provided: ["request"]' }, { status: 422 }) : new Response(null, { status: 204 });
    });
    expect(await dispatchRun('acme/shop', token, { branch: 'main', url: 'https://shop.example.com', interact: false, request: '#abc' }, old)).toEqual({ marked: false });
    expect(sent).toHaveLength(2);

    await expect(dispatchRun('acme/shop', token, { branch: 'main', url: 'https://x.dev', interact: false, request: '#a' }, fake(() => new Response('', { status: 403 })))).rejects.toThrow(/Actions: Read and write/);
  });

  it('finds the run it started', async () => {
    const runs = fake(() =>
      Response.json({
        workflow_runs: [
          { id: 3, display_title: 'CodeDNA QA #other', status: 'queued', created_at: '2026-11-08T10:00:09Z', html_url: 'https://github.com/acme/shop/actions/runs/3' },
          { id: 2, display_title: 'CodeDNA QA #abc', status: 'in_progress', created_at: '2026-11-08T10:00:05Z', html_url: 'https://github.com/acme/shop/actions/runs/2' },
          { id: 1, display_title: 'CodeDNA QA', status: 'completed', conclusion: 'success', created_at: '2026-11-08T09:00:00Z', html_url: 'https://github.com/acme/shop/actions/runs/1' },
        ],
      }),
    );
    const since = Date.parse('2026-11-08T10:00:00Z');
    expect(await findRun('acme/shop', token, { request: '#abc', since, marked: true }, runs)).toMatchObject({ id: 2, status: 'in_progress' });
    expect(await findRun('acme/shop', token, { request: '#nope', since, marked: true }, runs)).toBeUndefined();
    // Without the mark: the first run started after the button was pressed.
    expect(await findRun('acme/shop', token, { request: '#abc', since, marked: false }, runs)).toMatchObject({ id: 2 });
  });

  it('links to a token form limited to the repo’s owner and Actions', () => {
    const link = new URL(tokenLink('acme/shop'));
    expect(link.origin + link.pathname).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(link.searchParams.get('target_name')).toBe('acme');
    expect(link.searchParams.get('actions')).toBe('write');
  });
});
