import { describe, expect, it } from 'vitest';
import { analyzeRepository, buildLearningPlan } from '@codedna/core';
import type { LearnerEvent, Progress } from '@codedna/shared';
import { loadFixture } from '../../core/fixtures/load.js';
import { applyEvent, continueTarget, dayString, emptyProgress, pathStates, reconcile, touchStreak, XP } from './progress.js';
import { branchAt, conditionText, defaultChoices, outcomesOf, placesOf, placeText, visibleSteps, zonesOf } from './story.js';

const analysis = analyzeRepository(loadFixture('shop-app'));
const plan = buildLearningPlan(analysis);
const order = analysis.features.find((feature) => feature.title === 'Place order')!;
const lessonId = plan.path.find((id) => plan.lessons[id]!.title === 'Place order')!;
const lesson = plan.lessons[lessonId]!;
const day = '2026-11-03';

describe('story paths', () => {
  it('plays the usual path by default: signed in, valid data, order saved', () => {
    const titles = visibleSteps(order, defaultChoices(order)).map((step) => step.title);
    expect(titles).toContain('Saves a new order');
    expect(titles).not.toContain('Sends you to /login');
    expect(titles.at(-1)).toBe('Sends you to /orders/${…}');
  });

  it('follows the learner’s choice at a branch', () => {
    const branch = order.branches.find((item) => item.condition === 'if (!session)')!;
    const yes = branch.outcomes.find((outcome) => outcome.label === 'Yes')!;
    const titles = visibleSteps(order, { ...defaultChoices(order), [branch.id]: yes.id }).map((step) => step.title);
    expect(titles.at(-1)).toBe('Sends you to /login');
    expect(titles).not.toContain('Saves a new order');
  });

  it('describes a branch for the "which way?" buttons', () => {
    const decision = order.steps.find((step) => step.title === 'Checks !session')!;
    const branch = branchAt(order, decision.id)!;
    expect(conditionText(branch)).toBe('!session');
    expect(outcomesOf(order, branch).map(({ outcome, next }) => `${outcome.label} → ${next?.title}`)).toEqual(['Yes → Sends you to /login', 'No → Checks the data with OrderSchema']);
  });
});

