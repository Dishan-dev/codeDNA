import type { SourceFile } from '@codedna/shared';
export interface FileTreeNode {
  name: string;
  path: string;
  folders: FileTreeNode[];
  files: SourceFile[];
}
export function buildFileTree(files: SourceFile[]): FileTreeNode {
  type Mutable = {
    name: string;
    path: string;
    folders: Map<string, Mutable>;
    files: SourceFile[];
  };
  const root: Mutable = { name: '', path: '', folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      let child = folder.folders.get(part);
      if (!child) {
        child = {
          name: part,
          path: folder.path ? `${folder.path}/${part}` : part,
          folders: new Map(),
          files: [],
        };
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.files.push(file);
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const finish = (folder: Mutable): FileTreeNode => ({
    name: folder.name,
    path: folder.path,
    folders: [...folder.folders.values()]
      .sort((a, b) => compare(a.name, b.name))
      .map(finish),
    files: folder.files.sort((a, b) => compare(a.path, b.path)),
  });
  return finish(root);
}
