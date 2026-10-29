import { acquireRepository, AcquisitionError } from '@codedna/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
let active = 0;
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};
function reply(body: unknown, status: number) {
  return Response.json(body, { status, headers });
}
const statuses: Record<string, number> = {
  invalid_url: 400,
  not_found: 404,
  private_repository: 404,
  rate_limited: 429,
  limit_exceeded: 413,
  timeout: 504,
  cancelled: 499,
  truncated_tree: 422,
  invalid_response: 502,
  upstream_error: 502,
};
export async function POST(request: Request) {
  if (active >= 2)
    return reply(
      {
        error: {
          code: 'busy',
          message: 'The acquisition service is busy. Try again shortly.',
        },
      },
      503,
    );
  active++;
  try {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return reply(
        {
          error: {
            code: 'invalid_request',
            message: 'Expected a JSON request.',
          },
        },
        415,
      );
    if (!request.body)
      return reply(
        {
          error: {
            code: 'invalid_request',
            message: 'Expected a repository URL.',
          },
        },
        400,
      );
    const reader = request.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return reply(
          {
            error: {
              code: 'invalid_request',
              message: 'Request is too large.',
            },
          },
          413,
        );
      }
      chunks.push(value);
    }
    let data: unknown;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return reply(
        { error: { code: 'invalid_request', message: 'Expected valid JSON.' } },
        400,
      );
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      typeof (data as { url?: unknown }).url !== 'string'
    )
      return reply(
        {
          error: {
            code: 'invalid_request',
            message: 'Expected a repository URL.',
          },
        },
        400,
      );
    const token = process.env.GITHUB_TOKEN;
    const result = await acquireRepository((data as { url: string }).url, {
      ...(token ? { token } : {}),
      signal: request.signal,
    });
    return reply(result, 200);
  } catch (error) {
    if (error instanceof AcquisitionError)
      return reply(
        {
          error: {
            code: error.code,
            message:
              error.code === 'private_repository'
                ? 'The public repository was not found.'
                : error.message,
          },
        },
        statuses[error.code] ?? 502,
      );
    return reply(
      {
        error: {
          code: 'internal_error',
          message: 'Repository acquisition failed.',
        },
      },
      500,
    );
  } finally {
    active--;
  }
}
