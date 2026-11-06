import { githubImporter } from '@/lib/server/github-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The lesson bundle of an imported repo, while this server still has it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await githubImporter.load(id);
  if (!bundle) return Response.json({ error: { code: 'not_found', message: 'This repo isn’t imported on this server.' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(bundle, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
