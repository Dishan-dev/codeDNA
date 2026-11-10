import { describe, expect, it } from 'vitest';
import { authorizeUrl, exchangeCode, githubAppConfig, packState, safeReturnPath, sameState, unpackState } from './github-auth';

const config = { clientId: 'Iv23liabc', clientSecret: 'secret', slug: 'codedna-qa' };

describe('Connect GitHub', () => {
  it('is on only when the app is fully set up', () => {
    expect(githubAppConfig({})).toBeUndefined();
    expect(githubAppConfig({ GITHUB_APP_CLIENT_ID: 'a', GITHUB_APP_CLIENT_SECRET: 'b' })).toBeUndefined();
    expect(githubAppConfig({ GITHUB_APP_CLIENT_ID: 'a', GITHUB_APP_CLIENT_SECRET: 'b', GITHUB_APP_SLUG: 'bad slug/..' })).toBeUndefined();
    expect(githubAppConfig({ GITHUB_APP_CLIENT_ID: ' a ', GITHUB_APP_CLIENT_SECRET: 'b', GITHUB_APP_SLUG: 'codedna-qa' })).toEqual({ clientId: 'a', clientSecret: 'b', slug: 'codedna-qa' });
  });

  it('only returns to this site’s repo pages, and checks the state', () => {
    expect(safeReturnPath('/r/gh-acme-shop/qa')).toBe('/r/gh-acme-shop/qa');
    for (const bad of ['https://evil.example', '//evil.example', '/r/../x', '/api/github/auth/start', null]) expect(safeReturnPath(bad)).toBe('/projects');
    expect(unpackState(packState('abc', '/r/gh-acme-shop/qa'))).toEqual({ state: 'abc', returnTo: '/r/gh-acme-shop/qa' });
    expect(unpackState(packState('abc', 'https://evil.example'))).toEqual({ state: 'abc', returnTo: '/projects' });
    expect(unpackState('nodot')).toBeUndefined();
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'abcd')).toBe(false);
    const url = new URL(authorizeUrl(config, 'https://codedna.example/api/github/auth/callback', 'xyz'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'Iv23liabc', state: 'xyz', redirect_uri: 'https://codedna.example/api/github/auth/callback' });
  });

  it('swaps the code for a user token', async () => {
    let sent: Record<string, string> = {};
    const ok = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, string>;
      return Response.json({ access_token: 'ghu_abcdefghijklmnopqrstuvwxyz', expires_in: 28800 });
    }) as typeof fetch;
    expect(await exchangeCode(config, 'code1', 'https://codedna.example/cb', ok)).toEqual({ token: 'ghu_abcdefghijklmnopqrstuvwxyz', expiresIn: 28800 });
    expect(sent).toMatchObject({ client_id: 'Iv23liabc', client_secret: 'secret', code: 'code1' });
    const bad = (async () => Response.json({ error: 'bad_verification_code' })) as typeof fetch;
    await expect(exchangeCode(config, 'code1', 'https://codedna.example/cb', bad)).rejects.toThrow('bad_verification_code');
  });
});
