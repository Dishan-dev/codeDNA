import type { AnalysisResult, RepositorySnapshot } from '@codedna/shared';

/** Phase 1 placeholder: accepts a snapshot but performs no analysis. */
export function analyzeSnapshot(snapshot: RepositorySnapshot): AnalysisResult {
  return {
    schemaVersion: '1.0',
    snapshotId: snapshot.id,
    diagnostics: [],
    dependencyGraph: { schemaVersion: '1.0', nodes: [], edges: [] },
    uiFlowGraph: { schemaVersion: '1.0', nodes: [], edges: [] },
  };
}
