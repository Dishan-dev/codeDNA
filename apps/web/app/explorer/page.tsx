import { analyzeSnapshot } from '@codedna/core';
import { runUIFlowStage } from '@codedna/core/ui-flow-stage';
import { understandRepository } from '@codedna/core/understanding';
import { discoverFeatures } from '@codedna/core/features';
import { analyzeActions } from '@codedna/core/actions';
import type { RepositorySnapshot } from '@codedna/shared';
import { ExplorerSessionLoader } from '@/components/explorer-session-loader';
import { exampleSnapshot } from '@/lib/example';
import type { ExplorerSession } from '@/lib/explorer-session';
import nextFixture from '../../../../packages/core/fixtures/next-app-router.snapshot.json';
import actionsFixture from '../../../../packages/core/fixtures/next-actions-app.snapshot.json';
const createExample = (
  snapshot: RepositorySnapshot,
  repositoryName: string,
  completeness: ExplorerSession['completeness'] = { complete: true, skippedFiles: 0 },
): ExplorerSession => {
  const result = analyzeSnapshot(snapshot), uiFlow = runUIFlowStage(snapshot);
  const complete = completeness.complete;
  return { snapshot, result, uiFlow, understanding: understandRepository(snapshot, result, uiFlow.graph, complete), features: discoverFeatures(snapshot, result, uiFlow.graph, complete), actions: analyzeActions(snapshot, result, uiFlow.graph, { complete }), repositoryName, completeness, acquisitionDiagnostics: [], source: 'sample' };
};
const example = createExample(exampleSnapshot, 'example-repository');
const nextExample = createExample(
  nextFixture as RepositorySnapshot,
  'next-app-router-example',
);
const roomly = actionsFixture as RepositorySnapshot;
const actionsExample = createExample(roomly, 'roomly');
/** The same fixture with one component left out, as a truncated import would leave it. */
const partialExample = createExample(
  { ...roomly, id: `${roomly.id}-partial`, files: roomly.files.filter((file) => file.path !== 'components/room-list.tsx') },
  'roomly',
  { complete: false, skippedFiles: 1 },
);
const samples: Record<string, ExplorerSession> = { next: nextExample, roomly: actionsExample, 'roomly-partial': partialExample };
export default async function ExplorerPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; example?: string }>;
}) {
  const query = await searchParams;
  return (
    <ExplorerSessionLoader
      source={query.source === 'github' ? 'github' : 'sample'}
      sample={query.example && Object.hasOwn(samples, query.example) ? samples[query.example]! : example}
    />
  );
}
