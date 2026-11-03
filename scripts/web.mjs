// Runs the web app with plain npm (no pnpm or turbo needed): `npm run dev` or `npm start`.
// Builds the workspace packages the app imports from dist, then runs Next.js in apps/web.
// Extra arguments go to Next.js, e.g. `npm start -- -p 3001`.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const mode = process.argv[2];
const extra = process.argv.slice(3);
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: node scripts/web.mjs <dev|start> [next options]');
  process.exit(1);
}

const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
const next = createRequire(join(web, 'package.json')).resolve('next/dist/bin/next');

function run(label, script, args, cwd) {
  console.log(`> ${label}`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// shared first: the other packages import its types.
for (const name of ['shared', 'core', 'github', 'graph-ui']) {
  run(`build packages/${name}`, tsc, ['-p', 'tsconfig.json'], join(root, 'packages', name));
}
if (mode === 'start') run('next build', next, ['build'], web);
run(`next ${mode}`, next, [mode, ...extra], web);
