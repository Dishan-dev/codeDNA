import type {
  AnalysisDiagnostic,
  UIFlowEdge,
  UIFlowGraph,
  UIFlowNode,
} from '@codedna/shared';
import type { Edge, Node } from '@xyflow/react';
export type ScreenData = {
  source: UIFlowNode;
  incoming: number;
  outgoing: number;
  diagnostics: number;
  dynamic: boolean;
  emphasis: 'normal' | 'selected' | 'connected' | 'dimmed';
};
export type ScreenNode = Node<ScreenData, 'screen'>;
export type ScreenEdge = Edge<{ source: UIFlowEdge }>;
export type AdaptedUIFlow = { nodes: ScreenNode[]; edges: ScreenEdge[] };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Only explicitly resolved graph edges become visual connections. */
export function adaptUIFlowGraph(
  graph: UIFlowGraph,
  diagnostics: readonly AnalysisDiagnostic[] = [],
): AdaptedUIFlow {
  const incoming = new Map<string, number>(),
    outgoing = new Map<string, number>(),
    issues = new Map<string, number>();
  for (const edge of graph.edges) {
    incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1);
    outgoing.set(edge.sourceId, (outgoing.get(edge.sourceId) ?? 0) + 1);
  }
  for (const diagnostic of diagnostics)
    if (diagnostic.location)
      issues.set(
        diagnostic.location.path,
        (issues.get(diagnostic.location.path) ?? 0) + 1,
      );
  const nodes: ScreenNode[] = [...graph.nodes]
    .sort((a, b) => cmp(a.id, b.id))
    .map((source) => ({
      id: source.id,
      type: 'screen',
      position: { x: 0, y: 0 },
      ariaLabel: `Screen ${source.routePath ?? source.label}`,
      data: {
        source,
        incoming: incoming.get(source.id) ?? 0,
        outgoing: outgoing.get(source.id) ?? 0,
        diagnostics: issues.get(source.sourceFile ?? '') ?? 0,
        dynamic: /\[|(^|\/):|\*/.test(source.routePath ?? ''),
        emphasis: 'normal',
      },
    }));
  const edges: ScreenEdge[] = [...graph.edges]
    .sort((a, b) => cmp(a.id, b.id))
    .map((source) => ({
      id: source.id,
      source: source.sourceId,
      target: source.targetId,
      type: 'smoothstep',
      data: { source },
      markerEnd: { type: 'arrowclosed' as const },
      ariaLabel: `${source.kind ?? 'navigation'} ${source.destination ?? ''}`,
    }));
  return { nodes, edges };
}
