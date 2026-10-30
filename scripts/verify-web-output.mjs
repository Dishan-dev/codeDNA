import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
const root = process.cwd();
const next = resolve(root, 'apps/web/.next');
const traces = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.nft.json')) traces.push(path);
  }
}
await walk(join(next, 'server'));
if (!traces.length)
  throw new Error('No production server traces found. Run pnpm build first.');
let fileCount = 0;
for (const trace of traces) {
  const data = JSON.parse(await readFile(trace, 'utf8'));
  if (!Array.isArray(data.files)) throw new Error('Malformed production trace');
  for (const file of data.files) {
    const path = resolve(trace, '..', file);
    const rel = relative(root, path).split(sep).join('/');
    if (
      rel.startsWith('../') ||
      rel.includes('/node_modules/') ||
      rel.startsWith('node_modules/')
    )
      continue;
    if (
      /(?:^|\/)(?:tests|__tests__|host-fixture)(?:\/|$)/.test(rel) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel)
    )
      throw new Error(`Test source included in production trace: ${rel}`);
    fileCount++;
  }
}
console.log(
  `Checked ${traces.length} Next.js server traces (${fileCount} workspace entries): no test source files traced.`,
);
console.log(
  'This checks Next.js traces; it does not inspect a Vercel cloud build or prevent source checkout during builds.',
);
