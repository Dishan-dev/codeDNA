import type {
  DependencyGraph,
  DependencyEdge,
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
  edges: DependencyEdge[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export type DependencyQuestion = 'all' | 'direct' | 'uses' | 'dependents';
/** Filter only existing edges; the selected file remains visible even with no connections. */
export function graphForQuestion(
  graph: DependencyGraph,
  selectedId: string | null,
  question: DependencyQuestion,
): DependencyGraph {
  if (!selectedId || question === 'all') return graph;
  const edges = graph.edges.filter((edge) =>
    question === 'uses'
      ? edge.sourceId === selectedId
      : question === 'dependents'
        ? edge.targetId === selectedId
        : edge.sourceId === selectedId || edge.targetId === selectedId,
  );
  const ids = new Set([selectedId]);
  for (const edge of edges) {
    ids.add(edge.sourceId);
    ids.add(edge.targetId);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges,
  };
}
/** Show a folder and its direct neighbours, preserving only real source edges. */
export function graphForFolder(
  graph: DependencyGraph,
  path: string,
): DependencyGraph {
  if (!path) return graph;
  const members = new Set(
    graph.nodes
      .filter(
        (node) => node.kind !== 'external' && node.label.startsWith(`${path}/`),
      )
      .map((node) => node.id),
  );
  const visible = new Set(members);
  const edges = graph.edges.filter(
    (edge) => members.has(edge.sourceId) || members.has(edge.targetId),
  );
  for (const edge of edges) {
    visible.add(edge.sourceId);
    visible.add(edge.targetId);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges,
  };
}
export function graphForRootFiles(graph: DependencyGraph): DependencyGraph {
  const ids = new Set(
    graph.nodes
      .filter((node) => node.kind !== 'external' && !node.label.includes('/'))
      .map((node) => node.id),
  );
  const visible = new Set(ids);
  const edges = graph.edges.filter(
    (edge) => ids.has(edge.sourceId) || ids.has(edge.targetId),
  );
  for (const edge of edges) {
    visible.add(edge.sourceId);
    visible.add(edge.targetId);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges,
  };
}
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
      const value = links.get(key) ?? {
        path: otherPath,
        count: 0,
        direction,
        edges: [],
      };
      value.count++;
      value.edges.push(edge);
      links.set(key, value);
    }
  return {
    folders: [...folders.values()].sort((a, b) => compare(a.name, b.name)),
    files: files.sort((a, b) => compare(a.path, b.path)),
    connections: [...links.values()]
      .map((value) => ({
        ...value,
        edges: value.edges.sort((a, b) => compare(a.id, b.id)),
      }))
      .sort((a, b) =>
        compare(`${a.direction}:${a.path}`, `${b.direction}:${b.path}`),
      ),
  };
}
