import { analyzeSnapshot, analyzeUIFlows } from '@codedna/core';
import type { RepositorySnapshot } from '@codedna/shared';
import { ExplorerSessionLoader } from '@/components/explorer-session-loader';
import { exampleSnapshot } from '@/lib/example';
import type { ExplorerSession } from '@/lib/explorer-session';
import nextFixture from '../../../../packages/core/fixtures/next-app-router.snapshot.json';
const createExample = (
  snapshot: RepositorySnapshot,
  repositoryName: string,
): ExplorerSession => ({
  snapshot,
  result: analyzeSnapshot(snapshot),
  uiFlow: analyzeUIFlows(snapshot),
  repositoryName,
  completeness: { complete: true, skippedFiles: 0 },
  acquisitionDiagnostics: [],
  source: 'sample',
});
const example = createExample(exampleSnapshot, 'example-repository');
const nextExample = createExample(
  nextFixture as RepositorySnapshot,
  'next-app-router-example',
);
export default async function ExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; example?: string }>;
}) {
  const query = await searchParams;
  return (
    <ExplorerSessionLoader
      source={query.source === 'github' ? 'github' : 'sample'}
      sample={query.example === 'next' ? nextExample : example}
    />
  );
}
