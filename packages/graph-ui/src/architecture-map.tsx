'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from '@xyflow/react';
import type { DependencyGraph } from '@codedna/shared';
import {
  adaptGraph,
  neighborhood,
  type AdaptedGraph,
  type MapNode,
} from './graph.js';
import {
  fallbackLayout,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './layout.js';
import '@xyflow/react/dist/style.css';

const FileNode = memo(function FileNode({ data }: NodeProps<MapNode>) {
  const name = data.source.label.split('/').at(-1) ?? data.source.label;
  const external = data.source.kind === 'external';
  const group = data.source.id.startsWith('group:');
  const extension = group
    ? 'GROUP'
    : external
      ? 'PACKAGE'
      : name.includes('.')
        ? name.split('.').at(-1)?.toUpperCase()
        : 'FILE';
  return (
    <div
      className={`dna-node dna-node--${data.emphasis} ${external ? 'dna-node--external' : ''}`}
      title={`${data.source.label} | ${data.incoming} incoming, ${data.outgoing} outgoing`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="dna-node-icon" aria-hidden="true">
        {group ? 'grp' : external ? 'pkg' : '{ }'}
      </span>
      <div className="dna-node-copy">
        <strong>{name}</strong>
        <small>{data.source.label}</small>
      </div>
      <span className="dna-node-type">{extension}</span>
      <div className="dna-node-counts">
        <span>{data.incoming} in</span>
        <span>{data.outgoing} out</span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { file: FileNode };
const motionDuration = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
export interface ArchitectureMapProps {
  graph: DependencyGraph;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
  highlightedNodeIds?: readonly string[];
  highlightedEdgeIds?: readonly string[];
}
function MapCanvas({
  graph,
  selectedId,
  onSelectionChange,
  highlightedNodeIds,
  highlightedEdgeIds,
}: ArchitectureMapProps) {
  const adapted = useMemo(() => adaptGraph(graph), [graph]);
  const [laidOut, setLaidOut] = useState<AdaptedGraph | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>(
    'loading',
  );
  const [reset, setReset] = useState(0);
  const { fitView, setCenter } = useReactFlow();
  const initialized = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLaidOut(null);
    layoutGraph(adapted)
      .then((result) => {
        if (!cancelled) {
          setLaidOut(result);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLaidOut(fallbackLayout(adapted));
          setStatus('fallback');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapted, reset]);
  const adjacent = useMemo(
    () => neighborhood(adapted.edges, selectedId),
    [adapted.edges, selectedId],
  );
  const highlightedNodes = useMemo(
    () => new Set(highlightedNodeIds ?? []),
    [highlightedNodeIds],
  );
  const highlightedEdges = useMemo(
    () => new Set(highlightedEdgeIds ?? []),
    [highlightedEdgeIds],
  );
  const nodes = useMemo(
    () =>
      (laidOut?.nodes ?? []).map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          emphasis: highlightedNodeIds
            ? node.id === selectedId
              ? ('selected' as const)
              : highlightedNodes.has(node.id)
                ? ('connected' as const)
                : ('dimmed' as const)
            : !selectedId
              ? ('normal' as const)
              : node.id === selectedId
                ? ('selected' as const)
                : adjacent.nodes.has(node.id)
                  ? ('connected' as const)
                  : ('dimmed' as const),
        },
      })),
    [laidOut, selectedId, adjacent, highlightedNodeIds, highlightedNodes],
  );
  const edges = useMemo(
    () =>
      (laidOut?.edges ?? []).map((edge) => ({
        ...edge,
        className: highlightedEdgeIds
          ? highlightedEdges.has(edge.id)
            ? 'dna-edge--active'
            : 'dna-edge--dimmed'
          : !selectedId
            ? ''
            : adjacent.edgeIds.has(edge.id)
              ? 'dna-edge--active'
              : 'dna-edge--dimmed',
      })),
    [laidOut, selectedId, adjacent, highlightedEdgeIds, highlightedEdges],
  );
  useEffect(() => {
    if (!laidOut || !initialized.current) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.25, duration: motionDuration(), maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [laidOut, fitView]);
  useEffect(() => {
    if (!selectedId || !laidOut || !initialized.current) return;
    const node = laidOut.nodes.find((item) => item.id === selectedId);
    if (node)
      void setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom: 1, duration: motionDuration() },
      );
  }, [selectedId, laidOut, setCenter]);
  const select = useCallback(
    (id: string | null) => onSelectionChange(id),
    [onSelectionChange],
  );
  if (!adapted.nodes.length)
    return (
      <div className="dna-graph-empty">
        <strong>No files to map yet</strong>
        <span>This snapshot contains no supported source files.</span>
      </div>
    );
  return (
    <div className="dna-map" aria-label="Architecture dependency map">
      {adapted.nodes.length >= 250 && (
        <div className="dna-graph-notice" role="status">
          Large map: {adapted.nodes.length} nodes. Layout may take a moment; all
          nodes are included.
        </div>
      )}
      {status === 'fallback' && (
        <div className="dna-graph-notice dna-graph-warning" role="alert">
          Automatic layout failed. Showing a safe grid layout.
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={() => {
          initialized.current = true;
        }}
        onNodeClick={(_, node) => select(node.id)}
        onKeyDown={(event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            event.target instanceof Element
          ) {
            const id = event.target
              .closest('[data-id]')
              ?.getAttribute('data-id');
            if (id) {
              event.preventDefault();
              select(id);
            }
          }
        }}
        onPaneClick={() => select(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements={adapted.nodes.length >= 250}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#29354a"
        />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {status === 'loading' && (
        <div className="dna-graph-loading" role="status">
          <span className="dna-spinner" />
          Laying out the architecture...
        </div>
      )}
      <div className="dna-graph-toolbar">
        <span>
          <i /> LIVE ANALYSIS
        </span>
        <button
          type="button"
          onClick={() => {
            void fitView({
              padding: 0.25,
              duration: motionDuration(),
              maxZoom: 1,
            });
          }}
        >
          Fit view
        </button>
        <button type="button" onClick={() => setReset((value) => value + 1)}>
          Reset layout
        </button>
      </div>
      <div className="dna-graph-legend">
        <span>
          <i /> File
        </span>
        <span>
          <i /> External package
        </span>
        <span>Arrows point to dependencies</span>
      </div>
    </div>
  );
}
export const ArchitectureMap = memo(function ArchitectureMap(
  props: ArchitectureMapProps,
) {
  return (
    <ReactFlowProvider>
      <MapCanvas {...props} />
    </ReactFlowProvider>
  );
});
