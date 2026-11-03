'use client';
import { useMemo, useState } from 'react';
import type {
  DependencyGraph,
  RepositorySnapshot,
  UIFlowGraph,
  AnalysisDiagnostic,
  DependencyEdge,
} from '@codedna/shared';
import { folderView, type FolderConnection } from '@/lib/architecture-guide';
function ConnectionDetails({
  item,
  labels,
  onEvidence,
}: {
  item: FolderConnection;
  labels: Map<string, string>;
  onEvidence: (path: string, line: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const edges: DependencyEdge[] = showAll
    ? item.edges
    : item.edges.slice(0, 20);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {item.direction === 'uses' ? 'Uses' : 'Used by'}{' '}
        <strong>{item.path}</strong>{' '}
        <small>
          {item.count} {item.count === 1 ? 'dependency' : 'dependencies'}
        </small>
      </summary>
      {open && (
        <div className="guide-evidence-list">
          {edges.map((edge) => (
            <div key={edge.id}>
              <span>
                {labels.get(edge.sourceId) ?? edge.sourceId} →{' '}
                {labels.get(edge.targetId) ?? edge.targetId}
              </span>
              <small>
                {edge.kind ?? 'dependency'}
                {edge.specifier ? ` · ${edge.specifier}` : ''}
              </small>
              {edge.location && (
                <button
                  type="button"
                  onClick={() =>
                    onEvidence(edge.location!.path, edge.location!.start.line)
                  }
                >
                  View {edge.location.path}:{edge.location.start.line}
                </button>
              )}
            </div>
          ))}
          {!showAll && item.edges.length > 20 && (
            <button type="button" onClick={() => setShowAll(true)}>
              Show all {item.edges.length} dependencies
            </button>
          )}
        </div>
      )}
    </details>
  );
}
export function ArchitectureGuide({
  snapshot,
  graph,
  uiFlow,
  onSelect,
  complete,
  path,
  onPathChange,
  selectedId,
  diagnostics,
  onSourceEvidence,
  onExploreImpact,
  rootFiles,
  onVisualize,
  moduleDescription,
}: {
  snapshot: RepositorySnapshot;
  graph: DependencyGraph;
  uiFlow: UIFlowGraph;
  onSelect: (id: string) => void;
  complete: boolean;
  path: string;
  onPathChange: (path: string) => void;
  selectedId: string | null;
  diagnostics: AnalysisDiagnostic[];
  onSourceEvidence: (path: string, line: number) => void;
  onExploreImpact: () => void;
  rootFiles?: boolean;
  onVisualize: () => void;
  moduleDescription?: string | undefined;
}) {
  const view = useMemo(
    () => folderView(snapshot, graph, path),
    [snapshot, graph, path],
  );
  const graphNodeIds = useMemo(
    () => new Set(graph.nodes.map((node) => node.id)),
    [graph.nodes],
  );
  const labels = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.label])),
    [graph.nodes],
  );
  const screens = useMemo(
    () =>
      uiFlow.nodes
        .filter(
          (node) =>
            node.sourceFile &&
            graphNodeIds.has(`file:${node.sourceFile}`) &&
            (rootFiles
              ? !node.sourceFile.includes('/')
              : !path || node.sourceFile.startsWith(`${path}/`)),
        )
        .slice(0, 4),
    [uiFlow, graphNodeIds, path, rootFiles],
  );
  const source = graph.edges.find(
    (edge) =>
      edge.location &&
      (rootFiles
        ? !edge.location.path.includes('/')
        : !path || edge.location.path.startsWith(`${path}/`)),
  );
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState('');
  const folders = (rootFiles ? [] : view.folders).filter((item) =>
    item.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const files = view.files.filter((item) =>
    item.path.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="architecture-guide" aria-label="Codebase guide">
      <div className="guide-hero">
        <div>
          <span className="guide-eyebrow">02 / MODULE</span>
          <h2>{rootFiles ? 'Root files' : path || 'Repository files'}</h2>
          <p>{moduleDescription || 'A source folder in this repository. Open a file to inspect its detected relationships.'}</p>
        </div>
        <div className="guide-stats">
          <span>
            <strong>
              {rootFiles
                ? view.files.length
                : snapshot.files.filter(
                    (file) => !path || file.path.startsWith(`${path}/`),
                  ).length}
            </strong>{' '}
            files in this folder
          </span>
          <span>
            <strong>
              {view.connections.reduce((sum, item) => sum + item.count, 0)}
            </strong>{' '}
            connections outside this folder
          </span>
          <span>
            <strong>{screens.length}</strong> suggested screens
          </span>
        </div>
      </div>
      {!complete && (
        <p className="guide-warning">
          This repository snapshot is partial. Some files and connections may be
          missing.
        </p>
      )}
      {selectedId?.startsWith('file:') && (
        <div className="guide-card">
          <span className="guide-eyebrow">SELECTED FILE</span>
          <h3>{selectedId.slice(5)}</h3>
          <p>
            The inspector shows its source and directly detected dependencies.
            Open a small map only if you need a visual view.
          </p>
          <button className="guide-action" type="button" onClick={onVisualize}>
            Visualize relationships →
          </button>{' '}
          <button
            className="guide-more"
            type="button"
            onClick={onExploreImpact}
          >
            View potential impact →
          </button>
        </div>
      )}
      <div className="guide-grid">
        <div className="guide-main">
          <div className="guide-card">
            <div className="guide-heading">
              <div>
                <span className="guide-eyebrow">EXPLORE THE STRUCTURE</span>
                <h3>Repository files</h3>
              </div>
              <span>
                {view.folders.length} folders · {view.files.length} files here
              </span>
            </div>
            <label className="guide-file-search">
              Search files and folders{' '}
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter this folder"
              />
            </label>
            <div className="guide-entries">
              {(showAll ? folders : folders.slice(0, 8)).map((folder) => (
                <button
                  type="button"
                  className="guide-entry"
                  key={folder.path}
                  onClick={() => {
                    onPathChange(folder.path);
                    setShowAll(false);
                  }}
                >
                  <span className="guide-entry-icon">▤</span>
                  <span>
                    <strong>{folder.name}</strong>
                    <small>
                      {folder.count} source{' '}
                      {folder.count === 1 ? 'file' : 'files'} inside
                    </small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
              {(showAll ? files : files.slice(0, 8)).map((file) => (
                <button
                  type="button"
                  className="guide-entry"
                  key={file.id}
                  onClick={() => onSelect(`file:${file.path}`)}
                >
                  <span className="guide-entry-icon file">{'{ }'}</span>
                  <span>
                    <strong>{file.path.split('/').at(-1)}</strong>
                    <small>Open file and detected relationships</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
              {!folders.length && !files.length && (
                <p>No supported source files in this folder.</p>
              )}
              {(files.length > 8 || folders.length > 8) && !showAll && (
                <button
                  className="guide-more"
                  type="button"
                  onClick={() => setShowAll(true)}
                >
                  Show all folders and files ({folders.length + files.length})
                </button>
              )}
            </div>
          </div>
          {path && (
            <details className="guide-card guided-secondary">
              <summary>Direct relationships with other modules ({view.connections.length})</summary>
              <span className="guide-eyebrow">HOW THIS FOLDER CONNECTS</span>
              <h3>Direct dependencies</h3>
              <p>
                Expand a relationship to see the actual files and import
                locations. Arrows point from the importing file to its
                dependency.
              </p>
              {view.connections.length ? (
                <ul className="guide-connections">
                  {view.connections.map((item) => (
                    <li key={`${item.direction}:${item.path}`}>
                      <ConnectionDetails
                        item={item}
                        labels={labels}
                        onEvidence={onSourceEvidence}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No crossing imports detected. The analyzer may not resolve
                  every dependency.
                </p>
              )}
            </details>
          )}
        </div>
        <aside className="guide-aside">
          <div className="guide-card"><span className="guide-eyebrow">NEXT STEP</span><h3>Follow an entry point</h3>{screens.length ? screens.map((node) => <button type="button" className="guide-entry" key={node.id} onClick={() => onSelect(`file:${node.sourceFile}`)}>{node.routePath ?? node.label} →</button>) : source ? <button type="button" className="guide-entry" onClick={() => onSelect(source.sourceId)}>Inspect a file with an import →</button> : <p>Select a file in this folder to inspect its source.</p>}<button type="button" className="guide-more" onClick={onVisualize}>Show a focused 2D map →</button></div>
          <details className="guide-card guided-secondary"><summary>Analysis status and map legend</summary><p>File A → File B means A imports or re-exports B. Runtime calls are not established by imports alone.</p><p>{diagnostics.length} analysis diagnostics. Static analysis may miss dynamic dependencies.</p><ul className="guide-diagnostics">{diagnostics.slice(0, 20).map((item) => <li key={item.id}>{item.message}{item.location && <button type="button" onClick={() => onSourceEvidence(item.location!.path, item.location!.start.line)}>{item.location.path}:{item.location.start.line}</button>}</li>)}</ul></details>
        </aside>
      </div>
    </section>
  );
}
