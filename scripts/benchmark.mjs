import { performance } from 'node:perf_hooks';
import { cpus, platform, release, totalmem } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  analyzeSnapshot,
  analyzeUIFlows,
  analyzeImpact,
  generateLearningPlan,
} from '../packages/core/dist/index.js';

const round = (n) => Math.round(n * 100) / 100;
const measure = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: round(performance.now() - start) };
};
const snapshotFor = (size) => ({
  schemaVersion: '1.0',
  id: `benchmark-${size}`,
  files: Array.from({ length: size }, (_, i) => ({
    id: `app/route${i}/page.tsx`,
    path: `app/route${i}/page.tsx`,
    content: `import Link from 'next/link'; ${i ? `import Previous from '../route${i - 1}/page';` : ''} export default function Page(){return <Link href="/route${(i + 1) % size}">next</Link>}`,
  })),
});
async function worker(snapshot) {
  const start = performance.now();
  const value = await new Promise((resolve, reject) => {
    const w = new Worker(
      new URL('../apps/web/workers/analysis.mjs', import.meta.url),
      {
        workerData: snapshot,
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      },
    );
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error('worker timeout'));
    }, 15000);
    w.once('message', (value) => {
      clearTimeout(timer);
      void w.terminate();
      value.error ? reject(new Error('worker failure')) : resolve(value);
    });
    w.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return {
    ms: round(performance.now() - start),
    payloadBytes: Buffer.byteLength(JSON.stringify(value)),
  };
}
const output = {
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    systemMemoryMiB: round(totalmem() / 1048576),
  },
  caveat:
    'Single run; no warmup or baseline. Memory is process RSS sampled after each run, not peak or worker-only. 2000 files exceeds acquisition limit but is within core limits. No browser rendering measured.',
  results: [],
};
for (const size of [100, 500, 2000]) {
  const created = measure(() => snapshotFor(size));
  const dependency = measure(() => analyzeSnapshot(created.value));
  const flow = measure(() => analyzeUIFlows(created.value));
  const impact = measure(() =>
    analyzeImpact(dependency.value, 'app/route0/page.tsx', {
      uiFlowGraph: flow.value.graph,
    }),
  );
  const learning = measure(() =>
    generateLearningPlan(dependency.value, flow.value.graph),
  );
  const entry = {
    files: size,
    snapshotMs: created.ms,
    dependencyMs: dependency.ms,
    uiFlowMs: flow.ms,
    impactMs: impact.ms,
    learningMs: learning.ms,
    rssMiB: round(process.memoryUsage().rss / 1048576),
    inputBytes: Buffer.byteLength(JSON.stringify(created.value)),
    transferBytes: Buffer.byteLength(
      JSON.stringify({ analysis: dependency.value, uiFlow: flow.value }),
    ),
    impactFiles: impact.value.files.length,
  };
  if (size <= 500) {
    const start = performance.now();
    const workers = await Promise.all([
      worker(created.value),
      worker(created.value),
    ]);
    entry.concurrentWorkers = {
      wallMs: round(performance.now() - start),
      workers,
    };
  }
  output.results.push(entry);
}
console.log(JSON.stringify(output, null, 2));
