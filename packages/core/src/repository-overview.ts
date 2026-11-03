import type {
  AnalysisResult,
  DependencyEdge,
  RepositorySnapshot,
  UIFlowGraph,
  UIFlowNode,
} from '@codedna/shared';
export interface RepositoryModule {
  id: string;
  path: string;
  fileCount: number;
  incoming: number;
  outgoing: number;
  screens: UIFlowNode[];
  fileIds: string[];
}
export interface ModuleRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  edges: DependencyEdge[];
}
export interface RepositoryOverview {
  analysisAvailable: boolean;
  snapshotId: string;
  revision?: string;
  complete: boolean;
  modules: RepositoryModule[];
  relationships: ModuleRelationship[];
  frameworks: { id: string; evidence: { path: string; line?: number }[] }[];
  technologies: { name: string; evidence: { path: string; line: number }[] }[];
  screens: UIFlowNode[];
  diagnostics: number;
  unresolved: number;
  fileCount: number;
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function modulePath(path: string): string {
  const parts = path.split('/');
  if (parts.length === 1) return '';
  return (parts[0] === 'apps' || parts[0] === 'packages') && parts.length > 2
    ? parts.slice(0, 2).join('/')
    : parts[0]!;
}
/** Derives structural facts from existing analysis without parsing or executing source. */
export function summarizeRepository(
  snapshot: RepositorySnapshot,
  result: AnalysisResult | undefined,
  flow: UIFlowGraph,
  complete = true,
): RepositoryOverview {
  const modules = new Map<string, RepositoryModule>(),
    membership = new Map<string, string>();
  for (const file of [...snapshot.files].sort((a, b) =>
    compare(a.path, b.path),
  )) {
    const path = modulePath(file.path),
      id = `module:${encodeURIComponent(path)}`,
      group = modules.get(id) ?? {
        id,
        path,
        fileCount: 0,
        incoming: 0,
        outgoing: 0,
        screens: [],
        fileIds: [],
      };
    group.fileCount++;
    group.fileIds.push(`file:${file.path}`);
    modules.set(id, group);
    membership.set(`file:${file.path}`, id);
  }
  const screens = [...flow.nodes].sort((a, b) => compare(a.id, b.id));
  const frameworks = new Map<
    string,
    Map<string, { path: string; line?: number }>
  >();
  for (const screen of screens) {
    if (screen.sourceFile) {
      const id = membership.get(`file:${screen.sourceFile}`);
      if (id) modules.get(id)?.screens.push(screen);
      if (screen.framework) {
        const paths = frameworks.get(screen.framework) ?? new Map();
        const evidence = {
          path: screen.sourceFile,
          ...(screen.location ? { line: screen.location.start.line } : {}),
        };
        paths.set(`${evidence.path}:${evidence.line ?? 0}`, evidence);
        frameworks.set(screen.framework, paths);
      }
    }
  }
  const groups = new Map<string, ModuleRelationship>();
  const graphNodes = new Map(
    (result?.dependencyGraph.nodes ?? []).map((node) => [node.id, node]),
  );
  const technologies = new Map<
    string,
    Map<string, { path: string; line: number }>
  >();
  for (const edge of result?.dependencyGraph.edges ?? []) {
    const targetNode = graphNodes.get(edge.targetId);
    if (targetNode?.kind === 'external' && edge.location) {
      const values = technologies.get(targetNode.label) ?? new Map();
      const evidence = {
        path: edge.location.path,
        line: edge.location.start.line,
      };
      values.set(`${evidence.path}:${evidence.line}`, evidence);
      technologies.set(targetNode.label, values);
    }
    const source = membership.get(edge.sourceId),
      target = membership.get(edge.targetId);
    if (!source || !target || source === target) continue;
    const id = `module-edge:${encodeURIComponent(source)}:${encodeURIComponent(target)}`;
    const group = groups.get(id) ?? {
      id,
      sourceId: source,
      targetId: target,
      edges: [],
    };
    group.edges.push(edge);
    groups.set(id, group);
    modules.get(source)!.outgoing++;
    modules.get(target)!.incoming++;
  }
  const relations = [...groups.values()].sort((a, b) => compare(a.id, b.id));
  for (const item of relations) item.edges.sort((a, b) => compare(a.id, b.id));
  const diagnostics = result?.diagnostics ?? [];
  return {
    snapshotId: snapshot.id,
    ...(snapshot.revision ? { revision: snapshot.revision } : {}),
    complete,
    modules: [...modules.values()].sort((a, b) => compare(a.id, b.id)),
    relationships: relations,
    frameworks: [...frameworks.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([id, values]) => ({
        id,
        evidence: [...values.values()].sort(
          (a, b) => compare(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0),
        ),
      })),
    technologies: [...technologies.entries()]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, values]) => ({
        name,
        evidence: [...values.values()].sort(
          (a, b) => compare(a.path, b.path) || a.line - b.line,
        ),
      })),
    screens,
    diagnostics: diagnostics.length,
    unresolved: diagnostics.filter(
      (item) =>
        item.code === 'unresolved-module' || item.code === 'unresolved-dynamic',
    ).length,
    fileCount: snapshot.files.length,
    analysisAvailable: !!result,
  };
}
