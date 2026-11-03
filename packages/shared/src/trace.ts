import type { StableId } from './index.js';

/**
 * Page → action → trace contracts. Versioned separately from the 1.0 analysis schema so existing
 * consumers are unaffected. Every identifier is derived from repository paths and source positions,
 * so it is stable for a given commit.
 */
export const TRACE_SCHEMA_VERSION = '1.0' as const;

/**
 * How CodeDNA knows a step or edge. Exactly one tier per step.
 * - resolved: an identifier bound through a compiler-resolved import or a declaration in scope
 *   (syntactic binding resolution; not type-checker verified).
 * - conventional: a framework or platform rule (file routes, form actions, redirect, Link).
 * - heuristic: matched by name or URL text.
 * - inferred: AI text only; never used for a structural step or edge.
 * - gap: CodeDNA cannot follow this step. Always shown.
 */
export type EvidenceTier = 'resolved' | 'conventional' | 'heuristic' | 'inferred' | 'gap';
export type StructuralTier = Exclude<EvidenceTier, 'inferred'>;
/** Strongest first. */
export const STRUCTURAL_TIERS: readonly StructuralTier[] = ['resolved', 'conventional', 'heuristic', 'gap'];
export type TierCounts = Record<StructuralTier, number>;

export type TriggerKind = 'form-action' | 'event-handler' | 'link' | 'server-action' | 'route-handler';
export type EffectKind = 'db-write' | 'db-read' | 'http' | 'navigation' | 'redirect' | 'revalidate' | 'cookie' | 'validation' | 'local-state';

export interface Effect {
  kind: EffectKind;
  /** Short chip text, e.g. "writes Order" or "POST /api/coupons". */
  label: string;
  tier: StructuralTier;
  /** The trace step that evidences this effect. */
  evidenceId: StableId;
}

export interface PageEntry {
  id: StableId;
  /** 'api' groups route handlers that no page renders. */
  kind: 'page' | 'api';
  route: string;
  file: string;
  /** Only a literal `metadata.title` from the page source; never generated. */
  title?: string;
  actionCount: number;
  /** Number of actions on this page per worst tier. */
  tierSummary: TierCounts;
}

export interface UserAction {
  id: StableId;
  pageId: StableId;
  pageRoute: string;
  component: string;
  file: string;
  line: number;
  triggerKind: TriggerKind;
  /** Source text of the binding, e.g. `onClick={applyCoupon}`. */
  triggerCode: string;
  label: string;
  effects: Effect[];
  worstTier: StructuralTier;
  gapCount: number;
  changesData: boolean;
  traceId: StableId;
}

export interface TraceExcerpt {
  startLine: number;
  lines: string[];
}
export interface TraceBranchOption {
  id: 'then' | 'else';
  label: string;
}
export interface TraceBranch {
  id: StableId;
  /** Exact condition source text, e.g. `if (!session)`. */
  condition: string;
  options: TraceBranchOption[];
}
export interface TraceSymbol {
  id: StableId;
  name: string;
  file: string;
  line: number;
}
export type TraceStepKind = 'trigger' | 'call' | 'effect' | 'decision' | 'gap';

/** A trace step as stored by analysis: no excerpt, so stored traces stay small. */
export interface TraceStepData {
  id: StableId;
  kind: TraceStepKind;
  parentId?: StableId;
  depth: number;
  title: string;
  code: string;
  file: string;
  line: number;
  tier: StructuralTier;
  /** Templated, deterministic description. */
  plainText: string;
  why: string;
  /** Short label used in reverse-reach path chips. */
  pathLabel: string;
  symbol?: TraceSymbol;
  /** Where a call step's function was called from (the step itself points at the definition). */
  callSite?: { file: string; line: number };
  effect?: EffectKind;
  branch?: TraceBranch;
  /** Branch options under which this step is reached; empty or absent means unconditional. */
  when?: { branchId: StableId; option: 'then' | 'else' }[];
  gapReason?: string;
  possibleTargets?: { name?: string; file: string; symbolId?: StableId }[];
}
export interface TraceStep extends TraceStepData {
  excerpt: TraceExcerpt;
}
export interface StoredTrace {
  id: StableId;
  actionId: StableId;
  steps: TraceStepData[];
  truncated: boolean;
}
export interface Trace {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  id: StableId;
  actionId: StableId;
  /** Absent when the snapshot has no revision (for example a bundled sample). */
  commit?: string;
  steps: TraceStep[];
  tierCounts: TierCounts;
  staticOnly: true;
  partial: boolean;
  limitations: string[];
}

export interface ReachPath {
  actionId: StableId;
  pageRoute: string;
  label: string;
  path: string[];
  tier: StructuralTier;
  traceId: StableId;
  stepId: StableId;
}
export interface ReverseReach {
  symbol: string;
  symbolId: StableId;
  file: string;
  line: number;
  actions: ReachPath[];
  pages: string[];
  unresolvedCallers: { file: string; line: number; code: string; reason: string }[];
  /** Static callers that no detected user action reaches. */
  otherCallers: { file: string; line: number; name: string }[];
  partial: boolean;
}

export interface ActionGap {
  actionId: StableId;
  actionLabel: string;
  pageRoute: string;
  reason: string;
  file: string;
  line: number;
}
export interface ActionIndex {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  snapshotId: StableId;
  commit?: string;
  pages: PageEntry[];
  actions: UserAction[];
  traces: StoredTrace[];
  apiRoutes: number;
  gaps: ActionGap[];
  /** Actions by worst tier: followed (resolved or framework rule), heuristic, or containing a gap. */
  coverage: { followed: number; heuristic: number; gap: number };
  partial: boolean;
  limitations: string[];
}
