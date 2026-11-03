import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSnapshot } from '@codedna/core';
import { runUIFlowStage } from '@codedna/core/ui-flow-stage';
import { understandRepository } from '@codedna/core/understanding';
import { discoverFeatures } from '@codedna/core/features';
import { analyzeActions } from '@codedna/core/actions';
try {
  const { snapshot, complete } = workerData;
  const analysis = analyzeSnapshot(snapshot);
  const uiFlow = runUIFlowStage(snapshot);
  const understanding = understandRepository(snapshot, analysis, uiFlow.graph, complete);
  const features = discoverFeatures(snapshot, analysis, uiFlow.graph, complete);
  const actions = analyzeActions(snapshot, analysis, uiFlow.graph, { complete });
  parentPort.postMessage({ analysis, uiFlow, understanding, features, actions });
} catch {
  parentPort.postMessage({ error: true });
}
