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
