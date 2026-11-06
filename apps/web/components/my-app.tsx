'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon, continueTarget, pathStates, type IconName } from '@codedna/learn-ui';
import type { Feature, LearningArea, Lesson } from '@codedna/shared';
import { cn } from '@/lib/utils';
import { partHue, partIcon, partsOf } from '@/lib/flows';
import { DnaPath, type StrandEntry } from './dna-path';
import { useReducedMotion } from './flow-strip';
import { LessonInspector } from './lesson-inspector';
import { useRepo } from './repo-shell';
import { SmallThings, plural } from './small-things';
import { ButtonLink, Card, Eyebrow, Pill, ProgressRing, focus } from './ui';

/** What CodeDNA builds lessons from, in plain words. */
const LESSON_SOURCES = [
  { icon: 'click', text: 'Buttons with a click handler (onClick)' },
  { icon: 'form', text: 'Forms and server actions' },
  { icon: 'server', text: 'API routes (route.ts)' },
  { icon: 'database', text: 'Code that reads or saves data' },
] as const;

/**
 * When a repo has no lessons: say what CodeDNA read, why nothing came out of it, and what to do,
 * instead of an empty path that reads as "finished".
 */
function NothingToLearn() {
  const { bundle, base } = useRepo();
  const storyHref = (featureId: string) => (bundle.slugs[featureId] ? `${base}/story/${bundle.slugs[featureId]}` : undefined);
  const small = bundle.features.filter((feature) => feature.entryKind !== 'link');
  const { files, routes } = bundle.stats;
  // A PHP or Python repo with a script or two: say so, instead of "nothing for a person to do".
  const other = bundle.otherLanguages ?? [];
  const main = other[0];
  const foreign = main && main.files > files ? main : undefined;
  const fileCount = (count: number, word: string) => `${count} ${word} file${count === 1 ? '' : 's'}`;
  const otherList = other.slice(0, 3).map((item) => fileCount(item.files, item.language));
  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-0 sm:p-0">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent-soft/70 to-transparent" aria-hidden="true" />
        <div className="relative p-6 sm:p-8">
          <Eyebrow>{foreign ? `Mostly ${foreign.language}` : bundle.framework.label}</Eyebrow>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-[40px]">{bundle.name}</h1>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink/80">{foreign ? `${bundle.name} is mostly written in ${foreign.language}.` : bundle.plan.summary.sentence}</p>
          <ul className="mt-5 flex flex-wrap gap-2" aria-label="What CodeDNA read">
            <li>
              <Pill>
                <Icon name="code" className="h-3.5 w-3.5 text-muted" /> {files} file{files === 1 ? '' : 's'} read
              </Pill>
            </li>
            <li>
              <Pill>
                <Icon name="screen" className="h-3.5 w-3.5 text-muted" /> {routes} page{routes === 1 ? '' : 's'} and route{routes === 1 ? '' : 's'}
              </Pill>
            </li>
            {bundle.revision ? (
              <li>
                <Pill>
                  <Icon name="github" className="h-3.5 w-3.5 text-muted" /> commit <span className="font-mono">{bundle.revision.slice(0, 7)}</span>
                </Pill>
              </li>
            ) : null}
          </ul>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card as="section" className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">
              {foreign ? `This repo is mostly ${foreign.language}, which CodeDNA can’t read yet` : 'No lessons yet — there’s nothing for a person to do in this code'}
            </h2>
            <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
              {foreign
                ? `It has ${otherList.join(', ')}, and ${files === 0 ? 'no' : `only ${files}`} JavaScript or TypeScript file${files === 1 ? '' : 's'}. CodeDNA builds lessons from JavaScript and TypeScript, best of all Next.js apps, so there’s nothing here it can turn into a lesson yet.`
                : small.length
                  ? `CodeDNA found ${small.length} small feature${small.length === 1 ? '' : 's'}, but each is only one step, which is too little for a lesson. You can still watch ${small.length === 1 ? 'its' : 'their'} story.`
                  : 'CodeDNA read the code but found only pages that show things. A lesson follows something a person does, from the click to the result, so it needs one of these:'}
            </p>
          </div>
          {foreign ? null : small.length ? (
            <ul className="divide-y divide-line">
              {small.map((feature) => {
                const href = storyHref(feature.id);
                return (
                  <li key={feature.id} className="flex min-h-[44px] items-center gap-3 text-[15px] text-ink">
                    <span className="min-w-0 flex-1 truncate">{feature.title}</span>
                    {href ? (
                      <Link href={href} className={cn('shrink-0 text-sm font-medium text-accent hover:underline', focus)}>
                        Watch the story →
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {LESSON_SOURCES.map((source) => (
                <li key={source.text} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-[15px] text-ink">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
                    <Icon name={source.icon} className="h-4 w-4" />
                  </span>
                  {source.text}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <ButtonLink href="/r/snackshop" icon="play">
              Try the Snackshop starter
            </ButtonLink>
            <ButtonLink href="/#start" variant="secondary">
              Learn a different repo
            </ButtonLink>
          </div>
        </Card>

        <Card as="section" className="p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-warning-soft text-warning" aria-hidden="true">
              <Icon name="lightbulb" className="h-4 w-4" />
            </span>
            Expected more?
          </h2>
          {foreign ? (
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Reading {foreign.language} isn’t built yet. To see what CodeDNA can do, pick a repo built with Next.js, or try the Snackshop starter.</p>
          ) : bundle.source === 'github' ? (
            <p className="mt-3 text-[14px] leading-relaxed text-muted">
              CodeDNA reads what’s on GitHub, on the default branch
              {bundle.revision ? (
                <>
                  {' '}
                  (commit <span className="font-mono text-ink">{bundle.revision.slice(0, 7)}</span>)
                </>
              ) : null}
              . Work that is only on your computer, or on another branch, isn’t there yet. Push it and import again, or run <code className="rounded bg-surface-2 px-1 font-mono text-[13px] text-ink">pnpm codedna</code> in the project folder to learn it straight from your computer.
            </p>
          ) : (
            <p className="mt-3 text-[14px] leading-relaxed text-muted">Add a button, a form or an API route to your app and open this page again. CodeDNA turns each one into a lesson.</p>
          )}
          {bundle.limitations.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-muted">
              {bundle.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

const PART_KEY = (id: string) => `codedna:part:${id}`;

/** A small ring for a part's progress, with its icon inside. */
function PartRing({ value, total, icon, active }: { value: number; total: number; icon: IconName; active: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center" aria-hidden="true">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-[rgb(var(--part)/0.22)]" />
        {total ? <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-[rgb(var(--part))] transition-[stroke-dashoffset] duration-700" strokeDasharray={c} strokeDashoffset={c * (1 - value / total)} /> : null}
      </svg>
      <span className={cn('grid h-7 w-7 place-items-center rounded-full', active ? 'bg-[rgb(var(--part))] text-on-accent' : 'bg-[rgb(var(--part)/0.14)] text-[rgb(var(--part))]')}>
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
    </span>
  );
}

const desktop = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches;

/**
 * My App, in three panes: the app and its parts on the left, the chosen part's lessons as a DNA
 * strand in the middle, and the chosen lesson in an inspector on the right. On phones the parts
 * become a row of chips and the inspector a sheet that rises from the bottom.
 */
export function MyApp() {
  const { bundle, progress, base } = useRepo();
  const { plan } = bundle;
  const reduced = useReducedMotion();
  const items = pathStates(plan, progress);
  const itemById = new Map(items.map((item) => [item.lessonId, item]));
  const done = items.filter((item) => item.state === 'done').length;
  const target = continueTarget(plan, progress);
  const targetLesson = target ? plan.lessons[target.lessonId] : undefined;
  const featureById = new Map<string, Feature>(bundle.features.map((feature) => [feature.id, feature]));
  const parts = partsOf(bundle).filter((part) => part.featureIds.some((id) => featureById.get(id)?.entryKind !== 'link'));
  const startPart = Math.max(0, target ? parts.findIndex((part) => part.lessonIds.includes(target.lessonId)) : 0);
  const [selectedPart, setSelectedPart] = useState(startPart);
  const [selectedLesson, setSelectedLesson] = useState<string | undefined>();
  const [play, setPlay] = useState<{ id: string; tour: boolean } | null>(null);
  const [sheet, setSheet] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PART_KEY(bundle.id));
      const found = saved ? parts.findIndex((part) => part.title === saved) : -1;
      if (found >= 0) setSelectedPart(found);
    } catch {
      // Private windows may block storage; the part with the next lesson is a fine start.
    }
    // Only when the repo changes.
  }, [bundle.id]);
  if (!plan.path.length || !parts.length) return <NothingToLearn />;

  const index = Math.min(selectedPart, parts.length - 1);
  const part = parts[index]!;
  const nextPart = parts[index + 1];
  const multi = part.areas.length > 1 || part.areas[0]!.title !== part.title;
  const entries: StrandEntry[] = [];
  const order: { lesson: Lesson; area: LearningArea }[] = [];
  for (const area of part.areas.filter((item) => item.lessonIds.length)) {
    const areaDone = area.lessonIds.filter((id) => itemById.get(id)?.state === 'done').length;
    if (multi) entries.push({ kind: 'station', area, done: areaDone, total: area.lessonIds.length });
    for (const id of area.lessonIds) {
      const lesson = plan.lessons[id];
      const item = itemById.get(id);
      if (!lesson || !item) continue;
      entries.push({ kind: 'lesson', lesson, item, number: plan.path.indexOf(id) + 1, feature: featureById.get(lesson.featureId) });
      order.push({ lesson, area });
    }
  }
  const quiet = part.areas.filter((area) => !area.lessonIds.length && area.featureIds.some((id) => featureById.get(id)?.entryKind !== 'link'));
  const restOf = (area: LearningArea, except?: string) => area.featureIds.map((id) => featureById.get(id)).filter((feature): feature is Feature => !!feature && feature.entryKind !== 'link' && !area.lessonIds.some((lessonId) => plan.lessons[lessonId]?.featureId === feature.id) && feature.id !== except);
  const partDone = part.lessonIds.filter((id) => itemById.get(id)?.state === 'done').length;
  const fallback = order.find(({ lesson }) => itemById.get(lesson.id)?.state === 'next') ?? order.find(({ lesson }) => itemById.get(lesson.id)?.state !== 'done') ?? order[0];
  const current = order.find(({ lesson }) => lesson.id === selectedLesson) ?? fallback;
  const currentItem = current ? itemById.get(current.lesson.id) : undefined;

  const pickPart = (next: number) => {
    setSelectedPart(next);
    setSelectedLesson(undefined);
    setPlay(null);
    try {
      window.localStorage.setItem(PART_KEY(bundle.id), parts[next]!.title);
    } catch {
      // Remembering the part is only a convenience.
    }
  };
  const select = (id: string) => {
    setSelectedLesson(id);
    setPlay({ id, tour: false });
    if (!desktop()) setSheet(true);
  };
  const tour = () => {
    if (play?.tour) return setPlay(null);
    const first = order[0]?.lesson.id;
    if (!first) return;
    setSelectedLesson(first);
    setPlay({ id: first, tour: true });
  };
  const played = () => {
    if (!play?.tour) return setPlay(null);
    const at = order.findIndex(({ lesson }) => lesson.id === play.id);
    const next = order[at + 1]?.lesson.id;
    if (!next) return setPlay(null);
    // A short breath between lessons, so each path can be read.
    window.setTimeout(() => {
      setSelectedLesson(next);
      setPlay((now) => (now?.tour ? { id: next, tour: true } : now));
    }, 450);
  };
  const onKey = (event: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | undefined;
    if (event.key in keys) next = (index + keys[event.key]! + parts.length) % parts.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = parts.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    pickPart(next);
    tabs.current[next]?.focus();
  };

  const inspector = current && currentItem ? (
    <LessonInspector
      key={current.lesson.id}
      lesson={current.lesson}
      item={currentItem}
      number={plan.path.indexOf(current.lesson.id) + 1}
      total={plan.path.length}
      feature={featureById.get(current.lesson.featureId)}
      areaTitle={multi ? current.area.title : part.title}
      rest={restOf(current.area)}
      tips={plan.hiddenLessons.filter((tip) => tip.featureId === current.lesson.featureId)}
      playing={play?.id === current.lesson.id}
      onPlayed={played}
      onReplay={() => setPlay({ id: current.lesson.id, tour: false })}
    />
  ) : null;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] xl:grid-cols-[300px_minmax(0,1fr)_420px] xl:gap-8 2xl:grid-cols-[320px_minmax(0,1fr)_460px]" style={{ '--part': partHue(parts, part.title) } as CSSProperties}>
        {/* 1 · The app and its parts */}
        <aside aria-label="Your app" className="min-w-0 overflow-x-hidden lg:col-span-2 xl:sticky xl:top-8 xl:col-span-1 xl:max-h-[calc(100vh-4rem)] xl:self-start xl:overflow-y-auto xl:pb-4">
          <Eyebrow>{bundle.framework.label}</Eyebrow>
          <h1 className="mt-1.5 break-words text-xl font-semibold leading-tight tracking-tight text-ink xl:text-[24px]">{bundle.name}</h1>
          <p className="mt-3 line-clamp-4 text-[14.5px] leading-relaxed text-muted xl:line-clamp-none">{plan.summary.sentence}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 xl:flex-col xl:items-stretch">
            <div className="flex items-center gap-3">
              <ProgressRing value={done} total={plan.path.length} label="Lessons done" size={44} />
              <div className="text-[13px] leading-tight">
                <p className="font-semibold text-ink">{`${done} of ${plan.path.length} lessons`}</p>
                <p className="text-muted">{done === plan.path.length ? 'All done — well played.' : 'Keep going, one strand at a time.'}</p>
              </div>
            </div>
            {target && targetLesson ? (
              <ButtonLink href={`${base}/learn/${target.lessonId}`} icon="play" className="xl:w-full">
                {target.started ? `Continue: ${targetLesson.title}` : `Start: ${targetLesson.title}`}
              </ButtonLink>
            ) : null}
          </div>

          <p className="mb-3 mt-8 text-[12px] font-semibold uppercase tracking-wider text-muted">Parts of the app</p>
          <div role="tablist" aria-label="Parts of the app" aria-orientation="vertical" onKeyDown={onKey} className="relative flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:gap-1.5 xl:overflow-visible xl:pb-0">
            {/* The parts are joined like stops on a line. */}
            <span className="absolute bottom-7 left-[29px] top-7 hidden w-0.5 rounded-full bg-line xl:block" aria-hidden="true" />
            {parts.map((item, itemIndex) => {
              const active = itemIndex === index;
              const lessons = item.lessonIds.length;
              const itemDone = item.lessonIds.filter((id) => itemById.get(id)?.state === 'done').length;
              return (
                <button
                  key={item.title}
                  ref={(element) => {
                    tabs.current[itemIndex] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`part-tab-${itemIndex}`}
                  aria-selected={active}
                  aria-controls="part-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => pickPart(itemIndex)}
                  style={{ '--part': partHue(parts, item.title) } as CSSProperties}
                  className={cn('relative flex min-h-[60px] shrink-0 items-center gap-3 rounded-2xl border px-2 pr-4 text-left transition-colors', active ? 'border-[rgb(var(--part)/0.45)] bg-[rgb(var(--part)/0.08)] shadow-card' : 'border-transparent bg-surface/60 hover:bg-surface xl:bg-transparent', focus)}
                >
                  <PartRing value={itemDone} total={lessons} icon={partIcon(item.title)} active={active} />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-[15px] font-semibold', active ? 'text-ink' : 'text-ink/85')}>{item.title}</span>
                    <span className="block whitespace-nowrap text-[12.5px] text-muted">{lessons ? `${itemDone}/${lessons} lessons` : 'small details only'}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {plan.summary.dataStored.length ? (
            <p className="mt-5 hidden flex-wrap items-center gap-1.5 text-[12.5px] text-muted xl:flex">
              <Icon name="database" className="h-3.5 w-3.5" /> Stores {plan.summary.dataStored.join(', ')}
            </p>
          ) : null}
          {bundle.limitations.length ? (
            <details className="group mt-4 hidden xl:block">
              <summary className={cn('flex cursor-pointer list-none items-center gap-1.5 rounded-lg text-[12.5px] font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden', focus)}>
                <Icon name="next" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" /> Good to know
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
                {bundle.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </aside>

        {/* 2 · The chosen part as a strand */}
        <section
          role="tabpanel"
          id="part-panel"
          aria-labelledby={`part-tab-${index}`}
          key={part.title}
          className="codedna-slide-in relative min-w-0 overflow-hidden rounded-3xl border border-line bg-surface/70 bg-[radial-gradient(rgb(var(--color-line))_1px,transparent_1px)] p-5 [background-size:20px_20px] sm:p-8"
        >
          <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[80%] -translate-x-1/2 rounded-full bg-[rgb(var(--part)/0.16)] blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-[rgb(var(--part))]">{`Part ${index + 1} of ${parts.length}`}</p>
              <h2 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">{part.title}</h2>
              <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-muted">{multi ? `${plural(part.areas.length, 'area')}: ${part.areas.map((area) => area.title).join(', ')}.` : part.areas[0]!.summary}</p>
            </div>
            <div className="flex items-center gap-3">
              {part.lessonIds.length ? <span className="text-[13px] tabular-nums text-muted">{`${partDone}/${part.lessonIds.length} done`}</span> : null}
              {order.length > 1 ? (
                <button type="button" onClick={tour} className={cn('inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[14.5px] font-semibold transition-opacity', play?.tour ? 'border border-line bg-surface text-ink' : 'bg-[rgb(var(--part))] text-on-accent shadow-card hover:opacity-90', focus)}>
                  <Icon name={play?.tour ? 'pause' : 'play'} className="h-4 w-4" />
                  {play?.tour ? 'Stop' : 'Play the part'}
                </button>
              ) : null}
            </div>
          </div>

          {order.length ? (
            <div className="relative mt-4">
              <DnaPath entries={entries} selectedId={current?.lesson.id} playingId={play?.id} onSelect={select} label={`Lessons in ${part.title}`} reduced={reduced} />
            </div>
          ) : (
            <p className="relative mt-6 rounded-2xl border border-dashed border-line bg-surface p-4 text-[14px] text-muted">No lessons here: this part only has small details, like typing or opening a link.</p>
          )}

          {quiet.length || (!order.length && part.areas.length === 1) ? (
            <div className="relative mt-4 space-y-2">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">{order.length ? `Also in ${part.title}` : 'What’s here'}</p>
              {(quiet.length ? quiet : part.areas).map((area) => (
                <SmallThings key={area.title} features={restOf(area)} label={`${area.title} — ${plural(restOf(area).length, 'small thing')}`} />
              ))}
            </div>
          ) : null}

          {nextPart ? (
            <button type="button" onClick={() => pickPart(index + 1)} className={cn('relative mt-6 flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-[14px] text-muted shadow-card hover:border-accent/50 hover:text-ink', focus)}>
              <span>
                Next part: <span className="font-semibold text-ink">{nextPart.title}</span>
              </span>
              <Icon name="next" className="h-4 w-4" />
            </button>
          ) : null}
        </section>

        {/* 3 · The chosen lesson */}
        <aside aria-label="Lesson details" className="relative hidden overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card lg:sticky lg:top-8 lg:block lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto xl:p-7">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[rgb(var(--part)/0.14)] to-transparent" aria-hidden="true" />
          <div className="absolute inset-x-0 top-0 h-1 bg-[rgb(var(--part))]" aria-hidden="true" />
          <div className="relative">{inspector ?? <p className="text-[14px] text-muted">Pick a lesson on the strand to see it here.</p>}</div>
        </aside>
      </div>

      {/* Phones: the chosen lesson as a bar above the tab bar, opening into a sheet. */}
      {current && currentItem ? (
        <div className="lg:hidden" style={{ '--part': partHue(parts, part.title) } as CSSProperties}>
          {sheet ? (
            <>
              <div className="fixed inset-0 z-40 bg-ink/30" onClick={() => setSheet(false)} aria-hidden="true" />
              <div role="dialog" aria-modal="true" aria-label="Lesson details" className="codedna-sheet-up fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5 pb-8 shadow-lift">
                <div className="mb-3 flex items-center justify-between">
                  <span className="mx-auto h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
                  <button type="button" onClick={() => setSheet(false)} className={cn('absolute right-4 top-4 h-9 rounded-lg px-3 text-[13px] font-medium text-muted hover:text-ink', focus)}>
                    Close
                  </button>
                </div>
                {inspector}
              </div>
            </>
          ) : (
            <div className="fixed inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2.5 pl-3 shadow-lift backdrop-blur-md">
              <button type="button" onClick={() => setSheet(true)} className={cn('min-w-0 flex-1 text-left', focus)}>
                <span className="block text-[11.5px] font-semibold uppercase tracking-wider text-[rgb(var(--part))]">{currentItem.state === 'next' ? 'Up next' : currentItem.state === 'done' ? 'Done' : 'Locked'}</span>
                <span className="block truncate text-[14px] font-semibold text-ink">{current.lesson.title}</span>
              </button>
              {currentItem.state === 'locked' ? (
                <button type="button" onClick={() => setSheet(true)} className={cn('h-10 rounded-xl border border-line px-3 text-[13px] font-medium text-ink', focus)}>
                  Details
                </button>
              ) : (
                <ButtonLink href={`${base}/learn/${current.lesson.id}`} icon="play" className="h-10 min-h-0 px-3 text-[13px]">
                  Start
                </ButtonLink>
              )}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
