import type { ConceptCheck, ConceptId, ConceptUse, Feature } from '@codedna/shared';
import { code } from '../features/captions.js';
import { stepLine } from './challenges/fill-gap.js';
import { CONCEPT_ORDER, CONCEPTS } from './concepts.js';
import { choices, shuffle } from './util.js';

/**
 * Concepts you can see in a single line, with the text that proves it. A "which line?" question
 * is only asked when the right line matches and every wrong line does not, so no wrong answer
 * is secretly right. (Server code or conditional rendering can't be judged from one line.)
 */
const MARKERS: Partial<Record<ConceptId, RegExp>> = {
  'async-await': /\bawait\b/,
  'api-call': /\b(?:fetch|axios)\b/,
  database: /\b(?:prisma|supabase|db)\.|\.from\(/,
  validation: /\b(?:safeParse|parse|parseAsync|safeParseAsync|validate)\(/,
  state: /\bset[A-Z]\w*\(/,
  'event-handler': /\bon[A-Z]\w*=/,
  navigation: /\b(?:redirect|notFound)\(|router\.(?:push|replace)|<Link\b|href=/,
};

/**
 * One mini check per concept card. "Which line from your app is an example of X?" when the
 * concept is visible in a line; otherwise "which sentence describes X?" from the catalog.
 */
export function buildConceptChecks(ids: readonly ConceptId[], uses: readonly ConceptUse[], features: readonly Feature[]): Partial<Record<ConceptId, ConceptCheck>> {
  const steps = new Map(features.flatMap((feature) => feature.steps).map((step) => [step.id, step]));
  const lineOf = (use: ConceptUse) => {
    const step = use.stepId ? steps.get(use.stepId) : undefined;
    return step ? stepLine(step) : undefined;
  };
  const checks: Partial<Record<ConceptId, ConceptCheck>> = {};
  for (const id of ids) {
    const concept = CONCEPTS[id];
    const seed = `concept-check:${id}`;
    const marker = MARKERS[id];
    const right = marker ? uses.find((use) => use.conceptId === id && marker.test(lineOf(use) ?? '')) : undefined;
    // Wrong answers: real lines that clearly don't show this concept.
    const wrong = marker
      ? shuffle([...new Set(uses.flatMap((use) => lineOf(use) ?? []))].filter((line) => !marker.test(line)), seed).slice(0, 2)
      : [];
    if (right && wrong.length === 2) {
      const line = lineOf(right)!;
      checks[id] = {
        conceptId: id,
        prompt: `Which of these lines from your app is an example of “${concept.name}”?`,
        ...choices(line, wrong, seed),
        explanation: `${code(line, 80)} on line ${right.code.highlightLine} of ${code(right.code.path)}. ${concept.oneLiner}`,
        code: right.code,
      };
      continue;
    }
    const others = shuffle(
      CONCEPT_ORDER.filter((other) => other !== id),
      seed,
    )
      .slice(0, 2)
      .map((other) => CONCEPTS[other].oneLiner);
    checks[id] = {
      conceptId: id,
      prompt: `Which sentence describes “${concept.name}”?`,
      ...choices(concept.oneLiner, others, seed),
      explanation: concept.explainer.split(/(?<=\.)\s/)[0] ?? concept.oneLiner,
    };
  }
  return checks;
}
