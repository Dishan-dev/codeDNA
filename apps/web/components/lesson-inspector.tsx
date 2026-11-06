'use client';
import { CONCEPT_TINT, Icon, RichText, type PathItem } from '@codedna/learn-ui';
import type { Feature, HiddenLesson, Lesson } from '@codedna/shared';
import { ENTRY, hopsOf, pageText } from '@/lib/flows';
import { cn } from '@/lib/utils';
import { FlowStrip } from './flow-strip';
import { useRepo } from './repo-shell';
import { SmallThings } from './small-things';
import { ButtonLink, Difficulty, focus } from './ui';

const STATUS: Record<PathItem['state'], { label: string; tone: string }> = {
  done: { label: 'Done', tone: 'bg-success-soft text-success' },
  next: { label: 'Up next', tone: 'bg-[rgb(var(--part,var(--color-accent))/0.14)] text-[rgb(var(--part,var(--color-accent)))]' },
  locked: { label: 'Locked', tone: 'bg-surface-2 text-muted' },
};

/**
 * Everything about the lesson picked on the strand: where it happens, a simulation of its path,
 * the ideas it teaches, the way in, and what else lives in the same area.
 */
export function LessonInspector({
  lesson,
  item,
  number,
  total,
  feature,
  areaTitle,
  rest,
  tips,
  playing,
  onPlayed,
  onReplay,
}: {
  lesson: Lesson;
  item: PathItem;
  number: number;
  total: number;
  feature: Feature | undefined;
  areaTitle: string | undefined;
  rest: Feature[];
  tips: HiddenLesson[];
  playing: boolean;
  onPlayed: () => void;
  onReplay: () => void;
}) {
  const { bundle, base, openConcept } = useRepo();
  const slug = bundle.slugs[lesson.featureId];
  const hops = feature ? hopsOf(feature) : [];
  const status = STATUS[item.state];
  return (
    <section aria-labelledby="inspector-heading" className="space-y-7">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', status.tone)}>{status.label}</span>
          <span className="text-muted">{`Lesson ${number} of ${total}`}</span>
          {item.updated ? <span className="rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning">Updated in the code</span> : null}
        </div>
        <h2 id="inspector-heading" className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          {lesson.title}
        </h2>
        {feature ? (
          <p className="mt-1.5 text-[14.5px] text-muted">
            {pageText(feature) ?? ENTRY[feature.entryKind].label}
            {feature.codeName ? (
              <>
                {' · '}
                <code className="font-mono text-[12.5px] text-ink/80">{feature.codeName}</code>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-muted">
          <span className="inline-flex items-center gap-1">
            <Icon name="play" className="h-3.5 w-3.5" /> {`${lesson.minutes} min`}
          </span>
          <Difficulty level={lesson.difficulty} />
          {lesson.challenges.length ? <span>{`${lesson.challenges.length} challenge${lesson.challenges.length === 1 ? '' : 's'}`}</span> : null}
        </p>
      </div>

      {hops.length > 1 ? (
        <div className="rounded-2xl border border-[rgb(var(--part,var(--color-accent))/0.25)] bg-[rgb(var(--part,var(--color-accent))/0.05)] p-4">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">What happens</p>
            <button type="button" onClick={onReplay} disabled={playing} className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50', focus)}>
              <Icon name="replay" className="h-3.5 w-3.5" /> Play again
            </button>
          </div>
          <FlowStrip hops={hops} playing={playing} onDone={onPlayed} label={`What happens in “${lesson.title}”`} />
        </div>
      ) : null}

      {lesson.concepts.length ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">Ideas you’ll learn</p>
          <ul className="flex flex-wrap gap-1.5">
            {lesson.concepts.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => openConcept(id)} className={cn('inline-flex min-h-[36px] items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13.5px] text-ink hover:border-accent/50', focus)}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CONCEPT_TINT[id] }} aria-hidden="true" />
                  {bundle.plan.concepts[id]?.name ?? id}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {item.state === 'locked' ? (
          <>
            {slug ? (
              <ButtonLink href={`${base}/story/${slug}`} icon="play">
                Watch the story
              </ButtonLink>
            ) : null}
            <p className="flex basis-full items-center gap-1.5 text-[12.5px] text-muted">
              <Icon name="lock" className="h-3.5 w-3.5" /> Opens when you finish the lessons before it.
            </p>
          </>
        ) : (
          <>
            <ButtonLink href={`${base}/learn/${lesson.id}`} icon={item.state === 'done' ? 'replay' : 'play'} className="flex-1">
              {item.state === 'done' ? 'Review lesson' : 'Start lesson'}
            </ButtonLink>
            {slug ? (
              <ButtonLink href={`${base}/story/${slug}`} variant="secondary">
                Story
              </ButtonLink>
            ) : null}
          </>
        )}
      </div>

      {tips.length ? (
        <div className="space-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Worth a look</p>
          {tips.map((tip) => (
            <div key={tip.id} className="rounded-xl border border-warning/30 bg-warning-soft/40 p-3">
              <p className="flex items-start gap-2 text-[13.5px] font-semibold leading-snug text-ink">
                <Icon name="lightbulb" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                {tip.title}
              </p>
              <p className="mt-1 pl-6 text-[12.5px] leading-relaxed text-muted">
                <RichText text={tip.plain} />
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {rest.length && areaTitle ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">{`Also in ${areaTitle}`}</p>
          <SmallThings features={rest} />
        </div>
      ) : null}
    </section>
  );
}
