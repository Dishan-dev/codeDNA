export const dynamic = 'force-dynamic';
/** Liveness only: does not attest to external services or deployment security. */
export function GET() {
  return Response.json(
    {
      status: 'ok',
      mode:
        process.env.NODE_ENV === 'production'
          ? 'demo-only'
          : 'local-development',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
