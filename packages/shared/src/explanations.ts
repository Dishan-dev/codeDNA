import type { DependencyEdge } from './index.js';
/** Explain only the syntax recorded by static analysis, not runtime behavior. */
export function describeDependency(
  edge: DependencyEdge,
  source: string,
  target: string,
): string {
  if (edge.id.startsWith('group-edge:'))
    return `${source} has ${edge.specifier ?? 'detected dependencies'} pointing to ${target}. Expand the groups to inspect individual source files.`;
  switch (edge.kind) {
    case 'import':
      return `${source} imports ${target}. This source-level relationship does not prove a function is called at runtime.`;
    case 're-export':
      return `${source} re-exports something from ${target}, making it available through ${source}.`;
    case 'dynamic-import':
      return `${source} contains a literal dynamic import of ${target}. It may load at runtime when that expression is reached.`;
    case 'require':
      return `${source} refers to ${target} using a CommonJS require call.`;
    default:
      return `${source} has a detected source-level dependency on ${target}.`;
  }
}
