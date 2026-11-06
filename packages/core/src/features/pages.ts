import type { ImportEdge, PageRoute } from '@codedna/shared';

const MAX_VISITS = 20_000;

/**
 * Which pages each file can appear on: a page reaches every file it imports, directly or not,
 * without passing through another page or layout. Files only a layout reaches (navigation, a
 * user menu) get the layout's route. Type-only imports are ignored.
 */
export function pagesByFile(routes: readonly PageRoute[], imports: readonly ImportEdge[]): Map<string, string[]> {
  const roots = routes.filter((route) => route.kind === 'page' || route.kind === 'layout');
  const rootFiles = new Set(roots.map((route) => route.file));
  const next = new Map<string, string[]>();
  for (const edge of imports) {
    if (!edge.target || edge.kind === 'type') continue;
    const list = next.get(edge.from) ?? [];
    list.push(edge.target);
    next.set(edge.from, list);
  }
  const reach = (kind: 'page' | 'layout', result: Map<string, Set<string>>, skip: ReadonlySet<string>) => {
    let visits = 0;
    for (const root of roots.filter((route) => route.kind === kind)) {
      const seen = new Set([root.file]);
      const queue = [root.file];
      while (queue.length && visits++ < MAX_VISITS) {
        const file = queue.shift()!;
        if (!skip.has(file)) {
          const here = result.get(file) ?? new Set<string>();
          here.add(root.route);
          result.set(file, here);
        }
        for (const target of next.get(file) ?? []) {
          if (seen.has(target) || rootFiles.has(target)) continue;
          seen.add(target);
          queue.push(target);
        }
      }
    }
  };
  const byPage = new Map<string, Set<string>>();
  reach('page', byPage, new Set());
  const byLayout = new Map<string, Set<string>>();
  reach('layout', byLayout, new Set(byPage.keys()));
  return new Map([...byPage, ...byLayout].map(([file, here]) => [file, [...here].sort()]));
}
