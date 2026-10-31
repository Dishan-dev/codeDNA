import type { AnalysisDiagnostic, DependencyGraph } from '@codedna/shared';
export interface PracticeSuggestion {
  id: string;
  title: string;
  explanation: string;
  location?: { path: string; line: number };
}
/** Conservative review prompts based on recorded dependency facts, not quality scores. */
export function filePracticeSuggestions(
  graph: DependencyGraph,
  diagnostics: AnalysisDiagnostic[],
  selectedId: string,
  complete: boolean,
): PracticeSuggestion[] {
  const node = graph.nodes.find((item) => item.id === selectedId);
  if (!node || node.kind === 'external') return [];
  const suggestions: PracticeSuggestion[] = [];
  const unresolved = diagnostics.filter(
    (item) =>
      item.code === 'unresolved-module' && item.location?.path === node.label,
  );
  for (const item of unresolved.slice(0, 3)) {
    const location = item.location!;
    suggestions.push({
      id: item.id,
      title: 'Check an unresolved import',
      explanation: `The analyzer could not resolve this import. Check the path, alias configuration and whether the file is present; it may also use a resolution pattern CodeDNA does not support. ${item.message}`,
      location: { path: location.path, line: location.start.line },
    });
  }
  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.targetId === selectedId && edge.sourceId !== selectedId)
      incoming.add(edge.sourceId);
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId)!.push(edge.targetId);
  }
  const queue = [selectedId],
    visited = new Set([selectedId]),
    parent = new Map<string, string>();
  let cycle: string[] | undefined;
  for (let index = 0; index < queue.length && !cycle; index++) {
    const current = queue[index]!;
    for (const next of outgoing.get(current) ?? []) {
      if (next === selectedId) {
        const path = [current];
        let cursor = current;
        while (cursor !== selectedId) {
          cursor = parent.get(cursor)!;
          path.push(cursor);
        }
        cycle = [...path.reverse(), selectedId];
        break;
      }
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, current);
        queue.push(next);
      }
    }
  }
  if (cycle) {
    const names = new Map(graph.nodes.map((item) => [item.id, item.label]));
    suggestions.push({
      id: 'cycle',
      title: 'Review a circular dependency',
      explanation: `A detected dependency cycle connects ${cycle.map((id) => names.get(id) ?? id).join(' → ')}. Cycles are not always wrong, but can make initialization and changes harder to reason about. Consider whether shared code belongs in a separate module.`,
    });
  }
  if (incoming.size >= 8)
    suggestions.push({
      id: 'dependents',
      title: 'Review changes carefully',
      explanation: `At least ${incoming.size} files have a direct dependency on this file in the analyzed snapshot. Consider checking those dependents and adding focused tests when changing its public behavior. A high count is not necessarily a problem.`,
    });
  if (!complete)
    suggestions.push({
      id: 'partial',
      title: 'Results may be incomplete',
      explanation:
        'This is a partial snapshot, so missing files or imports can change these observations.',
    });
  return suggestions;
}
