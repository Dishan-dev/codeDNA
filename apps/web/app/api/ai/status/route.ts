import { readAiConfig } from '../../../../lib/ai-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reports availability only. Never includes credentials or the base URL. */
export async function GET() {
  return Response.json(readAiConfig().status, { headers: { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' } });
}
