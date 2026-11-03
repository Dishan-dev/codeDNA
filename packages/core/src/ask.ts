import type {
  Answer,
  AnswerAction,
  Behavior,
  BehaviorDiscovery,
  BehaviorStory,
  EvidenceItem,
  FeatureDiscovery,
  RepositorySnapshot,
  RepositoryUnderstanding,
} from '@codedna/shared';
import { makeEvidence, retrieveEvidence, tokenize } from './evidence.js';

export interface AskContext {
  snapshot: RepositorySnapshot;
  discovery: FeatureDiscovery;
  understanding: RepositoryUnderstanding;
  behaviors: BehaviorDiscovery;
  story: (behavior: Behavior) => BehaviorStory;
  selected?: { behaviorId?: string; stepId?: string };
}
const OVERVIEW = /\b(what (does|is) (this|the) (app|application|repo|repository|project|library|code)|what is this|purpose of (this|the))\b/i;
const FOLLOW = /\b(after|next|why|this step|this function|this part|here)\b/i;
const MAX_QUESTION = 500;

function score(behavior: Behavior, tokens: string[]): number {
  const text = [behavior.title, behavior.summary, behavior.entryPoint.route ?? '', behavior.entryPoint.path, behavior.entryPoint.symbolId?.split(':').pop() ?? '', ...behavior.suggestedQuestions].join(' ');
  const words = new Set(tokenize(text));
  return tokens.reduce((n, token) => n + (words.has(token) ? 1 : 0), 0);
}
const sourceAction = (path: string, line: number, label = 'Show the source'): AnswerAction => ({ kind: 'source', label, path, line });

/**
 * Deterministic answers composed from behaviors, stories and retrieved evidence. This never claims
 * open-ended intelligence: unmatched questions say so and offer supported behaviors instead.
 */
export function answerQuestion(rawQuestion: string, ctx: AskContext): Answer {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION);
  const base = { schemaVersion: '1.0' as const, question, origin: 'deterministic' as const };
  const toIds = (items: EvidenceItem[]) => items.map((item) => item.id);
  const explore = (b: Behavior): AnswerAction => ({ kind: 'story', label: `Explore: ${b.title}`, behaviorId: b.id });

  if (OVERVIEW.test(question)) {
    const intro = ctx.understanding.introduction;
    const evidence = intro.evidence.flatMap((e) => (e.location ? [makeEvidence(ctx.snapshot, 'documentation', e.description, e.location)] : [])).filter((e): e is EvidenceItem => !!e);
    const top = ctx.behaviors.behaviors.slice(0, 3);
    return {
      ...base, text: intro.text, certainty: intro.certainty === 'verified' ? 'verified' : intro.certainty === 'documented' ? 'documented' : 'inferred',
      details: top.length ? `Behaviors CodeDNA can walk through: ${top.map((b) => b.title).join('; ')}.` : undefined,
      evidenceIds: toIds(evidence), evidence,
      actions: top.map(explore),
      notes: intro.certainty === 'documented' ? ['This description comes from documentation and may not match the code.'] : ['No documentation described the purpose; this is summarized from source structure.'],
    } as Answer;
  }

  const question_tokens = tokenize(question);
  const ranked = ctx.behaviors.behaviors.map((behavior) => ({ behavior, score: score(behavior, question_tokens) })).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.behavior.id < b.behavior.id ? -1 : 1));
  const selected = ctx.selected?.behaviorId ? ctx.behaviors.behaviors.find((b) => b.id === ctx.selected?.behaviorId) : undefined;
  const useSelected = !!selected && (FOLLOW.test(question) || ranked.length === 0);
  const behavior = useSelected ? selected : ranked[0]?.behavior;

  if (!behavior) {
    const symbol = ctx.discovery.symbols.find((item) => question_tokens.length && tokenize(item.name).some((word) => question_tokens.includes(word)) && question.toLowerCase().includes(item.name.toLowerCase()));
    if (symbol) {
      const evidence = retrieveEvidence({ snapshot: ctx.snapshot, discovery: ctx.discovery, question }, { maxItems: 4, maxExcerptLines: 10, maxLineLength: 160, maxTotalChars: 2400 }).items;
      return { ...base, text: `${symbol.name} is a ${symbol.kind} declared in ${symbol.file} at line ${symbol.location.start.line}.`, certainty: 'verified', evidenceIds: toIds(evidence), evidence,
        actions: [sourceAction(symbol.file, symbol.location.start.line)], notes: ['Only the declaration is known. No supported behavior story starts from it.'] };
    }
    const suggestions = ctx.behaviors.behaviors.slice(0, 3);
    return {
      ...base, text: 'CodeDNA did not find a supported behavior that matches this question.', certainty: 'unresolved', evidenceIds: [], evidence: [],
      actions: suggestions.map(explore),
      notes: ['Answers without an AI provider are limited to detected behaviors and symbols.', ...ctx.behaviors.limitations.slice(0, 1)],
    };
  }

  const story = ctx.story(behavior);
  const stepId = useSelected ? ctx.selected?.stepId : undefined;
  const step = stepId ? story.steps.find((item) => item.id === stepId) : undefined;
  const bundle = retrieveEvidence({ snapshot: ctx.snapshot, discovery: ctx.discovery, behavior, story, ...(step ? { stepId: step.id } : {}), question }, { maxItems: 4, maxExcerptLines: 10, maxLineLength: 160, maxTotalChars: 2400 });
  const actions: AnswerAction[] = [explore(behavior)];
  const notes: string[] = [];
  let text: string, details: string | undefined;
  if (step && /\b(why)\b/i.test(question)) {
    text = `${step.narrative} ${step.why}`;
    actions.push({ kind: 'story', label: 'Return to this step', behaviorId: behavior.id, stepId: step.id });
  } else if (step && /\b(after|next)\b/i.test(question)) {
    const following = step.next.map((next) => story.steps.find((item) => item.id === next.stepId)).filter((item) => !!item);
    text = following.length ? `After this step, analysis found: ${following.map((item) => item!.title).join('; ')}.` : 'Analysis found nothing that follows this step.';
    following.slice(0, 2).forEach((item) => actions.push({ kind: 'story', label: `Go to: ${item!.title}`, behaviorId: behavior.id, stepId: item!.id }));
  } else {
    const first = story.steps.slice(0, 3);
    text = `${behavior.title}. ${behavior.summary}`;
    details = first.length > 1 ? first.map((item, i) => `${i + 1}. ${item.title}`).join('\n') : undefined;
  }
  if (behavior.unresolvedRelationships > 0) {
    const unresolved = story.steps.find((item) => item.role === 'unresolved');
    notes.push(`${behavior.unresolvedRelationships} relationship${behavior.unresolvedRelationships === 1 ? '' : 's'} could not be resolved, so this explanation is incomplete.`);
    actions.push({ kind: 'unresolved', label: 'Investigate what is unresolved', behaviorId: behavior.id, ...(unresolved ? { stepId: unresolved.id } : {}) });
  }
  actions.push(sourceAction(behavior.entryPoint.path, behavior.entryPoint.line), { kind: 'architecture', label: 'View related architecture', path: behavior.entryPoint.path });
  notes.push('Based on static analysis; it does not prove what happens at runtime.');
  return {
    ...base, text, ...(details ? { details } : {}), certainty: step?.certainty ?? behavior.certainty,
    evidenceIds: toIds(bundle.items), evidence: bundle.items, actions, notes,
  };
}
