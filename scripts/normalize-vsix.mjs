import { readFile, writeFile } from 'node:fs/promises';
import { unzipSync, zipSync } from 'fflate';
const path = new URL('../apps/vscode/codedna.vsix', import.meta.url);
const files = unzipSync(await readFile(path));
const ordered = Object.fromEntries(
  Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);
// ZIP cannot represent dates before 1980. A fixed local calendar timestamp makes ZIP metadata stable across time zones.
const bytes = zipSync(ordered, {
  mtime: new Date(1980, 0, 2, 0, 0, 0),
  level: 9,
});
await writeFile(path, bytes);
console.log(`Normalized VSIX archive: ${bytes.length} bytes.`);
