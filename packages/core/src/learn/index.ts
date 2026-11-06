import {
  LEARNING_SCHEMA_VERSION,
  type Challenge,
  type ConceptId,
  type ConceptUse,
  type Feature,
  type HiddenLesson,
  type LearningArea,
  type LearningPlan,
  type Lesson,
  type RepoAnalysis,
} from '@codedna/shared';
import { code, hash } from '../features/captions.js';
import { AREA_AUTH, AREA_HOME, AREA_SERVER } from '../features/naming.js';
import { fillGapChallenge, stepLine } from './challenges/fill-gap.js';
import { orderChallenge } from './challenges/order.js';
import { predictChallenges } from './challenges/predict.js';
import { spotBugChallenge } from './challenges/spot-bug.js';
import { buildConceptChecks } from './concept-checks.js';
import { CONCEPT_ORDER, CONCEPTS } from './concepts.js';
import { inSentence, known, quoted } from './util.js';

const MAX_LESSON_CONCEPTS = 4;
const MAX_USES_PER_CONCEPT = 12;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const lessonIdFor = (feature: Feature) => `lesson-${hash(feature.key)}`;
const isTyping = (feature: Feature) => /^Type in /.test(feature.title);
const conceptsOf = (feature: Feature): ConceptId[] => {
  const found = new Set(feature.steps.flatMap((step) => step.concepts));
  return CONCEPT_ORDER.filter((id) => found.has(id));
};
const modelOf = (label: string) => /^(?:writes|reads) (.+)$/.exec(label)?.[1];
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Features worth a lesson: not link-only, at least two real steps, and one lesson per shape
 * (two text boxes that only update state teach the same thing).
 */
export function lessonFeatures(features: readonly Feature[]): Feature[] {
  // Lessons follow what people set out to do; typing and closing boxes stay small details,
  // unless they are all the app has.
  const main = pickLessons(features.filter((feature) => feature.importance !== 'detail'));
  return main.length ? main : pickLessons(features);
}

function pickLessons(features: readonly Feature[]): Feature[] {
  const shapes = new Set<string>();
  // Lesson ids come from the feature key; the same button drawn twice in one component shares
  // a key, and two lessons with one id would overwrite each other and confuse progress.
  const ids = new Set<string>();
  return features.filter((feature) => {
    if (feature.entryKind === 'link' || known(feature.steps).length < 2) return false;
    const shape = `${feature.entryKind}|${feature.steps.map((step) => `${step.stage}:${step.confidence === 'gap'}`).join(',')}|${feature.effects.map((effect) => effect.kind).join(',')}`;
    const id = lessonIdFor(feature);
    if (shapes.has(shape) || ids.has(id)) return false;
    shapes.add(shape);
    ids.add(id);
    return true;
  });
}

/** Lines from every feature, as believable wrong answers for other features. */
function buildPools(features: readonly Feature[]) {
  const titles = new Map<string, string[]>();
  const lines = new Map<string, string[]>();
  for (const feature of features) {
    titles.set(feature.id, known(feature.steps).filter((step) => step.depth > 0).map((step) => step.title));
    lines.set(feature.id, feature.steps.flatMap((step) => stepLine(step) ?? []));
  }
  const others = (map: Map<string, string[]>, id: string) => [...map].filter(([key]) => key !== id).flatMap(([, values]) => values);
  return { titlesFor: (id: string) => others(titles, id), linesFor: (id: string) => others(lines, id) };
}

export function buildLesson(feature: Feature, pools: ReturnType<typeof buildPools>): Lesson {
  const id = lessonIdFor(feature);
  const challenges: Challenge[] = [];
  challenges.push(...predictChallenges(feature, id, pools.titlesFor(feature.id)));
  const order = orderChallenge(feature, id);
  if (order) challenges.push(order);
  const bug = spotBugChallenge(feature, id);
  if (bug) challenges.push(bug);
  const gap = fillGapChallenge(feature, id, pools.linesFor(feature.id));
  if (gap) challenges.push(gap);
  return {
    id,
    featureId: feature.id,
    featureKey: feature.key,
    contentHash: feature.contentHash,
    title: feature.title,
    minutes: Math.min(15, Math.max(3, 2 + Math.ceil(feature.steps.length / 4) + challenges.length)),
    difficulty: feature.difficulty,
    story: feature.steps,
    concepts: conceptsOf(feature),
    challenges: challenges.slice(0, 5),
    // Test scenarios arrive with the "Test it" phase.
    testScenarios: [],
  };
}

/** Easy first: difficulty, then how advanced its concepts are, then how much happens. */
export function orderLessons(lessons: readonly Lesson[]): Lesson[] {
  const level = (lesson: Lesson) => Math.max(0, ...lesson.concepts.map((id) => CONCEPTS[id].level));
  return [...lessons].sort((a, b) => a.difficulty - b.difficulty || level(a) - level(b) || a.story.length - b.story.length || compare(a.title, b.title) || compare(a.id, b.id));
}

