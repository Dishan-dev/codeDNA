import type { ChoiceOption, CodeRef, Feature, Step } from '@codedna/shared';
import { hash } from '../features/captions.js';

/** A small seeded random generator (xorshift32), so every shuffle is the same for the same commit. */
export function seeded(seed: string): () => number {
  let state = parseInt(hash(seed), 16) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

export function shuffle<T>(items: readonly T[], seed: string): T[] {
  const random = seeded(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

/** "Place order" → "place order", but acronyms and names stay as written ("GET /query", "OAuth"). */
export const lowerFirst = (text: string) => (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** A button label inside a sentence: "Sign Out" → "sign out", "Create Invoice" → "create invoice"; "GitHub" and "GET" stay. */
export const inSentence = (text: string) => text.split(' ').map((word) => (/^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word)).join(' ');

/** Steps a challenge may use as an answer: never unknown parts. */
export const known = (steps: readonly Step[]) => steps.filter((step) => step.confidence !== 'gap');

/**
 * The path most runs take: at each branch, the answer that leads to more steps. Early exits
 * (sign-in failed, bad data) are left out, so ordering challenges have one right answer.
 */
export function happyPath(feature: Feature): Step[] {
  const reached = new Map<string, number>();
  for (const step of feature.steps) for (const item of step.when ?? []) reached.set(item.outcomeId, (reached.get(item.outcomeId) ?? 0) + 1);
  const continues = new Map<string, string>();
  for (const branch of feature.branches) {
    const [yes, no] = branch.outcomes;
    if (!yes || !no) continue;
    continues.set(branch.id, (reached.get(yes.id) ?? 0) > (reached.get(no.id) ?? 0) ? yes.id : no.id);
  }
  return feature.steps.filter((step) => (step.when ?? []).every((item) => continues.get(item.branchId) === item.outcomeId));
}

/** Text of one repository line, when the excerpt contains it. */
export function lineAt(code: CodeRef, line: number): string | undefined {
  if (code.excerpt === undefined || line < code.startLine || line > code.endLine) return undefined;
  return code.excerpt.split('\n')[line - code.startLine];
}

/** Options with stable ids, shuffled for display. Returns the options and the id of the right one. */
export function choices(correct: string, wrong: readonly string[], seed: string): { options: ChoiceOption[]; answerId: string } {
  const labels = [correct, ...wrong.filter((label, index) => label !== correct && wrong.indexOf(label) === index)];
  const options = labels.map((label, index) => ({ id: `${seed}:option:${index}`, label }));
  return { options: shuffle(options, seed), answerId: options[0]!.id };
}

/** A feature title in quotes, unless it already contains them (“Type in “Search””). */
export const quoted = (title: string) => (/[“”"]/.test(title) ? title : `“${title}”`);
