'use client';
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  ArchitectureMap,
  buildArchitectureOverview,
  groupDetailGraph,
} from '@codedna/graph-ui';
import type {
  DependencyGraph,
  RepositorySnapshot,
  UIFlowGraph,
} from '@codedna/shared';
import { ArchitectureGuide } from './architecture-guide';
const Architecture3D = dynamic(
  () =>
    import('@codedna/graph-ui/architecture-3d').then(
      (module) => module.Architecture3D,
    ),
  {
    ssr: false,
    loading: () => <p className="architecture-hint">Loading 3D view?</p>,
  },
);
class View3DBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="dna-3d-fallback" role="alert">
        3D is unavailable on this device. Select 2D to continue exploring.
      </div>
    ) : (
      this.props.children
    );
  }
}

export function ArchitectureWorkspace({
  graph,
  snapshot,
  uiFlow,
  complete,
  selectedId,
  onSelectionChange,
}: {
  graph: DependencyGraph;
  snapshot: RepositorySnapshot;
  uiFlow: UIFlowGraph;
  complete: boolean;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}) {
  const [view, setView] = useState<'guide' | '2d' | '3d'>('guide');
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('codedna-architecture-view');
      if (saved === '3d' || saved === '2d' || saved === 'guide') setView(saved);
    } catch {
      // Storage may be unavailable; keep the in-memory choice.
    }
  }, []);
  const switchView = (next: 'guide' | '2d' | '3d') => {
    setView(next);
    try {
      sessionStorage.setItem('codedna-architecture-view', next);
    } catch {
      // Storage may be unavailable; keep the in-memory choice.
    }
  };
  const [showExternal, setShowExternal] = useState(false);
  const [directOnly, setDirectOnly] = useState(false);
  const baseGraph = useMemo(() => {
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
  const visibleGraph = useMemo(() => {
    if (!directOnly || !selectedId) return baseGraph;
    const ids = new Set([selectedId]);
    const edges = baseGraph.edges.filter(
      (edge) => edge.sourceId === selectedId || edge.targetId === selectedId,
    );
    for (const edge of edges) {
      ids.add(edge.sourceId);
      ids.add(edge.targetId);
    }
    return {
      ...baseGraph,
      nodes: baseGraph.nodes.filter((node) => ids.has(node.id)),
      edges,
    };
  }, [baseGraph, directOnly, selectedId]);
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
            {view === 'guide'
              ? 'Codebase guide'
              : showFiles
                ? group
                  ? group.label
                  : 'File dependencies'
                : 'Repository overview'}
          </strong>
          <span>
            {view === 'guide'
              ? 'Understand the structure and follow the evidence'
              : showFiles
                ? group
                  ? `${group.fileIds.length} files or packages · ${group.internalEdges} internal dependencies; direct neighbors included`
                  : directOnly && selectedId
                    ? 'Selected file and its direct connections'
                    : 'Every analyzed file and package'
                : 'Groups follow repository paths · arrows point from importer to dependency'}
          </span>
        </div>
        <div className="architecture-view-buttons">
          <button
            type="button"
            aria-pressed={view === 'guide'}
            onClick={() => switchView('guide')}
          >
            Guide
          </button>
          <button
            type="button"
            aria-pressed={view === '2d'}
            onClick={() => switchView('2d')}
          >
            2D
          </button>
          <button
            type="button"
            aria-pressed={view === '3d'}
            onClick={() => switchView('3d')}
          >
            3D
          </button>
          {view !== 'guide' && (
            <button
              type="button"
              aria-pressed={directOnly}
              disabled={!selectedId}
              onClick={() => setDirectOnly(!directOnly)}
            >
              {directOnly ? 'Show all connections' : 'Direct connections'}
            </button>
          )}
          {view !== 'guide' && (
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
          )}
          {view === '2d' && (
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
          )}
          {view === '2d' && (
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
          )}
        </div>
      </div>
      {view === '2d' && !showFiles && (
        <p className="architecture-hint">
          Select a group to inspect its files and direct connections. Group
          names describe paths, not inferred responsibilities. External packages
          are hidden by default.
        </p>
      )}
      <div className="architecture-map-area">
        {view === 'guide' ? (
          <ArchitectureGuide
            snapshot={snapshot}
            graph={graph}
            uiFlow={uiFlow}
            complete={complete}
            onSelect={onSelectionChange}
          />
        ) : view === '3d' ? (
          <View3DBoundary>
            <Architecture3D
              graph={visibleGraph}
              selectedId={selectedId}
              onSelectionChange={onSelectionChange}
            />
          </View3DBoundary>
        ) : (
          <ArchitectureMap
            graph={showFiles ? detail : overview.graph}
            selectedId={showFiles ? selectedId : null}
            onSelectionChange={showFiles ? onSelectionChange : openGroup}
          />
        )}
      </div>
      {view === '2d' && !showFiles && (
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
