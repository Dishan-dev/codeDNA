import type {
  AnalysisResult,
  LearningPlan,
  RepositorySnapshot,
} from '@codedna/shared';
import type { UIFlowAnalysis } from '@codedna/core';
import { analyzeImpact } from '@codedna/core/impact';
export async function chooseFolder<T>(
  trusted: boolean,
  folders: readonly T[],
  active: T | undefined,
  preferActive: boolean,
  pick: (folders: readonly T[]) => Promise<T | undefined>,
): Promise<T | undefined> {
  if (!trusted) throw new Error('Trust this workspace before running CodeDNA.');
  if (!folders.length) throw new Error('Open a local workspace folder first.');
  if (preferActive && active && folders.includes(active)) return active;
  if (folders.length === 1) return folders[0];
  return pick(folders);
}
export function currentFileImpact(
  result: AnalysisResult,
  snapshot: RepositorySnapshot,
  uiFlow: UIFlowAnalysis,
  complete: boolean,
  path: string,
) {
  if (!snapshot.files.some((file) => file.path === path)) return undefined;
  return analyzeImpact(result, path, {
    uiFlowGraph: uiFlow.graph,
    uiFlowDiagnostics: uiFlow.diagnostics,
    snapshotComplete: complete,
  });
}
export interface Progress {
  step: number;
  completed: string[];
  answers: Record<string, string>;
}
export class ProgressStore {
  private entries = new Map<string, Progress>();
  get(identity: string): Progress | undefined {
    return this.entries.get(identity);
  }
  set(identity: string, plan: LearningPlan, value: Progress): boolean {
    const ids = new Set(plan.steps.map((s) => s.id));
    if (
      value.step >= plan.steps.length ||
      value.completed.some((id) => !ids.has(id))
    )
      return false;
    const questions = new Map(
      plan.steps.flatMap((step) => step.questions ?? []).map((q) => [q.id, q]),
    );
    if (
      Object.entries(value.answers).some(
        ([id, choice]) =>
          !questions.get(id)?.choices.some((c) => c.id === choice),
      )
    )
      return false;
    this.entries.delete(identity);
    this.entries.set(identity, {
      step: value.step,
      completed: [...new Set(value.completed)],
      answers: { ...value.answers },
    });
    while (this.entries.size > 3)
      this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
}
