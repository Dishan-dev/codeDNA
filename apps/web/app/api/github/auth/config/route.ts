import { githubAppConfig } from '@/lib/server/github-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Whether "Connect GitHub" is set up on this server, and where to install the app on a repo. */
export function GET() {
  const config = githubAppConfig();
  return Response.json(config ? { enabled: true, installUrl: `https://github.com/apps/${config.slug}/installations/new` } : { enabled: false }, { headers: { 'Cache-Control': 'no-store' } });
}
