import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { AdaptedGraph } from './graph.js';
export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 82;
/** Deterministic grid used when layout fails; no nodes are discarded. */
export function fallbackLayout(graph: AdaptedGraph): AdaptedGraph {
  const columns = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) => ({
      ...node,
      position: {
        x: (index % columns) * 280,
        y: Math.floor(index / columns) * 140,
      },
    })),
  };
}
export async function layoutGraph(graph: AdaptedGraph): Promise<AdaptedGraph> {
  if (!graph.nodes.length) return graph;
  const Constructor = ELK as unknown as new () => {
    layout(graph: ElkNode): Promise<ElkNode>;
  };
  const elk = new Constructor();
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '72',
      'elk.layered.spacing.nodeNodeBetweenLayers': '110',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions = new Map(
    (result.children ?? []).map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  );
  if (positions.size !== graph.nodes.length)
    throw new Error('Incomplete graph layout');
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id)!,
    })),
  };
}
