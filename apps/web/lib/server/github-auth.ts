import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * "Connect GitHub" for the hosted QA flows page, through the CodeDNA GitHub App. The visitor
 * approves the app on GitHub and comes back with a short-lived user token (8 hours) that can only
 * reach repos where the app is installed, and only their Actions. The token is handed to the
 * visitor's browser in the address fragment (never sent to a server again by the browser) and is
 * not kept on this server.
 *
 * Settings: GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET and GITHUB_APP_SLUG (the app's name
 * in its github.com/apps/<slug> address). Without them the page falls back to a pasted token.
 */
export interface GithubAppConfig {
  clientId: string;
  clientSecret: string;
  slug: string;
}

export function githubAppConfig(env: Record<string, string | undefined> = process.env): GithubAppConfig | undefined {
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  const slug = env.GITHUB_APP_SLUG?.trim();
  if (!clientId || !clientSecret || !slug || !/^[a-z0-9-]{1,100}$/i.test(slug)) return undefined;
  return { clientId, clientSecret, slug };
}

export const STATE_COOKIE = 'codedna_gh_auth';

/** Where to come back to: only this site's own repo pages. */
export function safeReturnPath(value: string | null | undefined): string {
  return value && /^\/r\/[a-z0-9][a-z0-9-]{0,59}(\/[a-z0-9-]*)*$/.test(value) ? value : '/projects';
}

export function newState(): string {
  return randomBytes(18).toString('base64url');
}

export function authorizeUrl(config: GithubAppConfig, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, state, allow_signup: 'false' });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/** The cookie kept during the round trip: the state (against forged callbacks) and where to return. */
export const packState = (state: string, returnTo: string) => `${state}.${encodeURIComponent(returnTo)}`;
export function unpackState(cookie: string | undefined): { state: string; returnTo: string } | undefined {
  if (!cookie) return undefined;
  const dot = cookie.indexOf('.');
  if (dot <= 0) return undefined;
  try {
    return { state: cookie.slice(0, dot), returnTo: safeReturnPath(decodeURIComponent(cookie.slice(dot + 1))) };
  } catch {
    return undefined;
  }
}

export function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Swaps the one-time code from GitHub for the visitor's user token. */
export async function exchangeCode(config: GithubAppConfig, code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<{ token: string; expiresIn?: number }> {
  const response = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'CodeDNA' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
  if (!response.ok || typeof body.access_token !== 'string' || !/^[A-Za-z0-9_]{20,255}$/.test(body.access_token)) throw new Error(typeof body.error === 'string' ? body.error : 'exchange_failed');
  return { token: body.access_token, ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}) };
}
