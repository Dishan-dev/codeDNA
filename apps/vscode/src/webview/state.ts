import type {
  AnalysisResult,
  ImpactAnalysisResult,
  LearningPlan,
} from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
import type { ExplorerMode } from '../protocol.js';
export type WebviewState = {
  version: 1;
  type: 'state';
  status: 'ready' | 'empty' | 'loading' | 'error' | 'stale';
  message?: string;
  mode: ExplorerMode;
  selection?: string;
  files?: string[];
  result?: AnalysisResult;
  uiFlow?: UIFlowAnalysis;
  learning?: LearningPlan;
  impact?: ImpactAnalysisResult;
  complete?: boolean;
  diagnostics?: { path: string; message: string }[];
  identity?: string;
  progress?: {
    step: number;
    completed: string[];
    answers: Record<string, string>;
  };
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const graph = (value: unknown) =>
  record(value) &&
  Array.isArray(value.nodes) &&
  Array.isArray(value.edges) &&
  value.nodes.every(
    (n: unknown) =>
      record(n) &&
      typeof n.id === 'string' &&
      typeof n.label === 'string' &&
      record(n.metadata),
  ) &&
  value.edges.every(
    (e: unknown) =>
      record(e) &&
      typeof e.id === 'string' &&
      typeof e.sourceId === 'string' &&
      typeof e.targetId === 'string' &&
      record(e.metadata),
  );
export function validState(value: unknown): value is WebviewState {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.type !== 'state' ||
    !['ready', 'empty', 'loading', 'error', 'stale'].includes(
      String(value.status),
    ) ||
    !['Architecture', 'UI Flow', 'Impact Analysis', 'Learning Mode'].includes(
      String(value.mode),
    )
  )
    return false;
  if (
    (value.message !== undefined && typeof value.message !== 'string') ||
    (value.selection !== undefined && typeof value.selection !== 'string') ||
    (value.identity !== undefined && typeof value.identity !== 'string') ||
    (value.complete !== undefined && typeof value.complete !== 'boolean')
  )
    return false;
  if (
    value.files !== undefined &&
    (!Array.isArray(value.files) ||
      value.files.length > 1000 ||
      !value.files.every((f: unknown) => typeof f === 'string'))
  )
    return false;
  if (
    value.diagnostics !== undefined &&
    (!Array.isArray(value.diagnostics) ||
      !value.diagnostics.every(
        (d: unknown) =>
          record(d) &&
          typeof d.path === 'string' &&
          typeof d.message === 'string',
      ))
  )
    return false;
  if (
    value.result !== undefined &&
    (!record(value.result) ||
      !graph(value.result.dependencyGraph) ||
      !Array.isArray(value.result.diagnostics))
  )
    return false;
  if (
    value.uiFlow !== undefined &&
    (!record(value.uiFlow) ||
      !graph(value.uiFlow.graph) ||
      !Array.isArray(value.uiFlow.diagnostics))
  )
    return false;
  if (
    value.learning !== undefined &&
    (!record(value.learning) ||
      !Array.isArray(value.learning.steps) ||
      !Array.isArray(value.learning.warnings))
  )
    return false;
  if (
    value.progress !== undefined &&
    (!record(value.progress) ||
      !Number.isSafeInteger(value.progress.step) ||
      !Array.isArray(value.progress.completed) ||
      !value.progress.completed.every((v: unknown) => typeof v === 'string') ||
      !record(value.progress.answers) ||
      !Object.values(value.progress.answers).every(
        (v) => typeof v === 'string',
      ))
  )
    return false;
  if (
    value.impact !== undefined &&
    (!record(value.impact) ||
      !graph(value.impact.dependencyGraph) ||
      !Array.isArray(value.impact.files) ||
      !Array.isArray(value.impact.screens) ||
      !Array.isArray(value.impact.diagnostics) ||
      !record(value.impact.summary))
  )
    return false;
  return (
    value.status !== 'ready' ||
    (Array.isArray(value.files) &&
      record(value.result) &&
      record(value.uiFlow) &&
      record(value.learning))
  );
}
