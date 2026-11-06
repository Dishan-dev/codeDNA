import { describe, expect, it } from 'vitest';
import { AnalysisWorkerError, runAnalysis } from './run-analysis.js';

// The real worker runs from the build output (`pnpm test` builds first).
const workerUrl = new URL('../dist/worker.js', import.meta.url);
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const snapshot = {
  schemaVersion: '1.0',
  id: 'demo@1',
  files: [
    { id: 'app/page.tsx', path: 'app/page.tsx', content: "import { Form } from './form';\nexport default function Page() { return <Form />; }" },
    { id: 'app/form.tsx', path: 'app/form.tsx', content: 'export function Form() { return null; }' },
  ],
};
const failure = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error as AnalysisWorkerError);

describe('runAnalysis', () => {
  it('analyzes a snapshot in a worker thread', async () => {
    const analysis = await runAnalysis(snapshot, { workerUrl });
    expect(analysis.snapshotId).toBe('demo@1');
    expect(analysis.routes.map((route) => route.route)).toEqual(['/']);
    expect(analysis.imports[0]?.target).toBe('app/form.tsx');
  });

  it('reports a malformed snapshot as invalid', async () => {
    const error = await failure(runAnalysis({ id: 'x' }, { workerUrl }));
    expect(error).toMatchObject({ code: 'invalid', message: 'The snapshot needs a list of files.' });
  });

  it('times out a worker that never answers', async () => {
    const error = await failure(runAnalysis(snapshot, { workerUrl: fixture('hang-worker.mjs'), timeoutMs: 200 }));
    expect(error?.code).toBe('timeout');
  });

  it('cancels on abort, before or during the run', async () => {
    const early = new AbortController();
    early.abort();
    expect((await failure(runAnalysis(snapshot, { workerUrl, signal: early.signal })))?.code).toBe('cancelled');
    const late = new AbortController();
    const pending = failure(runAnalysis(snapshot, { workerUrl: fixture('hang-worker.mjs'), signal: late.signal }));
    setTimeout(() => late.abort(), 50);
    expect((await pending)?.code).toBe('cancelled');
  });

  it('turns a crashing worker into a failure', async () => {
    const error = await failure(runAnalysis(snapshot, { workerUrl: fixture('crash-worker.mjs') }));
    expect(error?.code).toBe('failed');
  });
});
