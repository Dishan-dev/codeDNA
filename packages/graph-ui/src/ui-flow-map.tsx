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
import type { AnalysisDiagnostic, UIFlowGraph } from '@codedna/shared';
import { neighborhood } from './graph.js';
import {
  adaptUIFlowGraph,
  type AdaptedUIFlow,
  type ScreenNode,
} from './ui-flow-graph.js';
import {
  fallbackLayout,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
} from './layout.js';
import '@xyflow/react/dist/style.css';
const Screen = memo(function Screen({ data }: NodeProps<ScreenNode>) {
  const route = data.source.routePath ?? data.source.label;
  return (
    <div
      className={`dna-node dna-screen dna-node--${data.emphasis}`}
      title={`${route} | ${data.source.sourceFile ?? 'Unknown source'} | ${data.incoming} incoming, ${data.outgoing} outgoing`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="dna-node-icon" aria-hidden="true">
        {data.dynamic ? '[ ]' : '/'}
      </span>
      <div className="dna-node-copy">
        <strong>{route}</strong>
        <small>{data.source.sourceFile ?? data.source.label}</small>
      </div>
      <span className="dna-node-type">
        {data.dynamic ? 'DYNAMIC' : 'STATIC'}
      </span>
      <div className="dna-node-counts">
        <span>{data.incoming} in</span>
        <span>{data.outgoing} out</span>
        {data.diagnostics > 0 && (
          <span>
            {data.diagnostics} diagnostic{data.diagnostics === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
const nodeTypes = { screen: Screen };
const duration = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
export interface UIFlowMapProps {
  graph: UIFlowGraph;
  diagnostics?: AnalysisDiagnostic[];
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
  frameworkDetected: boolean;
}
function Canvas({
  graph,
  diagnostics,
  selectedId,
  onSelectionChange,
  frameworkDetected,
}: UIFlowMapProps) {
  const adapted = useMemo(
    () => adaptUIFlowGraph(graph, diagnostics),
    [graph, diagnostics],
  );
  const [layout, setLayout] = useState<AdaptedUIFlow | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>(
    'loading',
  );
  const [reset, setReset] = useState(0);
  const initialized = useRef(false);
  const { fitView, setCenter } = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setLayout(null);
    layoutGraph(adapted)
      .then((result) => {
        if (!cancelled) {
          setLayout(result);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLayout(fallbackLayout(adapted));
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
  const nodes = useMemo(
    () =>
      (layout?.nodes ?? []).map((node) => ({
        ...node,
        selected: node.id === selectedId,
        data: {
          ...node.data,
          emphasis: !selectedId
            ? ('normal' as const)
            : node.id === selectedId
              ? ('selected' as const)
              : adjacent.nodes.has(node.id)
                ? ('connected' as const)
                : ('dimmed' as const),
        },
      })),
    [layout, selectedId, adjacent],
  );
  const edges = useMemo(
    () =>
      (layout?.edges ?? []).map((edge) => ({
        ...edge,
        className: !selectedId
          ? ''
          : adjacent.edgeIds.has(edge.id)
            ? 'dna-edge--active'
            : 'dna-edge--dimmed',
      })),
    [layout, selectedId, adjacent],
  );
  useEffect(() => {
    if (!layout || !initialized.current) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.25, duration: duration(), maxZoom: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, fitView]);
  useEffect(() => {
    if (!layout || !selectedId || !initialized.current) return;
    const node = layout.nodes.find((item) => item.id === selectedId);
    if (node)
      void setCenter(
        node.position.x + NODE_WIDTH / 2,
        node.position.y + NODE_HEIGHT / 2,
        { zoom: 1, duration: duration() },
      );
  }, [layout, selectedId, setCenter]);
  const select = useCallback(
    (id: string | null) => onSelectionChange(id),
    [onSelectionChange],
  );
  if (!adapted.nodes.length)
    return (
      <div className="dna-graph-empty">
        <strong>
          {frameworkDetected
            ? 'No supported screens found'
            : 'No supported framework detected'}
        </strong>
        <span>
          {frameworkDetected
            ? 'No supported routes could be mapped in this snapshot. Dynamic or unsupported patterns and missing files may limit detection.'
            : 'UI Flow detects supported routing patterns in Next.js App Router, Expo Router, React Router and React Navigation TypeScript or JavaScript projects.'}
        </span>
      </div>
    );
  return (
    <div className="dna-map" aria-label="UI Flow screen map">
      {adapted.nodes.length >= 250 && (
        <div className="dna-graph-notice" role="status">
          Large map: {adapted.nodes.length} screens. Layout may take a moment;
          all screens are included.
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
          Laying out screen flow...
        </div>
      )}
      <div className="dna-graph-toolbar">
        <span>
          <i /> STATIC UI ANALYSIS
        </span>
        <button
          type="button"
          onClick={() => {
            void fitView({ padding: 0.25, duration: duration(), maxZoom: 1 });
          }}
        >
          Fit view
        </button>
        <button type="button" onClick={() => setReset((v) => v + 1)}>
          Reset layout
        </button>
      </div>
      <div className="dna-graph-legend">
        <span>
          <i /> Screen
        </span>
        <span>Arrows show detected navigation</span>
      </div>
      {!adapted.edges.length && status !== 'loading' && (
        <div className="dna-flow-noedges" role="status">
          Screens found; no resolved navigation detected.
        </div>
      )}
    </div>
  );
}
export const UIFlowMap = memo(function UIFlowMap(props: UIFlowMapProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
});
