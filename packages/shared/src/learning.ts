import type { AnalysisStats, CodeRef, ConceptId, Feature, FrameworkInfo, StableId, Step } from './index.js';

/** Schema 2.0: lessons, challenges and progress. Everything here is deterministic for a commit. */
export const LEARNING_SCHEMA_VERSION = '2.0' as const;

export type LessonId = StableId;

export interface Concept {
  id: ConceptId;
  name: string;
  /** One sentence for chips and tooltips. */
  oneLiner: string;
  /** Three to five beginner sentences, written by us (never generated). */
  explainer: string;
  whyItMatters: string;
  level: 1 | 2 | 3;
  prerequisites: ConceptId[];
}

/** A concept found in the learner's code. */
export interface ConceptUse {
  conceptId: ConceptId;
  code: CodeRef;
  featureId?: StableId;
  stepId?: StableId;
}

export interface ChoiceOption {
  id: StableId;
  label: string;
}

export type MutationKind = 'remove-validation' | 'remove-auth-check' | 'flip-condition' | 'remove-await' | 'remove-early-return';

interface ChallengeBase {
  id: StableId;
  /** The question or instruction shown to the learner. */
  prompt: string;
  /** Shown after answering; points at the real line. */
  explanation: string;
  codeRef: CodeRef;
  concepts: ConceptId[];
}
export interface PredictChallenge extends ChallengeBase {
  kind: 'predict';
  options: ChoiceOption[];
  answerId: StableId;
}
export interface OrderChallenge extends ChallengeBase {
  kind: 'order';
  /** Step ids in a deterministic shuffled order. */
  stepsShuffled: StableId[];
  correct: StableId[];
}
export interface SpotBugChallenge extends ChallengeBase {
  kind: 'spot-bug';
  mutation: MutationKind;
  /** The changed copy of `codeRef.excerpt`; always labelled as a changed copy in the UI. */
  mutated: string;
  /** 1-based line within `mutated` that changed. */
  changedLine: number;
  options: ChoiceOption[];
  answerId: StableId;
}
export interface FillGapChallenge extends ChallengeBase {
  kind: 'fill-gap';
  /** Repository line number that is hidden. */
  hiddenLine: number;
  options: ChoiceOption[];
  answerId: StableId;
  hint: string;
}
export type Challenge = PredictChallenge | OrderChallenge | SpotBugChallenge | FillGapChallenge;
export type ChallengeKind = Challenge['kind'];

export interface TestScenario {
  id: StableId;
  branchId: StableId;
  outcomeId: StableId;
  title: string;
  given: string;
  when: string;
  then: string;
  framework: 'vitest' | 'playwright';
  /** Generated test code with a `// your turn` placeholder for the key assertion. */
  skeleton: string;
  hint: string;
}

export interface Lesson {
  id: LessonId;
  featureId: StableId;
  featureKey: string;
  contentHash: string;
  title: string;
  minutes: number;
  difficulty: 1 | 2 | 3;
  story: Step[];
  concepts: ConceptId[];
  challenges: Challenge[];
  testScenarios: TestScenario[];
}

export type HiddenLessonKind = 'missing-auth-check' | 'missing-validation' | 'unknown-part' | 'duplicated-logic';
/** A gentle "there's a lesson here" note found in the learner's app. */
export interface HiddenLesson {
  id: StableId;
  kind: HiddenLessonKind;
  title: string;
  plain: string;
  code: CodeRef;
  featureId?: StableId;
  conceptId?: ConceptId;
}

/** The one-question mini check on a concept card. */
export interface ConceptCheck {
  conceptId: ConceptId;
  prompt: string;
  options: ChoiceOption[];
  answerId: StableId;
  explanation: string;
  /** The real line the right answer comes from, when the check is about the learner's code. */
  code?: CodeRef;
}

