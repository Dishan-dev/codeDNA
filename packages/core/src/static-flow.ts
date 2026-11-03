import type { DiscoveredFeature, DiscoveredSymbol, Evidence, FeatureDiscovery, SourceLocation, StaticFlow, StaticFlowRelationship, StaticFlowStep } from '@codedna/shared';

export interface StaticFlowOptions {
  maxSteps?: number;
  maxDepth?: number;
  maxBranches?: number;
  snapshotComplete?: boolean;
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const allowed = new Set<StaticFlowRelationship['kind']>(['call', 'jsx-reference', 'event-handler', 'hook-reference', 'http-request']);
const at = (path: string): SourceLocation => ({ path, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } });
const optionsLimit = (value: number | undefined, fallback: number, maximum: number) => Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, maximum) : fallback;

/** Source-evidenced graph walk. Branches are alternatives, not a fabricated execution order. */
export function buildStaticFlow(discovery: FeatureDiscovery, featureId: string, options: StaticFlowOptions = {}): StaticFlow {
  const feature = discovery.features.find((item) => item.id === featureId);
  const maxSteps = optionsLimit(options.maxSteps, 60, 200);
  const maxDepth = optionsLimit(options.maxDepth, 8, 20);
  const maxBranches = optionsLimit(options.maxBranches, 12, 30);
  const symbols = new Map(discovery.symbols.map((item) => [item.id, item]));
  const outgoing = new Map<string, StaticFlowRelationship[]>();
  for (const relation of discovery.relationships) {
    if (!allowed.has(relation.kind)) continue;
    const list = outgoing.get(relation.sourceId) ?? [];
    list.push(relation);
    outgoing.set(relation.sourceId, list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => compare(a.location.path, b.location.path) || a.location.start.line - b.location.start.line || a.location.start.column - b.location.start.column || compare(a.id, b.id));
  const steps: StaticFlowStep[] = [], relations: StaticFlowRelationship[] = [], unresolved: StaticFlowRelationship[] = [];
  const limitations: string[] = [];
  let truncated = false;
  if (!feature) return { schemaVersion: '1.0', id: `static-flow:${featureId}`, entryPointId: featureId, steps, relationships: relations, unresolved, verification: 'incomplete', limitations: ['The selected feature is unavailable.'], truncated };
  const start = chooseEntry(feature, symbols);
  if (!start) {
    const location = feature.evidence.find((item) => item.location)?.location ?? at(feature.files[0] ?? 'unknown');
    steps.push({ id: `flow-step:${feature.id}`, file: location.path, location, explanation: feature.kind === 'entry-point' ? 'This file has a conventional entry-point name. No callable symbol was established.' : 'This entry is known, but no callable symbol was established.', verification: 'inferred-entry', branches: [], evidence: feature.evidence });
    limitations.push('No callable symbol can be safely attributed to this entry. Select a function for a deeper walkthrough.');
  } else {
    const visited = new Set<string>([start.id]);
    const root = symbolStep(start, feature.evidence, feature.kind === 'entry-point' ? 'inferred-entry' : 'source-evidenced');
    steps.push(root);
    const queue: { symbol: DiscoveredSymbol; depth: number; step: StaticFlowStep }[] = [{ symbol: start, depth: 0, step: root }];
    while (queue.length) {
      const current = queue.shift()!;
      const candidates = outgoing.get(current.symbol.id) ?? [];
      if (current.depth >= maxDepth && candidates.length) { truncated = true; continue; }
      if (candidates.length > maxBranches) truncated = true;
      for (const relation of candidates.slice(0, maxBranches)) {
        if (relations.length + unresolved.length >= maxSteps || steps.length >= maxSteps) { truncated = true; break; }
        if (relation.status === 'unresolved' || !relation.targetId || !symbols.has(relation.targetId)) {
          unresolved.push(relation);
          const id = `flow-step:${relation.id}`;
          const boundary: StaticFlowStep = { id, file: relation.location.path, location: relation.location, explanation: `${relation.kind} has no uniquely resolved target${relation.destination ? ` for ${relation.destination}` : ''}.`, relationshipKind: relation.kind, relationshipId: relation.id, verification: 'unresolved', branches: [], evidence: relation.evidence };
          steps.push(boundary);
          current.step.branches.push({ id: `branch:${relation.id}`, label: relation.kind, targetStepId: id, ...(relation.condition ? { condition: relation.condition.description } : {}) });
          continue;
        }
        const target = symbols.get(relation.targetId)!;
        relations.push(relation);
        const id = `flow-step:${target.id}`;
        current.step.branches.push({ id: `branch:${relation.id}`, label: `${relation.kind} → ${target.name}`, targetStepId: id, ...(relation.condition ? { condition: relation.condition.description } : {}) });
        if (visited.has(target.id)) { limitations.push(`Cycle or repeated reference reaches ${target.name}; the step is reused.`); continue; }
        visited.add(target.id);
        const step = symbolStep(target, [...relation.evidence, { description: 'Target declaration', location: target.location }], 'source-evidenced', relation);
        steps.push(step);
        queue.push({ symbol: target, depth: current.depth + 1, step });
      }
    }
  }
  if (truncated) limitations.push(`Walkthrough reached a limit (${maxSteps} steps, ${maxDepth} levels or ${maxBranches} branches per step).`);
  if (options.snapshotComplete === false) limitations.push('The snapshot is partial; omitted files may hide transitions.');
  limitations.push('Static references do not prove that these steps execute or that a branch is taken.');
  const conditions = relations.concat(unresolved).flatMap((item) => item.condition ? [{ description: item.condition.description, evidence: [{ description: 'Syntactic condition', location: item.condition.location }] as Evidence[] }] : []);
  return { schemaVersion: '1.0', id: `static-flow:${feature.id}`, entryPointId: feature.id, steps, relationships: relations, unresolved, ...(conditions.length ? { conditions } : {}), verification: truncated || unresolved.length || options.snapshotComplete === false || steps[0]?.verification === 'inferred-entry' ? 'incomplete' : 'static-evidence-only', limitations: [...new Set(limitations)], truncated };
}
function chooseEntry(feature: DiscoveredFeature, symbols: Map<string, DiscoveredSymbol>): DiscoveredSymbol | undefined {
  if (feature.kind === 'exported-symbol') return symbols.get(feature.symbols[0] ?? '');
  const candidates = feature.symbols.map((id) => symbols.get(id)).filter((item): item is DiscoveredSymbol => !!item && item.exported);
  return candidates.length === 1 ? candidates[0] : undefined;
}
function symbolStep(symbol: DiscoveredSymbol, evidence: Evidence[], verification: StaticFlowStep['verification'], relation?: StaticFlowRelationship): StaticFlowStep {
  return { id: `flow-step:${symbol.id}`, symbolId: symbol.id, file: symbol.file, location: symbol.location, explanation: relation ? `${relation.kind} references ${symbol.name} in ${symbol.file}.` : `Start at ${symbol.name} in ${symbol.file}.`, ...(relation ? { relationshipKind: relation.kind, relationshipId: relation.id } : {}), verification, branches: [], evidence: evidence.length ? evidence : [{ description: 'Symbol declaration', location: symbol.location }] };
}
