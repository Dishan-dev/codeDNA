import type { ActionIndex, ReachPath, ReverseReach, StructuralTier, Trace, TraceStepData, UserAction } from '@codedna/shared';
import { redactSecrets } from './evidence.js';

/**
 * Browser-safe helpers over an ActionIndex: no TypeScript compiler import, so the Explorer can
 * hydrate traces and compute reverse reach without shipping the analyzer.
 */
const TIER_RANK: Record<StructuralTier, number> = { resolved: 0, conventional: 1, heuristic: 2, gap: 3 };
const weakest = (tiers: StructuralTier[]): StructuralTier => tiers.reduce<StructuralTier>((worst, tier) => (TIER_RANK[tier] > TIER_RANK[worst] ? tier : worst), 'resolved');
const EXCERPT_BEFORE = 3;
const EXCERPT_AFTER = 5;
const MAX_LINE = 200;

/** Attach bounded, secret-redacted excerpts from the snapshot to a stored trace. */
export function hydrateTrace(index: ActionIndex, traceId: string, files: readonly { path: string; content: string }[]): Trace | undefined {
  const stored = index.traces.find((trace) => trace.id === traceId);
  if (!stored) return undefined;
  const contents = new Map(files.map((file) => [file.path, file.content.split('\n')]));
  const tierCounts = { resolved: 0, conventional: 0, heuristic: 0, gap: 0 };
  const steps = stored.steps.map((step) => {
    tierCounts[step.tier]++;
    const lines = contents.get(step.file);
    if (!lines) return { ...step, excerpt: { startLine: step.line, lines: [] } };
    const start = Math.max(1, step.line - EXCERPT_BEFORE);
    const end = Math.min(lines.length, step.line + EXCERPT_AFTER);
    return { ...step, excerpt: { startLine: start, lines: lines.slice(start - 1, end).map((line) => redactSecrets(line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line)) } };
  });
  const limitations = [index.commit ? `Static analysis of commit ${index.commit}. Nothing was executed.` : 'Static analysis of a snapshot without a commit. Nothing was executed.'];
  if (stored.truncated) limitations.push('This trace stopped at a step or depth limit; later steps are not shown.');
  if (index.partial) limitations.push('The analysis is partial; missing files or limits may hide steps.');
  return { schemaVersion: '1.0', id: stored.id, actionId: stored.actionId, ...(index.commit ? { commit: index.commit } : {}), steps, tierCounts, staticOnly: true, partial: stored.truncated || index.partial, limitations };
}

/** Steps hidden by the chosen branch options; unconditional steps are always visible. */
export function visibleSteps<T extends Pick<TraceStepData, 'when'>>(steps: readonly T[], choices: Readonly<Record<string, 'then' | 'else'>>): T[] {
  return steps.filter((step) => !step.when?.some((condition) => choices[condition.branchId] && choices[condition.branchId] !== condition.option));
}

interface RelationshipLike { kind: string; sourceId: string; targetId?: string; location: { path: string; start: { line: number } } }
interface SymbolLike { id: string; name: string }
/** Which detected user actions reach a symbol, by which path, and what CodeDNA could not resolve. */
export function reverseReach(index: ActionIndex, symbolId: string, relationships: readonly RelationshipLike[] = [], symbols: readonly SymbolLike[] = []): ReverseReach | undefined {
  let symbol: TraceStepData['symbol'];
  for (const trace of index.traces) for (const step of trace.steps) if (!symbol && step.symbol?.id === symbolId) symbol = step.symbol;
  if (!symbol) return undefined;
  const actionsByTrace = new Map<string, UserAction[]>();
  for (const action of index.actions) actionsByTrace.set(action.traceId, [...(actionsByTrace.get(action.traceId) ?? []), action]);
  const rows = new Map<string, ReachPath>();
  const callSites = new Set<string>();
  const unresolved = new Map<string, ReverseReach['unresolvedCallers'][number]>();
  let truncated = false;
  for (const trace of index.traces) {
    const byId = new Map(trace.steps.map((step) => [step.id, step]));
    for (const step of trace.steps) {
      if (step.kind === 'gap' && step.possibleTargets?.some((target) => target.symbolId === symbolId || (!target.symbolId && target.file === symbol!.file && !target.name)))
        unresolved.set(`${step.file}:${step.line}`, { file: step.file, line: step.line, code: step.code, reason: step.gapReason ?? step.plainText });
      if (step.symbol?.id !== symbolId) continue;
      if (step.callSite) callSites.add(`${step.callSite.file}:${step.callSite.line}`);
      truncated ||= trace.truncated;
      const chain: TraceStepData[] = [];
      for (let current: TraceStepData | undefined = step; current; current = current.parentId ? byId.get(current.parentId) : undefined) chain.unshift(current);
      const tier = weakest(chain.map((item) => item.tier));
      for (const action of actionsByTrace.get(trace.id) ?? []) {
        const existing = rows.get(action.id);
        if (existing && TIER_RANK[existing.tier] <= TIER_RANK[tier]) continue;
        rows.set(action.id, { actionId: action.id, pageRoute: action.pageRoute, label: action.label, path: chain.map((item) => item.pathLabel), tier, traceId: trace.id, stepId: step.id });
      }
    }
  }
  const names = new Map(symbols.map((item) => [item.id, item.name]));
  const otherCallers = relationships
    .filter((relation) => relation.kind === 'call' && relation.targetId === symbolId && !callSites.has(`${relation.location.path}:${relation.location.start.line}`))
    .map((relation) => ({ file: relation.location.path, line: relation.location.start.line, name: names.get(relation.sourceId) ?? relation.sourceId }))
    .slice(0, 50);
  const actions = [...rows.values()].sort((a, b) => (a.pageRoute < b.pageRoute ? -1 : a.pageRoute > b.pageRoute ? 1 : TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.label < b.label ? -1 : 1)));
  return { symbol: symbol.name, symbolId, file: symbol.file, line: symbol.line, actions, pages: [...new Set(actions.map((row) => row.pageRoute))], unresolvedCallers: [...unresolved.values()], otherCallers, partial: index.partial || truncated };
}

export interface SearchHit { kind: 'action' | 'symbol' | 'page'; label: string; detail: string; actionId?: string; pageId?: string; symbolId?: string }
/** Case-insensitive substring search over action labels, pages and traced function names. */
export function searchIndex(index: ActionIndex, query: string, limit = 8): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  for (const action of index.actions) if (`${action.label} ${action.pageRoute} ${action.component}`.toLowerCase().includes(needle)) hits.push({ kind: 'action', label: action.label, detail: action.pageRoute, actionId: action.id, pageId: action.pageId });
  for (const page of index.pages) if (page.kind === 'page' && `${page.route} ${page.title ?? ''}`.toLowerCase().includes(needle)) hits.push({ kind: 'page', label: page.route, detail: page.title ?? 'page', pageId: page.id });
  const seen = new Set<string>();
  for (const trace of index.traces) for (const step of trace.steps) {
    if (!step.symbol || seen.has(step.symbol.id) || !step.symbol.name.toLowerCase().includes(needle)) continue;
    seen.add(step.symbol.id);
    hits.push({ kind: 'symbol', label: `${step.symbol.name}()`, detail: `function · ${step.symbol.file}`, symbolId: step.symbol.id });
  }
  return hits.slice(0, limit);
}
