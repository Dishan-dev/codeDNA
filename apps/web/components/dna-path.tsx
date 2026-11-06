'use client';
import { useEffect, useRef } from 'react';
import { Icon, type PathItem } from '@codedna/learn-ui';
import type { Feature, LearningArea, Lesson } from '@codedna/shared';
import { pageText } from '@/lib/flows';
import { cn } from '@/lib/utils';
import { focus } from './ui';

export type StrandEntry =
  | { kind: 'station'; area: LearningArea; done: number; total: number }
  | { kind: 'lesson'; lesson: Lesson; item: PathItem; number: number; feature: Feature | undefined };

const STATION_H = 80;
const LESSON_H = 128;
const TOP = 32;
/** How far the strand swings from the middle, in % of the width. */
const SWING = 19;

const xOf = (index: number) => 50 + Math.sin(index * 0.95 + 0.55) * SWING;
const STATUS = { done: 'done', next: 'up next', locked: 'locked' } as const;

/**
 * A part's lessons as a strand of DNA: each lesson is a base on a swinging strand, its twin runs
 * mirrored beside it with rungs between, and areas are stations along the way. The strand is
 * coloured up to where you are. Pick a lesson to see it in the inspector.
 */
export function DnaPath({ entries, selectedId, playingId, onSelect, label, reduced }: { entries: StrandEntry[]; selectedId: string | undefined; playingId: string | undefined; onSelect: (lessonId: string) => void; label: string; reduced: boolean }) {
  const nodes = useRef(new Map<string, HTMLButtonElement>());

  // Work out where everything sits: stations are short rows, lessons tall ones.
  let y = TOP;
  let lessonIndex = 0;
  const placed = entries.map((entry) => {
    if (entry.kind === 'station') {
      const at = { entry, y, x: 50 };
      y += STATION_H;
      return at;
    }
    const at = { entry, y: y + LESSON_H / 2, x: xOf(lessonIndex++) };
    y += LESSON_H;
    return at;
  });
  const height = y + TOP;
  const points = placed.filter((item) => item.entry.kind === 'lesson');
  const curve = (mirror: boolean) => {
    const px = (x: number) => (mirror ? 100 - x : x);
    let d = `M50 0`;
    let last = { x: 50, y: 0 };
    for (const point of [...points, { x: 50, y: height }]) {
      const half = (point.y - last.y) / 2;
      d += ` C${px(last.x)} ${last.y + half} ${px(point.x)} ${point.y - half} ${px(point.x)} ${point.y}`;
      last = point;
    }
    return d;
  };
  // Coloured up to the lesson that's next (or the last one done).
  const reachedIndex = points.findIndex((point) => point.entry.kind === 'lesson' && point.entry.item.state === 'next');
  const lastDone = [...points].reverse().find((point) => point.entry.kind === 'lesson' && point.entry.item.state === 'done');
  const progressY = reachedIndex >= 0 ? points[reachedIndex]!.y : lastDone ? lastDone.y : 0;

  useEffect(() => {
    if (!playingId) return;
    nodes.current.get(playingId)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [playingId, reduced]);

  return (
    <div className="relative" style={{ height }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <clipPath id="strand-progress">
            <rect x="0" y="0" width="100" height={progressY} className="transition-[height] duration-700" />
          </clipPath>
        </defs>
        {/* Rungs between the two strands, at every base and halfway between. */}
        {points.map((point, index) => {
          const previous = points[index - 1] ?? { x: 50, y: 0 };
          const midX = (previous.x + point.x) / 2;
          const midY = (previous.y + point.y) / 2;
          return (
            <g key={index} className="stroke-line" vectorEffect="non-scaling-stroke">
              <line x1={point.x} x2={100 - point.x} y1={point.y} y2={point.y} strokeWidth={1.5} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
              {index > 0 ? <line x1={midX} x2={100 - midX} y1={midY} y2={midY} strokeWidth={1} strokeDasharray="2 6" vectorEffect="non-scaling-stroke" /> : null}
            </g>
          );
        })}
        <path d={curve(true)} fill="none" className="stroke-[rgb(var(--part)/0.3)]" strokeWidth={3} vectorEffect="non-scaling-stroke" />
        <path d={curve(false)} fill="none" className="stroke-line" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={curve(false)} fill="none" className="stroke-[rgb(var(--part))]" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" clipPath="url(#strand-progress)" />
      </svg>

      <ol aria-label={label} className="absolute inset-0">
        {placed.map(({ entry, x, y: top }) => {
          if (entry.kind === 'station')
            return (
              <li key={`area:${entry.area.title}`} className="absolute inset-x-0 flex justify-center" style={{ top: top + 18 }}>
                <h3 className="flex items-center gap-2 rounded-full border border-[rgb(var(--part)/0.35)] bg-surface px-4 py-2 text-[14px] font-semibold text-[rgb(var(--part))] shadow-card">
                  {entry.area.title}
                  <span className="rounded-full bg-[rgb(var(--part)/0.12)] px-2 text-[12px] font-semibold tabular-nums">{`${entry.done}/${entry.total}`}</span>
                </h3>
              </li>
            );
          const { lesson, item, number, feature } = entry;
          const selected = lesson.id === selectedId;
          const playing = lesson.id === playingId;
          const left = x < 50;
          const choose = () => onSelect(lesson.id);
          return (
            <li key={lesson.id} className="absolute inset-x-0" style={{ top: top - 34, height: 68 }}>
              <button
                ref={(element) => {
                  if (element) nodes.current.set(lesson.id, element);
                  else nodes.current.delete(lesson.id);
                }}
                type="button"
                onClick={choose}
                aria-current={selected ? 'true' : undefined}
                aria-label={`Lesson ${number}: ${lesson.title}, ${STATUS[item.state]}`}
                className={cn(
                  'absolute top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] text-[17px] font-bold tabular-nums transition-[box-shadow,transform] duration-300',
                  item.state === 'done' && 'border-success bg-success text-on-accent',
                  item.state === 'next' && 'border-[rgb(var(--part))] bg-[rgb(var(--part))] text-on-accent',
                  item.state === 'locked' && 'border-[rgb(var(--part)/0.35)] bg-surface text-[rgb(var(--part))] hover:border-[rgb(var(--part))]',
                  selected && 'scale-110 shadow-[0_0_0_4px_rgb(var(--color-bg)),0_0_0_8px_rgb(var(--part)/0.45)]',
                  focus,
                )}
                style={{ left: `${x}%` }}
              >
                {item.state === 'next' ? <span className="codedna-node-next absolute inset-0 rounded-full" aria-hidden="true" /> : null}
                <span className={cn('relative grid place-items-center', playing && 'codedna-hop-now')}>{item.state === 'done' ? <Icon name="done" className="h-7 w-7" /> : number}</span>
              </button>
              {/* The label is a second, mouse-only way to pick the lesson; the round button is the one for keyboards. */}
              <div
                onClick={choose}
                aria-hidden="true"
                className={cn('absolute top-1/2 max-w-[44%] -translate-y-1/2 cursor-pointer rounded-2xl px-3.5 py-2 transition-colors', left ? 'text-left' : 'text-right', selected ? 'bg-[rgb(var(--part)/0.14)] shadow-[0_0_0_1px_rgb(var(--part)/0.4)]' : 'bg-surface/90 shadow-[0_0_0_1px_rgb(var(--color-line)/0.6)] backdrop-blur-sm hover:bg-surface')}
                style={left ? { left: `calc(${x}% + 46px)` } : { right: `calc(${100 - x}% + 46px)` }}
              >
                <p className={cn('text-[16px] font-semibold leading-snug', item.state === 'locked' && !selected ? 'text-ink/85' : 'text-ink')}>{lesson.title}</p>
                <p className="mt-1 truncate text-[13px] text-muted">
                  {item.state === 'next' ? <span className="font-semibold text-[rgb(var(--part))]">Up next · </span> : null}
                  {`${lesson.minutes} min`}
                  {feature && pageText(feature) ? ` · ${pageText(feature)!.replace(/^On the /, '')}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
