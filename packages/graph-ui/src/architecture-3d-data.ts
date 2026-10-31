import type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
} from '@codedna/shared';
export const MAX_3D_NODES = 500;
export const MAX_3D_EDGES = 2000;
export type SceneNode = {
  id: string;
  label: string;
  position: [number, number, number];
  kind: 'folder' | 'file' | 'external';
  count: number;
  source?: DependencyNode;
  folder: string;
};
export type SceneEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  evidence: DependencyEdge[];
};
export interface SceneGraph {
  nodes: SceneNode[];
  edges: SceneEdge[];
  folders: string[];
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function canRender3D(graph: DependencyGraph): boolean {
  return (
    graph.nodes.length <= MAX_3D_NODES && graph.edges.length <= MAX_3D_EDGES
  );
}
export function folderOf(node: DependencyNode): string {
  if (node.kind === 'external') return 'External packages';
  const parts = node.label.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root files';
}
/** Positions depend on sorted path and IDs, never on input iteration order. */
export function buildSceneGraph(
  graph: DependencyGraph,
  expanded: ReadonlySet<string>,
): SceneGraph {
  const groups = new Map<string, DependencyNode[]>();
  for (const node of graph.nodes) {
    const folder = folderOf(node);
    const list = groups.get(folder) ?? [];
    list.push(node);
    groups.set(folder, list);
  }
  const folders = [...groups.keys()].sort(cmp),
    columns = Math.max(1, Math.ceil(Math.sqrt(folders.length)));
  const nodes: SceneNode[] = [],
    membership = new Map<string, string>();
  const spacing = Math.max(
    10,
    ...[...groups.values()].map(
      (items) => Math.ceil(Math.sqrt(items.length)) * 1.7 + 4,
    ),
  );
  for (const [i, folder] of folders.entries()) {
    const files = groups.get(folder)!.sort((a, b) => cmp(a.id, b.id)),
      x = (i % columns) * spacing,
      z = Math.floor(i / columns) * spacing;
    const id = `cluster:${encodeURIComponent(folder)}`;
    if (!expanded.has(folder)) {
      nodes.push({
        id,
        label: folder,
        position: [x, 0, z],
        kind: 'folder',
        count: files.length,
        folder,
      });
      for (const file of files) membership.set(file.id, id);
    } else
      for (const [j, file] of files.entries()) {
        const width = Math.max(1, Math.ceil(Math.sqrt(files.length))),
          row = Math.floor(j / width),
          column = j % width;
        nodes.push({
          id: file.id,
          label: file.label,
          position: [
            x + (column - (width - 1) / 2) * 1.7,
            0.5 + Math.floor(j / 100) * 2,
            z + row * 1.7,
          ],
          kind: file.kind === 'external' ? 'external' : 'file',
          count: 1,
          source: file,
          folder,
        });
        membership.set(file.id, file.id);
      }
  }
  const grouped = new Map<string, SceneEdge>();
  for (const edge of [...graph.edges].sort((a, b) => cmp(a.id, b.id))) {
    const sourceId = membership.get(edge.sourceId),
      targetId = membership.get(edge.targetId);
    if (!sourceId || !targetId) continue;
    const id = `scene-edge:${encodeURIComponent(sourceId)}:${encodeURIComponent(targetId)}`;
    const value = grouped.get(id) ?? { id, sourceId, targetId, evidence: [] };
    value.evidence.push(edge);
    grouped.set(id, value);
  }
  return {
    nodes,
    edges: [...grouped.values()].sort((a, b) => cmp(a.id, b.id)),
    folders,
  };
}

/** Locate the visible file or its collapsed folder for selection highlighting. */
export function visibleSelectionId(
  scene: SceneGraph,
  graph: DependencyGraph,
  selectedId: string | null,
): string | null {
  if (!selectedId) return null;
  if (scene.nodes.some((node) => node.id === selectedId)) return selectedId;
  const node = graph.nodes.find((item) => item.id === selectedId);
  if (!node) return null;
  return (
    scene.nodes.find(
      (item) => item.kind === 'folder' && item.folder === folderOf(node),
    )?.id ?? null
  );
}
