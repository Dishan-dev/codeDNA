import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { unzipSync, strFromU8 } from 'fflate';

const root = process.cwd();
const web = resolve(root, 'apps/web');
const vsixPath = resolve(root, 'apps/vscode/codedna.vsix');
const manifest = JSON.parse(
  await readFile(resolve(root, 'apps/vscode/package.json'), 'utf8'),
);
const changelog = await readFile(
  resolve(root, 'apps/vscode/CHANGELOG.md'),
  'utf8',
);
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
assert.ok(
  changelog.includes(`## [${manifest.version}]`),
  'changelog must contain extension version',
);
const archive = await readFile(vsixPath);
const entries = unzipSync(archive);
const allowed = (name) =>
  name === '[Content_Types].xml' ||
  name === 'extension.vsixmanifest' ||
  [
    'extension/package.json',
    'extension/readme.md',
    'extension/changelog.md',
    'extension/LICENSE',
  ].includes(name) ||
  /^extension\/dist\/[\w.-]+$/.test(name);
for (const name of Object.keys(entries))
  assert.ok(allowed(name), `Unexpected VSIX entry: ${name}`);
for (const name of [
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/dist/extension.cjs',
  'extension/dist/worker.cjs',
  'extension/dist/webview.js',
  'extension/dist/webview.css',
])
  assert.ok(entries[name], `Missing VSIX entry: ${name}`);
const packaged = JSON.parse(strFromU8(entries['extension/package.json']));
assert.equal(
  packaged.version,
  manifest.version,
  'VSIX manifest version mismatch',
);
assert.ok(
  strFromU8(entries['extension/changelog.md']).includes(
    `## [${manifest.version}]`,
  ),
  'VSIX changelog mismatch',
);
assert.ok(
  strFromU8(entries['extension.vsixmanifest']).includes(
    `Version="${manifest.version}"`,
  ),
  'VSIX version metadata mismatch',
);
for (const [name, bytes] of Object.entries(entries)) {
  if (!/\.(?:js|cjs|css|json|md|map|vsixmanifest|xml)$/i.test(name)) continue;
  const content = strFromU8(bytes);
  assert.ok(
    !/gh[pousr]_[A-Za-z0-9]{36,}/.test(content),
    `Potential credential in ${name}`,
  );
  assert.ok(
    !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content),
    `Potential private key in ${name}`,
  );
}
console.log(
  `VSIX: version ${manifest.version}, ${Object.keys(entries).length} entries, ${archive.length} bytes, sha256 ${createHash('sha256').update(archive).digest('hex')}`,
);

const snapshot = {
  schemaVersion: '1.0',
  id: 'release-check',
  files: [
    {
      id: 'app/page.tsx',
      path: 'app/page.tsx',
      content: 'export default function Page(){return null}',
    },
  ],
};
const workerResult = await new Promise((resolveResult, reject) => {
  const worker = new Worker(resolve(web, 'workers/analysis.mjs'), {
    workerData: snapshot,
    resourceLimits: {
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 32,
      stackSizeMb: 4,
    },
  });
  const timer = setTimeout(() => {
    void worker.terminate();
    reject(new Error('Worker smoke timed out'));
  }, 15000);
  worker.once('message', (value) => {
    clearTimeout(timer);
    void worker.terminate();
    resolveResult(value);
  });
  worker.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  worker.once('exit', (code) => {
    if (code !== 0) {
      clearTimeout(timer);
      reject(new Error(`Worker exited ${code}`));
    }
  });
});
assert.equal(
  workerResult.analysis?.snapshotId,
  snapshot.id,
  'worker entrypoint must analyze snapshot',
);
assert.equal(
  workerResult.uiFlow?.graph.nodes[0]?.routePath,
  '/',
  'worker UI analysis must resolve route',
);
console.log(
  'Worker entrypoint: passed against workspace installation (deployment packaging not verified).',
);

const probe = createServer();
await new Promise((resolveProbe, reject) =>
  probe.once('error', reject).listen(0, '127.0.0.1', resolveProbe),
);
const port = probe.address().port;
await new Promise((resolveProbe) => probe.close(resolveProbe));
const secret = `codedna-release-check-${randomUUID()}`;
const server = spawn(
  process.execPath,
  [
    resolve(web, 'node_modules/next/dist/bin/next'),
    'start',
    '-H',
    '127.0.0.1',
    '-p',
    String(port),
  ],
  {
    cwd: web,
    env: { ...process.env, NODE_ENV: 'production', GITHUB_TOKEN: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);
let logs = '';
server.stdout.on('data', (chunk) => {
  logs += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  logs += chunk.toString();
});
try {
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null)
      throw new Error('Production server exited before becoming healthy');
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        assert.deepEqual(await response.json(), {
          status: 'ok',
          mode: 'demo-only',
        });
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.ok(healthy, 'Production server did not start');
  const html = await (await fetch(base)).text();
  assert.ok(
    html.includes('Demo-only mode'),
    'Landing page must disclose demo-only mode',
  );
  assert.ok(!html.includes(secret), 'Secret leaked in landing HTML');
  const response = await fetch(`${base}/api/repositories/acquire`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://github.com/example/repo' }),
  });
  assert.equal(response.status, 503, 'Production acquisition must fail closed');
  assert.equal((await response.json()).error.code, 'unavailable');
  const explorer = await fetch(`${base}/explorer`);
  assert.equal(explorer.status, 200, 'Demo Explorer must load');
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if ((await readFile(path)).includes(Buffer.from(secret)))
        throw new Error('Secret leaked in client static assets');
    }
  }
  await scan(resolve(web, '.next/static'));
  assert.ok(!logs.includes(secret), 'Secret leaked in server startup logs');
  console.log(
    'Production startup, liveness, demo disclosure, Explorer, acquisition fail-closed and client-secret canary: passed.',
  );
} finally {
  server.kill();
  if (server.exitCode === null)
    await new Promise((resolveExit) => server.once('exit', resolveExit));
}
