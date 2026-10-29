'use client';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { ArchitectureMap } from '@codedna/graph-ui';
import Link from 'next/link';
import {
  ArrowLeft,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileCode2,
  Folder,
  GitBranch,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radar,
  Search,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react';
import type {
  AnalysisResult,
  RepositorySnapshot,
  SourceFile,
} from '@codedna/shared';
import { Brand } from './brand';
import { Badge, Button, Input, Panel, Tooltip } from './ui';

type Mode = 'Architecture' | 'UI Flow' | 'Impact Analysis' | 'Learning Mode';
const modes = [
  { name: 'Architecture', icon: LayoutDashboard },
  { name: 'UI Flow', icon: Waypoints },
  { name: 'Impact Analysis', icon: Radar },
  { name: 'Learning Mode', icon: Sparkles },
] as const;
export type WorkspaceState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: RepositorySnapshot; result?: AnalysisResult };

function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? modes.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + modes.length) %
            modes.length;
    const chosen = modes[next];
    if (chosen) {
      onChange(chosen.name);
      document.getElementById(`mode-${next}`)?.focus();
    }
  }
  return (
    <div className="mode-tabs" role="tablist" aria-label="Explorer mode">
      {modes.map(({ name, icon: Icon }, index) => (
        <button
          key={name}
          id={`mode-${index}`}
          role="tab"
          aria-selected={mode === name}
          aria-controls="workspace-panel"
          tabIndex={mode === name ? 0 : -1}
          onClick={() => onChange(name)}
          onKeyDown={(e) => navigate(e, index)}
        >
          <Icon size={16} />
          <span>{name}</span>
        </button>
      ))}
    </div>
  );
}
export function Workspace({
  state,
  mode,
  selectedId,
  onSelectionChange,
}: {
  state: WorkspaceState;
  mode: Mode;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
}) {
  if (state.status === 'loading')
    return (
      <div className="workspace-state" role="status">
        <span className="state-orbit">
          <span className="spinner" />
        </span>
        <h2>Preparing your workspace</h2>
        <p>Getting the repository ready to explore.</p>
      </div>
    );
  if (state.status === 'error')
    return (
      <div className="workspace-state" role="alert">
        <span className="state-orbit">
          <CircleHelp size={25} />
        </span>
        <h2>Something went wrong</h2>
        <p>{state.message}</p>
      </div>
    );
  if (state.status === 'empty')
    return (
      <div className="workspace-state">
        <span className="state-orbit">
          <Box size={25} />
        </span>
        <h2>No repository selected</h2>
        <p>Choose a repository to begin exploring.</p>
      </div>
    );
  if (mode === 'Architecture' && state.result)
    return (
      <ArchitectureMap
        graph={state.result.dependencyGraph}
        selectedId={selectedId}
        onSelectionChange={onSelectionChange}
      />
    );
  return (
    <div className="workspace-state">
      <div className="workspace-illustration" aria-hidden="true">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <span className="orbit-point p1" />
        <span className="orbit-point p2" />
        <span className="orbit-point p3" />
        <div className="workspace-symbol">
          <GitBranch size={27} />
        </div>
      </div>
      <div className="state-eyebrow">{mode.toUpperCase()} / WORKSPACE</div>
      <h2>
        {mode === 'Architecture'
          ? 'A little space to see the big picture.'
          : `${mode} is on the way.`}
      </h2>
      <p>
        {state.result
          ? 'This mode is not available yet. Switch to Architecture to explore file dependencies.'
          : 'This is a bundled example repository. Select a file to inspect its source; the interactive graph is coming in the next phase.'}
      </p>
      <div className="state-pills">
        <span>
          <i /> SAMPLE REPOSITORY
        </span>
        <span>
          <i /> GRAPH COMING SOON
        </span>
      </div>
    </div>
  );
}
function FileList({
  files,
  selected,
  onSelect,
  query,
}: {
  files: SourceFile[];
  selected: string | null;
  onSelect: (file: SourceFile) => void;
  query: string;
}) {
  const matches = files.filter((file) =>
    file.path.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="file-list">
      <div className="tree-root">
        <ChevronDown size={14} />
        <Folder size={15} />
        <span>example-repository</span>
      </div>
      {matches.length ? (
        matches.map((file) => (
          <button
            key={file.id}
            className={`file-item ${selected === file.path ? 'selected' : ''}`}
            onClick={() => onSelect(file)}
            aria-pressed={selected === file.path}
          >
            <FileCode2 size={15} />
            <span>{file.path}</span>
          </button>
        ))
      ) : (
        <p className="no-files">No files match your search.</p>
      )}
    </div>
  );
}
export function Explorer({
  snapshot,
  result,
}: {
  snapshot: RepositorySnapshot;
  result?: AnalysisResult;
}) {
  const [mode, setMode] = useState<Mode>('Architecture');
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    snapshot.files.find((file) => `file:${file.path}` === selectedId) ?? null;
  const selectedNode = result?.dependencyGraph.nodes.find(
    (node) => node.id === selectedId,
  );
  const onSelectionChange = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setRight(true);
      if (window.matchMedia('(max-width: 760px)').matches) setLeft(false);
    }
  }, []);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setLeft(false);
      setRight(false);
    }
  }, []);
  const state: WorkspaceState = result
    ? { status: 'ready', snapshot, result }
    : { status: 'ready', snapshot };
  return (
    <div className="explorer">
      <header className="explorer-header">
        <div className="explorer-header-left">
          <Brand />
          <span className="header-divider" />
          <Link href="/" className="back-link">
            <ArrowLeft size={14} /> Home
          </Link>
          <span className="header-divider" />
          <div className="repo-identity">
            <span className="repo-icon">
              <GitBranch size={15} />
            </span>
            <div>
              <small>REPOSITORY</small>
              <strong>example-repository</strong>
            </div>
            <ChevronDown size={14} />
          </div>
          <Badge className="sample-badge">SAMPLE</Badge>
        </div>
        <div className="explorer-header-right">
          <span className="header-note">
            <span className="status-dot" /> LOCAL EXAMPLE
          </span>
          <Tooltip label="About this workspace">
            <a
              href="#workspace-help"
              className="icon-link"
              aria-label="About this workspace"
            >
              <CircleHelp size={18} />
            </a>
          </Tooltip>
        </div>
      </header>
      <div className="explorer-nav">
        <ModeTabs mode={mode} onChange={setMode} />
        <div className="panel-controls">
          <Tooltip label={left ? 'Hide files' : 'Show files'}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={left ? 'Hide files' : 'Show files'}
              aria-expanded={left}
              onClick={() => {
                if (!left && window.matchMedia('(max-width: 760px)').matches)
                  setRight(false);
                setLeft(!left);
              }}
            >
              {left ? (
                <PanelLeftClose size={17} />
              ) : (
                <PanelLeftOpen size={17} />
              )}
            </Button>
          </Tooltip>
          <Tooltip label={right ? 'Hide inspector' : 'Show inspector'}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={right ? 'Hide inspector' : 'Show inspector'}
              aria-expanded={right}
              onClick={() => {
                if (!right && window.matchMedia('(max-width: 760px)').matches)
                  setLeft(false);
                setRight(!right);
              }}
            >
              {right ? (
                <PanelRightClose size={17} />
              ) : (
                <PanelRightOpen size={17} />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
      <div
        className={`explorer-body ${!left ? 'without-left' : ''} ${!right ? 'without-right' : ''}`}
      >
        {left && (
          <Panel className="file-panel" aria-label="Repository files">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">YOUR REPOSITORY</span>
                <h2>
                  Files{' '}
                  <span className="file-count">{snapshot.files.length}</span>
                </h2>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setLeft(false)}
                aria-label="Close file panel"
              >
                <PanelLeftClose size={16} />
              </Button>
            </div>
            <label className="search-box">
              <Search size={15} />
              <span className="sr-only">Filter files</span>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter files..."
              />
            </label>
            <div className="panel-section-label">
              REPOSITORY <ChevronDown size={13} aria-hidden="true" />
            </div>
            <FileList
              files={snapshot.files}
              selected={selected?.path ?? null}
              onSelect={(file) => {
                onSelectionChange(`file:${file.path}`);
                setRight(true);
                if (window.matchMedia('(max-width: 760px)').matches)
                  setLeft(false);
              }}
              query={query}
            />
            <div className="panel-bottom">
              <span className="status-dot" /> BUNDLED EXAMPLE <span>v1.0</span>
            </div>
          </Panel>
        )}
        <section
          id="workspace-panel"
          className="workspace"
          role="tabpanel"
          aria-labelledby={`mode-${modes.findIndex((item) => item.name === mode)}`}
          tabIndex={0}
        >
          <div className="workspace-top">
            <div>
              <span>EXPLORER</span>
              <ChevronRight size={13} />
              <strong>{mode}</strong>
            </div>
            <Badge>PREVIEW</Badge>
          </div>
          {result && result.diagnostics.length > 0 && (
            <details className="analysis-diagnostics">
              <summary>
                {result.diagnostics.length} analysis diagnostic
                {result.diagnostics.length === 1 ? '' : 's'}
              </summary>
              <ul>
                {result.diagnostics.map((d) => (
                  <li key={d.id}>
                    <strong>{d.severity}</strong>{' '}
                    {d.location
                      ? `${d.location.path}:${d.location.start.line}:${d.location.start.column} - `
                      : ''}
                    {d.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Workspace
            state={state}
            mode={mode}
            selectedId={selectedId}
            onSelectionChange={onSelectionChange}
          />
          <div className="workspace-footer">
            <span>
              <span className="status-dot" /> SAMPLE DATA
            </span>
            <span id="workspace-help">
              Importer to dependency. Repository import is coming soon.
            </span>
          </div>
        </section>
        {right && (
          <Panel className="inspector" aria-label="Context inspector">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">THE DETAILS</span>
                <h2>Inspector</h2>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setRight(false)}
                aria-label="Close inspector"
              >
                <PanelRightClose size={16} />
              </Button>
            </div>
            {selected ? (
              <div className="inspector-content">
                <div className="inspector-label">
                  SELECTED FILE{' '}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Clear selected file"
                    onClick={() => onSelectionChange(null)}
                  >
                    <X size={14} />
                  </Button>
                </div>
                <div className="selected-file">
                  <span className="node-icon blue">
                    <FileCode2 size={18} />
                  </span>
                  <div>
                    <strong>{selected.path.split('/').at(-1)}</strong>
                    <small>{selected.path}</small>
                  </div>
                </div>
                <div className="inspector-rule" />
                <div className="inspector-label">
                  SOURCE <span>EXAMPLE</span>
                </div>
                <pre className="source-preview">
                  <code>{selected.content}</code>
                </pre>
                <p className="inspector-footnote">
                  Source from the bundled example. Select a connected node to
                  explore its dependencies.
                </p>
              </div>
            ) : selectedNode ? (
              <div className="inspector-content">
                <div className="inspector-label">
                  EXTERNAL PACKAGE{' '}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Clear selected package"
                    onClick={() => onSelectionChange(null)}
                  >
                    <X size={14} />
                  </Button>
                </div>
                <div className="selected-file">
                  <span className="node-icon teal">
                    <Box size={18} />
                  </span>
                  <div>
                    <strong>{selectedNode.label}</strong>
                    <small>External dependency</small>
                  </div>
                </div>
                <p className="inspector-footnote">
                  Package availability is not verified by static analysis.
                </p>
              </div>
            ) : (
              <div className="inspector-empty">
                <div className="inspector-empty-icon">
                  <Braces size={20} />
                </div>
                <h3>Nothing selected yet</h3>
                <p>Select a file from the sidebar to see its details here.</p>
              </div>
            )}
            <div className="inspector-bottom">
              <span>CONTEXT, WHEN YOU NEED IT</span>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
