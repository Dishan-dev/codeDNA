import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSnapshot, analyzeUIFlows } from '@codedna/core';
try {
  const analysis = analyzeSnapshot(workerData);
  const uiFlow = analyzeUIFlows(workerData);
  parentPort.postMessage({ analysis, uiFlow });
} catch {
  parentPort.postMessage({ error: true });
}
