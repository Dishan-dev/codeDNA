'use client';
import { useMemo, useState } from 'react';
import { createImpactAnalyzer } from '@codedna/core/impact';
import { ArchitectureMap } from '@codedna/graph-ui';
import type { UIFlowAnalysis } from '@codedna/core';
import type { AnalysisResult, DependencyPath } from '@codedna/shared';

export function ImpactWorkspace({
  result,
  uiFlow,
  rootId,
  complete,
  onInspect,
}: {
  result?: AnalysisResult;
  uiFlow: UIFlowAnalysis;
  rootId: string | null;
  complete: boolean;
  onInspect: (id: string) => void;
}) {
  const analyzer = useMemo(
    () =>
      result
        ? createImpactAnalyzer(result, {
            uiFlowGraph: uiFlow.graph,
            uiFlowDiagnostics: uiFlow.diagnostics,
            snapshotComplete: complete,
          })
        : null,
    [result, uiFlow, complete],
  );
  const path = rootId?.startsWith('file:') ? rootId.slice(5) : null;
  const impact = useMemo(
    () => (analyzer && path ? analyzer.analyze(path) : null),
    [analyzer, path],
  );
  const [chosen, setChosen] = useState<{
    root: string;
    file: string;
    path: DependencyPath;
  } | null>(null);
  const [shownLargeRoot, setShownLargeRoot] = useState<string | null>(null);
  const active = chosen?.root === rootId ? chosen : null;
  const selectedPath = active?.path;
  if (!result)
    return (
      <div className="workspace-state">
        <h2>Analysis unavailable</h2>
        <p>Dependency analysis is needed to calculate impact.</p>
      </div>
    );
  if (!impact)
    return (
      <div className="workspace-state">
        <h2>Select a source file</h2>
        <p>
          Choose a file in the tree or Architecture Map to see its potential
          impact.
        </p>
      </div>
    );
  if (!impact.selectedFileId)
    return (
      <div className="workspace-state">
        <h2>File is not in the dependency graph</h2>
        <p>
          Choose an analyzed source file. Configuration files do not have
          dependency nodes.
        </p>
      </div>
    );
  const large = impact.dependencyGraph.nodes.length >= 250;
  return (
    <div className="impact-workspace">
      <div className="impact-summary" aria-label="Impact summary">
        <strong>Change: {impact.selectedFilePath}</strong>
        <span>{impact.summary.direct} direct dependents</span>
        <span>{impact.summary.transitive} transitive dependents</span>
        <span>{impact.summary.screens} potentially affected screens</span>
        <small>
          Static dependency evidence identifies possible effects, not breakage.
        </small>
      </div>
      {impact.diagnostics.length > 0 && (
        <details className="analysis-diagnostics" open>
          <summary>
            Analysis may be incomplete or uncertain ({impact.diagnostics.length}
            )
          </summary>
          <ul>
            {impact.diagnostics.map((d) => (
              <li key={d.id}>
                {d.location
                  ? `${d.location.path}:${d.location.start.line}:${d.location.start.column} ? `
                  : ''}
                {d.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="impact-content">
        <div className="impact-results" aria-label="Impact results">
          <h3>Affected files</h3>
          {impact.files.filter((f) => f.category !== 'selected').length ===
          0 ? (
            <p>No dependents found in the available graph.</p>
          ) : (
            impact.files
              .filter((f) => f.category !== 'selected')
              .map((file) => (
                <div key={file.id} className="impact-entry">
                  <button
                    type="button"
                    onClick={() => {
                      const first = file.paths[0];
                      if (first)
                        setChosen({
                          root: rootId!,
                          file: file.id,
                          path: first,
                        });
                      onInspect(file.id);
                    }}
                  >
                    {file.path}
                  </button>
                  <small>
                    {file.category} · {file.distance}{' '}
                    {file.distance === 1 ? 'step' : 'steps'}
                  </small>
                  {file.paths.map((p, i) => (
                    <button
                      type="button"
                      className="impact-path"
                      key={p.id}
                      aria-pressed={selectedPath?.id === p.id}
                      onClick={() => {
                        setChosen({ root: rootId!, file: file.id, path: p });
                        onInspect(file.id);
                      }}
                    >
                      Path {i + 1}:{' '}
                      {p.fileIds
                        .map((id) =>
                          id.startsWith('file:') ? id.slice(5) : id,
                        )
                        .join(' → ')}
                      {p.certainty === 'uncertain'
                        ? ' (uncertain evidence)'
                        : ''}
                    </button>
                  ))}
                  {active?.file === file.id && selectedPath && (
                    <div className="impact-evidence">
                      <strong>Dependency evidence</strong>
                      {selectedPath.evidence.length ? (
                        selectedPath.evidence.map((e, i) => (
                          <small key={i}>
                            {e.description}
                            {e.location
                              ? ` ? ${e.location.path}:${e.location.start.line}:${e.location.start.column}`
                              : ''}
                          </small>
                        ))
                      ) : (
                        <small>
                          No source evidence is available for this path.
                        </small>
                      )}
                    </div>
                  )}
                </div>
              ))
          )}
          <h3>Potentially affected screens</h3>
          {impact.screens.length === 0 ? (
            <p>No screens are directly attributed to the affected files.</p>
          ) : (
            impact.screens.map((screen) => (
              <div className="impact-entry" key={screen.id}>
                <strong>
                  {screen.screen.routePath ?? screen.screen.label}
                </strong>
                <small>
                  {screen.sourceFile} ·{' '}
                  {screen.distance === 0
                    ? 'selected file'
                    : `${screen.distance} dependency steps`}
                </small>
                <small>Screen source attribution; possible impact.</small>
                {screen.evidence.map((e, i) => (
                  <small key={i}>
                    {e.description}
                    {e.location
                      ? ` ? ${e.location.path}:${e.location.start.line}`
                      : ''}
                  </small>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const first = screen.paths[0];
                    if (first)
                      setChosen({
                        root: rootId!,
                        file: `file:${screen.sourceFile}`,
                        path: first,
                      });
                    onInspect(`file:${screen.sourceFile}`);
                  }}
                >
                  Inspect source
                </button>
              </div>
            ))
          )}
        </div>
        <div className="impact-map">
          {large && shownLargeRoot !== rootId ? (
            <div className="workspace-state">
              <h2>Large impact graph</h2>
              <p>
                {impact.files.length} files are included in the result. The list
                is available now; graph layout may take time.
              </p>
              <button
                type="button"
                className="impact-show-graph"
                onClick={() => setShownLargeRoot(rootId)}
              >
                Show retained-path graph
              </button>
            </div>
          ) : (
            <ArchitectureMap
              graph={impact.dependencyGraph}
              selectedId={active?.file ?? impact.selectedFileId}
              onSelectionChange={(id) => {
                if (!id) return;
                const file = impact.files.find((f) => f.id === id);
                const first = file?.paths[0];
                if (first) setChosen({ root: rootId!, file: id, path: first });
                onInspect(id);
              }}
              {...(selectedPath
                ? {
                    highlightedNodeIds: selectedPath.fileIds,
                    highlightedEdgeIds: selectedPath.edgeIds,
                  }
                : {})}
            />
          )}
        </div>
      </div>
    </div>
  );
}
