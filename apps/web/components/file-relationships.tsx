'use client';
import { useMemo } from 'react';
import type { DependencyEdge, DependencyGraph } from '@codedna/shared';
export function FileRelationships({
  graph,
  selectedId,
  onSelect,
}: {
  graph: DependencyGraph;
  selectedId: string;
  onSelect: (id: string) => void;
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
            <button
              type="button"
              key={edge.id}
              className="relationship-item"
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
