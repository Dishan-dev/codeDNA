import type { BehaviorStory, ExplanationCertainty } from '@codedna/shared';

export type StoryAdvance = { trail: string[]; reason: 'advanced' | 'choose-branch' | 'end' | 'cycle' };

/** The story always starts at its first step; steps are only ever reached through `next` links. */
export const startTrail = (story: BehaviorStory): string[] => (story.steps[0] ? [story.steps[0].id] : []);

/** Moves forward along the single next link, or the chosen one when the step branches. */
export function advanceStory(story: BehaviorStory, trail: string[], choice?: string): StoryAdvance {
  const current = story.steps.find((step) => step.id === trail.at(-1));
  if (!current || !current.next.length) return { trail, reason: 'end' };
  const link = current.next.length === 1 ? current.next[0] : current.next.find((item) => item.stepId === choice);
  if (!link) return { trail, reason: 'choose-branch' };
  if (trail.includes(link.stepId)) return { trail, reason: 'cycle' };
  return { trail: [...trail, link.stepId], reason: 'advanced' };
}
export const retreatStory = (trail: string[]): string[] => (trail.length > 1 ? trail.slice(0, -1) : trail);
/** Re-enters a story at a specific step (for example from an answer) with a path that is valid in the story. */
export function trailTo(story: BehaviorStory, stepId: string | undefined): string[] {
  const first = story.steps[0];
  if (!first) return [];
  if (!stepId || stepId === first.id) return [first.id];
  const parents = new Map<string, string>();
  for (const step of story.steps) for (const link of step.next) if (!parents.has(link.stepId) && link.stepId !== first.id) parents.set(link.stepId, step.id);
  const path = [stepId];
  while (parents.has(path[0]!) && path.length <= story.steps.length) path.unshift(parents.get(path[0]!)!);
  return path[0] === first.id ? path : [first.id];
}
export const CERTAINTY_LABEL: Record<ExplanationCertainty, string> = {
  verified: 'Verified by supported static analysis',
  documented: 'Documented',
  inferred: 'Inferred',
  unresolved: 'Unresolved',
  'runtime-observed': 'Runtime observed',
};
export const CATEGORY_LABEL = { page: 'Page', api: 'API route', interaction: 'Interaction', library: 'Library function', cli: 'Command', entry: 'Entry point' } as const;
