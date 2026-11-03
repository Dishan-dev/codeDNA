import type {
  AnalysisResult,
  DependencyEdge,
  UIFlowNode,
} from '@codedna/shared';
/** Bounded source-level imports reachable from a screen; not a runtime call graph. */
export function routeDependencies(
  screen: UIFlowNode,
  result: AnalysisResult | undefined,
  options: { maxDepth?: number; maxNodes?: number; maxEdges?: number } = {},
) {
  const maxDepth = Math.min(4, Math.max(0, options.maxDepth ?? 2)),
    maxNodes = Math.min(200, Math.max(1, options.maxNodes ?? 60)),
    maxEdges = Math.min(400, Math.max(1, options.maxEdges ?? 120));
  const graph = result?.dependencyGraph;
  const root = screen.sourceFile ? `file:${screen.sourceFile}` : null;
  if (!graph || !root || !graph.nodes.some((node) => node.id === root))
    return {
      nodes: [],
      edges: [],
      truncated: false,
      available: false,
      diagnostics: [],
    };
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, DependencyEdge[]>();
  for (const edge of graph.edges) {
    const list = adjacent.get(edge.sourceId) ?? [];
    list.push(edge);
    adjacent.set(edge.sourceId, list);
  }
  for (const edges of adjacent.values())
    edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const queue = [{ id: root, depth: 0 }],
    seen = new Set([root]),
    edges: DependencyEdge[] = [];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const outgoing = adjacent.get(current.id) ?? [];
    if (current.depth >= maxDepth) {
      if (outgoing.length) truncated = true;
      continue;
    }
    for (const edge of outgoing) {
      if (!nodes.has(edge.targetId)) continue;
      if (edges.length >= maxEdges) {
        truncated = true;
        break;
      }
      if (!seen.has(edge.targetId)) {
        if (seen.size >= maxNodes) {
          truncated = true;
          continue;
        }
        seen.add(edge.targetId);
        queue.push({ id: edge.targetId, depth: current.depth + 1 });
      }
      edges.push(edge);
    }
  }
  const paths = new Set(queue.map((item) => nodes.get(item.id)?.label));
  return {
    nodes: queue.map((item) => ({
      node: nodes.get(item.id)!,
      depth: item.depth,
    })),
    edges,
    truncated,
    available: true,
    diagnostics: (result.diagnostics ?? []).filter(
      (item) => item.location && paths.has(item.location.path),
    ),
  };
}
