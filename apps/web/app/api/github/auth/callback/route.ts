import { STATE_COOKIE, exchangeCode, githubAppConfig, sameState, unpackState } from '@/lib/server/github-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/**
 * GitHub sends the visitor back here after "Authorize". The state must match the cookie set when
 * they left; the token then goes to their browser in the address fragment, and nowhere else.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const saved = unpackState(cookieOf(request, STATE_COOKIE));
  const returnTo = saved?.returnTo ?? '/projects';
  const back = (fragment: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: new URL(`${returnTo}#${fragment}`, url.origin).toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `${STATE_COOKIE}=; Path=/api/github/auth; HttpOnly; SameSite=Lax; Max-Age=0`,
      },
    });
  const config = githubAppConfig();
  if (!config) return back('codedna-github-error=off');
  if (url.searchParams.get('error')) return back('codedna-github-error=denied');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!saved || !code || !state || !sameState(state, saved.state)) return back('codedna-github-error=expired');
  try {
    const { token, expiresIn } = await exchangeCode(config, code, `${url.origin}/api/github/auth/callback`);
    return back(`codedna-github=${token}${expiresIn ? `&expires=${expiresIn}` : ''}`);
  } catch (error) {
    console.error('[github-auth]', error instanceof Error ? error.message : 'unknown error');
    return back('codedna-github-error=failed');
  }
}
