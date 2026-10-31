'use client';
import { useMemo } from 'react';
import {
  describeDependency,
  type DependencyEdge,
  type DependencyGraph,
} from '@codedna/shared';
export function FileRelationships({
  graph,
  selectedId,
  onSelect,
  onEvidence,
}: {
  graph: DependencyGraph;
  selectedId: string;
  onSelect: (id: string) => void;
  onEvidence: (path: string, line: number) => void;
}) {
  const { nodes, incoming, outgoing, external } = useMemo(() => {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const incoming: DependencyEdge[] = [],
      outgoing: DependencyEdge[] = [],
      external: DependencyEdge[] = [];
    for (const edge of graph.edges) {
      if (edge.sourceId === selectedId)
        (nodes.get(edge.targetId)?.kind === 'external'
          ? external
          : outgoing
        ).push(edge);
      if (edge.targetId === selectedId) incoming.push(edge);
    }
    return { nodes, incoming, outgoing, external };
  }, [graph, selectedId]);
  const section = (
    title: string,
    edges: DependencyEdge[],
    direction: 'incoming' | 'outgoing',
  ) => (
    <section className="relationship-section">
      <h3>
        {title} ({edges.length})
      </h3>
      {edges.length ? (
        edges.map((edge) => {
          const other =
            direction === 'incoming' ? edge.sourceId : edge.targetId;
          const node = nodes.get(other);
          return (
            <div key={edge.id} className="relationship-item">
              <button
                type="button"
                className="relationship-target"
                onClick={() => onSelect(other)}
              >
                <strong>{node?.label ?? other}</strong>
                <small>
                  {edge.kind ?? 'dependency'}
                  {edge.specifier ? ` · ${edge.specifier}` : ''}
                  {edge.location
                    ? ` · ${edge.location.path}:${edge.location.start.line}:${edge.location.start.column}`
                    : ''}
                </small>
              </button>
              <p className="relationship-explanation">
                {describeDependency(
                  edge,
                  nodes.get(edge.sourceId)?.label ?? edge.sourceId,
                  nodes.get(edge.targetId)?.label ?? edge.targetId,
                )}
              </p>
              {edge.location && (
                <button
                  type="button"
                  className="relationship-evidence"
                  onClick={() =>
                    onEvidence(edge.location!.path, edge.location!.start.line)
                  }
                >
                  View import at line {edge.location.start.line}
                </button>
              )}
            </div>
          );
        })
      ) : (
        <p>None detected.</p>
      )}
    </section>
  );
  return (
    <div>
      <div className="inspector-rule" />
      <div className="inspector-label">DETECTED DEPENDENCIES</div>
      <p className="relationship-summary">
        This file has {outgoing.length} detected{' '}
        {outgoing.length === 1
          ? 'import or re-export'
          : 'imports or re-exports'}{' '}
        of local files, {incoming.length}{' '}
        {incoming.length === 1 ? 'reference' : 'references'} from other files,
        and {external.length} to external packages.
      </p>
      <p className="inspector-footnote">
        Static imports and references only; a connection does not prove runtime
        behavior. Select a file to follow it.
      </p>
      {section('Uses these files', outgoing, 'outgoing')}
      {section('Used by these files', incoming, 'incoming')}
      {section('External packages', external, 'outgoing')}
    </div>
  );
}
