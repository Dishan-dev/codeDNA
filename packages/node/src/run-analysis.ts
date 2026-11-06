import { Worker } from 'node:worker_threads';
import type { AnalyzeOptions } from '@codedna/core';
import type { RepoAnalysis } from '@codedna/shared';

export type AnalysisWorkerErrorCode = 'timeout' | 'cancelled' | 'invalid' | 'failed';
export class AnalysisWorkerError extends Error {
  constructor(
    readonly code: AnalysisWorkerErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'AnalysisWorkerError';
  }
}
export type WorkerReply = { ok: true; analysis: RepoAnalysis } | { ok: false; code: 'invalid' | 'failed'; message: string };

export interface RunAnalysisOptions extends Pick<AnalyzeOptions, 'limits' | 'timeBudgetMs'> {
  signal?: AbortSignal;
  /** Hard wall-clock limit for the worker, above the engine's own time budget. */
  timeoutMs?: number;
  /** Override for tests. */
  workerUrl?: URL;
}

/**
 * Run the analysis in a worker thread with bounded heap and time. A worker contains runaway
 * analysis; it is not an OS sandbox, and the engine never executes repository code anyway.
 */
export function runAnalysis(snapshot: unknown, options: RunAnalysisOptions = {}): Promise<RepoAnalysis> {
  const { signal, timeoutMs = 30_000, workerUrl = new URL('./worker.js', import.meta.url), limits, timeBudgetMs } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AnalysisWorkerError('cancelled'));
    const worker = new Worker(workerUrl, {
      workerData: { snapshot, options: { ...(limits ? { limits } : {}), ...(timeBudgetMs ? { timeBudgetMs } : {}) } },
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let finished = false;
    const finish = (error?: AnalysisWorkerError, analysis?: RepoAnalysis) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (analysis) resolve(analysis);
      else reject(error ?? new AnalysisWorkerError('failed'));
    };
    const abort = () => finish(new AnalysisWorkerError('cancelled'));
    const timer = setTimeout(() => finish(new AnalysisWorkerError('timeout', 'Analysis took too long.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (reply: WorkerReply) => (reply.ok ? finish(undefined, reply.analysis) : finish(new AnalysisWorkerError(reply.code, reply.message))));
    worker.once('error', () => finish(new AnalysisWorkerError('failed', 'Analysis failed.')));
    worker.once('exit', () => finish(new AnalysisWorkerError('failed', 'Analysis stopped unexpectedly.')));
  });
}
