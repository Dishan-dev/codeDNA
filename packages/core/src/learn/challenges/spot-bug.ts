import type { Feature, MutationKind, SpotBugChallenge, Step } from '@codedna/shared';
import { code } from '../../features/captions.js';
import { choices, inSentence, lineAt, lowerFirst } from '../util.js';

interface Mutation {
  kind: MutationKind;
  step: Step;
  /** Excerpt with the change applied. */
  mutated: string;
  /** 1-based line within `mutated` where the change is. */
  changedLine: number;
  correct: string;
  wrong: string[];
  explanation: string;
}

const lines = (step: Step) => step.code.excerpt?.split('\n') ?? [];
const span = (step: Step) => ({ from: step.code.highlightLine - step.code.startLine, to: (step.code.highlightEndLine ?? step.code.highlightLine) - step.code.startLine });
const where = (step: Step) => `line ${step.code.highlightLine} of ${code(step.code.path)}`;

/** Remove the highlighted statement (a whole `if` block) from the excerpt. */
function removeStatement(step: Step): { mutated: string; changedLine: number } | undefined {
  const all = lines(step);
  const { from, to } = span(step);
  if (from < 0 || to >= all.length || !all.length) return undefined;
  const kept = [...all.slice(0, from), ...all.slice(to + 1)];
  if (!kept.some((line) => line.trim())) return undefined;
  return { mutated: kept.join('\n'), changedLine: Math.min(from + 1, kept.length) };
}

function replaceOnLine(step: Step, replace: (line: string) => string | undefined): { mutated: string; changedLine: number } | undefined {
  const all = lines(step);
  const { from } = span(step);
  const original = all[from];
  const changed = original === undefined ? undefined : replace(original);
  if (changed === undefined || changed === original) return undefined;
  all[from] = changed;
  return { mutated: all.join('\n'), changedLine: from + 1 };
}

/**
 * One safe mutation of a real excerpt, with "what could go wrong now?" consequences.
 * Only resolved or framework-rule steps are mutated; unknown parts never are.
 */
export function spotBugChallenge(feature: Feature, lessonId: string): SpotBugChallenge | undefined {
  // Shallow steps first: a check in the action itself teaches more than one inside a helper.
  const steps = feature.steps.filter((step) => step.confidence === 'resolved' || step.confidence === 'conventional').sort((a, b) => a.depth - b.depth || feature.steps.indexOf(a) - feature.steps.indexOf(b));
  const writes = feature.effects.some((effect) => effect.kind === 'db-write');
  const action = inSentence(lowerFirst(feature.title));
  const candidates: (() => Mutation | undefined)[] = [
    () => {
      const step = steps.find((item) => item.stage === 'check' && item.concepts.includes('authentication') && /^\s*if\b/.test(lineAt(item.code, item.code.highlightLine) ?? ''));
      const change = step && removeStatement(step);
      return step && change && {
        kind: 'remove-auth-check',
        step,
        ...change,
        correct: `Someone who isn’t signed in could still ${action}.`,
        wrong: ['Signed-in users would be sent to the login page instead.', 'Nothing would change; the check is only there for show.', 'The page would crash before it loads.'],
        explanation: `The real code checks who is signed in on ${where(step)}. Without that check, the server would ${action} for anyone who sends the request.`,
      };
    },
    () => {
      const step = steps.find((item) => item.stage === 'check' && item.concepts.includes('validation') && /^\s*if\b/.test(lineAt(item.code, item.code.highlightLine) ?? ''));
      const change = step && removeStatement(step);
      return step && change && {
        kind: 'remove-validation',
        step,
        ...change,
        correct: writes ? 'Wrong or missing data would no longer be stopped, so it could be saved to the database.' : 'Wrong or missing data would no longer be stopped, and the code would use it as if it were fine.',
        wrong: ['Every form would be rejected, even correct ones.', 'Nothing would change; the check only runs while developing.', 'The user would be signed out.'],
        explanation: `On ${where(step)} the real code stops when the data doesn’t pass the check. Without it, bad data carries on to the next steps.`,
      };
    },
    () => {
      const step = steps.find((item) => (item.stage === 'database' || item.stage === 'request') && item.concepts.includes('async-await') && /\bawait\s/.test(lineAt(item.code, item.code.highlightLine) ?? ''));
      const change = step && replaceOnLine(step, (line) => line.replace(/\bawait\s+/, ''));
      const thing = step?.stage === 'database' ? 'database work' : 'request';
      return step && change && {
        kind: 'remove-await',
        step,
        ...change,
        correct: `The code would move on before the ${thing} is finished, so later steps could use a result that isn’t ready yet.`,
        wrong: [`The ${thing} would happen twice.`, 'Nothing would change; await only makes the code look tidy.', 'The app would refuse to start.'],
        explanation: `On ${where(step)}, \`await\` makes the code wait for “${step.title}” to finish before moving on.`,
      };
    },
    () => {
      const branch = feature.branches.find((item) => /^if \(!?[\w.?$]+\)$/.test(item.condition));
      const step = branch && steps.find((item) => item.id === branch.stepId);
      const change = step && replaceOnLine(step, (line) => line.replace(/if \((!?)([\w.?$]+)\)/, (_match, not: string, name: string) => `if (${not ? '' : '!'}${name})`));
      const yesNext = branch && feature.steps.find((item) => item.id === branch.outcomes[0]?.nextStepId);
      return step && change && yesNext && {
        kind: 'flip-condition',
        step,
        ...change,
        correct: `The code would take the wrong path: it would ${lowerFirst(yesNext.title)} in exactly the cases where it shouldn’t.`,
        wrong: ['Nothing would change; `!` only changes how the code looks.', 'Both paths would run, one after the other.', 'The app would crash straight away.'],
        explanation: `The real condition on ${where(step)} is ${code(branch.condition)}. The \`!\` means “not”, so removing or adding it swaps the two paths.`,
      };
    },
    () => {
      const step = steps.find((item) => item.when && /^\s*return\b/.test(lineAt(item.code, item.code.highlightLine) ?? '') && !item.code.highlightEndLine);
      const change = step && removeStatement(step);
      return step && change && {
        kind: 'remove-early-return',
        step,
        ...change,
        correct: 'The code would keep going after finding a problem, and run steps meant only for the good case.',
        wrong: ['The code would stop even when everything is fine.', 'Nothing would change; return is optional.', 'The function would run twice.'],
        explanation: `On ${where(step)}, \`return\` stops the function early. Without it, the code falls through to the next steps.`,
      };
    },
  ];
  for (const candidate of candidates) {
    const mutation = candidate();
    if (!mutation) continue;
    const seed = `${lessonId}/spot-bug:${mutation.kind}`;
    return {
      kind: 'spot-bug',
      id: seed,
      prompt: 'This is a changed copy of the real code. What could go wrong now?',
      mutation: mutation.kind,
      mutated: mutation.mutated,
      changedLine: mutation.changedLine,
      ...choices(mutation.correct, mutation.wrong.slice(0, 2), seed),
      explanation: mutation.explanation,
      codeRef: mutation.step.code,
      concepts: mutation.step.concepts,
    };
  }
  return undefined;
}
