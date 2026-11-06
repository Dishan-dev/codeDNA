import type { Feature, OrderChallenge, Step, StepStage } from '@codedna/shared';
import { happyPath, known, quoted, shuffle } from '../util.js';

const MAX_STEPS = 5;
const MIN_STEPS = 3;
/** When there are too many steps, keep the ones that show the journey best. */
const PRIORITY: StepStage[] = ['request', 'server', 'database', 'check', 'screen', 'response', 'external', 'click', 'form', 'client', 'logic'];

function pick(steps: Step[]): Step[] {
  if (steps.length <= MAX_STEPS) return steps;
  const first = steps[0]!;
  const last = steps[steps.length - 1]!;
  const middle = steps.slice(1, -1);
  const ranked = [...middle].sort((a, b) => PRIORITY.indexOf(a.stage) - PRIORITY.indexOf(b.stage) || middle.indexOf(a) - middle.indexOf(b));
  const keep = new Set([first, last, ...ranked.slice(0, MAX_STEPS - 2)]);
  return steps.filter((step) => keep.has(step));
}

/** "Put the steps in order", from the feature's usual path. Unknown steps are left out. */
export function orderChallenge(feature: Feature, lessonId: string): OrderChallenge | undefined {
  const seen = new Set<string>();
  const unique = known(happyPath(feature)).filter((step) => !seen.has(step.title) && seen.add(step.title));
  if (unique.length < MIN_STEPS) return undefined;
  // Prefer the main journey over the inside of helper functions.
  const shallow = unique.filter((step) => step.depth <= 2);
  const steps = pick(shallow.length >= MIN_STEPS ? shallow : unique);
  const correct = steps.map((step) => step.id);
  const seed = `${lessonId}/order`;
  let shuffled = shuffle(correct, seed);
  // A "shuffle" that is already right teaches nothing; rotate it by one.
  if (shuffled.every((id, index) => id === correct[index])) shuffled = [...shuffled.slice(1), shuffled[0]!];
  return {
    kind: 'order',
    id: seed,
    prompt: `Put the steps of ${quoted(feature.title)} in the order they happen.`,
    stepsShuffled: shuffled,
    correct,
    explanation: `The real order is: ${steps.map((step, index) => `${index + 1}. ${step.title}`).join(' → ')}.`,
    codeRef: feature.entry,
    concepts: [...new Set(steps.flatMap((step) => step.concepts))],
  };
}
