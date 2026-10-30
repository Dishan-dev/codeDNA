import { acquireRepository, AcquisitionError } from '@codedna/github';
import {
  AnalysisWorkerError,
  runAnalysisWorker,
} from '../../../../lib/analysis-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
let active = 0;
const BODY_TIMEOUT_MS = 5000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const recentRequests: number[] = [];

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
  // There is no configured distributed limiter. Do not expose acquisition in production.
  if (process.env.NODE_ENV === 'production')
    return reply(
      {
        error: {
          code: 'unavailable',
          message:
            'Repository acquisition is not configured for public deployment.',
        },
      },
      503,
    );
  const now = Date.now();
  while (recentRequests.length && recentRequests[0]! <= now - RATE_WINDOW_MS)
    recentRequests.shift();
  if (recentRequests.length >= RATE_LIMIT)
    return reply(
      {
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Try again shortly.',
        },
      },
      429,
    );
  recentRequests.push(now);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('body_timeout')),
        BODY_TIMEOUT_MS,
      );
    });
    try {
      while (true) {
        const { value, done } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        size += value.length;
        if (size > 4096) {
          void reader.cancel().catch(() => {});
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
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (error instanceof Error && error.message === 'body_timeout')
        return reply(
          { error: { code: 'timeout', message: 'Request body timed out.' } },
          408,
        );
      return reply(
        {
          error: {
            code: 'invalid_request',
            message: 'Could not read request body.',
          },
        },
        400,
      );
    } finally {
      clearTimeout(timer);
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
    const { analysis, uiFlow } = await runAnalysisWorker(
      result.snapshot,
      request.signal,
    );
    return reply({ ...result, analysis, uiFlow }, 200);
  } catch (error) {
    if (error instanceof AnalysisWorkerError)
      return reply(
        {
          error: {
            code: error.code,
            message:
              error.code === 'timeout'
                ? 'Analysis timed out.'
                : error.code === 'cancelled'
                  ? 'Analysis cancelled.'
                  : 'Analysis failed.',
          },
        },
        error.code === 'timeout' ? 504 : error.code === 'cancelled' ? 499 : 500,
      );
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
