import type {
  DependencyGraph,
  RepositorySnapshot,
  SourceFile,
} from '@codedna/shared';
export interface FolderItem {
  path: string;
  name: string;
  count: number;
}
export interface FolderConnection {
  path: string;
  count: number;
  direction: 'uses' | 'used-by';
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function folderView(
  snapshot: RepositorySnapshot,
  graph: DependencyGraph,
  path: string,
) {
  const prefix = path ? `${path}/` : '';
  const folders = new Map<string, FolderItem>();
  const files: SourceFile[] = [];
  for (const file of snapshot.files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length),
      slash = rest.indexOf('/');
    if (slash < 0) files.push(file);
    else {
      const name = rest.slice(0, slash),
        child = `${prefix}${name}`;
      const folder = folders.get(child) ?? { path: child, name, count: 0 };
      folder.count++;
      folders.set(child, folder);
    }
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = new Map<string, FolderConnection>();
  if (path)
    for (const edge of graph.edges) {
      const source = nodes.get(edge.sourceId),
        target = nodes.get(edge.targetId);
      if (!source || !target) continue;
      const sourceIn =
          source.kind !== 'external' && source.label.startsWith(prefix),
        targetIn =
          target.kind !== 'external' && target.label.startsWith(prefix);
      if (sourceIn === targetIn) continue;
      const other = sourceIn ? target : source;
      const otherPath =
        other.kind === 'external'
          ? `Package: ${other.label}`
          : other.label.includes('/')
            ? other.label.slice(0, other.label.lastIndexOf('/'))
            : 'Root files';
      const direction = sourceIn ? 'uses' : 'used-by',
        key = `${direction}:${otherPath}`;
      const value = links.get(key) ?? { path: otherPath, count: 0, direction };
      value.count++;
      links.set(key, value);
    }
  return {
    folders: [...folders.values()].sort((a, b) => compare(a.name, b.name)),
    files: files.sort((a, b) => compare(a.path, b.path)),
    connections: [...links.values()].sort((a, b) =>
      compare(`${a.direction}:${a.path}`, `${b.direction}:${b.path}`),
    ),
  };
}
