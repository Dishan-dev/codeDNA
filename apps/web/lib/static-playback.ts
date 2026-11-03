import type { StaticFlow } from '@codedna/shared';

export type AdvanceResult = { trail: string[]; reason: 'advanced' | 'choose-branch' | 'end' | 'visit-limit' | 'cycle' };
export function advanceStaticFlow(flow: StaticFlow, trail: string[], choices: Record<string, string>, maxVisits = 100): AdvanceResult {
  if (trail.length >= maxVisits) return { trail, reason: 'visit-limit' };
  const step = flow.steps.find((item) => item.id === trail.at(-1));
  if (!step?.branches.length) return { trail, reason: 'end' };
  const branch = step.branches.length === 1 ? step.branches[0] : step.branches.find((item) => item.id === choices[step.id]);
  if (!branch) return { trail, reason: 'choose-branch' };
  const next = [...trail, branch.targetStepId];
  return { trail: next, reason: trail.includes(branch.targetStepId) ? 'cycle' : 'advanced' };
}
