'use client';
import { useMemo, useState } from 'react';
import {
  describeDependency,
  type DependencyEdge,
  type DependencyGraph,
} from '@codedna/shared';
export function DependencyEvidence({
  edges,
  graph,
  onSource,
}: {
  edges: readonly DependencyEdge[];
  graph: DependencyGraph;
  onSource?: (path: string, line: number) => void;
}) {
  const [limit, setLimit] = useState(10);
  const names = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.label])),
    [graph],
  );
  return (
    <div className="dna-evidence-items">
      {edges.slice(0, limit).map((edge) => (
        <div key={edge.id}>
          <p>
            {describeDependency(
              edge,
              names.get(edge.sourceId) ?? edge.sourceId,
              names.get(edge.targetId) ?? edge.targetId,
            )}
          </p>
          {edge.location &&
            (onSource ? (
              <button
                type="button"
                onClick={() =>
                  onSource(edge.location!.path, edge.location!.start.line)
                }
              >
                {edge.location.path}:{edge.location.start.line}
              </button>
            ) : (
              <small>
                {edge.location.path}:{edge.location.start.line}
              </small>
            ))}
        </div>
      ))}
      {edges.length > limit && (
        <button type="button" onClick={() => setLimit((value) => value + 10)}>
          Show more evidence ({edges.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
