import type {
  AnalysisDiagnostic,
  AnalysisResult,
  DependencyEdge,
  DependencyGraph,
  DependencyPath,
  ImpactAnalysisResult,
  ImpactDiagnostic,
  ImpactedFile,
  UIFlowGraph,
} from '@codedna/shared';
import { normalizePath } from './validation.js';
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export interface ImpactOptions {
  maxFiles?: number;
  maxDepth?: number;
  maxPathsPerFile?: number;
  uiFlowGraph?: UIFlowGraph;
  uiFlowDiagnostics?: readonly AnalysisDiagnostic[];
  snapshotComplete?: boolean;
}
export interface ImpactAnalyzer {
  analyze(selectedFilePath: string): ImpactAnalysisResult;
}
function limit(
  value: number | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < min)
    throw new RangeError(`Invalid ${name}`);
  return v;
}
/** Build the reverse index once for repeated selections in one repository. */
export function createImpactAnalyzer(
  result: AnalysisResult,
  options: ImpactOptions = {},
): ImpactAnalyzer {
  const maxFiles = limit(options.maxFiles, 1000, 'maxFiles', 1),
    maxDepth = limit(options.maxDepth, 30, 'maxDepth', 0),
    maxPathsPerFile = limit(options.maxPathsPerFile, 3, 'maxPathsPerFile', 1);
  const graph: DependencyGraph = result.dependencyGraph ?? {
    schemaVersion: '1.0',
    nodes: [],
    edges: [],
  };
  const missingData =
    !Array.isArray(graph.nodes) || !Array.isArray(graph.edges);
  const graphNodes = graph.nodes ?? [];
  const graphEdges = graph.edges ?? [];
  const nodes = new Map(graphNodes.map((node) => [node.id, node]));
  const duplicateIds = new Set<string>();
  const seenEdgeIds = new Set<string>();
  for (const edge of graphEdges) {
    if (seenEdgeIds.has(edge.id)) duplicateIds.add(edge.id);
    else seenEdgeIds.add(edge.id);
  }
  const reverse = new Map<string, DependencyEdge[]>();
  let invalidEdges = 0;
  for (const edge of graphEdges) {
    if (duplicateIds.has(edge.id)) {
      invalidEdges++;
      continue;
    }
    if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
      invalidEdges++;
      continue;
    }
    if (
      nodes.get(edge.sourceId)?.kind === 'external' ||
      nodes.get(edge.targetId)?.kind === 'external'
    )
      continue;
    const list = reverse.get(edge.targetId) ?? [];
    list.push(edge);
    reverse.set(edge.targetId, list);
  }
  for (const list of reverse.values()) list.sort((a, b) => cmp(a.id, b.id));
  const screenIndex = new Map<string, UIFlowGraph['nodes']>();
  for (const screen of (options.uiFlowGraph ?? result.uiFlowGraph)?.nodes ?? [])
    if (screen.sourceFile) {
      const list = screenIndex.get(screen.sourceFile) ?? [];
      list.push(screen);
      screenIndex.set(screen.sourceFile, list);
    }
  for (const list of screenIndex.values()) list.sort((a, b) => cmp(a.id, b.id));
  return {
    analyze(selectedFilePath) {
      let path = selectedFilePath;
      try {
        path = normalizePath(selectedFilePath);
      } catch {
        /* Return an unknown-file diagnostic. */
      }
      const diagnostics: ImpactDiagnostic[] = [];
      const report = (code: string, message: string) =>
        diagnostics.push({
          id: `impact-diagnostic:${code}`,
          code,
          message,
          severity: 'warning',
        });
      if (options.snapshotComplete === false)
        report(
          'partial-snapshot',
          'Repository acquisition was partial; additional dependencies and screens may be missing.',
        );
      if ((result.diagnostics?.length ?? 0) > 0)
        report(
          'analysis-diagnostics',
          'Dependency analysis reported diagnostics; some relationships may be missing or uncertain.',
        );
      if ((options.uiFlowDiagnostics?.length ?? 0) > 0)
        report(
          'ui-flow-diagnostics',
          'UI flow analysis reported diagnostics; screen attribution may be incomplete.',
        );
      for (const [prefix, source] of [
        ['dependency', result.diagnostics ?? []],
        ['ui-flow', options.uiFlowDiagnostics ?? []],
      ] as const) {
        const ordered = [...source].sort((a, b) => cmp(a.id, b.id));
        for (const item of ordered.slice(0, 50))
          diagnostics.push({
            id: `impact-source:${prefix}:${item.id}`,
            code: `${prefix}:${item.code ?? 'diagnostic'}`,
            message: item.message,
            severity: 'warning',
            ...(item.location ? { location: item.location } : {}),
          });
        if (ordered.length > 50)
          report(
            `${prefix}-diagnostics-limited`,
            `${ordered.length - 50} additional ${prefix} diagnostics are not listed.`,
          );
      }
      if (!result.dependencyGraph || missingData)
        report(
          'missing-graph',
          'Dependency analysis is unavailable or missing nodes or edges.',
        );
      if (invalidEdges)
        report(
          'invalid-edges',
          `${invalidEdges} dependency edges have duplicate IDs or reference missing graph nodes.`,
        );
      const selectedId = `file:${path}`,
        selected = nodes.get(selectedId);
      const distances = new Map<string, number>(),
        paths = new Map<string, DependencyPath[]>(),
        queue: string[] = [];
      const pathEvidence = (edge: DependencyEdge) =>
        edge.metadata?.evidence ?? [];
      if (selected && selected.kind !== 'external') {
        distances.set(selectedId, 0);
        paths.set(selectedId, [
          {
            id: `impact-path:${encodeURIComponent(selectedId)}`,
            fileIds: [selectedId],
            edgeIds: [],
            evidence: [],
            certainty: 'source-evidenced',
          },
        ]);
        queue.push(selectedId);
      } else
        report(
          'unknown-file',
          `The selected file ${JSON.stringify(path)} is not in the dependency graph.`,
        );
      let truncated = false,
        pathLimit = false;
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]!,
          distance = distances.get(current)!;
        for (const edge of reverse.get(current) ?? []) {
          const parent = edge.sourceId,
            known = distances.get(parent);
          if (known !== undefined && known !== distance + 1) continue;
          if (distance >= maxDepth) {
            if (known === undefined) truncated = true;
            continue;
          }
          if (known === undefined) {
            if (queue.length >= maxFiles) {
              truncated = true;
              continue;
            }
            distances.set(parent, distance + 1);
            paths.set(parent, []);
            queue.push(parent);
          }
          const targetPaths = paths.get(parent)!;
          for (const suffix of paths.get(current) ?? []) {
            const edgeIds = [edge.id, ...suffix.edgeIds],
              id = `impact-path:${encodeURIComponent(parent)}:${edgeIds.map(encodeURIComponent).join(':')}`;
            if (targetPaths.some((p) => p.id === id)) continue;
            if (targetPaths.length >= maxPathsPerFile) {
              pathLimit = true;
              continue;
            }
            targetPaths.push({
              id,
              fileIds: [parent, ...suffix.fileIds],
              edgeIds,
              evidence: [...pathEvidence(edge), ...suffix.evidence],
              certainty:
                edge.metadata?.confidence === 1 &&
                pathEvidence(edge).length > 0 &&
                suffix.certainty === 'source-evidenced'
                  ? 'source-evidenced'
                  : 'uncertain',
            });
          }
        }
      }
      if (truncated)
        report(
          'traversal-limited',
          'Traversal reached a file-count or depth limit; results may omit dependents.',
        );
      if (pathLimit)
        report(
          'paths-limited',
          'Only a bounded number of shortest paths are retained per file.',
        );
      const files: ImpactedFile[] = [...distances]
        .map(
          ([id, distance]): ImpactedFile => ({
            id,
            path: nodes.get(id)?.label ?? id.slice(5),
            category:
              distance === 0
                ? 'selected'
                : distance === 1
                  ? 'direct'
                  : 'transitive',
            distance,
            paths: paths.get(id) ?? [],
          }),
        )
        .sort(
          (a, b) =>
            a.distance - b.distance || cmp(a.path, b.path) || cmp(a.id, b.id),
        );
      const screens = files
        .flatMap((file) =>
          (screenIndex.get(file.path) ?? []).map((screen) => ({
            id: `impact-screen:${screen.id}`,
            screen,
            sourceFile: file.path,
            distance: file.distance,
            paths: file.paths,
            evidence: screen.metadata.evidence,
            attribution: 'source-file' as const,
          })),
        )
        .sort(
          (a, b) => a.distance - b.distance || cmp(a.screen.id, b.screen.id),
        );
      const usedEdges = new Set(
        files.flatMap((file) => file.paths.flatMap((p) => p.edgeIds)),
      );
      const selectedGraph: DependencyGraph = {
        schemaVersion: graph.schemaVersion,
        nodes: files.map((file) => nodes.get(file.id)!).filter(Boolean),
        edges: graphEdges
          .filter((edge) => usedEdges.has(edge.id))
          .sort((a, b) => cmp(a.id, b.id)),
      };
      if (
        files.some((file) =>
          file.paths.some((p) => p.certainty === 'uncertain'),
        )
      )
        report(
          'uncertain-evidence',
          'Some dependency edges lack full source evidence or have reduced confidence.',
        );
      diagnostics.sort((a, b) => cmp(a.id, b.id));
      const complete =
        !truncated &&
        !pathLimit &&
        !invalidEdges &&
        options.snapshotComplete !== false &&
        !result.diagnostics?.length &&
        !options.uiFlowDiagnostics?.length &&
        !diagnostics.some(
          (d) =>
            d.code === 'missing-graph' ||
            d.code === 'unknown-file' ||
            d.code === 'uncertain-evidence',
        );
      return {
        schemaVersion: '1.0',
        selectedFilePath: path,
        ...(selected && selected.kind !== 'external'
          ? { selectedFileId: selectedId }
          : {}),
        files,
        screens,
        dependencyGraph: selectedGraph,
        diagnostics,
        summary: {
          direct: files.filter((f) => f.category === 'direct').length,
          transitive: files.filter((f) => f.category === 'transitive').length,
          screens: screens.length,
        },
        traversal: {
          visitedFiles: files.length,
          maxFiles,
          maxDepth,
          maxPathsPerFile,
          truncated: truncated || pathLimit,
          complete,
        },
      };
    },
  };
}
export function analyzeImpact(
  result: AnalysisResult,
  selectedFilePath: string,
  options: ImpactOptions = {},
): ImpactAnalysisResult {
  return createImpactAnalyzer(result, options).analyze(selectedFilePath);
}
