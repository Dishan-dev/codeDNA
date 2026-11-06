import { LESSON_STAGES, type ConceptId, type ConceptMastery, type LearnerEvent, type LearningPlan, type LessonProgress, type LessonStage, type Progress } from '@codedna/shared';

/** XP rewards. Small, steady numbers: progress should feel earned, not inflated. */
export const XP = { stage: 10, correct: 20, lessonComplete: 50, testWritten: 10, testPassed: 30 } as const;
const MASTERY: readonly ConceptMastery[] = ['new', 'seen', 'practised', 'mastered'];

export function emptyProgress(repoKey: string): Progress {
  return { repoKey, xp: 0, streakDays: 0, concepts: {}, conceptEvidence: {}, lessons: {} };
}

/** Local calendar day as YYYY-MM-DD. */
export function dayString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const dayBefore = (day: string) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return dayString(new Date(year, month - 1, date - 1));
};

/** Same day keeps the streak, the next day grows it, a gap starts again at one. */
export function touchStreak(progress: Progress, today: string): Progress {
  if (progress.lastActiveDay === today) return progress;
  const streakDays = progress.lastActiveDay === dayBefore(today) ? progress.streakDays + 1 : 1;
  return { ...progress, streakDays, lastActiveDay: today };
}

/** Mastery never goes down. */
const raise = (current: ConceptMastery | undefined, to: ConceptMastery): ConceptMastery =>
  MASTERY.indexOf(to) > MASTERY.indexOf(current ?? 'new') ? to : (current ?? 'new');

function lessonEntry(progress: Progress, lessonId: string, featureKey: string, contentHash?: string): LessonProgress {
  return progress.lessons[lessonId] ?? { featureKey, contentHash: contentHash ?? '', stage: 'watch', completed: false, score: 0, answered: {} };
}

/**
 * Apply one learner event. Pure: returns a new Progress.
 * Mastery: seen (opened a card or story step) → practised (answered a challenge using it) →
 * mastered (correct in 2+ challenges across 2+ features, or a passing test that covers it).
 */
export function applyEvent(progress: Progress, event: LearnerEvent, today: string): Progress {
  let next = touchStreak(progress, today);
  switch (event.type) {
    case 'concept.viewed':
      return { ...next, concepts: { ...next.concepts, [event.conceptId]: raise(next.concepts[event.conceptId], 'seen') } };

    case 'lesson.step.completed': {
      const entry = lessonEntry(next, event.lessonId, event.featureKey, event.contentHash);
      const at = LESSON_STAGES.indexOf(entry.stage);
      const done = LESSON_STAGES.indexOf(event.stage);
      // Re-doing an earlier stage (or the final recap again) earns nothing new.
      if (done < at || (entry.stage === 'recap' && event.stage === 'recap')) return next;
      const stage: LessonStage = LESSON_STAGES[Math.min(done + 1, LESSON_STAGES.length - 1)]!;
      // Watch, Understand and Try are required; finishing Try completes the lesson.
      const completes = !entry.completed && done >= LESSON_STAGES.indexOf('try');
      next = { ...next, xp: next.xp + XP.stage + (completes ? XP.lessonComplete : 0) };
      const updated: LessonProgress = { ...entry, featureKey: event.featureKey, contentHash: event.contentHash, stage, completed: entry.completed || completes };
      delete updated.updated;
      return { ...next, lessons: { ...next.lessons, [event.lessonId]: updated } };
    }

    case 'challenge.answered': {
      const entry = lessonEntry(next, event.lessonId, event.featureKey);
      // Only the first answer to a challenge counts, so retrying can't farm XP.
      if (event.challengeId in entry.answered) return next;
      const concepts = { ...next.concepts };
      const evidence = { ...next.conceptEvidence };
      for (const id of event.concepts) {
        concepts[id] = raise(concepts[id], 'practised');
        if (!event.correct) continue;
        const before = evidence[id] ?? { correct: 0, features: [], tested: false };
        const features = before.features.includes(event.featureKey) ? before.features : [...before.features, event.featureKey];
        evidence[id] = { ...before, correct: before.correct + 1, features };
        if (evidence[id]!.correct >= 2 && features.length >= 2) concepts[id] = 'mastered';
      }
      return {
        ...next,
        xp: next.xp + (event.correct ? XP.correct : 0),
        concepts,
        conceptEvidence: evidence,
        lessons: { ...next.lessons, [event.lessonId]: { ...entry, score: entry.score + (event.correct ? 1 : 0), answered: { ...entry.answered, [event.challengeId]: event.correct } } },
      };
    }

    case 'test.written':
      return { ...next, xp: next.xp + XP.testWritten };

    case 'test.passed': {
      const concepts = { ...next.concepts };
      const evidence = { ...next.conceptEvidence };
      for (const id of event.concepts) {
        evidence[id] = { ...(evidence[id] ?? { correct: 0, features: [] }), tested: true };
        concepts[id] = 'mastered';
      }
      return { ...next, xp: next.xp + XP.testPassed, concepts, conceptEvidence: evidence };
    }
  }
}

/** After the code changed: keep progress, and flag lessons whose feature changed as "Updated". */
export function reconcile(progress: Progress, plan: LearningPlan): Progress {
  let changed = false;
  const lessons = { ...progress.lessons };
  for (const lesson of Object.values(plan.lessons)) {
    const entry = lessons[lesson.id];
    if (!entry || entry.contentHash === lesson.contentHash || entry.updated) continue;
    lessons[lesson.id] = { ...entry, updated: true };
    changed = true;
  }
  return changed ? { ...progress, lessons } : progress;
}

export type PathState = 'done' | 'next' | 'locked';
export interface PathItem {
  lessonId: string;
  state: PathState;
  updated: boolean;
}

/** Done lessons, then the next one to do; the rest wait their turn. */
export function pathStates(plan: LearningPlan, progress: Progress): PathItem[] {
  let nextFound = false;
  return plan.path.map((lessonId) => {
    const entry = progress.lessons[lessonId];
    const updated = !!entry?.updated;
    if (entry?.completed) return { lessonId, state: 'done', updated };
    if (!nextFound) {
      nextFound = true;
      return { lessonId, state: 'next', updated };
    }
    return { lessonId, state: 'locked', updated };
  });
}

/** "Continue: Place order — step 3 of 5". Undefined when every lesson is done. */
export function continueTarget(plan: LearningPlan, progress: Progress): { lessonId: string; stage: LessonStage; stepNumber: number; started: boolean } | undefined {
  const next = pathStates(plan, progress).find((item) => item.state === 'next');
  if (!next) return undefined;
  const entry = progress.lessons[next.lessonId];
  const stage = entry?.stage ?? 'watch';
  return { lessonId: next.lessonId, stage, stepNumber: LESSON_STAGES.indexOf(stage) + 1, started: !!entry };
}

export function masteryOf(progress: Progress, conceptId: ConceptId): ConceptMastery {
  return progress.concepts[conceptId] ?? 'new';
}
