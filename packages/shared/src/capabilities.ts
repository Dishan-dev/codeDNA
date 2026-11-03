import type { SchemaVersion, SourceLocation, StableId } from './index.js';
/** Additive assessment contracts; these do not change the existing graph schemas. */
export type CapabilityStatus =
  | 'available'
  | 'partial'
  | 'unsupported'
  | 'not_configured'
  | 'failed'
  | 'not_run';
export type CapabilityKind =
  | 'snapshot'
  | 'dependencies'
  | 'ui_flow'
  | 'architecture_map'
  | 'visualization_3d'
  | 'documentation'
  | 'symbols'
  | 'static_simulation'
  | 'runtime_qa'
  | 'ai_explanations';
export interface CapabilityEvidence {
  type: 'snapshot' | 'analysis' | 'diagnostic';
  description: string;
  location?: SourceLocation;
  diagnosticId?: StableId;
}
export interface AnalysisCapability {
  id: StableId;
  kind: CapabilityKind;
  status: CapabilityStatus;
  reason: string;
  nextAction: string;
  missingPrerequisites: string[];
  evidence: CapabilityEvidence[];
  diagnosticCount: number;
}
export interface CapabilityAssessment {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  revision?: string;
  /** Omitted when acquisition completeness was not supplied. */
  snapshotComplete?: boolean;
  sourceFiles: number;
  capabilities: AnalysisCapability[];
}
