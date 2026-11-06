import { githubImporter, toImportError, type ImportEvent } from '@/lib/server/github-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = (code: string, message: string, status: number) => Response.json({ error: { code, message } }, { status, headers });

/** Who is asking, for the per-visitor limit. Behind a proxy the first forwarded address is used. */
function clientOf(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

/**
 * POST { url } → a stream of JSON lines: downloading → analysing → done { id } (or error).
 * Only this site's own pages may start an import.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return fail('forbidden', 'Imports can only be started from CodeDNA itself.', 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return fail('bad_request', 'Send the repo link as JSON.', 400);
  const text = await request.text();
  if (text.length > 2048) return fail('bad_request', 'That request is too large.', 413);
  let url: unknown;
  try {
    url = (JSON.parse(text) as { url?: unknown }).url;
  } catch {
    return fail('bad_request', 'Send the repo link as JSON.', 400);
  }

  let prepared: Awaited<ReturnType<typeof githubImporter.prepare>>;
  try {
    prepared = await githubImporter.prepare(url, clientOf(request));
  } catch (error) {
    const failure = toImportError(error);
    return fail(failure.code, failure.message, failure.status);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ImportEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        if (prepared.cachedId) send({ stage: 'done', id: prepared.cachedId, cached: true });
        else send({ stage: 'done', id: await githubImporter.run(prepared.identity, send, request.signal), cached: false });
      } catch (error) {
        const failure = toImportError(error);
        // Unexpected failures are logged on the server; visitors only see the friendly message.
        if (failure.status >= 500) console.error('[github-import]', error);
        send({ stage: 'error', code: failure.code, message: failure.message });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
}
