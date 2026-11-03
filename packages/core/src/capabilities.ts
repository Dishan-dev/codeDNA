import type {
  AnalysisCapability,
  AnalysisDiagnostic,
  AnalysisResult,
  CapabilityAssessment,
  CapabilityEvidence,
  CapabilityKind,
  CapabilityStatus,
  RepositorySnapshot,
} from '@codedna/shared';
import type { UIFlowAnalysis } from './ui-flow/index.js';
export interface CapabilityOptions {
  complete?: boolean;
  skippedFiles?: number;
  documentationAnalyzed?: boolean;
  symbolsAnalyzed?: boolean;
  staticWalkthroughReady?: boolean;
}
/** Undefined means not run; null means the caller knows that a stage failed. */
export function assessCapabilities(
  snapshot: RepositorySnapshot,
  dependency: AnalysisResult | null | undefined,
  uiFlow: UIFlowAnalysis | null | undefined,
  options: CapabilityOptions = {},
): CapabilityAssessment {
  const complete = options.complete === true,
    sourceFiles = snapshot.files.filter((file) =>
      /\.(?:ts|tsx|js|jsx)$/i.test(file.path),
    ).length;
  const evidence = (
    items: readonly AnalysisDiagnostic[],
  ): CapabilityEvidence[] =>
    [...items]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 10)
      .map((item) => ({
        type: 'diagnostic',
        description: item.message,
        diagnosticId: item.id,
        ...(item.location ? { location: item.location } : {}),
      }));
  const make = (
    kind: CapabilityKind,
    status: CapabilityStatus,
    reason: string,
    nextAction: string,
    details: Partial<
      Pick<
        AnalysisCapability,
        'diagnosticCount' | 'evidence' | 'missingPrerequisites'
      >
    > = {},
  ): AnalysisCapability => ({
    id: `capability:${kind}`,
    kind,
    status,
    reason,
    nextAction,
    diagnosticCount: details.diagnosticCount ?? 0,
    evidence: details.evidence ?? [],
    missingPrerequisites: details.missingPrerequisites ?? [],
  });
  const mismatch = !!dependency && dependency.snapshotId !== snapshot.id;
  const depDiagnostics = dependency?.diagnostics ?? [],
    uiDiagnostics = uiFlow?.diagnostics ?? [];
  const dependencyEvidence: CapabilityEvidence[] = [
    ...(dependency?.dependencyGraph.edges ?? []),
  ]
    .filter((item) => item.location)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 3)
    .map((item) => ({
      type: 'analysis',
      description: `Detected ${item.kind ?? 'dependency'}${item.specifier ? ` ${item.specifier}` : ''}.`,
      ...(item.location ? { location: item.location } : {}),
    }));
  const routeEvidence: CapabilityEvidence[] = [...(uiFlow?.graph.nodes ?? [])]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 3)
    .map((item) => ({
      type: 'analysis',
      description: `Detected screen ${item.routePath ?? item.label}${item.sourceFile ? ` in ${item.sourceFile}` : ''}.`,
      ...(item.location ? { location: item.location } : {}),
    }));
  const items: AnalysisCapability[] = [
    make(
      'snapshot',
      options.complete === undefined
        ? 'not_run'
        : complete
          ? 'available'
          : 'partial',
      options.complete === undefined
        ? 'Snapshot completeness was not supplied.'
        : complete
          ? `${snapshot.files.length} supported snapshot entries are available.`
          : `The snapshot is partial; ${options.skippedFiles ?? 0} entries were reported skipped.`,
      options.complete === undefined
        ? 'Check acquisition coverage before treating the snapshot as complete.'
        : complete
          ? 'Explore the included source files.'
          : 'Review acquisition diagnostics and treat missing files as unknown.',
      {
        evidence: [
          {
            type: 'snapshot',
            description:
              options.complete === undefined
                ? 'Snapshot identity supplied by the caller; acquisition completeness is unknown.'
                : 'Snapshot identity and acquisition completeness supplied by the caller.',
          },
        ],
      },
    ),
    !dependency
      ? make(
          'dependencies',
          dependency === null ? 'failed' : 'not_run',
          dependency === null
            ? 'Dependency analysis did not produce a result.'
            : 'Dependency analysis has not run.',
          'Analyze supported source files or review the stage error.',
          { missingPrerequisites: ['A successful dependency analysis'] },
        )
      : mismatch
        ? make(
            'dependencies',
            'failed',
            'The analysis belongs to a different snapshot.',
            'Reanalyze the active repository snapshot.',
            {
              missingPrerequisites: [
                'An analysis matching the snapshot identity',
              ],
            },
          )
        : sourceFiles === 0
          ? make(
              'dependencies',
              'unsupported',
              'The snapshot contains no supported TypeScript or JavaScript source files.',
              'Inspect another supported repository or add supported source files.',
            )
          : make(
              'dependencies',
              !complete || depDiagnostics.length ? 'partial' : 'available',
              `${sourceFiles} supported source files were included; ${depDiagnostics.length} dependency diagnostics were reported.`,
              'Review diagnostics and follow source-located imports.',
              {
                diagnosticCount: depDiagnostics.length,
                evidence: [...dependencyEvidence, ...evidence(depDiagnostics)],
              },
            ),
    !uiFlow
      ? make(
          'ui_flow',
          uiFlow === null ? 'failed' : 'not_run',
          uiFlow === null
            ? 'Route analysis did not produce a result.'
            : 'Route analysis has not run.',
          'Run route analysis or inspect source files.',
          { missingPrerequisites: ['A successful UI flow analysis'] },
        )
      : make(
          'ui_flow',
          uiDiagnostics.some((item) => item.code === 'ui-stage-failed')
            ? 'failed'
            : !complete || uiDiagnostics.length
              ? 'partial'
              : 'available',
          uiDiagnostics.some((item) => item.code === 'ui-stage-failed')
            ? 'Route analysis failed; no conclusion about routes can be drawn.'
            : `${uiFlow.graph.nodes.length} screens and ${uiFlow.graph.navigationEvents?.length ?? 0} navigation events were detected. No detected screens does not prove the repository has no routes.`,
          'Explore detected screens or inspect the route diagnostics.',
          {
            diagnosticCount: uiDiagnostics.length,
            evidence: [...routeEvidence, ...evidence(uiDiagnostics)],
          },
        ),
    make(
      'documentation',
      options.documentationAnalyzed ? snapshot.documents?.length ? complete ? 'available' : 'partial' : 'partial' : 'not_run',
      options.documentationAnalyzed ? snapshot.documents?.length ? `${snapshot.documents.length} bounded documentation files were available; their claims are unverified.` : 'No README or documentation was available. Structural exploration remains available.' : 'Documentation understanding has not run.',
      'Review documentation claims against linked source evidence.',
      { evidence: snapshot.documents?.slice(0, 3).map((doc) => ({ type: 'snapshot' as const, description: `Documentation: ${doc.path}` })) ?? [] },
    ),
    make(
      'symbols',
      options.symbolsAnalyzed ? complete ? 'available' : 'partial' : 'not_run',
      options.symbolsAnalyzed ? 'Bounded syntactic symbol discovery ran; dynamic behavior remains unknown.' : 'Symbol discovery has not run.',
      'Inspect Features and source evidence.',
    ),
    make(
      'static_simulation',
      options.staticWalkthroughReady ? complete ? 'available' : 'partial' : 'not_run',
      options.staticWalkthroughReady ? 'Bounded source-backed walkthroughs are available for detected entries; repository code is not executed.' : 'No supported walkthrough entry was established.',
      options.staticWalkthroughReady ? 'Select a feature or function and inspect its static references.' : 'Inspect source and supported feature entries.',
    ),
    make(
      'runtime_qa',
      'not_run',
      'No repository code or tests are executed by this analysis.',
      'Run tests in your own trusted environment.',
      { missingPrerequisites: ['An explicitly authorized isolated runtime'] },
    ),
    make(
      'ai_explanations',
      'not_configured',
      'No optional AI explanation provider is configured in this experience.',
      'Use deterministic explanations and source evidence.',
      {
        missingPrerequisites: [
          'An optional configured provider and user authorization',
        ],
      },
    ),
  ];
  const dependencyStatus = items.find(
    (item) => item.kind === 'dependencies',
  )!.status;
  items.push(
    make(
      'architecture_map',
      dependencyStatus,
      dependencyStatus === 'available'
        ? 'A dependency result is available for a 2D architecture map.'
        : 'The 2D map depends on the availability and completeness of dependency analysis.',
      'Use the guide or inspect dependency analysis diagnostics.',
    ),
  );
  items.push(
    make(
      'visualization_3d',
      'not_run',
      'Device WebGL support has not been checked by repository analysis. The 3D view is optional and may fall back.',
      'Open 3D to check this device, or use the guide and 2D map.',
      { missingPrerequisites: ['A compatible WebGL device'] },
    ),
  );
  return {
    schemaVersion: '1.0',
    snapshotId: snapshot.id,
    ...(snapshot.revision ? { revision: snapshot.revision } : {}),
    ...(options.complete === undefined ? {} : { snapshotComplete: complete }),
    sourceFiles,
    capabilities: items,
  };
}
