'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { generateLearningPlan } from '@codedna/core/learning';
import { assessCapabilities } from '@codedna/core/capabilities';
import {
  summarizeRepository,
  type RepositoryOverview as OverviewData,
} from '@codedna/core/repository-overview';
import type { ActionIndex } from '@codedna/shared';
import { FlowOverview } from './flow-overview';
import { AdvancedMenu, ActionSearch, type AdvancedItem } from './flow-header';
import { readFlowLocation, screenTab, tracePermalink, writeFlowLocation, type FlowLocation, type Screen } from '@/lib/flow-state';
import { DiscoverWorkspace } from './discover-workspace';
import { FeatureWorkspace } from './feature-workspace';
import type { UIFlowAnalysis } from '@codedna/core';
import { learningSessionKey, screenForFile } from '@/lib/explorer-session';
import type { ExplorerSession } from '@/lib/explorer-session';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileCode2,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Radar,
  Search,
  Sparkles,
  Sun,
  Moon,
  Waypoints,
  X,
} from 'lucide-react';
import type {
  AnalysisResult,
  RepositorySnapshot,
  LearningPlan,
  CapabilityAssessment,
  DependencyGraph,
  RepositoryUnderstanding,
  FeatureDiscovery,
} from '@codedna/shared';
import { Brand } from './brand';
import { FileList } from './file-list';
import { FileRelationships } from './file-relationships';
import { filePracticeSuggestions } from '@/lib/practice-suggestions';
import {
  LearningWorkspace,
  emptyLearningProgress,
  type LearningProgress,
} from './learning-workspace';
import { Button, Input, Panel, Tooltip } from './ui';

const BehaviorTools = dynamic(() => import('./behavior-tools').then((module) => module.BehaviorTools), { loading: () => <p className="workspace-state">Preparing behavior tools…</p> });
const DiagnosticsView = dynamic(() => import('./diagnostics-view').then((module) => module.DiagnosticsView), { loading: () => <p className="workspace-state">Collecting diagnostics…</p> });
const SimulationWorkspace = dynamic(() => import('./simulation-workspace').then((module) => module.SimulationWorkspace), { loading: () => <p className="workspace-state">Preparing static walkthrough…</p> });
const ImpactWorkspace = dynamic(() => import('./impact-workspace').then((module) => module.ImpactWorkspace), { loading: () => <p className="workspace-state">Preparing impact analysis…</p> });
const ArchitectureWorkspace = dynamic(() => import('./architecture-workspace').then((module) => module.ArchitectureWorkspace), { loading: () => <p className="workspace-state">Preparing architecture…</p> });
const PageInventory = dynamic(() => import('./page-inventory').then((module) => module.PageInventory), { loading: () => <p className="workspace-state">Preparing the page…</p> });
const ActionTrace = dynamic(() => import('./action-trace').then((module) => module.ActionTrace), { loading: () => <p className="workspace-state">Preparing the trace…</p> });
const ReachView = dynamic(() => import('./reach-view').then((module) => module.ReachView), { loading: () => <p className="workspace-state">Finding callers…</p> });
const RouteExplorer = dynamic(() => import('./route-explorer').then((module) => module.RouteExplorer), { loading: () => <p className="workspace-state">Preparing routes…</p> });
type Mode = 'Discover' | 'Architecture' | 'Features' | 'Static Walkthrough' | 'UI Flow' | 'Impact Analysis' | 'Learning Mode';
const modes = [
  { name: 'Discover', icon: Search },
  { name: 'Architecture', icon: LayoutDashboard },
  { name: 'Features', icon: Braces },
  { name: 'Static Walkthrough', icon: Play },
  { name: 'UI Flow', icon: Waypoints },
  { name: 'Impact Analysis', icon: Radar },
  { name: 'Learning Mode', icon: Sparkles },
] as const;
const emptyDependencyGraph: DependencyGraph = {
  schemaVersion: '1.0',
  nodes: [],
  edges: [],
};
export type WorkspaceState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: RepositorySnapshot; result?: AnalysisResult };

