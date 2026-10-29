/** All schema identifiers are opaque and stable within a snapshot. */
export type StableId = string;
export type SchemaVersion = '1.0';

/** Positions are 1-based; end is exclusive. Paths are repository-relative. */
export interface SourceLocation {
  path: string;
  start: { line: number; column: number };
  end: { line: number; column: number };
}
export interface Evidence {
  description: string;
  location?: SourceLocation;
}
/** Confidence is a number between 0 and 1, inclusive. */
export interface AnalysisMetadata {
  confidence: number;
  evidence: Evidence[];
}
export interface SourceFile {
  id: StableId;
  path: string;
  content: string;
  language?: string;
}
export interface RepositorySnapshot {
  schemaVersion: SchemaVersion;
  id: StableId;
  files: SourceFile[];
  revision?: string;
}
export interface AnalysisDiagnostic {
  id: StableId;
  severity: 'info' | 'warning' | 'error';
  message: string;
  code?: string;
  location?: SourceLocation;
}
export type DependencyKind =
  | 'import'
  | 're-export'
  | 'dynamic-import'
  | 'require';
export interface DependencyNode {
  id: StableId;
  label: string;
  kind?: 'file' | 'external';
  location?: SourceLocation;
  metadata: AnalysisMetadata;
}
export interface DependencyEdge {
  id: StableId;
  sourceId: StableId;
  targetId: StableId;
  kind?: DependencyKind;
  specifier?: string;
  location?: SourceLocation;
  metadata: AnalysisMetadata;
}
export interface DependencyGraph {
  schemaVersion: SchemaVersion;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}
export type UINavigationKind =
  | 'link'
  | 'push'
  | 'navigate'
  | 'replace'
  | 'back'
  | 'history'
  | 'redirect';
export type UINavigationResolution =
  | 'internal'
  | 'external'
  | 'dynamic'
  | 'unresolved';
/** Static evidence of a navigation action; an event does not assert runtime reachability. */
export interface UINavigationEvent {
  id: StableId;
  sourceId?: StableId;
  targetId?: StableId;
  kind: UINavigationKind;
  resolution: UINavigationResolution;
  destination?: string;
  /** Literal nested navigator targets, when available. */
  navigationPath?: string[];
  location: SourceLocation;
  metadata: AnalysisMetadata;
}
export interface UIFlowNode {
  id: StableId;
  label: string;
  framework?: string;
  /** Navigator containing a registered screen, when applicable. */
  navigator?: {
    id: StableId;
    name: string;
    kind: string;
    parentIds?: StableId[];
    group?: string;
  };
  routePath?: string;
  sourceFile?: string;
  boundaries?: { kind: 'layout' | 'loading' | 'error'; path: string }[];
  location?: SourceLocation;
  metadata: AnalysisMetadata;
}
export interface UIFlowEdge {
  id: StableId;
  sourceId: StableId;
  targetId: StableId;
  kind?: UINavigationKind;
  destination?: string;
  /** Literal nested navigator targets, when available. */
  navigationPath?: string[];
  location?: SourceLocation;
  metadata: AnalysisMetadata;
}
export interface UIFlowGraph {
  schemaVersion: SchemaVersion;
  nodes: UIFlowNode[];
  edges: UIFlowEdge[];
  navigationEvents?: UINavigationEvent[];
}
export interface AnalysisResult {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  diagnostics: AnalysisDiagnostic[];
  dependencyGraph: DependencyGraph;
  uiFlowGraph: UIFlowGraph;
}

/** A path follows importer-to-dependency edges from an affected file to the changed file. */
export interface DependencyPath {
  id: StableId;
  fileIds: StableId[];
  edgeIds: StableId[];
  evidence: Evidence[];
  certainty: 'source-evidenced' | 'uncertain';
}
export interface ImpactedFile {
  id: StableId;
  path: string;
  category: 'selected' | 'direct' | 'transitive';
  distance: number;
  paths: DependencyPath[];
}
export interface ImpactedScreen {
  id: StableId;
  screen: UIFlowNode;
  sourceFile: string;
  distance: number;
  paths: DependencyPath[];
  evidence: Evidence[];
  attribution: 'source-file';
}
export interface ImpactDiagnostic {
  id: StableId;
  code: string;
  message: string;
  severity: 'info' | 'warning';
  location?: SourceLocation;
}
export interface ImpactAnalysisResult {
  schemaVersion: SchemaVersion;
  selectedFilePath: string;
  selectedFileId?: StableId;
  files: ImpactedFile[];
  screens: ImpactedScreen[];
  dependencyGraph: DependencyGraph;
  diagnostics: ImpactDiagnostic[];
  summary: { direct: number; transitive: number; screens: number };
  traversal: {
    visitedFiles: number;
    maxFiles: number;
    maxDepth: number;
    maxPathsPerFile: number;
    truncated: boolean;
    complete: boolean;
  };
}

/** Learning plans contain only static evidence and clearly labeled heuristics. */
export interface LearningQuestion {
  id: StableId;
  prompt: string;
  choices: { id: StableId; label: string }[];
  answerId: StableId;
  explanation: string;
  evidence: Evidence[];
}
export interface LearningStep {
  id: StableId;
  kind:
    | 'overview'
    | 'entry'
    | 'dependency'
    | 'module'
    | 'navigation'
    | 'impact'
    | 'recap';
  title: string;
  explanation: string;
  objective: string;
  action: string;
  complexity: 'introductory' | 'moderate' | 'advanced';
  files: string[];
  evidence: Evidence[];
  dependencyEdgeIds?: StableId[];
  navigationEdgeIds?: StableId[];
  screenIds?: StableId[];
  questions?: LearningQuestion[];
}
export interface LearningPlan {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  steps: LearningStep[];
  warnings: string[];
}
