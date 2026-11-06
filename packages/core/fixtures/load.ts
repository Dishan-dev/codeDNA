import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Test helper: read a fixture folder into a snapshot, the way the CLI would. */
export function loadFixture(name: string) {
  const root = join(import.meta.dirname, name);
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else paths.push(relative(root, full).split('\\').join('/'));
    }
  };
  walk(root);
  paths.sort();
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  return {
    schemaVersion: '1.0' as const,
    id: `fixture:${name}`,
    revision: 'fixture',
    files: paths.filter((path) => !/(?:^|\/)(?:package\.json|README\.md)$/.test(path)).map((path) => ({ id: path, path, content: read(path) })),
    manifests: paths.filter((path) => path.endsWith('package.json')).map((path) => ({ path, content: read(path) })),
    documents: paths.filter((path) => path.endsWith('README.md')).map((path) => ({ path, content: read(path) })),
  };
}
