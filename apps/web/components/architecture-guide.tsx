'use client';
import { useMemo, useState } from 'react';
import type {
  DependencyGraph,
  RepositorySnapshot,
  UIFlowGraph,
} from '@codedna/shared';
import { folderView } from '@/lib/architecture-guide';
export function ArchitectureGuide({
  snapshot,
  graph,
  uiFlow,
  onSelect,
  complete,
}: {
  snapshot: RepositorySnapshot;
  graph: DependencyGraph;
  uiFlow: UIFlowGraph;
  onSelect: (id: string) => void;
  complete: boolean;
}) {
  const [path, setPath] = useState('');
  const view = useMemo(
    () => folderView(snapshot, graph, path),
    [snapshot, graph, path],
  );
  const graphNodeIds = useMemo(
    () => new Set(graph.nodes.map((node) => node.id)),
    [graph.nodes],
  );
  const screens = useMemo(
    () =>
      uiFlow.nodes
        .filter(
          (node) =>
            node.sourceFile && graphNodeIds.has(`file:${node.sourceFile}`),
        )
        .slice(0, 4),
    [uiFlow, graphNodeIds],
  );
  const source = graph.edges.find((edge) => edge.sourceId.startsWith('file:'));
  const [showAll, setShowAll] = useState(false);
  const pathParts = path ? path.split('/') : [];
  return (
    <section className="architecture-guide" aria-label="Codebase guide">
      <div className="guide-hero">
        <div>
          <span className="guide-eyebrow">START HERE / CODEBASE GUIDE</span>
          <h2>Understand the code, one folder at a time.</h2>
          <p>
            Explore where files live, then follow the imports that connect them.
          </p>
        </div>
        <div className="guide-stats">
          <span>
            <strong>{snapshot.files.length}</strong> files in snapshot
          </span>
          <span>
            <strong>{graph.edges.length}</strong> detected dependencies
          </span>
          <span>
            <strong>{uiFlow.nodes.length}</strong> detected screens
          </span>
        </div>
      </div>
      {!complete && (
        <p className="guide-warning">
          This repository snapshot is partial. Some files and connections may be
          missing.
        </p>
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
            <nav className="guide-breadcrumbs" aria-label="Folder path">
              <button type="button" onClick={() => setPath('')}>
                Repository
              </button>
              {pathParts.map((part, index) => (
                <span key={pathParts.slice(0, index + 1).join('/')}>
                  <span aria-hidden="true"> / </span>
                  <button
                    type="button"
                    aria-current={
                      index === pathParts.length - 1 ? 'location' : undefined
                    }
                    onClick={() =>
                      setPath(pathParts.slice(0, index + 1).join('/'))
                    }
                  >
                    {part}
                  </button>
                </span>
              ))}
            </nav>
            <div className="guide-entries">
              {view.folders.map((folder) => (
                <button
                  type="button"
                  className="guide-entry"
                  key={folder.path}
                  onClick={() => {
                    setPath(folder.path);
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
              {(showAll ? view.files : view.files.slice(0, 30)).map((file) => (
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
              {!view.folders.length && !view.files.length && (
                <p>No supported source files in this folder.</p>
              )}
              {view.files.length > 30 && !showAll && (
                <button
                  className="guide-more"
                  type="button"
                  onClick={() => setShowAll(true)}
                >
                  Show all {view.files.length} files
                </button>
              )}
            </div>
          </div>
          {path && (
            <div className="guide-card">
              <span className="guide-eyebrow">HOW THIS FOLDER CONNECTS</span>
              <h3>Direct dependencies</h3>
              <p>
                These are detected import statements crossing the folder
                boundary. Select a file to see the exact source lines.
              </p>
              {view.connections.length ? (
                <ul className="guide-connections">
                  {view.connections.map((item) => (
                    <li key={`${item.direction}:${item.path}`}>
                      <span>
                        {item.direction === 'uses' ? 'Uses' : 'Used by'}{' '}
                        <strong>{item.path}</strong>
                      </span>
                      <small>
                        {item.count} {item.count === 1 ? 'import' : 'imports'}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No crossing imports detected. The analyzer may not resolve
                  every dependency.
                </p>
              )}
            </div>
          )}
        </div>
        <aside className="guide-aside">
          <div className="guide-card">
            <span className="guide-eyebrow">A SIMPLE WAY TO START</span>
            <h3>Explore in three steps</h3>
            <ol className="guide-steps">
              <li>
                <strong>Find a screen</strong>
                <p>Start from a route detected in this snapshot.</p>
                {screens.length ? (
                  screens.map((node) => (
                    <button
                      type="button"
                      key={node.id}
                      onClick={() => onSelect(`file:${node.sourceFile}`)}
                    >
                      {node.routePath ?? node.label} →
                    </button>
                  ))
                ) : (
                  <small>
                    No supported screens detected. Pick a file from the
                    repository instead.
                  </small>
                )}
              </li>
              <li>
                <strong>Follow an import</strong>
                <p>Choose a file to see what it uses and which files use it.</p>
                {source && (
                  <button
                    type="button"
                    onClick={() => onSelect(source.sourceId)}
                  >
                    Inspect a file with an import →
                  </button>
                )}
              </li>
              <li>
                <strong>Explore the map</strong>
                <p>
                  Switch to 2D or 3D to see the same detected connections
                  visually.
                </p>
              </li>
            </ol>
          </div>
          <div className="guide-card guide-legend">
            <span className="guide-eyebrow">READING THE MAP</span>
            <h3>What does an arrow mean?</h3>
            <p>
              <strong>File A → File B</strong> means A imports or re-exports B.
              It does not necessarily mean A calls B at runtime.
            </p>
            <p>
              External packages can be shown separately in the map. Unresolved
              imports are listed in analysis diagnostics.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
