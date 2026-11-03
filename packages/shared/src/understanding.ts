import type { Evidence, SchemaVersion, SourceLocation, StableId } from './index.js';

export interface UnderstandingClaim {
  text: string;
  certainty: 'verified' | 'documented' | 'inferred' | 'unverified';
  evidence: Evidence[];
}
export interface RepositoryUnderstanding {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  revision?: string;
  introduction: UnderstandingClaim;
  capabilities: UnderstandingClaim[];
  technologies: UnderstandingClaim[];
  modules: { id: StableId; path: string; description: UnderstandingClaim; fileCount: number }[];
  entryPoints: { path: string; evidence: Evidence[] }[];
  routes: { id: StableId; path: string; sourceFile?: string; evidence: Evidence[] }[];
  exploration: { label: string; path: string; reason: string }[];
  limitations: string[];
}
export interface DiscoveredSymbol {
  id: StableId;
  name: string;
  kind: 'function' | 'class' | 'component';
  file: string;
  location: SourceLocation;
  exported: boolean;
}
export interface StaticFlowRelationship {
  id: StableId;
  sourceId: StableId;
  targetId?: StableId;
  kind: 'call' | 'jsx-reference' | 'event-handler' | 'hook-reference' | 'http-request' | 'import';
  location: SourceLocation;
  status: 'verified' | 'unresolved';
  evidence: Evidence[];
  destination?: string;
  condition?: { description: string; location: SourceLocation };
}
export interface DiscoveredFeature {
  id: StableId;
  name: string;
  description: UnderstandingClaim;
  kind: 'route' | 'entry-point' | 'exported-symbol';
  routes: string[];
  modules: string[];
  files: string[];
  symbols: StableId[];
  relationships: StaticFlowRelationship[];
  unresolved: StaticFlowRelationship[];
  coverage: 'partial' | 'source-evidenced';
  evidence: Evidence[];
}
export interface FeatureDiscovery {
  schemaVersion: SchemaVersion;
  snapshotId: StableId;
  revision?: string;
  features: DiscoveredFeature[];
  symbols: DiscoveredSymbol[];
  relationships: StaticFlowRelationship[];
  limitations: string[];
}
/** A static sequence of evidence, not a claim that code executes in this order. */
export interface StaticFlowStep {
  id: StableId;
  symbolId?: StableId;
  file: string;
  location: SourceLocation;
  explanation: string;
  relationshipKind?: StaticFlowRelationship['kind'];
  relationshipId?: StableId;
  verification: 'source-evidenced' | 'inferred-entry' | 'unresolved';
  branches: { id: StableId; label: string; targetStepId: StableId; condition?: string }[];
  evidence: Evidence[];
}
export interface StaticFlow {
  schemaVersion: SchemaVersion;
  id: StableId;
  entryPointId: StableId;
  steps: StaticFlowStep[];
  relationships: StaticFlowRelationship[];
  unresolved: StaticFlowRelationship[];
  conditions?: { description: string; evidence: Evidence[] }[];
  verification: 'static-evidence-only' | 'incomplete';
  limitations: string[];
  truncated: boolean;
}
