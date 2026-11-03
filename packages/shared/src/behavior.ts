import type { Evidence, SchemaVersion, SourceLocation, StableId } from './index.js';

/**
 * Versioned contracts for the behavior-first experience. Facts (evidence, relationships)
 * are kept apart from explanatory text, and every explanation names how well it is supported.
 */
export const BEHAVIOR_SCHEMA_VERSION = '1.0' as const;

/** `runtime-observed` is reserved for real runtime evidence; static analysis never produces it. */
export type ExplanationCertainty = 'verified' | 'documented' | 'inferred' | 'unresolved' | 'runtime-observed';
export type BehaviorCategory = 'page' | 'api' | 'interaction' | 'library' | 'cli' | 'entry';

export interface EvidenceItem {
  /** Stable for a snapshot: `ev:<kind>:<path>:<startLine>-<endLine>`. */
  id: StableId;
  kind: 'documentation' | 'route' | 'entry-point' | 'symbol' | 'reference' | 'flow-step' | 'source';
  title: string;
  path: string;
  location?: SourceLocation;
  /** Bounded, secret-redacted text. Repository text is untrusted data, never instructions. */
  excerpt: string;
  origin: 'documentation' | 'source';
}
export interface EvidenceBundle {
  schemaVersion: SchemaVersion;
  query: { behaviorId?: StableId; stepId?: StableId; question?: string };
  items: EvidenceItem[];
  truncated: boolean;
}

export interface Behavior {
  schemaVersion: SchemaVersion;
  id: StableId;
  title: string;
  /** `documented` when the title reuses a documentation heading; otherwise derived from source names. */
  titleBasis: 'documented' | 'derived';
  summary: string;
  category: BehaviorCategory;
  entryPoint: { path: string; line: number; symbolId?: StableId; route?: string; methods?: string[] };
  /** Feature that anchors the static flow. */
  flowFeatureId: StableId;
  /** Every feature grouped into this behavior (for example several methods of one route). */
  featureIds: StableId[];
  evidence: Evidence[];
  certainty: ExplanationCertainty;
  verifiedRelationships: number;
  unresolvedRelationships: number;
  coverage: 'source-evidenced' | 'partial';
  limitations: string[];
  suggestedQuestions: string[];
}
export interface BehaviorDiscovery {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  revision?: string;
  behaviors: Behavior[];
  /** The behavior CodeDNA suggests exploring first, when any exists. */
  recommendedId?: StableId;
  limitations: string[];
}

export type StepRole = 'user-action' | 'interface' | 'request' | 'server' | 'handoff' | 'start' | 'unresolved';
export interface StoryStep {
  id: StableId;
  flowStepId: StableId;
  role: StepRole;
  title: string;
  narrative: string;
  why: string;
  certainty: ExplanationCertainty;
  file: string;
  location: SourceLocation;
  evidenceIds: StableId[];
  next: { stepId: StableId; label: string; condition?: string }[];
}
export interface BehaviorStory {
  schemaVersion: SchemaVersion;
  id: StableId;
  behaviorId: StableId;
  title: string;
  overview: string;
  steps: StoryStep[];
  evidence: EvidenceItem[];
  limitations: string[];
  truncated: boolean;
}

export interface AnswerAction {
  kind: 'story' | 'source' | 'architecture' | 'unresolved' | 'ask';
  label: string;
  behaviorId?: StableId;
  stepId?: StableId;
  path?: string;
  line?: number;
  question?: string;
}
export interface Answer {
  schemaVersion: SchemaVersion;
  question: string;
  origin: 'deterministic' | 'ai';
  text: string;
  details?: string;
  certainty: ExplanationCertainty;
  evidenceIds: StableId[];
  evidence: EvidenceItem[];
  actions: AnswerAction[];
  /** Missing-information and uncertainty notes. */
  notes: string[];
}
/** Structured output required from an AI provider. Validated against retrieved evidence before use. */
export interface AiExplanationResponse {
  explanation: string;
  evidenceIds: string[];
  uncertainty: string[];
  targets: { kind: 'behavior' | 'source'; id?: string; path?: string; line?: number }[];
}
export interface AiStatus {
  configured: boolean;
  enabled: boolean;
  /** True when the configured endpoint is not on this machine, so content leaves it. */
  external: boolean;
  provider?: string;
  model?: string;
  reason?: string;
}
