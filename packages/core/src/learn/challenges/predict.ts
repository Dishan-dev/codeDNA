import type { Feature, PredictChallenge, Step } from '@codedna/shared';
import { code } from '../../features/captions.js';
import { choices, happyPath, known, quoted, shuffle } from '../util.js';

const MAX_BRANCH_QUESTIONS = 2;
const conditionText = (condition: string) => condition.replace(/^if \((.*)\)$/, '$1');
const concepts = (...steps: (Step | undefined)[]) => [...new Set(steps.flatMap((step) => step?.concepts ?? []))];

/** Distractors: other real step titles, first from this feature, then from the rest of the app. */
function distractors(correct: Step, feature: Feature, pool: readonly string[], seed: string, prefer: string[] = []): string[] {
  const own = shuffle(known(feature.steps).map((step) => step.title), seed);
  const titles = [...prefer, ...own, ...shuffle(pool, `${seed}:pool`)].filter((title, index, list) => title !== correct.title && list.indexOf(title) === index);
  return titles.slice(0, 3);
}

/**
 * "If the answer is Yes, what happens next?" from real branches. When a feature has no branch,
 * "After X, what happens next?" from its real order. Unknown steps are never answers.
 */
export function predictChallenges(feature: Feature, lessonId: string, pool: readonly string[]): PredictChallenge[] {
  const byId = new Map(feature.steps.map((step) => [step.id, step]));
  const result: PredictChallenge[] = [];
  for (const branch of feature.branches) {
    if (result.length >= MAX_BRANCH_QUESTIONS) break;
    const decision = byId.get(branch.stepId);
    // Ask about the answer that leaves the usual path: that is where the interesting behaviour is.
    const path = new Set(happyPath(feature).map((step) => step.id));
    const outcomes = [...branch.outcomes].sort((a, b) => Number(path.has(a.nextStepId ?? '')) - Number(path.has(b.nextStepId ?? '')));
    const outcome = outcomes.find((item) => item.nextStepId && byId.get(item.nextStepId)?.confidence !== 'gap');
    const next = outcome?.nextStepId ? byId.get(outcome.nextStepId) : undefined;
    if (!decision || !outcome || !next) continue;
    const other = branch.outcomes.find((item) => item !== outcome);
    const otherNext = other?.nextStepId ? byId.get(other.nextStepId) : undefined;
    const seed = `${lessonId}/predict:${branch.id}`;
    const wrong = distractors(next, feature, pool, seed, otherNext && otherNext.confidence !== 'gap' ? [otherNext.title] : []);
    if (wrong.length < 2) continue;
    const condition = conditionText(branch.condition);
    const answer = branch.condition.startsWith('if') ? `the answer to ${code(condition)} is “${outcome.label}”` : `“${outcome.label}”`;
    result.push({
      kind: 'predict',
      id: seed,
      prompt: branch.condition.startsWith('if')
        ? `In ${quoted(feature.title)}, the code asks ${code(condition)}. If the answer is “${outcome.label}”, what happens next?`
        : `In ${quoted(feature.title)}, what happens next if ${lowerOutcome(outcome.label)}?`,
      ...choices(next.title, wrong, seed),
      explanation: `When ${answer}, the code goes to line ${next.code.highlightLine} of ${code(next.code.path)}: ${next.plain}`,
      codeRef: decision.code,
      concepts: concepts(decision, next),
    });
  }
  if (result.length) return result;

  // No usable branch: ask what follows a step on the usual path.
  const path = known(happyPath(feature));
  const index = Math.max(0, path.findIndex((step, position) => position > 0 && ['request', 'server', 'database', 'screen', 'check'].includes(step.stage)) - 1);
  const before = path[index];
  const next = path[index + 1];
  if (!before || !next) return result;
  const seed = `${lessonId}/predict:sequence`;
  const wrong = distractors(next, feature, pool, seed).filter((title) => title !== before.title);
  if (wrong.length < 2) return result;
  result.push({
    kind: 'predict',
    id: seed,
    prompt: `In ${quoted(feature.title)}, after “${before.title}”, what happens next?`,
    ...choices(next.title, wrong, seed),
    explanation: `Next comes line ${next.code.highlightLine} of ${code(next.code.path)}: ${next.plain}`,
    codeRef: next.code,
    concepts: concepts(before, next),
  });
  return result;
}

const lowerOutcome = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
