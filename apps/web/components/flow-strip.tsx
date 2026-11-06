'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, RichText } from '@codedna/learn-ui';
import { HOP_SOURCE, type Hop, type HopDetail, type HopKind } from '@/lib/flows';
import { cn } from '@/lib/utils';

/** One look per kind of stop, always with a word and an icon, never colour alone. */
export const HOP_STYLE: Record<HopKind, string> = {
  start: 'border-accent/40 bg-accent-soft text-accent',
  check: 'border-warning/40 bg-warning-soft text-ink',
  logic: 'border-line bg-surface text-ink',
  server: 'border-line bg-surface-2 text-ink',
  data: 'border-success/40 bg-success-soft text-success',
  service: 'border-line bg-surface text-ink',
  unknown: 'border-dashed border-danger/60 bg-danger-soft text-danger',
  end: 'border-accent/30 bg-surface text-ink',
};

const STEP_MS = 520;
const CARD_W = 340;
/** Tallest the list of steps gets before it scrolls inside the card. */
const LIST_MAX = 340;

/** What each kind of stop is, as the card's small heading. */
const KIND_NAME: Record<HopKind, string> = {
  start: 'What the person does',
  check: 'Checks on the way',
  logic: 'The app’s own code',
  server: 'The server',
  data: 'Data',
  service: 'Another service',
  unknown: 'Decided while the app runs',
  end: 'What they see at the end',
};

/** Steps grouped by file, in the order they were traced: [path, steps with their line numbers]. */
function byFile(details: readonly HopDetail[]): [string, (HopDetail & { line: string })[]][] {
  const groups = new Map<string, (HopDetail & { line: string })[]>();
  for (const detail of details) {
    const match = /^(.*):(\d+)$/.exec(detail.where);
    const path = match?.[1] ?? detail.where;
    groups.set(path, [...(groups.get(path) ?? []), { ...detail, line: match?.[2] ?? '' }]);
  }
  return [...groups];
}
/** Roughly how tall the list is, to decide whether it scrolls and where the card fits. */
const listHeight = (details: readonly HopDetail[]) => Math.min(LIST_MAX, details.length * 30 + byFile(details).length * 28);

/**
 * The card behind a stop: what it means, every traced step grouped by file with its line, and how
 * sure it is. Long lists scroll inside the card, which stays open while the pointer is on it.
 */
