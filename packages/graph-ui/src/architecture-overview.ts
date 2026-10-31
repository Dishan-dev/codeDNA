import type {
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
} from '@codedna/shared';
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export interface ArchitectureGroup {
  id: string;
  label: string;
  fileIds: string[];
  internalEdges: number;
}
export interface ArchitectureOverview {
  graph: DependencyGraph;
  groups: ArchitectureGroup[];
  edgeEvidence: Record<string, DependencyEdge[]>;
}
/** Group by actual repository paths; names describe structure, not inferred responsibilities. */
export function buildArchitectureOverview(
  graph: DependencyGraph,
): ArchitectureOverview {
  const groupFor = (node: DependencyNode) => {
    if (node.kind === 'external') return 'External packages';
    const parts = node.label.split('/');
    if (parts.length === 1) return 'Root files';
    if ((parts[0] === 'apps' || parts[0] === 'packages') && parts.length > 2)
      return parts.slice(0, 2).join('/');
    return parts[0]!;
  };
  const groups = new Map<string, ArchitectureGroup>();
  const membership = new Map<string, string>();
  for (const node of graph.nodes) {
    const label = groupFor(node),
      id = `group:${node.kind === 'external' ? 'external' : node.label.includes('/') ? 'directory' : 'root'}:${encodeURIComponent(label)}`;
    if (!groups.has(id))
      groups.set(id, { id, label, fileIds: [], internalEdges: 0 });
    groups.get(id)!.fileIds.push(node.id);
    membership.set(node.id, id);
  }
  const aggregated = new Map<
    string,
    { sourceId: string; targetId: string; edges: DependencyEdge[] }
  >();
  for (const edge of graph.edges) {
    const sourceId = membership.get(edge.sourceId),
      targetId = membership.get(edge.targetId);
    if (!sourceId || !targetId) continue;
    if (sourceId === targetId) {
      groups.get(sourceId)!.internalEdges++;
      continue;
    }
    const id = `group-edge:${encodeURIComponent(sourceId)}:${encodeURIComponent(targetId)}`;
    const value = aggregated.get(id) ?? { sourceId, targetId, edges: [] };
    value.edges.push(edge);
    aggregated.set(id, value);
  }
  const sorted = [...groups.values()].sort((a, b) => compare(a.id, b.id));
  for (const group of sorted) group.fileIds.sort(compare);
  const edgeEvidence: Record<string, DependencyEdge[]> = {};
  const edges: DependencyEdge[] = [...aggregated.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([id, item]) => {
      const originals = item.edges.sort((a, b) => compare(a.id, b.id));
      edgeEvidence[id] = originals;
      return {
        id,
        sourceId: item.sourceId,
        targetId: item.targetId,
        specifier: `${originals.length} source ${originals.length === 1 ? 'dependency' : 'dependencies'}`,
        metadata: {
          confidence: Math.min(
            ...originals.map((edge) => edge.metadata.confidence),
          ),
          evidence: [],
        },
      };
    });
  return {
    groups: sorted,
    edgeEvidence,
    graph: {
      schemaVersion: '1.0',
      nodes: sorted.map((group) => ({
        id: group.id,
        label: group.label,
        kind: 'file',
        metadata: { confidence: 1, evidence: [] },
      })),
      edges,
    },
  };
}
/** Keep all files in a group plus directly connected files and their original edges. */
export function groupDetailGraph(
  graph: DependencyGraph,
  group: ArchitectureGroup,
): DependencyGraph {
  const members = new Set(group.fileIds),
    visible = new Set(group.fileIds);
  const edges = graph.edges.filter(
    (edge) => members.has(edge.sourceId) || members.has(edge.targetId),
  );
  for (const edge of edges) {
    visible.add(edge.sourceId);
    visible.add(edge.targetId);
  }
  return {
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.filter((node) => visible.has(node.id)),
    edges,
  };
}
