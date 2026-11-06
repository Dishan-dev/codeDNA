import { describe, expect, it } from 'vitest';
import type { Challenge, ChallengeKind, ConceptId, Feature, Lesson, RepoAnalysis } from '@codedna/shared';
import { loadFixture } from '../../fixtures/load.js';
import { analyzeRepository } from '../analyze.js';
import { CONCEPT_ORDER, CONCEPTS } from './concepts.js';
import { buildLearningPlan, lessonFeatures } from './index.js';
import { happyPath, shuffle } from './util.js';

const analysis = analyzeRepository(loadFixture('shop-app'));
const plan = buildLearningPlan(analysis);
const lesson = (title: string): Lesson => {
  const found = Object.values(plan.lessons).find((item) => item.title === title);
  if (!found) throw new Error(`No lesson "${title}"`);
  return found;
};
const challenge = <K extends ChallengeKind>(item: Lesson, kind: K) => item.challenges.find((entry): entry is Extract<Challenge, { kind: K }> => entry.kind === kind);
const feature = (title: string): Feature => analysis.features.find((item) => item.title === title)!;
const stepConcepts = (title: string) => Object.fromEntries(feature(title).steps.map((step) => [step.title, step.concepts]));

describe('concept catalog', () => {
  it('has a beginner explainer for each of the twelve MVP concepts', () => {
    expect(CONCEPT_ORDER).toHaveLength(12);
    for (const id of CONCEPT_ORDER) {
      const concept = CONCEPTS[id];
      expect(concept.id).toBe(id);
      const sentences = concept.explainer.split(/(?<=[.!?])\s+/).length;
      expect(sentences, id).toBeGreaterThanOrEqual(3);
      expect(sentences, id).toBeLessThanOrEqual(5);
      for (const prerequisite of concept.prerequisites) expect(CONCEPT_ORDER.indexOf(prerequisite), `${id} needs ${prerequisite} first`).toBeLessThan(CONCEPT_ORDER.indexOf(id));
    }
  });
});

describe('concept detection', () => {
  it('tags each step of "Place order" with the ideas it uses', () => {
    expect(stepConcepts('Place order')).toMatchObject({
      'You press “Place order”': ['component', 'event-handler'],
      'Sends the data to the server': ['server-action'],
      'Runs getSession': ['authentication', 'async-await'],
      'Reads the session cookie': ['authentication'],
      'Checks !session': ['authentication'],
      'Sends you to /login': ['navigation'],
      'Checks the data with OrderSchema': ['validation'],
      'Checks !parsed.success': ['validation'],
      // The error it returns is shown with {state?.error && <p>…}.
      'Sends back an answer': ['conditional-rendering'],
      'Saves a new order': ['database', 'async-await'],
      'Refreshes /orders': [],
      'Picks a function while the app runs': [],
    });
  });

  it('finds props, state and API calls', () => {
    expect(stepConcepts('Save to favorites')['You click “Save to favorites”']).toEqual(['component', 'event-handler', 'props']);
    expect(stepConcepts('Apply coupon')).toMatchObject({ 'Sends a POST request to /api/coupons': ['api-call', 'async-await'], 'Updates discount on the screen': ['state'] });
    expect(stepConcepts('Type in “Search snacks”')['Updates query on the screen']).toEqual(['state']);
  });
});

