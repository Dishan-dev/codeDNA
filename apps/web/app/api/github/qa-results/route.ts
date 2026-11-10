import { GithubQaError, fetchGithubQaResults } from '@/lib/server/github-qa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (message: string, status: number) => Response.json({ error: { message } }, { status, headers });

/** A few downloads per visitor, so this server can't be used as a free download mirror. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 10 * 60_000;
const PER_VISITOR = 20;
function allowed(client: string): boolean {
  const now = Date.now();
  const times = (recent.get(client) ?? []).filter((time) => now - time < WINDOW_MS);
  if (times.length >= PER_VISITOR) return false;
  times.push(now);
  recent.set(client, times);
  if (recent.size > 5000) for (const [key, value] of recent) if (!value.some((time) => now - time < WINDOW_MS)) recent.delete(key);
  return true;
}

/**
 * POST { repo: "owner/name", runId } with the visitor's GitHub token in `x-github-token` →
 * { report, shots }: the results of a CodeDNA QA run on that repo's GitHub Actions.
 * Only this site's own pages may ask, and the token is used for this one request only.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return fail('Results can only be fetched from CodeDNA itself.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return fail('Send the run as JSON.', 400);
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  if (!allowed(client)) return fail('Too many downloads for now. Try again in a few minutes.', 429);
  const text = await request.text();
  if (text.length > 1024) return fail('That request is too large.', 413);
  let body: { repo?: unknown; runId?: unknown };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    return fail('Send the run as JSON.', 400);
  }
  try {
    const results = await fetchGithubQaResults({ repo: body.repo, runId: body.runId, token: request.headers.get('x-github-token') ?? undefined }, fetch, request.signal);
    return Response.json(results, { headers });
  } catch (error) {
    if (error instanceof GithubQaError) return fail(error.message, error.status);
    console.error('[github-qa]', error instanceof Error ? error.message : 'unknown error');
    return fail('The results couldn’t be fetched. Try again in a moment.', 500);
  }
}
