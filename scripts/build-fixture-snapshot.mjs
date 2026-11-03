// Builds packages/core/fixtures/<name>.snapshot.json from a fixture directory so the web sample
// can import it as JSON. A core test checks the JSON stays in sync with the directory.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const name = process.argv[2] ?? 'next-actions-app';
const root = resolve('packages/core/fixtures', name);
const files = [];
const documents = [];
const manifests = [];
async function walk(dir) {
  const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      const rel = relative(root, path).split(sep).join('/');
      const content = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
      if (/\.md$/i.test(rel)) documents.push({ path: rel, content });
      else if (rel.endsWith('package.json')) manifests.push({ path: rel, content });
      else files.push({ id: rel, path: rel, content });
    }
  }
}
await walk(root);
const snapshot = { schemaVersion: '1.0', id: `fixture-${name}`, files, documents, manifests };
await writeFile(resolve('packages/core/fixtures', `${name}.snapshot.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${files.length} files, ${documents.length} documents, ${manifests.length} manifests.`);
