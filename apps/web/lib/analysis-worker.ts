import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { RepositorySnapshot, AnalysisResult } from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';

type Result = { analysis: AnalysisResult; uiFlow: UIFlowAnalysis };
export class AnalysisWorkerError extends Error {
  constructor(readonly code: 'timeout' | 'cancelled' | 'failed') {
    super(code);
  }
}
/** A worker bounds JS heap and time; it is not an OS security sandbox. */
export function runAnalysisWorker(
  snapshot: RepositorySnapshot,
  signal: AbortSignal,
  options: { timeoutMs?: number; workerPath?: string } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AnalysisWorkerError('cancelled'));
    const worker = new Worker(
      options.workerPath ?? join(process.cwd(), 'workers', 'analysis.mjs'),
      {
        workerData: snapshot,
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      },
    );
    let finished = false;
    const finish = (error?: AnalysisWorkerError, value?: Result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else if (value) resolve(value);
      else reject(new AnalysisWorkerError('failed'));
    };
    const abort = () => finish(new AnalysisWorkerError('cancelled'));
    const timer = setTimeout(
      () => finish(new AnalysisWorkerError('timeout')),
      options.timeoutMs ?? 15000,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    worker.once('message', (message: Result | { error: true }) => {
      if ('error' in message) finish(new AnalysisWorkerError('failed'));
      else finish(undefined, message);
    });
    worker.once('error', () => finish(new AnalysisWorkerError('failed')));
    worker.once('exit', () => finish(new AnalysisWorkerError('failed')));
  });
}
