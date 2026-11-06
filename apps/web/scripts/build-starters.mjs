// Builds the starter repos' learning bundles ahead of time, so the first experience is instant.
// Reads curated example apps from disk and analyses them with the same engine the CLI uses.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeRepository, buildRepoBundle } from '@codedna/core';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'starters');
const STARTERS = [{ id: 'snackshop', folder: join(here, '..', '..', '..', 'packages', 'core', 'fixtures', 'shop-app') }];

function snapshot(id, root) {
  const paths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else paths.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  paths.sort();
  const read = (path) => readFileSync(join(root, path), 'utf8');
  return {
    schemaVersion: '1.0',
    id: `starter:${id}`,
    revision: 'starter',
    files: paths.filter((path) => !/(?:^|\/)(?:package\.json|README\.md)$/.test(path)).map((path) => ({ id: path, path, content: read(path) })),
    manifests: paths.filter((path) => path.endsWith('package.json')).map((path) => ({ path, content: read(path) })),
    documents: paths.filter((path) => path.endsWith('README.md')).map((path) => ({ path, content: read(path) })),
  };
}

mkdirSync(out, { recursive: true });
const index = [];
for (const starter of STARTERS) {
  const bundle = buildRepoBundle(starter.id, analyzeRepository(snapshot(starter.id, starter.folder)), 'starter');
  writeFileSync(join(out, `${starter.id}.json`), JSON.stringify(bundle));
  index.push({ id: bundle.id, name: bundle.name, sentence: bundle.plan.summary.sentence, lessons: bundle.plan.path.length, framework: bundle.framework.label });
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index));
console.log(`Built ${index.length} starter repo${index.length === 1 ? '' : 's'}: ${index.map((item) => item.id).join(', ')}`);
