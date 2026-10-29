import type { AnalysisResult, RepositorySnapshot } from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
export const SESSION_KEY = 'codedna.repository-session.v1';
export interface ExplorerSession {
  snapshot: RepositorySnapshot;
  result: AnalysisResult;
  uiFlow: UIFlowAnalysis;
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
