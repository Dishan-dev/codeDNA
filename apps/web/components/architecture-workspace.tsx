'use client';
import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import {
  ArrowUpLeft,
  ChevronRight,
  FolderOpen,
  House,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { buildArchitectureOverview } from '@codedna/graph-ui/architecture-overview';
import type {
  DependencyGraph,
  RepositorySnapshot,
  UIFlowGraph,
  AnalysisDiagnostic,
  CapabilityAssessment,
} from '@codedna/shared';
import type { RepositoryOverview as OverviewData } from '@codedna/core/repository-overview';
import { ArchitectureGuide } from './architecture-guide';
import { RepositoryOverview } from './repository-overview';
import {
  graphForFolder,
  graphForRootFiles,
  graphForQuestion,
  type DependencyQuestion,
} from '@/lib/architecture-guide';
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
const ArchitectureMap = dynamic(
  () => import('@codedna/graph-ui/architecture-map').then((module) => module.ArchitectureMap),
  { ssr: false, loading: () => <p className="architecture-hint">Loading focused map…</p> },
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
  diagnostics,
  onSourceEvidence,
  onExploreImpact,
  initialFolderPath,
  repositoryOverview,
  understanding,
  capabilities,
  repositoryName,
  onOpenScreen,
  onLearning,
  routeDiagnostics,
}: {
  graph: DependencyGraph;
  snapshot: RepositorySnapshot;
  uiFlow: UIFlowGraph;
  complete: boolean;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
  diagnostics: AnalysisDiagnostic[];
  onSourceEvidence: (path: string, line: number) => void;
  onExploreImpact: () => void;
  initialFolderPath?: string;
  repositoryOverview: OverviewData;
  understanding: import('@codedna/shared').RepositoryUnderstanding;
  capabilities: CapabilityAssessment;
  repositoryName: string;
  onOpenScreen: (id: string) => void;
  onLearning: () => void;
  routeDiagnostics: number;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState<'none' | 'native' | 'expanded'>(
    'none',
  );
  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen((current) =>
        document.fullscreenElement === workspaceRef.current
          ? 'native'
          : current === 'native'
            ? 'none'
            : current,
      );
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);
  useEffect(() => {
    if (fullscreen !== 'expanded') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setFullscreen('none');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);
  const toggleFullscreen = async () => {
    if (fullscreen === 'native') {
      try {
        await document.exitFullscreen();
      } catch {
        /* The browser may have already exited. */
      }
      return;
    }
    if (fullscreen === 'expanded') {
      setFullscreen('none');
      return;
    }
    const element = workspaceRef.current;
    if (element?.requestFullscreen && !document.fullscreenElement) {
      try {
        await element.requestFullscreen();
        setFullscreen('native');
        return;
      } catch {
        /* Use the in-page expanded view if fullscreen is unavailable. */
      }
    }
    setFullscreen('expanded');
  };
  const [view, setView] = useState<'guide' | '2d' | '3d'>('guide');
  const [rawGraph, setRawGraph] = useState(false);
  const switchView = (next: 'guide' | '2d' | '3d') => {
    setView(next);
    if (next === 'guide') setRawGraph(false);
  };
  const [showExternal, setShowExternal] = useState(false);
  const [question, setQuestion] = useState<DependencyQuestion>('all');
  useEffect(() => {
    setQuestion(selectedId ? 'direct' : 'all');
  }, [selectedId]);
  const [folderPath, setFolderPath] = useState(initialFolderPath ?? '');
  const [rootFiles, setRootFiles] = useState(false);
  const pathParts = folderPath ? folderPath.split('/') : [];
  const selectedFile = selectedId?.startsWith('file:')
    ? selectedId.slice(5)
    : null;
  const navigateFolder = (path: string, root = false) => {
    setFolderPath(path);
    setRootFiles(root);
    onSelectionChange(null);
    setQuestion('all');
  };
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
    return graphForQuestion(baseGraph, selectedId, question);
  }, [baseGraph, question, selectedId]);
  const overview = useMemo(
    () => buildArchitectureOverview(visibleGraph),
    [visibleGraph],
  );
  const folderGraph = useMemo(
    () =>
      rootFiles
        ? graphForRootFiles(visibleGraph)
        : graphForFolder(visibleGraph, folderPath),
    [visibleGraph, folderPath, rootFiles],
  );
  const folderSelectedId = folderGraph.nodes.some(
    (node) => node.id === selectedId,
  )
    ? selectedId
    : null;
  useEffect(() => {
    if (!selectedId) return;
    const node = graph.nodes.find(
      (item) => item.id === selectedId && item.kind !== 'external',
    );
    if (node) {
      setFolderPath(
        node.label.includes('/')
          ? node.label.slice(0, node.label.lastIndexOf('/'))
          : '',
      );
      setRootFiles(!node.label.includes('/'));
    }
  }, [selectedId, graph]);
  useEffect(() => {
    if (
      selectedId &&
      graph.nodes.some(
        (node) => node.id === selectedId && node.kind === 'external',
      )
    )
      setShowExternal(true);
  }, [selectedId, graph]);
  const openGroup = (id: string | null) => {
    const item = overview.groups.find((group) => group.id === id);
    if (
      item &&
      snapshot.files.some((file) => file.path.startsWith(`${item.label}/`))
    ) {
      navigateFolder(item.label);
    } else if (item?.id.startsWith('group:root:')) {
      navigateFolder('', true);
    }
  };
  const scopedOverview = useMemo(
    () => buildArchitectureOverview(folderGraph),
    [folderGraph],
  );
  const mapHasFileFocus = !!folderSelectedId && !rawGraph;
  const groupedMap = !rawGraph && !mapHasFileFocus;
  const mapGraph = rawGraph
    ? baseGraph
    : mapHasFileFocus
      ? graphForQuestion(
          baseGraph,
          folderSelectedId,
          question === 'all' ? 'direct' : question,
        )
      : folderPath || rootFiles
        ? scopedOverview.graph
        : overview.graph;
  const mapTooLarge =
    !rawGraph && (mapGraph.nodes.length > 100 || mapGraph.edges.length > 250);
  return (
    <div
      ref={workspaceRef}
      className={`architecture-workspace ${fullscreen === 'expanded' ? 'architecture-workspace--expanded' : ''}`}
    >
      <div className="architecture-view-controls">
        <div>
          <strong>
            {view === 'guide'
              ? 'Understand the repository'
              : rawGraph
                ? 'Advanced raw dependency graph'
                : selectedId
                  ? 'File relationships'
                  : folderPath || rootFiles
                    ? 'Module connections'
                    : 'Repository modules'}
          </strong>
          <span>
            {view === 'guide'
              ? 'Explore the structure, then open a file or a focused visualization.'
              : rawGraph
                ? 'Showing all analyzed files and dependencies.'
                : 'Only detected static relationships are shown.'}
          </span>
        </div>
        <div className="architecture-view-buttons">
          <button
            type="button"
            className="architecture-fullscreen-button"
            aria-pressed={fullscreen !== 'none'}
            aria-label={
              fullscreen === 'none'
                ? 'Open fullscreen architecture workspace'
                : 'Exit fullscreen architecture workspace'
            }
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen === 'none' ? (
              <Maximize2 size={14} aria-hidden="true" />
            ) : (
              <Minimize2 size={14} aria-hidden="true" />
            )}
            {fullscreen === 'none' ? 'Fullscreen' : 'Exit fullscreen'}
          </button>
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
          {/* The 3D view (packages/graph-ui architecture-3d) is kept but no longer linked from navigation. */}
          {view !== 'guide' && <details className="architecture-advanced"><summary>Map options</summary><div>
            <button
              type="button"
              aria-pressed={showExternal}
              onClick={() => {
                setShowExternal(!showExternal);
              }}
            >
              {showExternal ? 'Hide packages' : 'Show packages'}
            </button>

            <button
              type="button"
              aria-pressed={rawGraph}
              onClick={() => {
                setRawGraph(!rawGraph);
                setQuestion('all');
              }}
            >
              {rawGraph ? 'Return to focused view' : 'Advanced / Raw graph'}
            </button>
          </div></details>}
        </div>
      </div>
      {view !== 'guide' && (
        <div className="architecture-question">
          <label htmlFor="dependency-question">
            What would you like to see?
          </label>
          <select
            id="dependency-question"
            value={question}
            onChange={(event) =>
              setQuestion(event.target.value as DependencyQuestion)
            }
          >
            <option value="all">All connections in this view</option>
            <option value="direct" disabled={!selectedId}>
              Selected file: direct connections
            </option>
            <option value="uses" disabled={!selectedId}>
              Selected file: what it uses
            </option>
            <option value="dependents" disabled={!selectedId}>
              Selected file: what uses it
            </option>
          </select>
          <span>
            {selectedId
              ? 'Select another file to follow its connections.'
              : 'Select a file to explore a focused question.'}
          </span>
        </div>
      )}
      <div className="guide-location architecture-location">
        <div className="guide-location-header">
          <span>
            <FolderOpen size={14} aria-hidden="true" /> CURRENT LOCATION
          </span>
          {(folderPath || rootFiles || selectedFile) && (
            <button
              type="button"
              className="guide-up"
              onClick={() =>
                selectedFile
                  ? onSelectionChange(null)
                  : navigateFolder(pathParts.slice(0, -1).join('/'))
              }
            >
              <ArrowUpLeft size={14} aria-hidden="true" />{' '}
              {selectedFile ? 'Back to folder' : 'Up one folder'}
            </button>
          )}
        </div>
        <nav
          className="guide-breadcrumbs"
          aria-label="Architecture folder path"
        >
          <button
            type="button"
            aria-current={
              !folderPath && !rootFiles && !selectedFile
                ? 'location'
                : undefined
            }
            onClick={() => navigateFolder('')}
          >
            <House size={13} aria-hidden="true" /> Repository
          </button>
          {rootFiles && (
            <span>
              <ChevronRight size={14} aria-hidden="true" />
              <button
                type="button"
                aria-current={!selectedFile ? 'location' : undefined}
                onClick={() => navigateFolder('', true)}
              >
                Root files
              </button>
            </span>
          )}
          {pathParts.map((part, index) => (
            <span key={pathParts.slice(0, index + 1).join('/')}>
              <ChevronRight size={14} aria-hidden="true" />
              <button
                type="button"
                aria-current={
                  index === pathParts.length - 1 && !selectedFile
                    ? 'location'
                    : undefined
                }
                onClick={() =>
                  navigateFolder(pathParts.slice(0, index + 1).join('/'))
                }
              >
                {part}
              </button>
            </span>
          ))}
          {selectedFile && (
            <span>
              <ChevronRight size={14} aria-hidden="true" />
              <span className="architecture-file-crumb" aria-current="location">
                {selectedFile.split('/').at(-1)}
              </span>
            </span>
          )}
        </nav>
        <p>
          {folderPath
            ? 'Showing this folder and its directly connected files in the maps.'
            : 'Explore a folder in the guide or select a group in a map.'}
        </p>
      </div>
      {view !== 'guide' && groupedMap && (
        <p className="architecture-hint">
          Select a group to inspect its files and direct connections. Group
          names describe paths, not inferred responsibilities. External packages
          are hidden by default.
        </p>
      )}
      <div className="architecture-map-area">
        {view === 'guide' ? (
          folderPath || rootFiles ? (
            <ArchitectureGuide
              key={`${folderPath}:${rootFiles}`}
              snapshot={snapshot}
              graph={graph}
              uiFlow={uiFlow}
              complete={complete}
              onSelect={onSelectionChange}
              path={folderPath}
              onPathChange={navigateFolder}
              selectedId={selectedId}
              diagnostics={diagnostics}
              onSourceEvidence={onSourceEvidence}
              onExploreImpact={onExploreImpact}
              rootFiles={rootFiles}
              onVisualize={() => switchView('2d')}
              moduleDescription={understanding.modules.find((module) => module.path === folderPath)?.description.text}
            />
          ) : (
            <RepositoryOverview
              overview={repositoryOverview}
              understanding={understanding}
              capabilities={capabilities}
              name={repositoryName}
              onModule={(path) => navigateFolder(path, !path)}
              onScreen={onOpenScreen}
              onLearning={onLearning}
              onEvidence={onSourceEvidence}
              routeDiagnostics={routeDiagnostics}
            />
          )
        ) : mapTooLarge ? (
          <div className="workspace-state" role="status">
            <h2>This selection has too many connections for a clear map</h2>
            <p>
              {mapGraph.nodes.length} nodes and {mapGraph.edges.length}{' '}
              connections are available. Explore a smaller folder or file in
              Guide, or choose Advanced / Raw graph to inspect everything.
            </p>
            <button
              className="guide-action"
              type="button"
              onClick={() => switchView('guide')}
            >
              Return to Guide
            </button>
          </div>
        ) : view === '3d' ? (
          <View3DBoundary>
            <Architecture3D
              graph={mapGraph}
              {...(groupedMap
                ? {
                    edgeEvidence: (folderPath || rootFiles
                      ? scopedOverview
                      : overview
                    ).edgeEvidence,
                    evidenceGraph: graph,
                    onEvidence: onSourceEvidence,
                  }
                : { evidenceGraph: graph, onEvidence: onSourceEvidence })}
              selectedId={groupedMap ? null : folderSelectedId}
              onSelectionChange={groupedMap ? openGroup : onSelectionChange}
              onFolderNavigate={(path) => {
                if (
                  snapshot.files.some((file) =>
                    file.path.startsWith(`${path}/`),
                  )
                )
                  navigateFolder(path);
              }}
            />
          </View3DBoundary>
        ) : (
          <ArchitectureMap
            graph={mapGraph}
            {...(groupedMap
              ? {
                  edgeEvidence: (folderPath || rootFiles
                    ? scopedOverview
                    : overview
                  ).edgeEvidence,
                  evidenceGraph: graph,
                  onEvidence: onSourceEvidence,
                }
              : { evidenceGraph: graph, onEvidence: onSourceEvidence })}
            selectedId={groupedMap ? null : folderSelectedId}
            onSelectionChange={groupedMap ? openGroup : onSelectionChange}
          />
        )}
      </div>
    </div>
  );
}
