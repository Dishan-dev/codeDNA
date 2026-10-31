import { describe, expect, it } from 'vitest';
import { buildFileTree } from './file-tree';
describe('repository file tree', () => {
  it('groups nested files in deterministic folders without losing root files', () => {
    const files = [
      { id: '2', path: 'src/app/page.tsx', content: '' },
      { id: '1', path: 'README.js', content: '' },
      { id: '3', path: 'src/app/layout.tsx', content: '' },
    ];
    const tree = buildFileTree(files);
    expect(tree.files.map((file) => file.path)).toEqual(['README.js']);
    expect(tree.folders[0]?.folders[0]?.files.map((file) => file.path)).toEqual(
      ['src/app/layout.tsx', 'src/app/page.tsx'],
    );
    expect(buildFileTree([...files].reverse())).toEqual(tree);
  });
});
