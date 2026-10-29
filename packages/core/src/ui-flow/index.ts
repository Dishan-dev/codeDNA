import type {
  AnalysisDiagnostic,
  RepositorySnapshot,
  SourceFile,
  UIFlowGraph,
} from '@codedna/shared';
import type ts from 'typescript';
import { validateSnapshot, type AnalysisOptions } from '../validation.js';
import { parseSource } from '../source.js';
import { nextAppRouterAdapter } from './next-app-router.js';
import { hasReactRouterEvidence, reactRouterAdapter } from './react-router.js';
import {
  hasReactNavigationEvidence,
  reactNavigationAdapter,
} from './react-navigation.js';
import {
  hasExpoRouterEvidence,
  hasNextSourceEvidence,
  expoRouterAdapter,
} from './expo-router.js';
export { nextAppRouterAdapter } from './next-app-router.js';
export { reactRouterAdapter } from './react-router.js';
export { expoRouterAdapter } from './expo-router.js';
export { reactNavigationAdapter } from './react-navigation.js';

export interface UIFlowContext {
  snapshot: RepositorySnapshot;
  files: ReadonlyMap<string, SourceFile>;
  parse(path: string): ts.SourceFile | undefined;
}
export interface UIFlowAnalysis {
  framework?: string;
  graph: UIFlowGraph;
  diagnostics: AnalysisDiagnostic[];
}
export interface UIFlowFrameworkAdapter {
  readonly id: string;
  analyze(context: UIFlowContext): UIFlowAnalysis;
}
/** Analyze framework navigation without altering the existing dependency-analysis API. */
export function analyzeUIFlows(
  snapshot: RepositorySnapshot,
  options: AnalysisOptions = {},
  adapter?: UIFlowFrameworkAdapter,
): UIFlowAnalysis {
  const checked = validateSnapshot(snapshot, options);
  const files = new Map(checked.files.map((file) => [file.path, file]));
  const cache = new Map<string, ts.SourceFile>();
  const context: UIFlowContext = {
    snapshot: checked,
    files,
    parse(path) {
      const source = files.get(path);
      if (!source) return undefined;
      let parsed = cache.get(path);
      if (!parsed) {
        parsed = parseSource(source);
        cache.set(path, parsed);
      }
      return parsed;
    },
  };
  if (adapter) return adapter.analyze(context);
  const reactEvidence = hasReactRouterEvidence(context);
  const expoEvidence = hasExpoRouterEvidence(context);
  const navigationEvidence = hasReactNavigationEvidence(context);
  const hasNextPages = [...files.keys()].some((path) =>
    /^(?:src\/)?app\/(?:.*\/)?page\.(?:ts|tsx|js|jsx)$/.test(path),
  );
  const nextEvidence =
    hasNextPages && (!expoEvidence || hasNextSourceEvidence(context));
  const selected = nextEvidence
    ? nextAppRouterAdapter
    : expoEvidence
      ? expoRouterAdapter
      : reactEvidence
        ? reactRouterAdapter
        : navigationEvidence
          ? reactNavigationAdapter
          : nextAppRouterAdapter;
  const result = selected.analyze(context);
  const evidence = [
    nextEvidence && 'Next.js App Router',
    expoEvidence && 'Expo Router',
    reactEvidence && 'React Router',
    navigationEvidence && 'React Navigation',
  ].filter(Boolean);
  if (evidence.length > 1)
    result.diagnostics.push({
      id: 'ui-diagnostic:mixed-frameworks',
      code: 'ui-mixed-frameworks',
      severity: 'warning',
      message: `${evidence.join(', ')} evidence coexists; automatic analysis selected ${selected.id}. Pass an adapter explicitly to analyze another framework.`,
    });
  result.diagnostics.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return result;
}