export interface AppSummary {
  /** "Your app in one sentence", built from templates and detected features. */
  sentence: string;
  /** What users can do, e.g. "Reserve room". */
  featureTitles: string[];
  /** Data the app stores, e.g. "Booking", from database writes. */
  dataStored: string[];
}

export interface LearningPlan {
  schemaVersion: typeof LEARNING_SCHEMA_VERSION;
  snapshotId: StableId;
  revision?: string;
  summary: AppSummary;
  /** Lesson ids: grouped by app part, easiest part first, and easiest first inside each part. */
  path: LessonId[];
  /** The app broken into parts (Checkout, Signing in…), in path order. Missing in older bundles. */
  areas?: LearningArea[];
  lessons: Record<LessonId, Lesson>;
  concepts: Partial<Record<ConceptId, Concept>>;
  conceptUses: ConceptUse[];
  conceptChecks: Partial<Record<ConceptId, ConceptCheck>>;
  hiddenLessons: HiddenLesson[];
}

/** One part of the app, as a person would name it, with its lessons and every flow in it. */
export interface LearningArea {
  title: string;
  /** The bigger part of the app it belongs to ("Admin"); the same as title when there is no bigger part. */
  section?: string;
  /** One plain sentence about this part. */
  summary: string;
  lessonIds: LessonId[];
  /** Every feature in this part, links included, for the app map. */
  featureIds: StableId[];
}

export type LessonStage = 'watch' | 'understand' | 'try' | 'test' | 'recap';
export const LESSON_STAGES: readonly LessonStage[] = ['watch', 'understand', 'try', 'test', 'recap'];
export type ConceptMastery = 'new' | 'seen' | 'practised' | 'mastered';

export interface LessonProgress {
  featureKey: string;
  /** Content hash of the lesson when progress was last saved. */
  contentHash: string;
  stage: LessonStage;
  completed: boolean;
  score: number;
  answered: Record<StableId, boolean>;
  /** Set when the feature changed since this progress was saved. */
  updated?: boolean;
}

/** Stored locally (IndexedDB), keyed by repository, not commit. No account for the MVP. */
export interface Progress {
  repoKey: string;
  xp: number;
  streakDays: number;
  /** ISO date (YYYY-MM-DD) of the last active day, for the streak. */
  lastActiveDay?: string;
  concepts: Partial<Record<ConceptId, ConceptMastery>>;
  /** Features in which a concept was answered correctly, for the mastery rule. */
  conceptEvidence: Partial<Record<ConceptId, { correct: number; features: string[]; tested: boolean }>>;
  lessons: Record<string, LessonProgress>;
}

export type LearnerEvent =
  | { type: 'lesson.step.completed'; lessonId: LessonId; featureKey: string; contentHash: string; stage: LessonStage }
  | { type: 'challenge.answered'; lessonId: LessonId; featureKey: string; challengeId: StableId; concepts: ConceptId[]; correct: boolean }
  | { type: 'concept.viewed'; conceptId: ConceptId }
  | { type: 'test.written'; lessonId: LessonId; scenarioId: StableId }
  | { type: 'test.passed'; lessonId: LessonId; scenarioId: StableId; concepts: ConceptId[] };

/**
 * Everything the learning UI needs for one repository, as one JSON document. Built once per
 * commit (by the CLI, a server worker, or at build time for starter repos) and cached.
 */
export interface RepoBundle {
  schemaVersion: typeof LEARNING_SCHEMA_VERSION;
  /** URL-safe key, e.g. `snackshop`; also the progress key. */
  id: string;
  name: string;
  source: 'starter' | 'local' | 'github';
  revision?: string;
  framework: FrameworkInfo;
  stats: AnalysisStats;
  partial: boolean;
  limitations: string[];
  /** Code in languages CodeDNA can't read (PHP, Python…), most first. Set when the source knows it. */
  otherLanguages?: { language: string; files: number }[];
  features: Feature[];
  /** URL-safe slug per feature id, for `/r/[repo]/story/[feature]`. */
  slugs: Record<StableId, string>;
  plan: LearningPlan;
}