/** 2–4 concept cards per lesson, preferring concepts the learner hasn't met earlier on the path. */
function chooseCards(path: Lesson[]): void {
  const met = new Set<ConceptId>();
  for (const lesson of path) {
    const fresh = lesson.concepts.filter((id) => !met.has(id));
    const seen = lesson.concepts.filter((id) => met.has(id));
    lesson.concepts = [...fresh, ...seen].slice(0, MAX_LESSON_CONCEPTS).sort((a, b) => CONCEPT_ORDER.indexOf(a) - CONCEPT_ORDER.indexOf(b));
    for (const id of lesson.concepts) met.add(id);
  }
}

/** Gentle "there's a lesson here" notes. Each points at the real line it is about. */
export function findHiddenLessons(analysis: RepoAnalysis): HiddenLesson[] {
  const hidden: HiddenLesson[] = [];
  for (const feature of analysis.features) {
    const write = feature.effects.find((effect) => effect.kind === 'db-write');
    const writeStep = write && feature.steps.find((step) => step.id === write.stepId);
    const onServer = feature.steps.some((step) => step.stage === 'server');
    if (!writeStep || !onServer) continue;
    const model = modelOf(write.label) ?? 'data';
    if (!feature.steps.some((step) => step.concepts.includes('authentication')))
      hidden.push({
        id: `hidden:missing-auth-check:${feature.id}`,
        kind: 'missing-auth-check',
        title: `${quoted(feature.title)} changes data without a sign-in check`,
        plain: `This saves ${code(model)} without checking who is signed in, so anyone who can send the request could do it. There’s a security lesson here.`,
        code: writeStep.code,
        featureId: feature.id,
        conceptId: 'authentication',
      });
    if (!feature.steps.some((step) => step.concepts.includes('validation')))
      hidden.push({
        id: `hidden:missing-validation:${feature.id}`,
        kind: 'missing-validation',
        title: `${quoted(feature.title)} saves data without checking it first`,
        plain: `The data for ${code(model)} goes to the database without a validation step. Anything the browser sends, even something wrong, would be saved.`,
        code: writeStep.code,
        featureId: feature.id,
        conceptId: 'validation',
      });
  }
  for (const feature of analysis.features)
    for (const step of feature.steps)
      if (step.confidence === 'gap' && /\bsetting\b/.test(step.unknownReason ?? ''))
        hidden.push({
          id: `hidden:unknown-part:${step.id}`,
          kind: 'unknown-part',
          title: `Part of ${quoted(feature.title)} depends on a setting`,
          plain: `${step.unknownReason} It’s worth knowing which setting your live app uses.`,
          code: step.code,
          featureId: feature.id,
        });
  for (const duplicate of analysis.duplicates)
    hidden.push({
      id: `hidden:duplicated-logic:${duplicate.places.map((place) => place.path).join('|')}:${duplicate.name}`,
      kind: 'duplicated-logic',
      title: `${duplicate.name} is written ${duplicate.places.length} times`,
      plain: `The same ${code(duplicate.name)} function is in ${duplicate.places.map((place) => code(place.path)).join(' and ')}. If you fix a bug in one copy, the other keeps it. There’s a lesson here about sharing code.`,
      code: duplicate.places[0]!,
    });
  return hidden;
}

function summarize(analysis: RepoAnalysis, features: readonly Feature[]) {
  // "People can …" is about what users do on screens, so API routes and bare server functions are left out.
  const onScreen = (feature: Feature) => feature.entryKind === 'event-handler' || feature.entryKind === 'form-action';
  const actions = [...features].filter((feature) => onScreen(feature) && !isTyping(feature) && feature.importance !== 'detail').sort((a, b) => b.difficulty - a.difficulty || b.steps.length - a.steps.length || compare(a.id, b.id));
  // The app's big parts, and one thing people do in each, so the sentence covers the whole app.
  // Only worth saying when a part holds several areas (Admin: users, branches, logs), not for small apps.
  const areasIn = new Map<string, Set<string>>();
  for (const feature of analysis.features) if (feature.section && !GENERAL_PARTS.has(feature.section)) areasIn.set(feature.section, (areasIn.get(feature.section) ?? new Set()).add(feature.area ?? ''));
  const parts = [...areasIn].some(([, areas]) => areas.size > 1) ? [...areasIn.keys()] : [];
  const picked = parts.length >= 2 ? parts.flatMap((part) => actions.find((feature) => feature.section === part) ?? []).slice(0, 3) : [];
  for (const feature of actions) if (picked.length < 3 && !picked.includes(feature)) picked.push(feature);
  const verbs = [...new Set(picked.map((feature) => inSentence(feature.title)))];
  const list = andList(verbs);
  const name = analysis.name ?? 'This app';
  if (parts.length >= 2 && list)
    return {
      sentence: `${name} is a ${analysis.framework.label} app with ${parts.length} main parts: ${andList(parts)}. People can ${list}.`,
      featureTitles: analysis.features.filter((feature) => feature.entryKind !== 'link').map((feature) => feature.title),
      dataStored: storedModels(analysis),
    };
  return {
    sentence: list ? `${name} is a ${analysis.framework.label} app where people can ${list}.` : `${name} is a ${analysis.framework.label} app.`,
    featureTitles: analysis.features.filter((feature) => feature.entryKind !== 'link').map((feature) => feature.title),
    dataStored: storedModels(analysis),
  };
}

