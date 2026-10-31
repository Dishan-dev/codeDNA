'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArchitectureMap,
  buildArchitectureOverview,
  groupDetailGraph,
} from '@codedna/graph-ui';
import type { DependencyGraph } from '@codedna/shared';
export function ArchitectureWorkspace({
  graph,
  selectedId,
  onSelectionChange,
}: {
  graph: DependencyGraph;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}) {
  const [showExternal, setShowExternal] = useState(false);
  const visibleGraph = useMemo(() => {
    if (showExternal) return graph;
    const nodes = graph.nodes.filter((node) => node.kind !== 'external');
    const ids = new Set(nodes.map((node) => node.id));
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter(
        (edge) => ids.has(edge.sourceId) && ids.has(edge.targetId),
      ),
    };
  }, [graph, showExternal]);
  const overview = useMemo(
    () => buildArchitectureOverview(visibleGraph),
    [visibleGraph],
  );
  const [groupId, setGroupId] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const group = overview.groups.find((item) => item.id === groupId);
  const detail = useMemo(
    () => (group ? groupDetailGraph(visibleGraph, group) : visibleGraph),
    [visibleGraph, group],
  );
  useEffect(() => {
    if (
      selectedId &&
      graph.nodes.some(
        (node) => node.id === selectedId && node.kind === 'external',
      )
    )
      setShowExternal(true);
  }, [selectedId, graph]);
  useEffect(() => {
    if (
      selectedId &&
      (!showFiles ||
        (group && !detail.nodes.some((node) => node.id === selectedId)))
    ) {
      setShowFiles(true);
      setGroupId(null);
    }
  }, [selectedId, showFiles, group, detail]);
  const openGroup = (id: string | null) => {
    if (id && overview.groups.some((item) => item.id === id)) {
      setGroupId(id);
      setShowFiles(true);
    }
  };
  return (
    <div className="architecture-workspace">
      <div className="architecture-view-controls">
        <div>
          <strong>
            {showFiles
              ? group
                ? group.label
                : 'File dependencies'
              : 'Repository overview'}
          </strong>
          <span>
            {showFiles
              ? group
                ? `${group.fileIds.length} files or packages · ${group.internalEdges} internal dependencies; direct neighbors included`
                : 'Every analyzed file and package'
              : 'Groups follow repository paths · arrows point from importer to dependency'}
          </span>
        </div>
        <div className="architecture-view-buttons">
          <button
            type="button"
            aria-pressed={showExternal}
            onClick={() => {
              setShowExternal(!showExternal);
              setGroupId(null);
            }}
          >
            {showExternal ? 'Hide packages' : 'Show packages'}
          </button>
          <button
            type="button"
            aria-pressed={!showFiles}
            onClick={() => {
              setShowFiles(false);
              setGroupId(null);
              onSelectionChange(null);
            }}
          >
            Overview
          </button>
          <button
            type="button"
            aria-pressed={showFiles}
            onClick={() => {
              setGroupId(null);
              setShowFiles(true);
            }}
          >
            All files
          </button>
        </div>
      </div>
      {!showFiles && (
        <p className="architecture-hint">
          Select a group to inspect its files and direct connections. Group
          names describe paths, not inferred responsibilities. External packages
          are hidden by default.
        </p>
      )}
      <div className="architecture-map-area">
        <ArchitectureMap
          graph={showFiles ? detail : overview.graph}
          selectedId={showFiles ? selectedId : null}
          onSelectionChange={showFiles ? onSelectionChange : openGroup}
        />
      </div>
      {!showFiles && (
        <div
          className="architecture-group-list"
          aria-label="Architecture groups"
        >
          {overview.groups.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => openGroup(item.id)}
            >
              <strong>{item.label}</strong>
              <span>
                {item.fileIds.length}{' '}
                {item.id.includes('External%20packages') ? 'packages' : 'files'}{' '}
                · {item.internalEdges} internal dependencies
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