describe('lessons', () => {
  it('makes one lesson per meaningful feature: no link-only or look-alike lessons', () => {
    expect(lessonFeatures(analysis.features).map((item) => item.title)).toEqual(['Export orders', 'Save to favorites', 'Place order', 'Apply coupon']);
    // The same button drawn twice shares a key, so it must not become two lessons with one id.
    const order = analysis.features.find((item) => item.title === 'Place order')!;
    const twin = { ...order, id: 'twin', steps: order.steps.slice(0, 3) };
    expect(lessonFeatures([...analysis.features, twin]).map((item) => item.title)).toEqual(['Export orders', 'Save to favorites', 'Place order', 'Apply coupon']);
  });

  it('groups the learning path by app part, easier parts first and easiest first inside each', () => {
    expect(plan.areas!.map((area) => [area.title, area.lessonIds.map((id) => plan.lessons[id]!.title)])).toEqual([
      ['Orders', ['Export orders']],
      ['Home page', ['Save to favorites']],
      ['Checkout', ['Apply coupon', 'Place order']],
    ]);
    expect(plan.path).toEqual(plan.areas!.flatMap((area) => area.lessonIds));
    for (const area of plan.areas!) {
      const difficulties = area.lessonIds.map((id) => plan.lessons[id]!.difficulty);
      expect([...difficulties].sort()).toEqual(difficulties);
    }
    // Every feature is in exactly one part, links included, for the app map.
    expect(plan.areas!.flatMap((area) => area.featureIds).sort()).toEqual(analysis.features.map((feature) => feature.id).sort());
  });

  it('gives each lesson 2–4 concept cards, new ones first', () => {
    expect(lesson('Save to favorites').concepts.length).toBeGreaterThanOrEqual(2);
    expect(lesson('Place order').concepts).toEqual(['conditional-rendering', 'validation', 'authentication', 'navigation']);
    for (const item of Object.values(plan.lessons)) expect(item.concepts.length).toBeLessThanOrEqual(4);
  });

  it('builds 3–5 challenges for features with enough to practise', () => {
    expect(lesson('Place order').challenges.map((item) => item.kind)).toEqual(['predict', 'predict', 'order', 'spot-bug', 'fill-gap']);
    expect(lesson('Apply coupon').challenges.map((item) => item.kind)).toEqual(['predict', 'order', 'spot-bug', 'fill-gap']);
    expect(lesson('Save to favorites').challenges.map((item) => item.kind)).toEqual(['predict', 'order', 'spot-bug', 'fill-gap']);
  });

  it('never uses an unknown part as an answer or an ordering step', () => {
    for (const item of Object.values(plan.lessons)) {
      const gaps = new Set(item.story.filter((step) => step.confidence === 'gap').map((step) => step.title));
      for (const entry of item.challenges) {
        if (entry.kind === 'order') expect(entry.correct.every((id) => item.story.find((step) => step.id === id)?.confidence !== 'gap')).toBe(true);
        if (entry.kind === 'predict') expect(gaps.has(entry.options.find((option) => option.id === entry.answerId)!.label)).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    expect(buildLearningPlan(analyzeRepository(loadFixture('shop-app')))).toEqual(plan);
  });
});

describe('challenge generators', () => {
  it('Predict asks about the path that leaves the usual flow, with real outcomes as options', () => {
    const predict = lesson('Place order').challenges.filter((item) => item.kind === 'predict')[1]!;
    expect(predict.prompt).toBe('In “Place order”, the code asks `!session`. If the answer is “Yes”, what happens next?');
    expect(predict.options.find((option) => option.id === predict.answerId)?.label).toBe('Sends you to /login');
    // The other real answer of the same branch is always offered as a choice.
    expect(predict.options.map((option) => option.label)).toContain('Checks the data with OrderSchema');
    expect(predict.explanation).toContain('line 11 of `app/actions/orders.ts`');
  });

  it('Predict falls back to "what happens next?" for a feature without branches', () => {
    const predict = challenge(lesson('Save to favorites'), 'predict')!;
    expect(predict.prompt).toBe('In “Save to favorites”, after “You click “Save to favorites””, what happens next?');
    expect(predict.options.find((option) => option.id === predict.answerId)?.label).toBe('Sends the data to the server');
  });

  it('Order the steps uses the main journey and a real shuffle', () => {
    const order = challenge(lesson('Place order'), 'order')!;
    const title = (id: string) => lesson('Place order').story.find((step) => step.id === id)?.title;
    expect(order.correct.map(title)).toEqual(['You press “Place order”', 'Sends the data to the server', 'The server runs placeOrder', 'Saves a new order', 'Sends you to /orders/${…}']);
    expect(order.stepsShuffled).not.toEqual(order.correct);
    expect([...order.stepsShuffled].sort()).toEqual([...order.correct].sort());
  });

  it('Spot the bug removes the sign-in check from a copy and asks for the consequence', () => {
    const bug = challenge(lesson('Place order'), 'spot-bug')!;
    expect(bug.mutation).toBe('remove-auth-check');
    expect(bug.codeRef.excerpt).toContain("if (!session) redirect('/login');");
    expect(bug.mutated).not.toContain("if (!session) redirect('/login');");
    expect(bug.mutated).toContain('const session = await getSession();');
    expect(bug.options.find((option) => option.id === bug.answerId)?.label).toBe('Someone who isn’t signed in could still place order.');
    expect(bug.options).toHaveLength(3);
  });

  it('Spot the bug removes an await when there is no check to remove', () => {
    const bug = challenge(lesson('Save to favorites'), 'spot-bug')!;
    expect(bug.mutation).toBe('remove-await');
    expect(bug.codeRef.excerpt).toContain('await prisma.favorite.create');
    expect(bug.mutated.split('\n')[bug.changedLine - 1]?.trim()).toBe('prisma.favorite.create({ data: { productId } });');
  });

  it('Fill the gap hides the validation line and offers other real lines', () => {
    const gap = challenge(lesson('Place order'), 'fill-gap')!;
    expect(gap.hiddenLine).toBe(13);
    expect(gap.options.find((option) => option.id === gap.answerId)?.label).toBe('const parsed = OrderSchema.safeParse(Object.fromEntries(formData));');
    expect(gap.hint).toBe('This line checks the data with OrderSchema.');
    const lines = new Set(analysis.features.flatMap((item) => item.steps.flatMap((step) => step.code.excerpt?.split('\n').map((line) => line.trim()) ?? [])));
    for (const option of gap.options) expect(lines.has(option.label), option.label).toBe(true);
  });

  it('every challenge explains itself and points at real code', () => {
    for (const item of Object.values(plan.lessons))
      for (const entry of item.challenges) {
        expect(entry.explanation.length, entry.id).toBeGreaterThan(20);
        expect(entry.codeRef.excerpt, entry.id).toBeTruthy();
        if ('options' in entry) expect(entry.options.some((option) => option.id === entry.answerId)).toBe(true);
      }
  });
});

describe('app summary and hidden lessons', () => {
  it('describes the app in one sentence and lists the data it stores', () => {
    expect(plan.summary).toEqual({
      sentence: 'Snackshop is a Next.js (App Router) app where people can place order, apply coupon and save to favorites.',
      featureTitles: ['Export orders', 'Save to favorites', 'Place order', 'Type in “Coupon code”', 'Apply coupon', 'Type in “Search snacks”'],
      dataStored: ['Coupon', 'Favorite', 'Order', 'Session'],
    });
  });

  it('finds the lessons hidden in the app', () => {
    expect(plan.hiddenLessons.map((item) => [item.kind, item.title])).toEqual([
      ['missing-auth-check', '“Save to favorites” changes data without a sign-in check'],
      ['missing-validation', '“Save to favorites” saves data without checking it first'],
      ['unknown-part', 'Part of “Place order” depends on a setting'],
      ['duplicated-logic', 'formatPrice is written 2 times'],
    ]);
    const duplicate = plan.hiddenLessons.find((item) => item.kind === 'duplicated-logic')!;
    expect(duplicate.plain).toContain('`components/cart-summary.tsx` and `lib/format.ts`');
  });

  it('links concepts to the real lines that use them', () => {
    const uses = plan.conceptUses.filter((use) => use.conceptId === 'validation');
    expect(uses.map((use) => `${use.code.path}:${use.code.highlightLine}`)).toEqual(['app/actions/orders.ts:13', 'app/actions/orders.ts:14']);
    expect(Object.keys(plan.concepts)).toEqual(CONCEPT_ORDER.filter((id): id is ConceptId => plan.conceptUses.some((use) => use.conceptId === id)));
  });
});

describe('concept card checks', () => {
  it('has one mini check for every concept in the plan', () => {
    expect(Object.keys(plan.conceptChecks).sort()).toEqual(Object.keys(plan.concepts).sort());
  });

  it('asks "which line?" only when the right line shows the concept and no wrong line does', () => {
    const validation = plan.conceptChecks.validation!;
    expect(validation.prompt).toBe('Which of these lines from your app is an example of “Validation”?');
    expect(validation.options.find((option) => option.id === validation.answerId)?.label).toBe('const parsed = OrderSchema.safeParse(Object.fromEntries(formData));');
    for (const option of validation.options) if (option.id !== validation.answerId) expect(option.label).not.toMatch(/parse\(/i);
    const awaitCheck = plan.conceptChecks['async-await']!;
    for (const option of awaitCheck.options) expect(/\bawait\b/.test(option.label)).toBe(option.id === awaitCheck.answerId);
  });

  it('asks "which sentence?" for ideas a single line can’t show', () => {
    for (const id of ['component', 'props', 'conditional-rendering', 'server-action', 'authentication'] as const) {
      const check = plan.conceptChecks[id]!;
      expect(check.prompt, id).toBe(`Which sentence describes “${CONCEPTS[id].name}”?`);
      expect(check.options.find((option) => option.id === check.answerId)?.label).toBe(CONCEPTS[id].oneLiner);
    }
  });
});

describe('helpers', () => {
  it('shuffles deterministically', () => {
    expect(shuffle([1, 2, 3, 4, 5], 'seed')).toEqual(shuffle([1, 2, 3, 4, 5], 'seed'));
    expect(shuffle([1, 2, 3, 4, 5], 'seed')).not.toEqual(shuffle([1, 2, 3, 4, 5], 'other'));
  });

  it('follows the answer that leads to more steps as the usual path', () => {
    const titles = happyPath(feature('Place order')).map((step) => step.title);
    expect(titles).toContain('Saves a new order');
    expect(titles).not.toContain('Sends you to /login');
    expect(titles).not.toContain('Sends back an answer');
  });

  it('builds a plan for an app with no features', () => {
    const empty: RepoAnalysis = { ...analysis, name: 'Empty', features: [], duplicates: [] };
    const result = buildLearningPlan(empty);
    expect(result.path).toEqual([]);
    expect(result.summary.sentence).toBe('Empty is a Next.js (App Router) app.');
  });
});
