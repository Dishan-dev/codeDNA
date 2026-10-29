import type {
  AnalysisDiagnostic,
  AnalysisResult,
  LearningPlan,
  LearningQuestion,
  LearningStep,
  UIFlowGraph,
} from '@codedna/shared';
export interface LearningOptions {
  maxFilesPerStep?: number;
  maxQuestions?: number;
  snapshotComplete?: boolean;
  uiFlowDiagnostics?: readonly AnalysisDiagnostic[];
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function bounded(
  value: number | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < 0 || v > max)
    throw new RangeError(`Invalid ${name}`);
  return v;
}
/** Builds bounded lessons from existing graphs; never reads or executes source. */
export function generateLearningPlan(
  result: AnalysisResult | null | undefined,
  uiFlowGraph?: UIFlowGraph,
  options: LearningOptions = {},
): LearningPlan {
  const maxFiles = bounded(options.maxFilesPerStep, 6, 'maxFilesPerStep', 20),
    maxQuestions = bounded(options.maxQuestions, 3, 'maxQuestions', 10);
  const graph = result?.dependencyGraph,
    flow = uiFlowGraph ?? result?.uiFlowGraph;
  const warnings: string[] = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    warnings.push('Dependency analysis is unavailable or incomplete.');
  if (options.snapshotComplete === false)
    warnings.push(
      'The repository snapshot is partial; files and relationships may be missing.',
    );
  if (result?.diagnostics?.length)
    warnings.push(
      'Dependency diagnostics may limit the accuracy or coverage of this plan.',
    );
  if (options.uiFlowDiagnostics?.length)
    warnings.push(
      'UI flow diagnostics may leave some screens and navigation unattributed.',
    );
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (flow && (!Array.isArray(flow.nodes) || !Array.isArray(flow.edges)))
    warnings.push('UI flow data is incomplete.');
  const fileNodes = graphNodes
    .filter((n) => n.id.startsWith('file:') && n.kind !== 'external')
    .sort((a, b) => cmp(a.id, b.id));
  const byId = new Map(fileNodes.map((n) => [n.id, n])),
    paths = new Set(fileNodes.map((n) => n.label));
  const edges = graphEdges
    .filter((e) => byId.has(e.sourceId) && byId.has(e.targetId))
    .sort((a, b) => cmp(a.id, b.id));
  if (
    edges.length !==
    graphEdges.filter(
      (e) => e.sourceId.startsWith('file:') && e.targetId.startsWith('file:'),
    ).length
  )
    warnings.push('Some dependency edges refer to missing file nodes.');
  const incoming = new Map<string, Set<string>>(),
    outgoing = new Map<string, Set<string>>();
  const evidenceByTarget = new Map<string, (typeof edges)[number]>();
  for (const edge of edges) {
    if (edge.metadata?.evidence?.length && !evidenceByTarget.has(edge.targetId))
      evidenceByTarget.set(edge.targetId, edge);
    const a = incoming.get(edge.targetId) ?? new Set<string>();
    a.add(edge.sourceId);
    incoming.set(edge.targetId, a);
    const b = outgoing.get(edge.sourceId) ?? new Set<string>();
    b.add(edge.targetId);
    outgoing.set(edge.sourceId, b);
  }
  const screens = (Array.isArray(flow?.nodes) ? flow.nodes : [])
    .filter((n) => n.sourceFile && paths.has(n.sourceFile))
    .sort((a, b) => cmp(a.id, b.id));
  const screenById = new Map(screens.map((s) => [s.id, s]));
  const navEdges = (Array.isArray(flow?.edges) ? flow.edges : [])
    .filter(
      (e) =>
        screenById.has(e.sourceId) &&
        screenById.has(e.targetId) &&
        e.metadata?.evidence?.length,
    )
    .sort((a, b) => cmp(a.id, b.id));
  const steps: LearningStep[] = [];
  if (!fileNodes.length) {
    warnings.push(
      'No analyzed source files are available for a learning plan.',
    );
    return {
      schemaVersion: '1.0',
      snapshotId: result?.snapshotId ?? '',
      steps,
      warnings,
    };
  }
  const categories = new Map<string, number>();
  for (const file of fileNodes) {
    const ext = file.label.match(/\.(tsx|ts|jsx|js)$/)?.[1] ?? 'other';
    categories.set(ext, (categories.get(ext) ?? 0) + 1);
  }
  const folders = new Map<string, number>();
  for (const file of fileNodes) {
    const folder = file.label.includes('/')
      ? file.label.split('/')[0]!
      : '(root)';
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const folderText = [...folders]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, 4)
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ');
  const categoryText = [...categories]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([ext, count]) => `${count} ${ext}`)
    .join(', ');
  steps.push({
    id: 'learning:overview',
    kind: 'overview',
    title: 'Orient yourself',
    explanation: `The analyzed graph contains ${fileNodes.length} source files (${categoryText}) and ${edges.length} internal dependency edges. Largest source groups: ${folderText}.`,
    objective:
      'Locate the source files and understand the scope of the snapshot.',
    action: 'Browse the file tree; open a file that interests you.',
    complexity: 'introductory',
    files: fileNodes.slice(0, maxFiles).map((n) => n.label),
    evidence: [
      {
        description: `Counted ${fileNodes.length} file nodes and ${edges.length} internal dependency edges. Largest source groups: ${folderText}.`,
      },
    ],
  });
  const entries = fileNodes.filter((n) =>
    /(?:^|\/)(?:index|main|app|page|_layout)\.(?:tsx?|jsx?)$/i.test(n.label),
  );
  if (entries.length && maxFiles) {
    const selected = entries.slice(0, maxFiles);
    steps.push({
      id: 'learning:entries',
      kind: 'entry',
      title: 'Find possible entry files',
      explanation:
        'These files match common entry, route, or layout naming conventions. Names alone do not prove runtime entry points.',
      objective: 'Check how the project starts or exposes screens.',
      action: 'Read these candidates and verify how the application uses them.',
      complexity: 'introductory',
      files: selected.map((n) => n.label),
      evidence: selected.map((n) => ({
        description: `Filename matches an entry or route convention: ${n.label}`,
      })),
    });
  }
  const ranked = [...fileNodes]
    .filter((n) => incoming.has(n.id) || outgoing.has(n.id))
    .sort(
      (a, b) =>
        (incoming.get(b.id)?.size ?? 0) +
          (outgoing.get(b.id)?.size ?? 0) -
          ((incoming.get(a.id)?.size ?? 0) + (outgoing.get(a.id)?.size ?? 0)) ||
        cmp(a.id, b.id),
    );
  const primary = ranked[0];
  if (primary && maxFiles) {
    const connected = edges
      .filter((e) => e.targetId === primary.id || e.sourceId === primary.id)
      .slice(0, maxFiles);
    const related = new Set<string>();
    // Dependencies first, then the selected module and its importers.
    for (const edge of connected)
      if (edge.sourceId === primary.id)
        related.add(byId.get(edge.targetId)!.label);
    related.add(primary.label);
    for (const edge of connected)
      if (edge.targetId === primary.id)
        related.add(byId.get(edge.sourceId)!.label);
    steps.push({
      id: 'learning:dependencies',
      kind: 'dependency',
      title: 'Trace a connected module',
      explanation: `${primary.label} has ${incoming.get(primary.id)?.size ?? 0} distinct importers and ${outgoing.get(primary.id)?.size ?? 0} internal dependencies in the graph. Connectivity is a reading heuristic, not a measure of business importance.`,
      objective: 'Trace dependencies before the files that import them.',
      action:
        'Open the files and follow the recorded import locations in Architecture.',
      complexity: connected.length > 3 ? 'advanced' : 'moderate',
      files: [...related].slice(0, maxFiles),
      evidence: connected.flatMap((e) => e.metadata?.evidence ?? []),
      dependencyEdgeIds: connected.map((e) => e.id),
    });
  }
  const utilityCandidates = fileNodes
    .filter((node) =>
      /(?:^|\/)(?:utils?|services?|lib)(?:\/|\.)/i.test(node.label),
    )
    .slice(0, maxFiles);
  if (utilityCandidates.length)
    steps.push({
      id: 'learning:module-candidates',
      kind: 'module',
      title: 'Inspect shared-module candidates',
      explanation:
        'These paths contain common utility or service names. The names are reading hints and do not establish what the code does or whether it is shared.',
      objective: 'Verify module responsibilities and their actual importers.',
      action: 'Read a candidate and inspect its dependency neighborhood.',
      complexity: 'moderate',
      files: utilityCandidates.map((node) => node.label),
      evidence: utilityCandidates.map((node) => ({
        description: `Path matches a utility or service naming convention: ${node.label}`,
      })),
    });
  if (screens.length && maxFiles) {
    const nav = navEdges[0],
      source = nav ? screenById.get(nav.sourceId) : screens[0],
      target = nav ? screenById.get(nav.targetId) : undefined;
    const related = [
      ...new Set(
        [source?.sourceFile, target?.sourceFile].filter(
          (v): v is string => !!v,
        ),
      ),
    ].slice(0, maxFiles);
    steps.push({
      id: 'learning:ui-flow',
      kind: 'navigation',
      title: 'Explore a screen and navigation',
      explanation:
        nav && source && target
          ? `The analyzer detected navigation from ${source.routePath ?? source.label} to ${target.routePath ?? target.label}. This is static evidence, not proof the action executes.`
          : `The analyzer attributed ${screens.length} screens to source files; no resolved navigation edge is available for this lesson.`,
      objective: 'Connect screen source to the evidence the analyzer found.',
      action: 'Open the screen source and inspect its UI Flow map.',
      complexity: nav ? 'moderate' : 'introductory',
      files: related,
      evidence: nav ? nav.metadata.evidence : (source?.metadata.evidence ?? []),
      screenIds: [source?.id, target?.id].filter((v): v is string => !!v),
      ...(nav ? { navigationEdgeIds: [nav.id] } : {}),
    });
  }
  const impactEdge = edges.find((e) => e.metadata?.evidence?.length);
  if (impactEdge && maxFiles) {
    const from = byId.get(impactEdge.sourceId)!,
      to = byId.get(impactEdge.targetId)!;
    steps.push({
      id: 'learning:impact',
      kind: 'impact',
      title: 'Consider a change',
      explanation: `${from.label} imports or references ${to.label}. A change to ${to.label} may affect ${from.label}; it does not prove breakage.`,
      objective: 'Distinguish a dependency from its reverse dependent.',
      action:
        'Select the dependency in Impact Analysis and inspect the recorded path.',
      complexity: 'moderate',
      files: [to.label, from.label].slice(0, maxFiles),
      evidence: impactEdge.metadata.evidence,
      dependencyEdgeIds: [impactEdge.id],
    });
  }
  const questions: LearningQuestion[] = [];
  if (maxQuestions && fileNodes.length >= 3) {
    const nodes = fileNodes;
    for (const target of nodes) {
      const importerIds = incoming.get(target.id);
      if (!importerIds || importerIds.size !== 1) continue;
      const importer = [...importerIds][0]!,
        edge = evidenceByTarget.get(target.id);
      if (!edge) continue;
      const decoys = nodes
        .filter(
          (n) =>
            n.id !== target.id && n.id !== importer && !importerIds.has(n.id),
        )
        .slice(0, 2);
      if (decoys.length < 2) continue;
      const correct = byId.get(importer)!;
      const choices = [correct, ...decoys]
        .sort((a, b) => cmp(a.id, b.id))
        .map((n) => ({ id: n.id, label: n.label }));
      questions.push({
        id: `question:importer:${encodeURIComponent(target.id)}`,
        prompt: `According to the dependency graph, which file directly imports or references ${target.label}?`,
        choices,
        answerId: correct.id,
        explanation: `${correct.label} has a recorded dependency on ${target.label}.`,
        evidence: edge.metadata.evidence,
      });
      break;
    }
  }
  if (questions.length < maxQuestions && screens.length >= 3) {
    const incomingNav = new Map<string, Set<string>>();
    for (const edge of Array.isArray(flow?.edges) ? flow.edges : []) {
      if (!screenById.has(edge.sourceId) || !screenById.has(edge.targetId))
        continue;
      const set = incomingNav.get(edge.targetId) ?? new Set<string>();
      set.add(edge.sourceId);
      incomingNav.set(edge.targetId, set);
    }
    const labelCounts = new Map<string, number>();
    for (const screen of screens) {
      const label = screen.routePath ?? screen.label;
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    const uniqueScreens = screens
      .filter(
        (screen) => labelCounts.get(screen.routePath ?? screen.label) === 1,
      )
      .slice(0, 5);
    for (const edge of navEdges) {
      const source = screenById.get(edge.sourceId)!,
        target = screenById.get(edge.targetId)!;
      if (incomingNav.get(target.id)?.size !== 1) continue;
      const label = (screen: typeof source) => screen.routePath ?? screen.label;
      if (
        labelCounts.get(label(source)) !== 1 ||
        labelCounts.get(label(target)) !== 1
      )
        continue;
      const decoys = uniqueScreens
        .filter((screen) => screen.id !== source.id && screen.id !== target.id)
        .slice(0, 2);
      if (decoys.length < 2 || label(source) === label(target)) continue;
      questions.push({
        id: `question:navigation:${encodeURIComponent(edge.id)}`,
        prompt: `According to the detected UI flow, which screen has a navigation edge to ${label(target)}?`,
        choices: [source, ...decoys]
          .sort((a, b) => cmp(a.id, b.id))
          .map((s) => ({ id: s.id, label: label(s) })),
        answerId: source.id,
        explanation: `The analyzed UI flow records navigation from ${label(source)} to ${label(target)}.`,
        evidence: edge.metadata.evidence,
      });
      break;
    }
  }
  steps.push({
    id: 'learning:recap',
    kind: 'recap',
    title: 'Recap and check your understanding',
    explanation: questions.length
      ? 'Review the evidence and answer the available questions.'
      : 'Review the files and relationships you inspected; there is not enough unambiguous evidence for a question.',
    objective: 'Recall observed relationships and their limits.',
    action: questions.length
      ? 'Answer the knowledge check and inspect its evidence.'
      : 'Return to a source file and summarize its role in your own words.',
    complexity: 'introductory',
    files: [],
    evidence: [],
    ...(questions.length
      ? { questions: questions.slice(0, maxQuestions) }
      : {}),
  });
  return {
    schemaVersion: '1.0',
    snapshotId: result?.snapshotId ?? '',
    steps,
    warnings,
  };
}
