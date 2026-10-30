import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const input = {
  complete: true,
  diagnostics: [],
  snapshot: {
    schemaVersion: '1.0',
    id: 'worker-smoke',
    revision: '1',
    files: [
      { id: 'a.ts', path: 'a.ts', content: "import './b'" },
      { id: 'b.ts', path: 'b.ts', content: 'export const b=1' },
    ],
  },
};
const result = await new Promise((resolveResult, reject) => {
  const worker = new Worker(resolve('dist/worker.cjs'), { workerData: input });
  worker.once('message', resolveResult);
  worker.once('error', reject);
  worker.once('exit', (code) => {
    if (code !== 0) reject(new Error(`Worker exited ${code}`));
  });
});
assert.equal(result.result.dependencyGraph.nodes.length, 2);
assert.equal(result.result.dependencyGraph.edges.length, 1);
assert.ok(result.learning.steps.length > 0);
process.stdout.write(
  'Worker smoke passed: two files, one dependency and a learning plan.\n',
);
