'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ActionBar, CONCEPT_TINT, Celebration, ChallengeView, ConceptChip, ConceptSteps, Icon, STAGES as STEP_STAGES, XP, buttonClass, defaultChoices, masteryOf, placesOf, placeText, visibleSteps, type IconName } from '@codedna/learn-ui';
import { LESSON_STAGES, type ConceptMastery, type Feature, type Lesson, type LessonStage } from '@codedna/shared';
import { cn } from '@/lib/utils';
import { useRepo } from './repo-shell';
import { useSeenConcepts } from './story-page';
import { ButtonLink, Card, PageMessage } from './ui';

const StoryPlayer = dynamic(() => import('@codedna/learn-ui').then((module) => module.StoryPlayer), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse rounded-2xl border border-line bg-surface" aria-label="Loading the story" />,
});

const STAGES: Record<LessonStage, { label: string; note: string; icon: IconName }> = {
  watch: { label: 'Watch', note: 'See it run', icon: 'play' },
  understand: { label: 'Understand', note: 'Learn the ideas', icon: 'lightbulb' },
  try: { label: 'Try', note: 'Practise', icon: 'star' },
  test: { label: 'Test', note: 'How it breaks', icon: 'check' },
  recap: { label: 'Recap', note: 'Wrap up', icon: 'done' },
};
export const MASTERY_LABEL: Record<ConceptMastery, string> = { new: 'Not started', seen: 'Seen', practised: 'Practised', mastered: 'Mastered' };

/** The stages this lesson shows. "Test it" appears only when the lesson has test scenarios. */
const stagesOf = (lesson: Lesson) => LESSON_STAGES.filter((stage) => stage !== 'test' || lesson.testScenarios.length > 0);

