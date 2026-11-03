'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { routeDependencies } from '@codedna/core/route-context';
import type { UIFlowAnalysis } from '@codedna/core';
import type { AnalysisResult } from '@codedna/shared';
const UIFlowMap = dynamic(() => import('@codedna/graph-ui/ui-flow-map').then((module) => module.UIFlowMap), { ssr: false, loading: () => <p className="route-map-loading">Loading route map…</p> });
export function RouteExplorer({
  analysis,
  uiFlow,
  selectedId,
  onSelect,
  onSource,
  frameworkDetected,
}: {
  analysis: AnalysisResult | undefined;
  uiFlow: UIFlowAnalysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSource: (path: string, line: number) => void;
  frameworkDetected: boolean;
}) {
  const [showMap, setShowMap] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(30);
  const routes = useMemo(
    () =>
      [...uiFlow.graph.nodes].sort((a, b) =>
        (a.routePath ?? a.label).localeCompare(b.routePath ?? b.label),
      ),
    [uiFlow.graph.nodes],
  );
  const screen = routes.find((item) => item.id === selectedId);
  const context = useMemo(
    () => (screen ? routeDependencies(screen, analysis) : null),
    [screen, analysis],
  );
  const events = useMemo(
    () =>
      uiFlow.graph.navigationEvents?.filter(
        (item) => item.sourceId === selectedId,
      ) ?? [],
    [uiFlow.graph.navigationEvents, selectedId],
  );
  const transitions = useMemo(
    () => uiFlow.graph.edges.filter((edge) => edge.sourceId === selectedId),
    [uiFlow.graph.edges, selectedId],
  );
  const filteredRoutes = useMemo(
    () =>
      routes.filter((item) =>
        `${item.routePath ?? item.label} ${item.sourceFile ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [routes, query],
  );
  return (
    <div className="route-workspace">
      <div className="route-toolbar">
        <div>
          <strong>Routes &amp; Features</strong>
          <span>Explore detected screens and their source evidence</span>
        </div>
        <div>
          <button
            type="button"
            aria-pressed={!showMap}
            onClick={() => setShowMap(false)}
          >
            Route explorer
          </button>
          <button
            type="button"
            aria-pressed={showMap}
            onClick={() => setShowMap(true)}
          >
            Advanced flow map
          </button>
        </div>
      </div>
      {showMap ? (
        <UIFlowMap
          graph={uiFlow.graph}
          diagnostics={uiFlow.diagnostics}
          selectedId={selectedId}
          onSelectionChange={onSelect}
          frameworkDetected={frameworkDetected}
        />
      ) : (
        <div className="route-layout">
          <div className="guide-card">
            <span className="guide-eyebrow">
              DETECTED SCREENS · {routes.length}
            </span>
            <h2>Choose a route or screen</h2>
            <input
              className="route-search"
              aria-label="Filter routes"
              placeholder="Filter routes or files"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(30);
              }}
            />
            <div className="route-list">
              {filteredRoutes.slice(0, visibleCount).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                >
                  <strong>{item.routePath ?? item.label}</strong>
                  <small>
                    {item.sourceFile ?? 'Source not identified'} ·{' '}
                    {item.framework ?? 'Framework unknown'}
                  </small>
                </button>
              ))}
              {filteredRoutes.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + 30)}
                >
                  Show more screens ({filteredRoutes.length - visibleCount}{' '}
                  remaining)
                </button>
              )}
              {routes.length > 0 && filteredRoutes.length === 0 && (
                <p>No screens match this search.</p>
              )}
              {!routes.length && (
                <p>
                  No supported screens detected. This does not prove that the
                  repository has no routes.
                </p>
              )}
            </div>
          </div>
          <div className="guide-card route-detail">
            {screen ? (
              <>
                <span className="guide-eyebrow">SCREEN SOURCE EVIDENCE</span>
                <h2>{screen.routePath ?? screen.label}</h2>
                <p>
                  {screen.framework ?? 'Framework unknown'} ·{' '}
                  {screen.sourceFile ?? 'Source not identified'}
                </p>
                {screen.sourceFile && (
                  <button
                    type="button"
                    className="guide-action"
                    onClick={() =>
                      onSource(
                        screen.sourceFile!,
                        screen.location?.start.line ?? 1,
                      )
                    }
                  >
                    Inspect screen source
                  </button>
                )}
                <h3>Detected navigation</h3>
                <p>
                  Actions are static evidence; they do not prove a user can
                  reach a destination at runtime.
                </p>
                {transitions.length > 0 && (
                  <div
                    className="route-transitions"
                    aria-label="Detected screen transitions"
                  >
                    {transitions.map((edge) => {
                      const target = uiFlow.graph.nodes.find(
                        (node) => node.id === edge.targetId,
                      );
                      return (
                        <div key={edge.id}>
                          <strong>{screen.routePath ?? screen.label}</strong>
                          <span aria-hidden="true"> → </span>
                          <button
                            type="button"
                            onClick={() => onSelect(edge.targetId)}
                          >
                            {target?.routePath ??
                              target?.label ??
                              'Unknown screen'}
                          </button>
                          <small>
                            {edge.kind ?? 'navigation'} · static evidence
                          </small>
                        </div>
                      );
                    })}
                  </div>
                )}
                {events.length ? (
                  <ul>
                    {events.map((event) => (
                      <li key={event.id}>
                        <strong>{event.kind}</strong> ·{' '}
                        {event.destination ?? '(dynamic or history)'} ·{' '}
                        {event.resolution}
                        <button
                          type="button"
                          onClick={() =>
                            onSource(
                              event.location.path,
                              event.location.start.line,
                            )
                          }
                        >
                          {event.location.path}:{event.location.start.line}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No attributed navigation actions detected for this screen.
                  </p>
                )}
                <h3>Related source files</h3>
                <p>
                  Imports followed up to two steps from the screen; these are
                  not proven runtime calls.
                </p>
                {context?.available ? (
                  <>
                    <ul>
                      {context.nodes.map(({ node, depth }) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            disabled={node.kind === 'external'}
                            onClick={() => onSource(node.label, 1)}
                          >
                            {node.label}
                          </button>{' '}
                          ·{' '}
                          {depth === 0
                            ? 'screen'
                            : depth === 1
                              ? 'direct dependency'
                              : 'second-level dependency'}
                        </li>
                      ))}
                    </ul>
                    {context.truncated && (
                      <p>
                        Traversal is bounded; additional dependencies may exist.
                      </p>
                    )}
                    {context.diagnostics.length > 0 && (
                      <p>
                        {context.diagnostics.length} source diagnostic(s) affect
                        these files. Review analysis diagnostics for details.
                      </p>
                    )}
                    <details>
                      <summary>
                        Dependency evidence ({context.edges.length})
                      </summary>
                      <ul>
                        {context.edges.map((edge) => (
                          <li key={edge.id}>
                            {edge.kind ?? 'dependency'} ·{' '}
                            {edge.specifier ?? 'unknown'}{' '}
                            {edge.location && (
                              <button
                                type="button"
                                onClick={() =>
                                  onSource(
                                    edge.location!.path,
                                    edge.location!.start.line,
                                  )
                                }
                              >
                                {edge.location.path}:{edge.location.start.line}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                ) : (
                  <p>Source dependencies are not available for this screen.</p>
                )}
              </>
            ) : (
              <>
                <h2>Start with a screen</h2>
                <p>
                  Select a route to explore its source, navigation events, and
                  nearby dependencies without displaying unrelated files.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
