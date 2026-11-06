import { parentPort, workerData } from 'node:worker_threads';
import { analyzeRepository, SnapshotError, type AnalyzeOptions } from '@codedna/core';
import type { WorkerReply } from './run-analysis.js';

const { snapshot, options } = workerData as { snapshot: unknown; options: Pick<AnalyzeOptions, 'limits' | 'timeBudgetMs'> };
let reply: WorkerReply;
try {
  reply = { ok: true, analysis: analyzeRepository(snapshot, options) };
} catch (error) {
  reply = error instanceof SnapshotError ? { ok: false, code: 'invalid', message: error.message } : { ok: false, code: 'failed', message: 'Analysis failed.' };
}
parentPort?.postMessage(reply);