function Stepper({ stages, current, reached, onSelect }: { stages: LessonStage[]; current: LessonStage; reached: number; onSelect: (stage: LessonStage) => void }) {
  return (
    <nav aria-label="Lesson steps">
      <ol className="grid gap-1.5 rounded-2xl border border-line bg-surface p-2 shadow-card" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((stage, index) => {
          const position = LESSON_STAGES.indexOf(stage);
          const done = position < reached;
          const active = stage === current;
          return (
            <li key={stage} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(stage)}
                disabled={position > reached}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex h-full min-h-[56px] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5 text-sm sm:min-h-[64px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed sm:flex-row sm:justify-start sm:gap-2.5 sm:px-3',
                  active ? 'bg-accent-soft text-ink' : done ? 'text-ink hover:bg-surface-2' : 'text-muted',
                )}
              >
                <span
                  className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold', done ? 'bg-success text-surface' : active ? 'bg-accent text-on-accent' : 'border border-line text-muted')}
                  aria-hidden="true"
                >
                  {done ? <Icon name="done" className="h-4 w-4" /> : index + 1}
                </span>
                <span className="min-w-0 text-center sm:text-left">
                  <span className="block truncate text-[13px] font-semibold sm:text-[15px]">{STAGES[stage].label}</span>
                  <span className="hidden truncate text-[13px] text-muted sm:block">{STAGES[stage].note}</span>
                </span>
                {done ? <span className="sr-only"> (done)</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** One line at the top of each stage: what this part is for and what to do. */
function StageIntro({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="mb-5 flex max-w-4xl items-start gap-3 text-base leading-relaxed text-muted">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
      <span>{children}</span>
    </p>
  );
}

function WatchStage({ feature, firstTime, onDone }: { feature: Feature; firstTime: boolean; onDone: () => void }) {
  const { bundle } = useRepo();
  const { onStepShown, onConceptOpen } = useSeenConcepts();
  const [watchedAll, setWatchedAll] = useState(false);
  const [at, setAt] = useState({ position: 0, total: 0 });
  const locked = firstTime && !watchedAll;
  const left = Math.max(0, at.total - at.position - 1);
  return (
    <>
      <StageIntro icon="play">
        Follow what happens, step by step. The marker shows <strong className="font-semibold text-ink">where</strong> each step runs. Press Play or click any step; when the code makes a choice, you pick the path.
      </StageIntro>
      <StoryPlayer
        feature={feature}
        concepts={bundle.plan.concepts}
        onStepShown={onStepShown}
        onConceptOpen={onConceptOpen}
        onFinished={() => setWatchedAll(true)}
        onProgress={(position, total) => setAt({ position, total })}
        autoPlay={firstTime}
        inlineConcepts={false}
      />
      <ActionBar
        status={
          watchedAll && firstTime ? (
            <Celebration text="You watched the whole journey." xp={XP.stage} />
          ) : locked ? (
            <span className="flex items-center gap-3 text-muted">
              <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-line sm:block" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${at.total ? ((at.position + 1) / at.total) * 100 : 0}%` }} />
              </span>
              <span>
                <span className="hidden sm:inline">Watch to the end · </span>
                {left} step{left === 1 ? '' : 's'} left
              </span>
            </span>
          ) : (
            <span className="text-muted">Next: the ideas behind this feature.</span>
          )
        }
      >
        <button type="button" disabled={locked} onClick={onDone} className={buttonClass('primary')}>
          Next: Understand
          <Icon name="next" className="h-4 w-4" />
        </button>
      </ActionBar>
    </>
  );
}

/** Understand: one idea at a time, each in three short parts. */
function UnderstandStage({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const { bundle, dispatch } = useRepo();
  const [index, setIndex] = useState(0);
  const ids = lesson.concepts.filter((id) => bundle.plan.concepts[id]);
  const id = ids[index];
  if (!id) {
    return (
      <>
        <Card className="text-center">
          <p className="text-ink">This lesson has no new ideas to explain.</p>
        </Card>
        <ActionBar>
          <button type="button" onClick={onDone} className={buttonClass('primary')}>
            Next: Try
          </button>
        </ActionBar>
      </>
    );
  }
  const last = index === ids.length - 1;
  return (
    <div>
      <StageIntro icon="lightbulb">
        This feature uses {ids.length} idea{ids.length === 1 ? '' : 's'}. For each one: read it, see it in your code, then check yourself.
      </StageIntro>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-1 text-sm font-semibold text-ink">
          Idea {index + 1} of {ids.length}
        </p>
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Ideas in this lesson">
          {ids.map((item, position) => {
            const done = position < index;
            const current = position === index;
            return (
              <li key={item}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => setIndex(position)}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default',
                    current ? 'border-accent bg-accent text-on-accent' : done ? 'border-accent/30 bg-accent-soft text-accent hover:border-accent' : 'border-dashed border-line bg-surface text-muted',
                  )}
                >
                  {done ? <Icon name="done" className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CONCEPT_TINT[item] }} aria-hidden="true" />}
                  {bundle.plan.concepts[item]?.name ?? item}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <ConceptSteps
        key={id}
        concept={bundle.plan.concepts[id]!}
        check={bundle.plan.conceptChecks[id]}
        uses={bundle.plan.conceptUses.filter((use) => use.conceptId === id && use.featureId === lesson.featureId).concat(bundle.plan.conceptUses.filter((use) => use.conceptId === id && use.featureId !== lesson.featureId))}
        onChecked={() => dispatch({ type: 'concept.viewed', conceptId: id })}
        doneLabel={last ? 'Next: Try' : 'Next idea'}
        onDone={() => {
          dispatch({ type: 'concept.viewed', conceptId: id });
          window.scrollTo({ top: 0 });
          if (last) onDone();
          else setIndex(index + 1);
        }}
      />
    </div>
  );
}

/** Try: the lesson's challenges, one per screen. */
function TryStage({ lesson, onDone }: { lesson: Lesson; onDone: () => void }) {
  const { dispatch } = useRepo();
  const [index, setIndex] = useState(0);
  const challenge = lesson.challenges[index];
  if (!challenge) {
    return (
      <>
        <Card className="text-center">
          <p className="text-ink">This feature is small, so there’s nothing to practise here yet.</p>
        </Card>
        <ActionBar>
          <button type="button" onClick={onDone} className={buttonClass('primary')}>
            Finish the lesson
          </button>
        </ActionBar>
      </>
    );
  }
  const last = index === lesson.challenges.length - 1;
  return (
    <div>
      <StageIntro icon="star">Short challenges built from this feature’s real code. There’s no penalty for a wrong answer: read why, and try again.</StageIntro>
      <div className="mb-4 flex items-center gap-3">
        <p className="shrink-0 text-sm font-semibold text-ink">
          Challenge {index + 1} of {lesson.challenges.length}
        </p>
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {lesson.challenges.map((item, position) => (
            <span key={item.id} className={cn('h-2 flex-1 rounded-full transition-colors', position < index ? 'bg-success' : position === index ? 'bg-accent' : 'bg-line')} />
          ))}
        </div>
      </div>
      <ChallengeView
        key={challenge.id}
        challenge={challenge}
        story={lesson.story}
        nextLabel={last ? 'Finish the lesson' : 'Next challenge'}
        onAnswer={(correct) => dispatch({ type: 'challenge.answered', lessonId: lesson.id, featureKey: lesson.featureKey, challengeId: challenge.id, concepts: challenge.concepts, correct })}
        onNext={() => {
          window.scrollTo({ top: 0 });
          if (last) onDone();
          else setIndex(index + 1);
        }}
      />
    </div>
  );
}

/** The usual path through the feature, as a short vertical timeline. */
function JourneySummary({ feature }: { feature: Feature }) {
  const steps = visibleSteps(feature, defaultChoices(feature));
  const places = placesOf(steps);
  return (
    <ol className="relative space-y-3 pl-1">
      <span className="absolute bottom-4 left-[19px] top-4 w-0.5 bg-line" aria-hidden="true" />
      {steps.map((step, index) => (
        <li key={step.id} className="relative flex items-start gap-3">
          <span className={cn('relative grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 bg-surface', step.confidence === 'gap' ? 'border-dashed border-danger/70 text-danger' : 'border-accent/50 text-accent')} aria-hidden="true">
            <Icon name={step.confidence === 'gap' ? 'unknown' : STEP_STAGES[step.stage].icon} className="h-4 w-4" />
          </span>
          <span className="min-w-0 pt-1">
            <span className="block text-[15px] font-medium text-ink">
              {index + 1}. {step.title}
            </span>
            <span className="block text-xs text-muted">{places[index] ? placeText(places[index]) : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function RecapStage({ lesson, feature, justFinished, onFinish }: { lesson: Lesson; feature: Feature; justFinished: boolean; onFinish: (href: string) => void }) {
  const { bundle, progress, base } = useRepo();
  const saved = progress.lessons[lesson.id];
  const firstTry = Object.values(saved?.answered ?? {}).filter(Boolean).length;
  const position = bundle.plan.path.indexOf(lesson.id);
  const nextId = bundle.plan.path[position + 1];
  const next = nextId ? bundle.plan.lessons[nextId] : undefined;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="space-y-6">
          {justFinished ? <Celebration text="Lesson complete!" xp={XP.lessonComplete} /> : <h2 className="text-xl font-semibold text-ink">Lesson recap</h2>}
          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-surface-2 p-3 sm:p-4">
              <dt className="text-xs text-muted sm:text-sm">Right first try</dt>
              <dd className="mt-1 text-xl font-semibold text-ink sm:text-2xl">
                {firstTry} / {lesson.challenges.length}
              </dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3 sm:p-4">
              <dt className="text-xs text-muted sm:text-sm">Total XP</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-xl font-semibold text-ink sm:text-2xl">
                <Icon name="star" className="h-5 w-5 text-accent" /> {progress.xp}
              </dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3 sm:p-4">
              <dt className="text-xs text-muted sm:text-sm">Streak</dt>
              <dd className="mt-1 flex items-center gap-1.5 text-xl font-semibold text-ink sm:text-2xl">
                <Icon name="flame" className="h-5 w-5 text-warning" /> {progress.streakDays} day{progress.streakDays === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
          <section>
            <h3 className="font-semibold text-ink">Ideas you learned</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {lesson.concepts.map((id) => (
                <li key={id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                  <ConceptChip id={id} concept={bundle.plan.concepts[id]} />
                  <span className="text-sm text-muted">{MASTERY_LABEL[masteryOf(progress, id)]}</span>
                </li>
              ))}
            </ul>
          </section>
        </Card>
        <Card>
          <h3 className="font-semibold text-ink">The journey, in one look</h3>
          <p className="mb-4 mt-1 text-sm text-muted">What happens when someone uses “{lesson.title}”, on the usual path.</p>
          <JourneySummary feature={feature} />
        </Card>
      </div>
      <ActionBar status={next ? <span className="text-muted">Up next: {next.title}</span> : <span className="text-muted">That was the last lesson on your path.</span>}>
        <button type="button" onClick={() => onFinish(base)} className={buttonClass(next ? 'secondary' : 'primary')}>
          Back to your app
        </button>
        {next ? (
          <button type="button" onClick={() => onFinish(`${base}/learn/${next.id}`)} className={buttonClass('primary')}>
            Next lesson: {next.title}
            <Icon name="next" className="h-4 w-4" />
          </button>
        ) : null}
      </ActionBar>
    </>
  );
}

export function LessonFlow({ lessonId }: { lessonId: string }) {
  const { bundle, progress, progressLoaded, dispatch, base } = useRepo();
  const router = useRouter();
  const lesson = bundle.plan.lessons[lessonId];
  const feature = lesson && bundle.features.find((item) => item.id === lesson.featureId);
  const saved = lesson ? progress.lessons[lesson.id] : undefined;
  const reached = LESSON_STAGES.indexOf(saved?.stage ?? 'watch');
  const [viewing, setViewing] = useState<LessonStage | undefined>();
  const [justFinished, setJustFinished] = useState(false);
  if (!lesson || !feature)
    return (
      <PageMessage title="That lesson isn’t here">
        <p>The code may have changed since this link was made.</p>
        <ButtonLink href={base} className="mt-6">
          Back to your app
        </ButtonLink>
      </PageMessage>
    );
  if (!progressLoaded) return <p className="text-muted" role="status">Loading your progress…</p>;

  const stages = stagesOf(lesson);
  // A saved stage this lesson doesn't show (like "Test it" before it has scenarios) resumes at the next one.
  const resumeAt = stages.find((stage) => LESSON_STAGES.indexOf(stage) >= reached) ?? 'recap';
  const stage = viewing ?? resumeAt;
  const complete = (done: LessonStage) => dispatch({ type: 'lesson.step.completed', lessonId: lesson.id, featureKey: lesson.featureKey, contentHash: lesson.contentHash, stage: done });
  const go = (next: LessonStage) => {
    setViewing(next);
    window.scrollTo({ top: 0 });
  };
  const first = lesson.story[0];
  const usual = visibleSteps(feature, defaultChoices(feature));
  const end = usual[usual.length - 1];

  return (
    <div className="mx-auto max-w-[1360px]">
      <ButtonLink href={base} variant="quiet" icon="back" className="-ml-2 text-sm">
        Your app
      </ButtonLink>
      <header className="mt-4 rounded-3xl border border-line bg-gradient-to-br from-accent-soft/70 via-surface to-surface px-5 py-6 shadow-card sm:px-8 sm:py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Lesson</p>
      <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight text-ink sm:text-[44px]">{lesson.title}</h1>
      {feature.area || feature.codeName ? (
        <p className="mt-2 text-[15px] text-muted">
          {feature.area ? `Part of ${feature.area}` : null}
          {feature.area && feature.codeName ? ' · ' : null}
          {feature.codeName ? (
            <>
              in the code: <code className="font-mono text-[13px] text-ink/80">{feature.codeName}</code>
            </>
          ) : null}
        </p>
      ) : null}
      {first && end && first.id !== end.id ? (
        <p className="mt-5 flex flex-wrap items-center gap-2.5 text-[15px] text-muted">
          <span>From</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[15px] font-medium text-ink shadow-card">
            <Icon name={STEP_STAGES[first.stage].icon} className="h-4 w-4 text-accent" /> {first.title}
          </span>
          <span>to</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[15px] font-medium text-ink shadow-card">
            <Icon name={STEP_STAGES[end.stage].icon} className="h-4 w-4 text-accent" /> {end.title}
          </span>
        </p>
      ) : null}
      <ul className="mt-5 flex flex-wrap gap-2 text-sm text-muted" aria-label="About this lesson">
        <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5">About {lesson.minutes} minutes</li>
        <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5"><Icon name="play" className="h-4 w-4" /> {usual.length} steps</li>
        <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5"><Icon name="star" className="h-4 w-4" /> {lesson.challenges.length} challenge{lesson.challenges.length === 1 ? '' : 's'}</li>
        {saved?.updated ? <li className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-ink">Updated — something changed in this feature</li> : null}
      </ul>
      </header>
      <div className="mt-8">
        <Stepper stages={stages} current={stage} reached={LESSON_STAGES.indexOf(resumeAt)} onSelect={go} />
      </div>

      <div className="mt-8">
        {stage === 'watch' ? (
          <WatchStage
            feature={feature}
            firstTime={reached === 0}
            onDone={() => {
              complete('watch');
              go('understand');
            }}
          />
        ) : null}
        {stage === 'understand' ? (
          <UnderstandStage
            lesson={lesson}
            onDone={() => {
              complete('understand');
              go('try');
            }}
          />
        ) : null}
        {stage === 'try' ? (
          <TryStage
            lesson={lesson}
            onDone={() => {
              if (!saved?.completed) setJustFinished(true);
              complete('try');
              // "Test it" arrives in a later update; until then Try leads straight to the recap.
              go('recap');
            }}
          />
        ) : null}
        {stage === 'recap' ? (
          <RecapStage
            lesson={lesson}
            feature={feature}
            justFinished={justFinished}
            onFinish={(href) => {
              complete('recap');
              // Client navigation keeps the page alive, so the progress save always completes.
              router.push(href);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
