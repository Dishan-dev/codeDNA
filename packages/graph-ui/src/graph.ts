import type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
} from '@codedna/shared';
import type { Edge, Node } from '@xyflow/react';

export type MapNodeData = {
  source: DependencyNode;
  incoming: number;
  outgoing: number;
  emphasis: 'normal' | 'selected' | 'connected' | 'dimmed';
};
export type MapNode = Node<MapNodeData, 'file'>;
export type MapEdge = Edge<{ source: DependencyEdge }>;
export interface AdaptedGraph {
  nodes: MapNode[];
  edges: MapEdge[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Edges retain the engine's importer -> dependency direction and metadata. */
export function adaptGraph(graph: DependencyGraph): AdaptedGraph {
  const counts = new Map<string, { incoming: number; outgoing: number }>();
  for (const node of graph.nodes)
    counts.set(node.id, { incoming: 0, outgoing: 0 });
  for (const edge of graph.edges) {
    const source = counts.get(edge.sourceId);
    const target = counts.get(edge.targetId);
    if (source) source.outgoing++;
    if (target) target.incoming++;
  }
  const nodes: MapNode[] = [...graph.nodes]
    .sort((a, b) => compare(a.id, b.id))
    .map((source) => ({
      id: source.id,
      type: 'file',
      position: { x: 0, y: 0 },
      data: {
        source,
        incoming: counts.get(source.id)?.incoming ?? 0,
        outgoing: counts.get(source.id)?.outgoing ?? 0,
        emphasis: 'normal',
      },
      ariaLabel: `${source.kind === 'external' ? 'External package' : 'File'} ${source.label}`,
    }));
  const edges: MapEdge[] = [...graph.edges]
    .sort((a, b) => compare(a.id, b.id))
    .map((source) => ({
      id: source.id,
      source: source.sourceId,
      target: source.targetId,
      type: 'smoothstep',
      data: { source },
      markerEnd: { type: 'arrowclosed' as const },
      ariaLabel: `${source.kind ?? 'dependency'} ${source.specifier ?? ''}`,
    }));
  return { nodes, edges };
}
export function neighborhood(
  edges: readonly MapEdge[],
  selectedId: string | null,
) {
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();
  if (selectedId) {
    nodes.add(selectedId);
    for (const edge of edges)
      if (edge.source === selectedId || edge.target === selectedId) {
        nodes.add(edge.source);
        nodes.add(edge.target);
        edgeIds.add(edge.id);
      }
  }
  return { nodes, edgeIds };
}
