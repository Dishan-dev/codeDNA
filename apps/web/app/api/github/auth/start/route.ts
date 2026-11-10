import { STATE_COOKIE, authorizeUrl, githubAppConfig, newState, packState, safeReturnPath } from '@/lib/server/github-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?return=/r/<repo>/qa → GitHub's "Authorize CodeDNA" page. */
export function GET(request: Request) {
  const config = githubAppConfig();
  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get('return'));
  if (!config) return Response.redirect(new URL(`${returnTo}#codedna-github-error=off`, url.origin), 302);
  const state = newState();
  const target = authorizeUrl(config, `${url.origin}/api/github/auth/callback`, state);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store',
      'Set-Cookie': `${STATE_COOKIE}=${packState(state, returnTo)}; Path=/api/github/auth; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
    },
  });
}