describe('progress', () => {
  const step = (stage: 'watch' | 'understand' | 'try' | 'test' | 'recap'): LearnerEvent => ({ type: 'lesson.step.completed', lessonId, featureKey: lesson.featureKey, contentHash: lesson.contentHash, stage });
  const run = (events: LearnerEvent[], start: Progress = emptyProgress('snackshop'), today = day) => events.reduce((progress, event) => applyEvent(progress, event, today), start);

  it('saves where the learner is in a lesson and completes it after Try', () => {
    const watched = run([step('watch')]);
    expect(watched.lessons[lessonId]).toMatchObject({ stage: 'understand', completed: false });
    expect(watched.xp).toBe(XP.stage);
    const done = run([step('watch'), step('understand'), step('try')]);
    expect(done.lessons[lessonId]).toMatchObject({ stage: 'test', completed: true });
    expect(done.xp).toBe(3 * XP.stage + XP.lessonComplete);
    expect(run([step('watch'), step('watch')]).xp).toBe(XP.stage);
  });

  it('raises concepts from seen to practised to mastered, never down', () => {
    const answer = (challengeId: string, featureKey: string, correct: boolean): LearnerEvent => ({ type: 'challenge.answered', lessonId, featureKey, challengeId, concepts: ['validation'], correct });
    const seen = run([{ type: 'concept.viewed', conceptId: 'validation' }]);
    expect(seen.concepts.validation).toBe('seen');
    const practised = run([answer('a', 'feature-1', false)], seen);
    expect(practised.concepts.validation).toBe('practised');
    expect(run([{ type: 'concept.viewed', conceptId: 'validation' }], practised).concepts.validation).toBe('practised');
    // Two correct answers in one feature are not enough; it takes two features.
    const oneFeature = run([answer('b', 'feature-1', true), answer('c', 'feature-1', true)], practised);
    expect(oneFeature.concepts.validation).toBe('practised');
    expect(run([answer('d', 'feature-2', true)], oneFeature).concepts.validation).toBe('mastered');
  });

  it('counts only the first answer to a challenge', () => {
    const answer: LearnerEvent = { type: 'challenge.answered', lessonId, featureKey: lesson.featureKey, challengeId: 'x', concepts: [], correct: true };
    const progress = run([answer, answer]);
    expect(progress.xp).toBe(XP.correct);
    expect(progress.lessons[lessonId]!.score).toBe(1);
  });

  it('masters a concept when a passing test covers it', () => {
    expect(run([{ type: 'test.passed', lessonId, scenarioId: 's', concepts: ['authentication'] }]).concepts.authentication).toBe('mastered');
  });

  it('keeps a daily streak', () => {
    const first = touchStreak(emptyProgress('x'), '2026-11-01');
    expect(first.streakDays).toBe(1);
    expect(touchStreak(first, '2026-11-01').streakDays).toBe(1);
    expect(touchStreak(first, '2026-11-02').streakDays).toBe(2);
    expect(touchStreak(touchStreak(first, '2026-11-02'), '2026-11-05').streakDays).toBe(1);
    // Month boundaries count as consecutive days.
    expect(touchStreak(touchStreak(emptyProgress('x'), '2026-10-31'), '2026-11-01').streakDays).toBe(2);
    expect(dayString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('shows the path as done / next / locked and where to continue', () => {
    expect(pathStates(plan, emptyProgress('x')).map((item) => item.state)).toEqual(['next', 'locked', 'locked', 'locked']);
    expect(continueTarget(plan, emptyProgress('x'))).toMatchObject({ lessonId: plan.path[0], stage: 'watch', stepNumber: 1, started: false });
    const first = plan.lessons[plan.path[0]!]!;
    const events: LearnerEvent[] = (['watch', 'understand', 'try'] as const).map((stage) => ({ type: 'lesson.step.completed', lessonId: first.id, featureKey: first.featureKey, contentHash: first.contentHash, stage }));
    const progress = run([...events, { type: 'lesson.step.completed', lessonId: plan.path[1]!, featureKey: 'k', contentHash: 'h', stage: 'watch' }]);
    expect(pathStates(plan, progress).map((item) => item.state)).toEqual(['done', 'next', 'locked', 'locked']);
    expect(continueTarget(plan, progress)).toMatchObject({ lessonId: plan.path[1], stage: 'understand', stepNumber: 2, started: true });
  });

  it('marks lessons "Updated" when their feature changed, and keeps the progress', () => {
    const progress = run([step('watch')]);
    expect(reconcile(progress, plan)).toBe(progress);
    const changed = { ...plan, lessons: { ...plan.lessons, [lessonId]: { ...lesson, contentHash: 'different' } } };
    const updated = reconcile(progress, changed);
    expect(updated.lessons[lessonId]).toMatchObject({ updated: true, stage: 'understand' });
    expect(pathStates(changed, updated).find((item) => item.lessonId === lessonId)?.updated).toBe(true);
    // Finishing a stage again clears the flag.
    expect(applyEvent(updated, { ...step('understand'), contentHash: 'different' }, day).lessons[lessonId]!.updated).toBeUndefined();
  });
});

describe('journey map places', () => {
  const coupon = analysis.features.find((feature) => feature.title === 'Apply coupon')!;
  const steps = visibleSteps(coupon, defaultChoices(coupon));
  const places = placesOf(steps);

  it('starts in the browser, travels to the server, and comes back', () => {
    expect(places[0]).toEqual({ zone: 'browser' });
    const request = steps.findIndex((step) => step.stage === 'request');
    expect(places[request]).toEqual({ from: 'browser', to: 'server' });
    expect(placeText(places[request]!)).toBe('On the way to the server');
    expect(places[places.length - 1]).toEqual({ zone: 'browser' });
  });

  it('puts database steps in the database and checks where the story is', () => {
    steps.forEach((step, index) => {
      if (step.stage === 'database') expect(places[index]).toEqual({ zone: 'database' });
      if (step.stage === 'check') expect(places[index]).toEqual({ zone: 'server' });
    });
    expect(zonesOf(places)).toEqual(['browser', 'server', 'database']);
  });

  it('keeps a check in the browser when it runs before any request', () => {
    const stub = (stage: (typeof steps)[number]['stage']) => ({ ...steps[0]!, stage });
    expect(placesOf([stub('click'), stub('check'), stub('request'), stub('check')])).toEqual([{ zone: 'browser' }, { zone: 'browser' }, { from: 'browser', to: 'server' }, { zone: 'server' }]);
  });
});

describe('diagrams', () => {
  const coupon = analysis.features.find((feature) => feature.title === 'Apply coupon')!;

  it('turns a playthrough into a sequence: you → browser → server → database and back', async () => {
    const { sequenceRows } = await import('./diagrams/layout.js');
    const steps = visibleSteps(coupon, defaultChoices(coupon));
    const { lanes, rows } = sequenceRows(steps, placesOf(steps), true);
    expect(lanes).toEqual(['person', 'browser', 'server', 'database']);
    const arrows = rows.filter((row) => row.kind === 'arrow').map((row) => (row.kind === 'arrow' ? `${row.from}>${row.to}${row.back ? ' (back)' : ''}` : ''));
    expect(arrows).toEqual(['person>browser', 'browser>server', 'server>database', 'server>browser (back)']);
    expect(rows).toHaveLength(steps.length);
  });

  it('starts a route with a caller instead of a person', async () => {
    const { sequenceRows } = await import('./diagrams/layout.js');
    const stub = { ...coupon.steps[0]!, stage: 'server' as const };
    const { lanes, rows } = sequenceRows([stub], [{ zone: 'server' }], false);
    expect(lanes).toEqual(['person', 'server']);
    expect(rows[0]).toMatchObject({ kind: 'arrow', from: 'person', to: 'server' });
  });

  it('lays out every step as a flowchart, with each fork splitting into its answers', async () => {
    const { flowLayout, choicesFor } = await import('./diagrams/layout.js');
    const layout = flowLayout(order);
    expect(layout.nodes).toHaveLength(order.steps.length);
    for (const branch of order.branches) {
      const out = layout.edges.filter((edge) => edge.from === branch.stepId && edge.label);
      expect(out.map((edge) => edge.label).sort()).toEqual(branch.outcomes.filter((outcome) => outcome.nextStepId).map((outcome) => outcome.label).sort());
    }
    // The usual path is the left column; a step off it sits to the right.
    const usual = new Set(visibleSteps(order, defaultChoices(order)).map((step) => step.id));
    for (const node of layout.nodes) if (usual.has(node.step.id)) expect(node.col).toBe(0);
    const off = layout.nodes.find((node) => !usual.has(node.step.id))!;
    expect(off.col).toBeGreaterThan(0);
    // Jumping to it picks the answers that lead there.
    expect(visibleSteps(order, choicesFor(off.step, defaultChoices(order))).map((step) => step.id)).toContain(off.step.id);
    // Every edge joins two real steps.
    const ids = new Set(order.steps.map((step) => step.id));
    for (const edge of layout.edges) expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
  });
});