const GENERAL_PARTS = new Set([AREA_AUTH, AREA_SERVER, AREA_HOME, 'Other']);
const andList = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]);
function storedModels(analysis: RepoAnalysis): string[] {
  const stored = new Set<string>();
  for (const feature of analysis.features) for (const effect of feature.effects) if (effect.kind === 'db-write' || effect.kind === 'db-read') stored.add(capital(modelOf(effect.label) ?? ''));
  stored.delete('');
  return [...stored].sort(compare);
}

const AREA_SUMMARY: Record<string, string> = {
  [AREA_AUTH]: 'How people sign in and out, and how the app knows who they are.',
  [AREA_SERVER]: 'Code on the server that runs when something asks for it, not from a button on a page.',
  [AREA_HOME]: 'What people can do on the first page they see.',
};
const areaSummary = (title: string) => AREA_SUMMARY[title] ?? `What people can do in the ${title.toLowerCase()} part of the app.`;

/**
 * Group lessons by app part. Easier parts come first (by average lesson difficulty), and lessons
 * stay easiest first inside each part, so the path finishes one part before starting the next.
 */
export function groupByArea(path: readonly Lesson[], features: readonly Feature[]): { path: Lesson[]; areas: LearningArea[] } {
  const areaOfFeature = new Map(features.map((feature) => [feature.id, feature.area ?? 'Other']));
  const order: string[] = [];
  const lessonsByArea = new Map<string, Lesson[]>();
  for (const lesson of path) {
    const area = areaOfFeature.get(lesson.featureId) ?? 'Other';
    if (!lessonsByArea.has(area)) {
      order.push(area);
      lessonsByArea.set(area, []);
    }
    lessonsByArea.get(area)!.push(lesson);
  }
  // Easier parts first: by average difficulty, then by where their easiest lesson was.
  const average = (area: string) => {
    const lessons = lessonsByArea.get(area)!;
    return lessons.reduce((sum, lesson) => sum + lesson.difficulty, 0) / lessons.length;
  };
  order.sort((a, b) => average(a) - average(b) || 0);
  // Parts with flows but no lesson (only links, or one-step features) still appear on the map.
  for (const feature of features) {
    const area = feature.area ?? 'Other';
    if (!order.includes(area)) order.push(area);
  }
  // Keep each big part together ("Admin", then "Bank customer"), in the order its first area came.
  const sectionOfArea = new Map<string, string>();
  for (const feature of features) if (!sectionOfArea.has(feature.area ?? 'Other')) sectionOfArea.set(feature.area ?? 'Other', feature.section ?? feature.area ?? 'Other');
  const sectionOrder = [...new Set(order.map((area) => sectionOfArea.get(area) ?? area))];
  order.sort((a, b) => sectionOrder.indexOf(sectionOfArea.get(a) ?? a) - sectionOrder.indexOf(sectionOfArea.get(b) ?? b));
  const areas = order.map((title) => ({
    title,
    section: sectionOfArea.get(title) ?? title,
    summary: areaSummary(title),
    lessonIds: (lessonsByArea.get(title) ?? []).map((lesson) => lesson.id),
    featureIds: features.filter((feature) => (feature.area ?? 'Other') === title).map((feature) => feature.id),
  }));
  return { path: order.flatMap((title) => lessonsByArea.get(title) ?? []), areas };
}

/** Analysis in, learning plan out. Deterministic: the same commit gives the same lessons. */
export function buildLearningPlan(analysis: RepoAnalysis): LearningPlan {
  const features = lessonFeatures(analysis.features);
  const pools = buildPools(features);
  const grouped = groupByArea(orderLessons(features.map((feature) => buildLesson(feature, pools))), analysis.features);
  const path = grouped.path;
  chooseCards(path);
  const used = new Set(path.flatMap((lesson) => lesson.concepts));
  const conceptUses: ConceptUse[] = [];
  const counts = new Map<ConceptId, number>();
  for (const feature of analysis.features)
    for (const step of feature.steps)
      for (const conceptId of step.concepts) {
        const count = counts.get(conceptId) ?? 0;
        if (count >= MAX_USES_PER_CONCEPT) continue;
        counts.set(conceptId, count + 1);
        conceptUses.push({ conceptId, code: step.code, featureId: feature.id, stepId: step.id });
      }
  for (const use of conceptUses) used.add(use.conceptId);
  const conceptIds = CONCEPT_ORDER.filter((id) => used.has(id));
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    snapshotId: analysis.snapshotId,
    ...(analysis.revision ? { revision: analysis.revision } : {}),
    summary: summarize(analysis, features),
    path: path.map((lesson) => lesson.id),
    areas: grouped.areas,
    lessons: Object.fromEntries(path.map((lesson) => [lesson.id, lesson])),
    concepts: Object.fromEntries(conceptIds.map((id) => [id, CONCEPTS[id]])),
    conceptUses,
    conceptChecks: buildConceptChecks(conceptIds, conceptUses, analysis.features),
    hiddenLessons: findHiddenLessons(analysis),
  };
}
