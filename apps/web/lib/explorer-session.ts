import type { ActionIndex, AnalysisResult, RepositorySnapshot, RepositoryUnderstanding, FeatureDiscovery } from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
export const SESSION_KEY = 'codedna.repository-session.v1';
export interface ExplorerSession {
  snapshot: RepositorySnapshot;
  result: AnalysisResult;
  uiFlow: UIFlowAnalysis;
  understanding: RepositoryUnderstanding;
  features: FeatureDiscovery;
  /** Absent in sessions saved before page/action analysis existed. */
  actions?: ActionIndex;
  repositoryName: string;
  completeness: { complete: boolean; skippedFiles: number };
  acquisitionDiagnostics: { code: string; path: string; message: string }[];
  source: 'sample' | 'github';
}
export function screenForFile(
  path: string,
  uiFlow: UIFlowAnalysis,
): string | null {
  const matches = uiFlow.graph.nodes.filter((node) => node.sourceFile === path);
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Changing any identity component remounts the Explorer and scopes session progress. */
export function learningSessionKey(
  source: string,
  repository: string,
  snapshotId: string,
  revision?: string,
): string {
  return JSON.stringify([source, repository, snapshotId, revision ?? null]);
}
