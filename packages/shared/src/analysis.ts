import type { AnalysisDiagnostic, StableId } from './index.js';

/**
 * Schema 2.0: the analysis contracts behind the learning experience. Every identifier is derived
 * from repository paths, names and source positions, so it is stable for a given commit.
 * `Feature.key` is additionally stable across commits so progress can survive code changes.
 */
export const ANALYSIS_SCHEMA_VERSION = '2.0' as const;

/**
 * How CodeDNA knows a step or edge. Exactly one tier per step.
 * - resolved: bound through a compiler-resolved import or a declaration in scope.
 * - conventional: a framework or platform rule (file routes, form actions, redirect, Link).
 * - heuristic: matched by name or URL text.
 * - gap: CodeDNA cannot follow this part. Always shown, never used as a challenge answer.
 */
export type Confidence = 'resolved' | 'conventional' | 'heuristic' | 'gap';
/** Strongest first. */
export const CONFIDENCE_ORDER: readonly Confidence[] = ['resolved', 'conventional', 'heuristic', 'gap'];
/** Friendly words shown to learners. */
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  resolved: 'Sure',
  conventional: 'Framework rule',
  heuristic: 'Likely',
  gap: 'Unknown',
};

/** A place in the code. Lines are 1-based and inclusive; `excerpt` is bounded and secret-redacted. */
export interface CodeRef {
  path: string;
  startLine: number;
  endLine: number;
  highlightLine: number;
  /** Last line of the highlighted statement when it spans several lines. */
  highlightEndLine?: number;
  excerpt?: string;
}

export type SourceLanguage = 'ts' | 'tsx' | 'js' | 'jsx' | 'json';
export interface FileSummary {
  path: string;
  language: SourceLanguage;
  lines: number;
  /** A leading `'use client'` or `'use server'` directive. */
  directive?: 'use client' | 'use server';
}

export type FrameworkId = 'next-app-router' | 'react' | 'unknown';
export interface FrameworkInfo {
  id: FrameworkId;
  label: string;
  /** `full` means lessons are built for this framework; `limited` means best effort. */
  support: 'full' | 'limited';
  /** Plain reasons, e.g. "package.json depends on next". */
  evidence: string[];
}

export type ImportKind = 'static' | 'reexport' | 'dynamic' | 'require' | 'type';
export interface ImportEdge {
  id: StableId;
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  /** Repository path the specifier resolved to. */
  target?: string;
  /** Package name for a bare specifier that resolved outside the repository or not at all. */
  package?: string;
  confidence: Confidence;
}

export type RouteKind = 'page' | 'layout' | 'route-handler';
export interface PageRoute {
  id: StableId;
  kind: RouteKind;
  /** URL path, e.g. `/checkout` or `/rooms/[id]`. */
  route: string;
  file: string;
  dynamic: boolean;
  /** HTTP methods exported by a route handler. */
  methods?: string[];
  /** Layout files that wrap a page, outermost first. */
  layouts?: string[];
}

/** Where a step sits on the journey the story player animates. */
export type StepStage =
  | 'click'
  | 'form'
  | 'client'
  | 'request'
  | 'server'
  | 'check'
  | 'logic'
  | 'database'
  | 'external'
  | 'response'
  | 'screen';

export type EffectKind =
  | 'db-read'
  | 'db-write'
  | 'api-call'
  | 'redirect'
  | 'navigation'
  | 'revalidate'
  | 'cookie'
  | 'validation'
  | 'local-state'
  | 'email'
  | 'payment';

export interface Effect {
  kind: EffectKind;
  /** Short chip text, e.g. "writes Order" or "POST /api/coupons". */
  label: string;
  stepId: StableId;
  confidence: Confidence;
}

/** Closed list so concept text is always written by us, never generated. */
export type ConceptId =
  | 'component'
  | 'props'
  | 'state'
  | 'event-handler'
  | 'conditional-rendering'
  | 'async-await'
  | 'api-call'
  | 'server-action'
  | 'validation'
  | 'authentication'
  | 'database'
  | 'navigation';

export interface Step {
  id: StableId;
  /** Short title, e.g. "Checks you are signed in". */
  title: string;
  stage: StepStage;
  /** Beginner caption from a deterministic template. */
  plain: string;
  code: CodeRef;
  concepts: ConceptId[];
  confidence: Confidence;
  /** Friendly explanation, present when confidence is `gap`. */
  unknownReason?: string;
  parentId?: StableId;
  depth: number;
  /** Branch outcomes under which this step is reached; absent means always. */
  when?: { branchId: StableId; outcomeId: StableId }[];
}

export interface BranchOutcome {
  id: StableId;
  label: string;
  nextStepId?: StableId;
}
export interface Branch {
  id: StableId;
  stepId: StableId;
  /** Exact condition source text, e.g. `if (!session)`. */
  condition: string;
  outcomes: BranchOutcome[];
}

export type EntryKind = 'event-handler' | 'form-action' | 'server-action' | 'link' | 'route-handler';

export interface Feature {
  id: StableId;
  /** Stable across commits: entry file, component, handler name and entry kind. */
  key: string;
  /** Changes when the feature's steps change; used to mark lessons "Updated". */
  contentHash: string;
  /** A plain name for what the person does, e.g. "Delete a product". */
  title: string;
  /** The name in the code when the title was rewritten, e.g. "deleteProduct" or "GET /api/seed". */
  codeName?: string;
  /** The part of the app it belongs to, e.g. "Checkout", "Signing in", "Behind the scenes". */
  area?: string;
  /** The bigger part of the app the area sits in, e.g. "Admin" for /admin/branch-management. */
  section?: string;
  /** The page in plain words, e.g. "Add bank officer" for /admin/bank-officer-management/add. */
  pageTitle?: string;
  /**
   * main: something a person sets out to do (save, delete, transfer, sign in).
   * detail: a small screen detail on the way (typing, closing a box, clearing a filter).
   */
  importance?: 'main' | 'detail';
  page?: string;
  entry: CodeRef;
  entryKind: EntryKind;
  steps: Step[];
  branches: Branch[];
  effects: Effect[];
  difficulty: 1 | 2 | 3;
  /** True when a limit stopped CodeDNA before the end of the feature. */
  partial: boolean;
}

export interface AnalysisStats {
  files: number;
  skippedFiles: number;
  imports: number;
  routes: number;
  features: number;
  durationMs: number;
}

/** The same function body written in more than one place. */
export interface DuplicateCode {
  name: string;
  places: CodeRef[];
}

export interface RepoAnalysis {
  schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
  snapshotId: StableId;
  revision?: string;
  /** App name from the root package.json, when it has one. */
  name?: string;
  /** False when the snapshot has no TypeScript or JavaScript source CodeDNA can read. */
  supported: boolean;
  framework: FrameworkInfo;
  files: FileSummary[];
  imports: ImportEdge[];
  routes: PageRoute[];
  features: Feature[];
  duplicates: DuplicateCode[];
  diagnostics: AnalysisDiagnostic[];
  /** True when a size, count or time limit was hit; lessons cover the rest. */
  partial: boolean;
  /** Plain sentences describing what was skipped or not followed. */
  limitations: string[];
  stats: AnalysisStats;
}