function HeaderTabs({ screen, onOverview, onPages }: { screen: Screen; onOverview: () => void; onPages: () => void }) {
  const tab = screenTab(screen);
  return (
    <nav className="flow-tabs" aria-label="Main">
      <button type="button" aria-current={tab === 'Overview' ? 'page' : undefined} onClick={onOverview}>Overview</button>
      <button type="button" aria-current={tab === 'Pages' ? 'page' : undefined} onClick={onPages}>Pages</button>
    </nav>
  );
}
const ADVANCED_ITEMS: AdvancedItem[] = [
  { id: 'Architecture', label: 'Architecture graph', hint: 'Module map and dependency graph' },
  { id: 'Features', label: 'Module & route explorer', hint: 'Former Features workspace' },
  { id: 'UI Flow', label: 'Routes & navigation', hint: 'Detected screens and links' },
  { id: 'Static Walkthrough', label: 'Function walkthrough', hint: 'Walk any exported function' },
  { id: 'Impact Analysis', label: 'File impact', hint: 'Which files and screens import a file' },
  { id: 'Learning Mode', label: 'Learning mode', hint: 'A guided tour of the structure' },
  { id: 'Discover', label: 'Discover modules', hint: 'Documentation, modules and symbols' },
  { id: 'diagnostics', label: 'Diagnostics', hint: 'What the analyzer could and couldn’t run' },
  { id: 'stories', label: 'Behavior stories', hint: 'Earlier story player' },
  { id: 'ask', label: 'Ask CodeDNA', hint: 'Questions answered from detected behaviors' },
  { id: 'export', label: 'Export traces (JSON)', hint: 'Download the page and action analysis' },
];
function ModeTabs({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  useEffect(() => {
    document.getElementById(`mode-${modes.findIndex((item) => item.name === mode)}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [mode]);
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
          aria-label={name === 'UI Flow' ? 'Routes & Features' : name === 'Learning Mode' ? 'Learning' : name}
          aria-selected={mode === name}
          aria-controls="workspace-panel"
          tabIndex={mode === name ? 0 : -1}
          onClick={() => onChange(name)}
          onKeyDown={(e) => navigate(e, index)}
        >
          <Icon size={16} />
          <span>
            {name === 'UI Flow'
              ? 'Routes & Features'
              : name === 'Learning Mode'
                ? 'Learning'
                : name}
          </span>
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
  uiFlow,
  uiSelectedId,
  onUISelection,
  frameworkDetected,
  impactComplete,
  onImpactInspect,
  onSourceEvidence,
  onExploreImpact,
  capabilities,
  overview,
  understanding,
  features,
  featureSelectedId,
  onFeatureSelection,
  onDiscoverModule,
  onFeatureArchitecture,
  onStartSimulation,
  onSimulationFeature,
  onBackFeatures,
  onDocumentEvidence,
  repositoryName,
  initialFolderPath,
  onOpenScreen,
  onOpenOverviewMode,
  learningPlan,
  learningProgress,
  onLearningProgress,
  onLearningInspect,
  onLearningExplore,
}: {
  state: WorkspaceState;
  mode: Mode;
  selectedId: string | null;
  onSelectionChange: (id: string | null) => void;
  uiFlow: UIFlowAnalysis;
  uiSelectedId: string | null;
  onUISelection: (id: string | null) => void;
  frameworkDetected: boolean;
  impactComplete: boolean;
  onImpactInspect: (id: string) => void;
  onSourceEvidence: (path: string, line: number) => void;
  onExploreImpact: () => void;
  capabilities: CapabilityAssessment;
  overview: OverviewData;
  understanding: RepositoryUnderstanding;
  features: FeatureDiscovery;
  featureSelectedId: string | null;
  onFeatureSelection: (id: string) => void;
  onDiscoverModule: (path: string) => void;
  onFeatureArchitecture: (path: string) => void;
  onStartSimulation: (id: string) => void;
  onSimulationFeature: (id: string) => void;
  onBackFeatures: () => void;
  onDocumentEvidence: (path: string, line: number) => void;
  repositoryName: string;
  initialFolderPath: string;
  onOpenScreen: (id: string) => void;
  onOpenOverviewMode: (mode: 'Architecture' | 'Learning Mode') => void;
  learningPlan: LearningPlan;
  learningProgress: LearningProgress;
  onLearningProgress: (progress: LearningProgress) => void;
  onLearningInspect: (file: string) => void;
  onLearningExplore: (
    mode: 'Architecture' | 'UI Flow' | 'Impact Analysis',
    file?: string,
    screenId?: string,
  ) => void;
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
  if (mode === 'Discover') return <DiscoverWorkspace understanding={understanding} features={features} onModule={onDiscoverModule} onFeature={(id) => { onFeatureSelection(id); }} onFile={onDocumentEvidence} />;
  if (mode === 'Features') return <FeatureWorkspace discovery={features} selectedId={featureSelectedId} onSelect={onFeatureSelection} onSource={onSourceEvidence} onArchitecture={onFeatureArchitecture} onSimulation={onStartSimulation} />;
  if (mode === 'Static Walkthrough') return <SimulationWorkspace discovery={features} snapshot={state.snapshot} featureId={featureSelectedId} complete={impactComplete} onFeature={onSimulationFeature} onBackFeatures={onBackFeatures} onBackArchitecture={onFeatureArchitecture} />;
  if (mode === 'Architecture')
    return (
      <ArchitectureWorkspace
        graph={state.result?.dependencyGraph ?? emptyDependencyGraph}
        snapshot={state.snapshot}
        uiFlow={uiFlow.graph}
        complete={impactComplete}
        selectedId={selectedId}
        onSelectionChange={onSelectionChange}
        diagnostics={state.result?.diagnostics ?? []}
        onSourceEvidence={onSourceEvidence}
        onExploreImpact={onExploreImpact}
        initialFolderPath={initialFolderPath}
        repositoryOverview={overview}
        understanding={understanding}
        capabilities={capabilities}
        repositoryName={repositoryName}
        onOpenScreen={onOpenScreen}
        onLearning={() => onOpenOverviewMode('Learning Mode')}
        routeDiagnostics={uiFlow.diagnostics.length}
      />
    );
  if (mode === 'Learning Mode')
    return (
      <LearningWorkspace
        plan={learningPlan}
        progress={learningProgress}
        onProgress={onLearningProgress}
        onInspect={onLearningInspect}
        onExplore={onLearningExplore}
      />
    );
  if (mode === 'Impact Analysis')
    return (
      <ImpactWorkspace
        {...(state.result ? { result: state.result } : {})}
        uiFlow={uiFlow}
        rootId={selectedId}
        complete={impactComplete}
        onInspect={onImpactInspect}
      />
    );
  if (mode === 'UI Flow')
    return (
      <RouteExplorer
        analysis={state.result}
        uiFlow={uiFlow}
        selectedId={uiSelectedId}
        onSelect={onUISelection}
        onSource={onSourceEvidence}
        frameworkDetected={frameworkDetected}
      />
    );
  return null;
}
export function Explorer({
  snapshot,
  result,
  uiFlow,
  understanding,
  features,
  actions,
  repositoryName,
  source,
  completeness,
  acquisitionDiagnostics,
}: {
  snapshot: RepositorySnapshot;
  result?: AnalysisResult;
  uiFlow: UIFlowAnalysis;
  understanding: RepositoryUnderstanding;
  features: FeatureDiscovery;
  actions?: ActionIndex | undefined;
  repositoryName: string;
  source: ExplorerSession['source'];
  completeness: ExplorerSession['completeness'];
  acquisitionDiagnostics: ExplorerSession['acquisitionDiagnostics'];
}) {
  const [mode, setMode] = useState<Mode>('Discover');
  const [location, setLocation] = useState<FlowLocation>({ screen: 'overview' });
  const screen = location.screen;
  const navigate = useCallback((next: FlowLocation, replace = false) => {
    setLocation(next);
    const url = `${window.location.pathname}${writeFlowLocation(window.location.search, next)}`;
    if (replace) window.history.replaceState(window.history.state, '', url);
    else {
      window.history.pushState(window.history.state, '', url);
      document.getElementById('workspace-panel')?.scrollTo?.({ top: 0 });
    }
  }, []);
  useEffect(() => {
    const read = () => {
      const next = readFlowLocation(window.location.search);
      setLocation(next);
      if (next.screen === 'advanced' && modes.some((item) => item.name === next.mode)) setMode(next.mode as Mode);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  useEffect(() => {
    if (location.screen === 'advanced' && location.mode !== mode) navigate({ screen: 'advanced', mode }, true);
  }, [location, mode, navigate]);
  const openAdvanced = useCallback((nextMode?: Mode) => {
    const target = nextMode ?? mode;
    setMode(target);
    navigate({ screen: 'advanced', mode: target });
  }, [mode, navigate]);
  const capabilities = useMemo(
    () =>
      assessCapabilities(snapshot, result, uiFlow, {
        complete: completeness.complete,
        skippedFiles: completeness.skippedFiles,
        documentationAnalyzed: true,
        symbolsAnalyzed: true,
        staticWalkthroughReady: features.features.length > 0,
      }),
    [
      snapshot,
      result,
      uiFlow,
      completeness.complete,
      completeness.skippedFiles,
      features.features.length,
    ],
  );
  const [architecturePath, setArchitecturePath] = useState('');
  const overview = useMemo(
    () =>
      summarizeRepository(
        snapshot,
        result,
        uiFlow.graph,
        completeness.complete,
      ),
    [snapshot, result, uiFlow.graph, completeness.complete],
  );
  const [featureSelectedId, setFeatureSelectedId] = useState<string | null>(null);
  const [learningProgress, setLearningProgress] = useState<LearningProgress>(
    emptyLearningProgress,
  );
  const progressKey = `codedna.learning.v1:${learningSessionKey(source, repositoryName, snapshot.id, snapshot.revision)}`;
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(progressKey);
      if (!stored) return;
      const value: unknown = JSON.parse(stored);
      if (
        value &&
        typeof value === 'object' &&
        'completed' in value &&
        Array.isArray(value.completed) &&
        value.completed.every((item) => typeof item === 'string') &&
        'answers' in value &&
        value.answers &&
        typeof value.answers === 'object' &&
        !Array.isArray(value.answers) &&
        'currentStepId' in value &&
        (value.currentStepId === null ||
          typeof value.currentStepId === 'string')
      )
        setLearningProgress(value as LearningProgress);
    } catch {
      /* Session storage is optional. */
    }
  }, [progressKey]);
  const saveLearningProgress = (progress: LearningProgress) => {
    setLearningProgress(progress);
    try {
      sessionStorage.setItem(progressKey, JSON.stringify(progress));
    } catch {
      /* Continue in memory when storage is unavailable. */
    }
  };
  const learningPlan = useMemo(
    () =>
      generateLearningPlan(result, uiFlow.graph, {
        snapshotComplete: completeness.complete,
        uiFlowDiagnostics: uiFlow.diagnostics,
      }),
    [result, uiFlow, completeness.complete],
  );
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  useEffect(() => {
    try {
      if (localStorage.getItem('codedna.theme') === 'dark') setTheme('dark');
    } catch {
      /* Theme preference is optional. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('codedna.theme', theme);
    } catch {
      /* Continue with the in-memory preference. */
    }
  }, [theme]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceEvidence, setSourceEvidence] = useState<{
    path: string;
    line: number;
  } | null>(null);
  const [documentEvidence, setDocumentEvidence] = useState<{ path: string; line: number } | null>(null);
  const [fileHistory, setFileHistory] = useState<{
    ids: string[];
    index: number;
  }>({ ids: [], index: -1 });
  const [uiSelectedId, setUISelectedId] = useState<string | null>(null);
  const [impactInspection, setImpactInspection] = useState<{
    root: string;
    id: string;
  } | null>(null);
  const [uiFilePath, setUIFilePath] = useState<string | null>(null);
  const [showScreenSource, setShowScreenSource] = useState(false);
  const selectedScreen = uiFlow.graph.nodes.find(
    (node) => node.id === uiSelectedId,
  );
  const activePath =
    mode === 'UI Flow'
      ? (selectedScreen?.sourceFile ?? uiFilePath)
      : mode === 'Impact Analysis' && impactInspection?.root === selectedId
        ? impactInspection.id.slice(5)
        : selectedId?.startsWith('file:')
          ? selectedId.slice(5)
          : null;
  const selected =
    snapshot.files.find((file) => file.path === activePath) ?? null;
  const selectedDocument = documentEvidence ? [...(snapshot.documents ?? []), ...(snapshot.manifests ?? [])].find((item) => item.path === documentEvidence.path) : undefined;
  const documentLine = documentEvidence?.line;
  const onUISelection = useCallback((id: string | null) => {
    setUISelectedId(id);
    setUIFilePath(null);
    setShowScreenSource(false);
    if (id) {
      setRight(true);
      if (window.matchMedia('(max-width: 760px)').matches) setLeft(false);
    }
  }, []);
  const frameworkDetected =
    !!uiFlow.framework ||
    snapshot.files.some((file) => /^(?:src\/)?app\//.test(file.path));
  const screenEvents =
    uiFlow.graph.navigationEvents?.filter(
      (event) => event.sourceId === uiSelectedId,
    ) ?? [];
  const incoming = uiFlow.graph.edges.filter(
    (edge) => edge.targetId === uiSelectedId,
  );
  const unattributed =
    uiFlow.graph.navigationEvents?.filter((event) => !event.sourceId) ?? [];

  const selectedNode = result?.dependencyGraph.nodes.find(
    (node) => node.id === selectedId,
  );
  const onSelectionChange = useCallback((id: string | null) => {
    setSelectedId(id);
    setSourceEvidence(null);
    if (id) {
      setFileHistory((current) => {
        if (current.ids[current.index] === id) return current;
        const ids = [...current.ids.slice(0, current.index + 1), id].slice(
          -100,
        );
        return { ids, index: ids.length - 1 };
      });
      setRight(true);
      if (window.matchMedia('(max-width: 760px)').matches) setLeft(false);
    }
  }, []);
  useEffect(() => {
    if (sourceEvidence && selected?.path === sourceEvidence.path)
      document
        .getElementById('source-evidence-line')
        ?.scrollIntoView({ block: 'nearest' });
  }, [sourceEvidence, selected]);
  const selectedScreenConvention =
    selected && uiFlow.framework === 'next-app-router'
      ? uiFlow.graph.nodes.find((node) => node.sourceFile === selected.path)
      : undefined;
  const selectedBoundaryConvention =
    selected && uiFlow.framework === 'next-app-router'
      ? uiFlow.graph.nodes
          .flatMap((node) => node.boundaries ?? [])
          .find((boundary) => boundary.path === selected.path)
      : undefined;
  const openSource = useCallback((path: string, line: number) => {
    onSelectionChange(`file:${path}`);
    setSourceEvidence({ path, line });
    setMode('Architecture');
    navigate({ screen: 'advanced', mode: 'Architecture' });
  }, [onSelectionChange, navigate]);
  const openArchitecture = useCallback((path: string) => {
    if (path) onSelectionChange(`file:${path}`);
    setMode('Architecture');
    navigate({ screen: 'advanced', mode: 'Architecture' });
  }, [onSelectionChange, navigate]);
  const practiceSuggestions = useMemo(
    () =>
      result && selectedId
        ? filePracticeSuggestions(
            result.dependencyGraph,
            result.diagnostics,
            selectedId,
            completeness.complete,
          )
        : [],
    [result, selectedId, completeness.complete],
  );
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setLeft(false);
      setRight(false);
    }
  }, []);
  const commit = actions?.commit;
  const openPage = useCallback((page: string) => navigate({ screen: 'page', page }), [navigate]);
  const openPages = useCallback(() => navigate({ screen: 'pages' }), [navigate]);
  const openOverview = useCallback(() => navigate({ screen: 'overview' }), [navigate]);
  const openTrace = useCallback((action: string, step?: string) => navigate({ screen: 'trace', action, ...(step ? { step } : {}), ...(commit ? { commit } : {}) }), [navigate, commit]);
  const openReach = useCallback((symbol: string) => navigate({ screen: 'reach', symbol }), [navigate]);
  const openGap = useCallback((actionId: string, file: string, line: number) => {
    const action = actions?.actions.find((item) => item.id === actionId);
    const step = actions?.traces.find((trace) => trace.id === action?.traceId)?.steps.find((item) => item.tier === 'gap' && item.file === file && item.line === line);
    openTrace(actionId, step?.id);
  }, [actions, openTrace]);
  const exportTraces = useCallback(() => {
    if (!actions) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(actions, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${repositoryName.replace(/[^\w.-]+/g, '-')}-traces.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [actions, repositoryName]);
  const chooseAdvanced = useCallback((id: string) => {
    if (id === 'export') exportTraces();
    else if (id === 'diagnostics' || id === 'stories' || id === 'ask') navigate({ screen: id });
    else if (modes.some((item) => item.name === id)) openAdvanced(id as Mode);
  }, [exportTraces, navigate, openAdvanced]);
  const staleLink = !!location.commit && location.commit !== commit;
  const state: WorkspaceState = result
    ? { status: 'ready', snapshot, result }
    : { status: 'ready', snapshot };
  return (
    <div className="explorer">
      <header className="explorer-header flow-header">
        <div className="flow-header__identity">
          <Brand />
          <Link href="/" className="back-link">
            <ArrowLeft size={14} /> Home
          </Link>
          <span className="flow-header__repo">
            <strong>{repositoryName}</strong>
            <span className="flow-pill" title={commit ? `Commit ${commit}` : 'This snapshot has no recorded commit'}>
              {commit ? commit.slice(0, 7) : source === 'sample' ? 'sample' : 'no commit'}
            </span>
          </span>
        </div>
        <HeaderTabs screen={screen} onOverview={openOverview} onPages={openPages} />
        <ActionSearch
          index={actions}
          onHit={(hit) => {
            if (hit.actionId) openTrace(hit.actionId);
            else if (hit.symbolId) openReach(hit.symbolId);
            else if (hit.pageId) openPage(hit.pageId);
          }}
        />
        <div className="flow-header__tools">
          <button type="button" className="flow-hbtn" disabled aria-describedby="ai-narration-note">
            AI narration: Off
          </button>
          <span id="ai-narration-note" className="sr-only">AI narration is not available yet. Every trace is fully described without it.</span>
          <AdvancedMenu items={ADVANCED_ITEMS} onSelect={chooseAdvanced} />
          <Button size="icon" variant="ghost" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
        </div>
      </header>
      {screen === 'advanced' && <div className="explorer-nav">
        <ModeTabs mode={mode} onChange={setMode} />
        {mode !== 'Static Walkthrough' && <div className="panel-controls">
          {mode !== 'Features' && <Tooltip label={left ? 'Hide files' : 'Show files'}>
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
          </Tooltip>}
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
        </div>}
      </div>}
      <div
        className={`explorer-body ${screen !== 'advanced' || !left || mode === 'Features' || mode === 'Static Walkthrough' ? 'without-left' : ''} ${screen !== 'advanced' || !right || mode === 'Static Walkthrough' ? 'without-right' : ''}`}
      >
        {screen === 'advanced' && left && mode !== 'Features' && mode !== 'Static Walkthrough' && (
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
            {mode === 'Architecture' && (
              <div
                className="file-history"
                aria-label="File navigation history"
              >
                <button
                  type="button"
                  disabled={fileHistory.index <= 0}
                  onClick={() => {
                    const index = fileHistory.index - 1;
                    setFileHistory({ ...fileHistory, index });
                    setSelectedId(fileHistory.ids[index] ?? null);
                  }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={fileHistory.index >= fileHistory.ids.length - 1}
                  onClick={() => {
                    const index = fileHistory.index + 1;
                    setFileHistory({ ...fileHistory, index });
                    setSelectedId(fileHistory.ids[index] ?? null);
                  }}
                >
                  Forward
                </button>
              </div>
            )}
            <FileList
              files={snapshot.files}
              selected={selected?.path ?? null}
              onSelect={(file) => {
                if (mode === 'UI Flow') {
                  const screen = screenForFile(file.path, uiFlow);
                  setUISelectedId(screen);
                  setUIFilePath(file.path);
                  setShowScreenSource(false);
                } else onSelectionChange(`file:${file.path}`);
                setRight(true);
                if (window.matchMedia('(max-width: 760px)').matches)
                  setLeft(false);
              }}
              query={query}
              repositoryName={repositoryName}
            />
            <div className="panel-bottom">
              <span className="status-dot" />{' '}
              {source === 'sample' ? 'BUNDLED EXAMPLE' : 'PUBLIC REPOSITORY'}{' '}
              <span>v1.0</span>
            </div>
          </Panel>
        )}
        {screen !== 'advanced' ? (
          <section id="workspace-panel" className="workspace flow-workspace" aria-label="CodeDNA" tabIndex={-1}>
            {(!completeness.complete || actions?.partial) && (
              <p className="flow-notice" role="status" data-testid="partial-notice">
                This analysis is partial
                {!completeness.complete ? `: the snapshot is missing ${completeness.skippedFiles || 'some'} file${completeness.skippedFiles === 1 ? '' : 's'}` : ': an analysis limit was reached'}. Pages, actions and steps may be missing. Details are under Advanced tools › Diagnostics.
              </p>
            )}
            {staleLink && (
              <p className="flow-notice" role="status">
                This link was made for commit {location.commit}. You are viewing {commit ? `commit ${commit}` : 'a snapshot without a recorded commit'}, so steps may differ.
              </p>
            )}
            {state.status !== 'ready' ? (
              <p className="workspace-state" role="status">Preparing your workspace…</p>
            ) : !actions && ['overview', 'pages', 'page', 'trace', 'reach'].includes(screen) ? (
              <div className="flow-page">
                <section className="flow-card flow-empty" role="status">
                  <h1>Pages and actions aren’t available for this session</h1>
                  <p>This repository was imported before page and action analysis existed. Import it again to see its pages, actions and traces. The advanced tools still work.</p>
                  <button type="button" className="flow-button" onClick={() => openAdvanced()}>Open advanced tools</button>
                </section>
              </div>
            ) : screen === 'overview' && actions ? (
              <FlowOverview repositoryName={repositoryName} understanding={understanding} index={actions} onPage={openPage} onGap={openGap} onAdvanced={() => openAdvanced()} />
            ) : (screen === 'pages' || screen === 'page') && actions ? (
              <PageInventory index={actions} pageId={screen === 'page' ? location.page : undefined} onPage={openPage} onPages={openPages} onTrace={(id) => openTrace(id)} />
            ) : screen === 'trace' && actions ? (
              <ActionTrace index={actions} snapshot={snapshot} actionId={location.action ?? ''} stepId={location.step}
                onStep={(step) => navigate({ ...location, step }, true)} onPage={openPage} onPages={openPages} onReach={openReach}
                permalink={(step) => tracePermalink(`${window.location.origin}${window.location.pathname}`, window.location.search, location.action ?? '', step, commit)} />
            ) : screen === 'reach' && actions ? (
              <ReachView index={actions} symbolId={location.symbol} features={features} onTrace={openTrace} onOverview={openOverview} />
            ) : screen === 'stories' || screen === 'ask' ? (
              <BehaviorTools screen={screen} snapshot={snapshot} understanding={understanding} features={features} complete={completeness.complete}
                onScreen={(next) => navigate({ screen: next })} onSource={openSource} onArchitecture={openArchitecture} onAdvanced={() => openAdvanced()} />
            ) : screen === 'diagnostics' ? (
              <DiagnosticsView capabilities={capabilities} diagnostics={result?.diagnostics ?? []} uiFlow={uiFlow} actions={actions} acquisition={acquisitionDiagnostics} onEvidence={openSource} />
            ) : null}
          </section>
        ) : (
        <section
          id="workspace-panel"
          className="workspace"
          role="tabpanel"
          aria-labelledby={`mode-${modes.findIndex((item) => item.name === mode)}`}
          tabIndex={0}
        >
          <div className="workspace-top">
            <div>
              <button type="button" onClick={() => setMode('Discover')}>Discover</button>
              <ChevronRight size={13} />
              <strong>{mode}</strong>
            </div>
          </div>
          {mode === 'Architecture' &&
            result &&
            result.diagnostics.length > 0 && (
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
          {!completeness.complete && (
            <details className="analysis-diagnostics">
              <summary>
                Partial repository: {completeness.skippedFiles} skipped entries
              </summary>
              <ul>
                {acquisitionDiagnostics.map((d, i) => (
                  <li key={`${d.path}:${d.code}:${i}`}>
                    {d.path}: {d.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mode === 'UI Flow' && (
            <details className="analysis-diagnostics">
              <summary>UI Flow support and limitations</summary>
              <ul>
                <li>
                  Supports statically detectable routes and navigation in
                  Next.js App Router, React Router, Expo Router and React
                  Navigation.
                </li>
                <li>
                  Analyzes TypeScript and JavaScript source files only. Other
                  frameworks and routing patterns may not be detected.
                </li>
                <li>
                  Dynamic or ambiguous navigation can remain unresolved;
                  detected connections do not prove runtime behavior.
                </li>
                <li>
                  Imports use the public repository?s default branch. Partial
                  snapshots can omit routes and connections.
                </li>
                <li>
                  Multiple Next.js application roots require selection through
                  the analysis API; the Explorer cannot select one yet.
                </li>
              </ul>
            </details>
          )}
          {mode === 'UI Flow' && source === 'sample' && !frameworkDetected && (
            <Link href="/explorer?example=next" className="ui-example-link">
              Try the Next.js App Router example
            </Link>
          )}
          {mode === 'UI Flow' && uiFlow.diagnostics.length > 0 && (
            <details className="analysis-diagnostics">
              <summary>
                {uiFlow.diagnostics.length} UI Flow diagnostic
                {uiFlow.diagnostics.length === 1 ? '' : 's'}
              </summary>
              <ul>
                {uiFlow.diagnostics.map((d, i) => (
                  <li key={`${d.id}:${i}`}>
                    {d.location
                      ? `${d.location.path}:${d.location.start.line}:${d.location.start.column} - `
                      : ''}
                    {d.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {mode === 'UI Flow' && unattributed.length > 0 && (
            <details className="analysis-diagnostics">
              <summary>
                {unattributed.length} unattributed navigation event
                {unattributed.length === 1 ? '' : 's'}
              </summary>
              <ul>
                {unattributed.map((event) => (
                  <li key={event.id}>
                    {event.kind}{' '}
                    {event.navigationPath?.join(' ? ') ??
                      event.destination ??
                      '(dynamic)'}{' '}
                    ? {event.resolution} at {event.location.path}:
                    {event.location.start.line}
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
            onSourceEvidence={(path, line) => {
              onSelectionChange(`file:${path}`);
              setSourceEvidence({ path, line });
              if (mode === 'UI Flow') setMode('Architecture');
            }}
            onExploreImpact={() => setMode('Impact Analysis')}
            overview={overview}
            understanding={understanding}
            features={features}
            featureSelectedId={featureSelectedId}
            onFeatureSelection={(id) => { setFeatureSelectedId(id); setMode('Features'); }}
            onStartSimulation={(id) => { setFeatureSelectedId(id); setMode('Static Walkthrough'); }}
            onSimulationFeature={setFeatureSelectedId}
            onBackFeatures={() => setMode('Features')}
            onDiscoverModule={(path) => { setArchitecturePath(path); setMode('Architecture'); }}
            onFeatureArchitecture={(path) => { if (path) onSelectionChange(`file:${path}`); setMode('Architecture'); }}
            onDocumentEvidence={(path, line) => {
              if ((snapshot.documents ?? []).some((item) => item.path === path) || (snapshot.manifests ?? []).some((item) => item.path === path)) {
                setDocumentEvidence({ path, line });
                setRight(true);
              } else {
                onSelectionChange(`file:${path}`);
                setSourceEvidence({ path, line });
                setMode('Architecture');
              }
            }}
            capabilities={capabilities}
            repositoryName={repositoryName}
            initialFolderPath={architecturePath}
            onOpenScreen={(id) => {
              onUISelection(id);
              setMode('UI Flow');
            }}
            onOpenOverviewMode={(nextMode) => setMode(nextMode)}
            uiFlow={uiFlow}
            uiSelectedId={uiSelectedId}
            onUISelection={onUISelection}
            frameworkDetected={frameworkDetected}
            impactComplete={completeness.complete}
            learningPlan={learningPlan}
            learningProgress={learningProgress}
            onLearningProgress={saveLearningProgress}
            onLearningInspect={(file) => onSelectionChange(`file:${file}`)}
            onLearningExplore={(nextMode, file, screenId) => {
              if (nextMode === 'UI Flow' && screenId) onUISelection(screenId);
              else if (file) onSelectionChange(`file:${file}`);
              setMode(nextMode);
            }}
            onImpactInspect={(id) => {
              if (selectedId) setImpactInspection({ root: selectedId, id });
              setRight(true);
            }}
          />
          <div className="workspace-footer">
            <span>
              <span className="status-dot" />{' '}
              {source === 'sample' ? 'SAMPLE DATA' : 'PUBLIC REPOSITORY'}
            </span>
            <span id="workspace-help">
              {mode === 'UI Flow'
                ? 'Detected navigation is static evidence, not reachability.'
                : mode === 'Impact Analysis'
                  ? 'Arrows point from importer to dependency; impact follows them in reverse.'
                  : 'Importer to dependency.'}
            </span>
          </div>
        </section>
        )}
        {screen === 'advanced' && right && mode !== 'Static Walkthrough' && (
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
            {mode === 'Discover' && selectedDocument ? <div className="inspector-content"><div className="inspector-label">DOCUMENT EVIDENCE <Button size="icon" variant="ghost" aria-label="Close document evidence" onClick={() => setDocumentEvidence(null)}><X size={14} /></Button></div><strong>{selectedDocument.path}</strong><p>Untrusted repository documentation at revision {snapshot.revision ?? 'unknown'}.</p><pre className="source-preview"><code>{selectedDocument.content.split('\n').map((line, index) => <span key={index} className={index + 1 === documentLine ? 'source-line-highlight' : undefined}>{line}{'\n'}</span>)}</code></pre></div> : mode === 'UI Flow' && selectedScreen ? (
              <div className="inspector-content">
                <div className="inspector-label">
                  SCREEN{' '}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Clear selected screen"
                    onClick={() => onUISelection(null)}
                  >
                    <X size={14} />
                  </Button>
                </div>
                <div className="selected-file">
                  <span className="node-icon violet">
                    <Waypoints size={18} />
                  </span>
                  <div>
                    <strong>
                      {selectedScreen.routePath ?? selectedScreen.label}
                    </strong>
                    <small>{selectedScreen.sourceFile}</small>
                  </div>
                </div>
                <p className="inspector-footnote">
                  Framework: {selectedScreen.framework ?? 'unknown'}. Static
                  evidence does not guarantee reachability.
                </p>
                {selected && (
                  <>
                    <Button
                      onClick={() => setShowScreenSource(!showScreenSource)}
                    >
                      {showScreenSource ? 'Hide source' : 'View source file'}
                    </Button>
                    {showScreenSource && (
                      <pre className="source-preview">
                        <code>
                          {sourceEvidence?.path === selected.path
                            ? selected.content
                                .split('\n')
                                .map((line, index) => (
                                  <span
                                    key={index}
                                    id={
                                      index + 1 === sourceEvidence.line
                                        ? 'source-evidence-line'
                                        : undefined
                                    }
                                    className={
                                      index + 1 === sourceEvidence.line
                                        ? 'source-line-highlight'
                                        : undefined
                                    }
                                  >
                                    {line}
                                    {'\n'}
                                  </span>
                                ))
                            : selected.content}
                        </code>
                      </pre>
                    )}
                  </>
                )}
                <div className="inspector-rule" />
                <div className="inspector-label">
                  OUTGOING EVENTS <span>{screenEvents.length}</span>
                </div>
                {screenEvents.length ? (
                  <ul className="flow-events">
                    {screenEvents.map((event) => (
                      <li key={event.id}>
                        <strong>{event.kind}</strong>{' '}
                        <span>{event.resolution}</span>
                        <div>
                          {event.navigationPath?.join(' ? ') ??
                            event.destination ??
                            '(no static destination)'}
                        </div>
                        <small>
                          {event.location.path}:{event.location.start.line}:
                          {event.location.start.column}
                        </small>
                        {event.metadata.evidence.map((e, i) => (
                          <small key={i}>{e.description}</small>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inspector-footnote">
                    No navigation detected in this screen.
                  </p>
                )}
                <div className="inspector-rule" />
                <div className="inspector-label">
                  INCOMING EDGES <span>{incoming.length}</span>
                </div>
                <ul className="flow-events">
                  {incoming.map((edge) => (
                    <li key={edge.id}>
                      {uiFlow.graph.nodes.find(
                        (node) => node.id === edge.sourceId,
                      )?.routePath ?? edge.sourceId}{' '}
                      <small>{edge.kind ?? 'navigation'}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : selected ? (
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
                {mode === 'Architecture' && (
                  <p className="relationship-summary">
                    {selected.path.split('/').at(-1)} is a source file located
                    in{' '}
                    {selected.path.includes('/')
                      ? selected.path.slice(0, selected.path.lastIndexOf('/'))
                      : 'the repository root'}
                    . Select a relationship below to follow its source evidence.
                  </p>
                )}
                {mode === 'Architecture' &&
                  (selectedScreenConvention || selectedBoundaryConvention) && (
                    <div className="file-convention">
                      <strong>Next.js App Router convention</strong>
                      <p>
                        {selectedScreenConvention
                          ? `This file was detected as a page for ${selectedScreenConvention.routePath ?? 'a route'}.`
                          : `This file was detected as a ${selectedBoundaryConvention?.kind} boundary associated with a route.`}{' '}
                        This describes a framework convention, not confirmed
                        runtime behavior.
                      </p>
                    </div>
                  )}
                {mode === 'Architecture' && result && selectedId && (
                  <FileRelationships
                    graph={result.dependencyGraph}
                    selectedId={selectedId}
                    onSelect={onSelectionChange}
                    onEvidence={(path, line) => {
                      onSelectionChange(`file:${path}`);
                      setSourceEvidence({ path, line });
                    }}
                  />
                )}
                {mode === 'Architecture' && (
                  <div className="practice-suggestions">
                    <h3>Ideas to review</h3>
                    <p>
                      These are evidence-based suggestions, not confirmed
                      problems or a code quality score.
                    </p>
                    {practiceSuggestions.length ? (
                      practiceSuggestions.map((item) => (
                        <section key={item.id}>
                          <strong>{item.title}</strong>
                          <p>{item.explanation}</p>
                          {item.location && (
                            <button
                              className="relationship-evidence"
                              type="button"
                              onClick={() => {
                                onSelectionChange(
                                  `file:${item.location!.path}`,
                                );
                                setSourceEvidence(item.location!);
                              }}
                            >
                              View source line {item.location.line}
                            </button>
                          )}
                        </section>
                      ))
                    ) : (
                      <p>
                        No suggestions detected for this file with the available
                        analysis.
                      </p>
                    )}
                  </div>
                )}
                <details className="guided-secondary" key={`${selected.path}:${sourceEvidence?.line ?? 0}`} open={sourceEvidence?.path === selected.path}>
                  <summary>Source file {source === 'sample' ? '(example)' : ''}</summary>
                <pre className="source-preview">
                  <code>
                    {sourceEvidence?.path === selected.path
                      ? selected.content.split('\n').map((line, index) => (
                          <span
                            key={index}
                            id={
                              index + 1 === sourceEvidence.line
                                ? 'source-evidence-line'
                                : undefined
                            }
                            className={
                              index + 1 === sourceEvidence.line
                                ? 'source-line-highlight'
                                : undefined
                            }
                          >
                            {line}
                            {'\n'}
                          </span>
                        ))
                      : selected.content}
                  </code>
                </pre>
                <p className="inspector-footnote">
                  Source from the active repository snapshot.
                </p>
                </details>
              </div>
            ) : mode !== 'UI Flow' && selectedNode ? (
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