function HopCard({ hop, id, onEnter, onLeave }: { hop: Hop; id: string; onEnter: () => void; onLeave: () => void }) {
  const groups = byFile(hop.details);
  // With a few steps there's room for the plain-words note under each one.
  const rich = hop.details.length <= 3;
  const scrolls = hop.details.length * 30 + groups.length * 28 > LIST_MAX;
  const files = groups.length;
  return (
    <div id={id} role="tooltip" onMouseEnter={onEnter} onMouseLeave={onLeave} className="codedna-slide-in rounded-2xl border border-line bg-surface p-4 text-left shadow-lift">
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg border', HOP_STYLE[hop.kind])} aria-hidden="true">
          <Icon name={hop.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{KIND_NAME[hop.kind]}</p>
          <p className="truncate text-[14.5px] font-semibold text-ink">{hop.label}</p>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{hop.about}</p>
      {groups.length ? (
        <>
          <div
            tabIndex={scrolls ? 0 : undefined}
            aria-label={scrolls ? `All ${hop.details.length} steps, scrollable` : undefined}
            className={cn('mt-3 overflow-hidden rounded-xl border border-line bg-surface-2/40', scrolls && 'overflow-y-auto overscroll-contain focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent')}
            style={scrolls ? { maxHeight: LIST_MAX } : undefined}
          >
            {groups.map(([path, steps]) => (
              <section key={path}>
                <p className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[11px] font-semibold text-muted" title={path}>
                  <Icon name="code" className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">{path.split('/').pop()}</span>
                  {files > 1 || steps.length > 1 ? <span className="ml-auto shrink-0 font-sans font-medium">{steps.length}</span> : null}
                </p>
                <ol>
                  {steps.map((step, index) => (
                    <li key={`${step.where}:${index}`} className="flex items-baseline gap-3 border-b border-line/60 px-3 py-1.5 last:border-b-0">
                      <span className="min-w-0 flex-1">
                        <span className={step.code ? 'block break-words font-mono text-[12px] leading-snug text-ink' : 'block text-[13px] font-medium leading-snug text-ink'}>{step.label}</span>
                        {rich && step.note && !step.code ? (
                          <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                            <RichText text={step.note} />
                          </span>
                        ) : null}
                      </span>
                      {step.line ? <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{`line ${step.line}`}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] text-muted">
            {`${hop.details.length} step${hop.details.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}`}
            {scrolls ? ' · scroll to see them all' : ''}
          </p>
        </>
      ) : null}
      <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-[11.5px] leading-snug text-muted">
        <Icon name={hop.kind === 'unknown' ? 'unknown' : 'code'} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {HOP_SOURCE[hop.kind]}
      </p>
    </div>
  );
}

/**
 * One stop on a flow's path. Point at it, focus it or tap it to see the card with the evidence
 * behind it; Escape closes the card. The card floats above everything and stays on screen.
 */
export function HopPill({ hop, state = 'idle', compact }: { hop: Hop; state?: 'idle' | 'reached' | 'now' | 'ahead'; compact?: boolean }) {
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);
  const id = useId();
  const open = place !== null;

  const measure = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - CARD_W - 12);
    const below = window.innerHeight - rect.bottom;
    // Roughly how tall the card will be, so it opens on the side with room for it.
    const height = 190 + listHeight(hop.details);
    const above = below < height && rect.top > below;
    setPlace({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
  };
  const cancel = () => window.clearTimeout(timer.current);
  const show = (delay = 120) => {
    cancel();
    timer.current = window.setTimeout(measure, delay);
  };
  const enter = () => {
    hovering.current = true;
    cancel();
  };
  const leave = () => {
    hovering.current = false;
    hide();
  };
  const hide = () => {
    cancel();
    timer.current = window.setTimeout(() => setPlace(null), 160);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPlace(null);
        button.current?.focus();
      }
    };
    const scrolled = (event: Event) => {
      const card = document.getElementById(id);
      if (card && event.target instanceof Node && card.contains(event.target)) return;
      close();
    };
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', key);
    };
  }, [open, id]);
  useEffect(() => cancel, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => {
          hovering.current = true;
          show();
        }}
        onMouseLeave={leave}
        onFocus={() => show(0)}
        onBlur={() => {
          if (!hovering.current) hide();
        }}
        onClick={() => (open ? setPlace(null) : show(0))}
        className={cn(
          'inline-flex cursor-help items-center gap-1.5 rounded-full border font-medium transition-shadow duration-300 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          compact ? 'min-h-[26px] px-2 text-[11.5px]' : 'min-h-[30px] px-2.5 text-[12px]',
          HOP_STYLE[hop.kind],
          state === 'now' && 'codedna-hop-now shadow-lift ring-2 ring-accent/60 ring-offset-1 ring-offset-surface',
          state === 'reached' && 'ring-1 ring-accent/30',
        )}
      >
        <Icon name={hop.icon} className={cn('shrink-0', compact ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
        <span className={cn('truncate', compact ? 'max-w-[150px]' : 'max-w-[220px]')}>{hop.label}</span>
      </button>
      {place
        ? createPortal(
            <div className="fixed z-[60]" style={{ left: place.left, top: place.top, width: CARD_W, transform: place.above ? 'translateY(-100%)' : undefined }}>
              <HopCard hop={hop} id={id} onEnter={enter} onLeave={leave} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener?.('change', change);
    return () => query.removeEventListener?.('change', change);
  }, []);
  return reduced;
}

/**
 * The line a flow takes, as a small simulation: when `playing` turns on, a pulse walks from what
 * the person does to where it ends, one stop at a time, filling the track behind it. At rest every
 * stop is shown plainly. Colour changes only through rings and shadows, so text contrast never
 * dips mid-animation.
 */
export function FlowStrip({ hops, playing = false, onDone, compact, label }: { hops: Hop[]; playing?: boolean; onDone?: () => void; compact?: boolean; label: string }) {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(-1);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!playing) {
      setLit(-1);
      return;
    }
    if (reduced) {
      setLit(hops.length - 1);
      const timer = window.setTimeout(() => done.current?.(), 400);
      return () => window.clearTimeout(timer);
    }
    setLit(0);
    let index = 0;
    const timer = window.setInterval(() => {
      index++;
      if (index < hops.length) setLit(index);
      else {
        window.clearInterval(timer);
        done.current?.();
      }
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [playing, reduced, hops.length]);

  const stateOf = (index: number) => (lit < 0 ? 'idle' : index < lit ? 'reached' : index === lit ? 'now' : 'ahead');
  return (
    <ol className="flex flex-wrap items-center gap-y-2" aria-label={label}>
      {hops.map((hop, index) => (
        // The track sits inside the item, so it wraps onto the next line with its stop.
        <li key={`${hop.kind}:${hop.label}`} className="flex items-center" aria-current={stateOf(index) === 'now' ? 'step' : undefined}>
          {index > 0 ? (
            <span className={cn('relative mx-1 block h-[3px] overflow-hidden rounded-full bg-line', compact ? 'w-3 sm:w-4' : 'w-4 sm:w-6')} aria-hidden="true">
              <span className={cn('absolute inset-0 origin-left rounded-full bg-accent transition-transform ease-out', lit >= index ? 'scale-x-100' : 'scale-x-0')} style={{ transitionDuration: `${reduced ? 0 : STEP_MS - 120}ms` }} />
            </span>
          ) : null}
          <HopPill hop={hop} state={stateOf(index)} compact={!!compact} />
        </li>
      ))}
    </ol>
  );
}
