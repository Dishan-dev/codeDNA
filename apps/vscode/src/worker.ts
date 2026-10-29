import { parentPort, workerData } from 'node:worker_threads';
import {
  analyzeSnapshot,
  analyzeUIFlows,
  generateLearningPlan,
} from '@codedna/core';
import type { LocalSnapshot } from './snapshot.js';
try {
  const input = workerData as LocalSnapshot;
  const result = analyzeSnapshot(input.snapshot);
  const uiFlow = analyzeUIFlows(input.snapshot);
  const learning = generateLearningPlan(result, uiFlow.graph, {
    uiFlowDiagnostics: uiFlow.diagnostics,
    snapshotComplete: input.complete,
  });
  parentPort?.postMessage({ result, uiFlow, learning });
} catch (error) {
  parentPort?.postMessage({
    error: error instanceof Error ? error.message : 'Analysis failed',
  });
}
