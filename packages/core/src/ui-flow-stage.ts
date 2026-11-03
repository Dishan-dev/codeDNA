import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeUIFlows, type UIFlowAnalysis } from './ui-flow/index.js';
import { SnapshotValidationError } from './validation.js';
/** Isolate recoverable route-analysis failures; snapshot validation and worker failures remain hard failures. */
export function runUIFlowStage(
  snapshot: RepositorySnapshot,
  analyzer: (snapshot: RepositorySnapshot) => UIFlowAnalysis = analyzeUIFlows,
): UIFlowAnalysis {
  try {
    return analyzer(snapshot);
  } catch (error) {
    if (error instanceof SnapshotValidationError) throw error;
    return {
      graph: {
        schemaVersion: '1.0',
        nodes: [],
        edges: [],
        navigationEvents: [],
      },
      diagnostics: [
        {
          id: 'ui-stage-failed',
          code: 'ui-stage-failed',
          severity: 'error',
          message:
            'UI flow analysis could not complete. Dependency analysis may still be available.',
        },
      ],
    };
  }
}
