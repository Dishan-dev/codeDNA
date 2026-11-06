import type { EffectKind, Feature, FillGapChallenge, Step } from '@codedna/shared';
import { code } from '../../features/captions.js';
import { choices, lineAt, lowerFirst, shuffle } from '../util.js';

/** Lines worth hiding, most meaningful first. */
const PRIORITY: EffectKind[] = ['validation', 'db-write', 'redirect', 'api-call', 'local-state', 'db-read', 'navigation'];
const rank = (kind: EffectKind) => (PRIORITY.includes(kind) ? PRIORITY.indexOf(kind) : PRIORITY.length);
const MIN_LENGTH = 8;
const MAX_LENGTH = 100;

/** The single, real line a step's code points at; undefined for multi-line statements. */
export function stepLine(step: Step): string | undefined {
  if (step.confidence === 'gap' || step.code.highlightEndLine) return undefined;
  const line = lineAt(step.code, step.code.highlightLine)?.trim();
  return line && line.length >= MIN_LENGTH && line.length <= MAX_LENGTH ? line : undefined;
}

/** "Which line belongs in the gap?" Hides one meaningful line; options are other real lines. */
export function fillGapChallenge(feature: Feature, lessonId: string, pool: readonly string[]): FillGapChallenge | undefined {
  const byStep = new Map(feature.effects.map((effect) => [effect.stepId, effect.kind]));
  const candidates = feature.steps
    .filter((step) => byStep.has(step.id) && stepLine(step))
    .sort((a, b) => rank(byStep.get(a.id)!) - rank(byStep.get(b.id)!));
  const step = candidates[0];
  const answer = step && stepLine(step);
  if (!step || !answer) return undefined;
  const seed = `${lessonId}/fill-gap`;
  const own = feature.steps.filter((item) => item !== step).flatMap((item) => stepLine(item) ?? []);
  const wrong = [...shuffle(own, seed), ...shuffle(pool, `${seed}:pool`)].filter((line, index, list) => line !== answer && list.indexOf(line) === index).slice(0, 3);
  if (wrong.length < 2) return undefined;
  return {
    kind: 'fill-gap',
    id: seed,
    prompt: `One line is missing from ${code(step.code.path)}. Which line belongs in the gap?`,
    hiddenLine: step.code.highlightLine,
    ...choices(answer, wrong, seed),
    hint: `This line ${lowerFirst(step.title)}.`,
    explanation: `The missing line is line ${step.code.highlightLine}: ${code(answer, 100)}. ${step.plain}`,
    codeRef: step.code,
    concepts: step.concepts,
  };
}
