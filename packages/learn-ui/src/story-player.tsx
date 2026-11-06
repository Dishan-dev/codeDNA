'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Concept, ConceptId, Feature, Step } from '@codedna/shared';
import { ConceptChip, ConfidenceBadge } from './chips.js';
import { CodePanel } from './code-panel.js';
import { Icon } from './icons.js';
import { choicesFor, sequenceRows } from './diagrams/layout.js';
import { Flowchart } from './diagrams/flowchart.js';
import { SequenceDiagram } from './diagrams/sequence-diagram.js';
import { JourneyMap } from './journey-map.js';
import { STAGES, type IconName } from './meta.js';
import { RichText } from './rich-text.js';
import { branchAt, conditionText, defaultChoices, outcomesOf, placesOf, placeText, visibleSteps, zonesOf, type Choices, type Zone } from './story.js';

export interface StoryPlayerProps {
  feature: Feature;
  concepts: Partial<Record<ConceptId, Concept>>;
  /** Called once each time a step is shown. */
  onStepShown?: (step: Step) => void;
  /** Called when the learner reaches the last step of a playthrough. */
  onFinished?: () => void;
  /** Called whenever the position changes: how far along the story the learner is. */
  onProgress?: (position: number, total: number) => void;
  onConceptOpen?: (id: ConceptId) => void;
  autoPlay?: boolean;
  /** Show a short concept note inside the player. Turn off when the host opens a full concept card. */
  inlineConcepts?: boolean;
}

type View = 'journey' | 'sequence' | 'flow';
/** Three ways to see the same playthrough. They share one position, so they play together. */
const VIEWS: { id: View; label: string; icon: IconName; hint: string }[] = [
  { id: 'journey', label: 'Journey', icon: 'client', hint: 'Where each step runs' },
  { id: 'sequence', label: 'Sequence', icon: 'request', hint: 'Who talks to whom, in order' },
  { id: 'flow', label: 'Flowchart', icon: 'branch', hint: 'Every path, with each choice' },
];
const VIEW_KEY = 'codedna:story-view';
/** The last view the learner picked, kept in this browser only; any storage error means the default. */
function savedView(): View {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return value === 'sequence' || value === 'flow' ? value : 'journey';
  } catch {
    return 'journey';
  }
}

const SPEEDS = [0.75, 1, 1.5, 2] as const;
const STEP_MS = 3600;
const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * The Feature Story. A map shows where the story is (browser, server, database…) with a marker
 * that travels between them; below it, one plain caption per step and the real code beside it.
 * At a fork the story stops so the learner picks the path. Keyboard: ← → to move, space to play.
 */
export function StoryPlayer({ feature, concepts, onStepShown, onFinished, onProgress, onConceptOpen, autoPlay = false, inlineConcepts = true }: StoryPlayerProps) {
  const [choices, setChoices] = useState<Choices>(() => defaultChoices(feature));
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const steps = useMemo(() => visibleSteps(feature, choices), [feature, choices]);
  const places = useMemo(() => placesOf(steps), [steps]);
  const zones = useMemo(() => zonesOf(placesOf(feature.steps)), [feature]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [openConcept, setOpenConcept] = useState<ConceptId | undefined>();
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>('journey');
  useEffect(() => setView(savedView()), []);
  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Storage can be blocked; the view still changes for now.
    }
  };
  const startsWithPerson = feature.entryKind !== 'route-handler' && feature.entryKind !== 'server-action';
  const sequence = useMemo(() => sequenceRows(steps, places, startsWithPerson), [steps, places, startsWithPerson]);

  const position = Math.min(index, steps.length - 1);
  const step = steps[position];
  const place = places[position];
  const branch = step ? branchAt(feature, step.id) : undefined;
  const waiting = !!branch && !answered.has(branch.id);
  const atEnd = position >= steps.length - 1;
  const visited = useMemo(() => {
    const zonesSeen = new Set<Zone>();
    for (const item of places.slice(0, position + 1)) for (const zone of 'zone' in item ? [item.zone] : [item.from, item.to]) zonesSeen.add(zone);
    return zonesSeen;
  }, [places, position]);

  const shown = useRef(onStepShown);
  shown.current = onStepShown;
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const progressed = useRef(onProgress);
  progressed.current = onProgress;
  useEffect(() => {
    if (step) shown.current?.(step);
  }, [step]);
  useEffect(() => {
    progressed.current?.(position, steps.length);
  }, [position, steps.length]);
  useEffect(() => {
    if (atEnd && step) {
      setPlaying(false);
      finished.current?.();
    }
  }, [atEnd, step]);

  // Auto-play waits at every fork so the learner decides.
  useEffect(() => {
    if (!playing || atEnd || waiting) return;
    const timer = setTimeout(() => setIndex((value) => value + 1), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [playing, position, atEnd, waiting, speed]);

  const choose = useCallback(
    (branchId: string, outcomeId: string) => {
      setChoices((current) => ({ ...current, [branchId]: outcomeId }));
      setAnswered((current) => new Set(current).add(branchId));
      setIndex(position + 1);
    },
    [position],
  );
  const next = useCallback(() => {
    if (waiting && branch) choose(branch.id, choices[branch.id] ?? branch.outcomes[0]!.id);
    else setIndex(Math.min(position + 1, steps.length - 1));
  }, [waiting, branch, choices, choose, position, steps.length]);
  const back = useCallback(() => setIndex(Math.max(0, position - 1)), [position]);
  /** Jump to any step, even on another path: pick the answers that lead to it. */
  const jumpTo = (target: Step) => {
    const nextChoices = choicesFor(target, choices);
    setChoices(nextChoices);
    setAnswered((current) => {
      const updated = new Set(current);
      for (const item of target.when ?? []) updated.add(item.branchId);
      return updated;
    });
    setPlaying(false);
    setIndex(Math.max(0, visibleSteps(feature, nextChoices).findIndex((item) => item.id === target.id)));
  };
  const replay = () => {
    setChoices(defaultChoices(feature));
    setAnswered(new Set());
    setIndex(0);
    setPlaying(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      back();
    } else if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault();
      setPlaying((value) => !value);
    }
  };

  // Keep the current step dot in view.
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const current = dots.current[position];
    if (current && mounted.current) current.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced ? 'auto' : 'smooth' });
    mounted.current = true;
  }, [position, reduced]);

  if (!step || !place) return <p className="text-muted">This feature has no steps to show yet.</p>;
  const options = branch ? outcomesOf(feature, branch) : [];
  const usual = branch ? defaultChoices(feature)[branch.id] : undefined;
  const progress = ((position + 1) / steps.length) * 100;

  return (
    <section aria-label={`Story: ${feature.title}`} tabIndex={0} onKeyDown={onKeyDown} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {/* Where it is happening */}
      <div className="border-b border-line bg-gradient-to-b from-surface-2/80 to-surface">
        <div className="h-1 bg-line/60" aria-hidden="true">
          <div className={`h-full bg-accent ${reduced ? '' : 'transition-[width] duration-500'}`} style={{ width: `${progress}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-5">
          <div role="tablist" aria-label="Diagram" className="inline-flex gap-1 rounded-xl border border-line bg-surface p-1">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={view === item.id}
                onClick={() => chooseView(item.id)}
                className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium ${focusRing} ${view === item.id ? 'bg-accent text-on-accent' : 'text-muted hover:text-ink'}`}
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted">{VIEWS.find((item) => item.id === view)!.hint}</p>
        </div>
        <div className={view === 'journey' ? 'px-2 pb-6 pt-6 sm:px-8' : 'px-3 pb-6 pt-4 sm:px-8'} role="tabpanel" aria-label={VIEWS.find((item) => item.id === view)!.label}>
          {view === 'journey' ? <JourneyMap zones={zones} place={place} step={step} visited={visited} reduced={reduced} /> : null}
          {view === 'sequence' ? <SequenceDiagram lanes={sequence.lanes} rows={sequence.rows} position={position} personLabel={startsWithPerson ? 'You' : 'Caller'} onSelect={(next) => { setPlaying(false); setIndex(next); }} reduced={reduced} /> : null}
          {view === 'flow' ? <Flowchart feature={feature} visible={steps} current={step} onSelect={jumpTo} reduced={reduced} /> : null}
        </div>
      </div>

      {/* What is happening, and the code that does it */}
      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted" aria-live="polite">
            <span className="rounded-full bg-accent-soft px-3 py-1 font-semibold text-accent">Step {position + 1} of {steps.length}</span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Icon name={STAGES[step.stage].icon} className="h-4 w-4" />
              {placeText(place)}
            </span>
          </div>
          <h2 key={step.id} className="animate-pop mt-4 text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[30px]">
            {step.title}
          </h2>
          {step.confidence === 'gap' ? (
            <div className="mt-3 rounded-xl border border-dashed border-danger/60 bg-danger-soft p-4 text-ink">
              <p className="font-medium">CodeDNA can’t see this part from the code — it’s decided while the app runs.</p>
              <p className="mt-1 text-[15px] leading-relaxed">
                <RichText text={step.unknownReason ?? step.plain} />
              </p>
            </div>
          ) : (
            <p className="mt-3 max-w-prose text-[17px] leading-[1.7] text-ink/90 sm:text-lg">
              <RichText text={step.plain} />
            </p>
          )}

          {branch ? (
            <div className="mt-5 rounded-xl border-2 border-accent/40 bg-accent-soft/60 p-4">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                <Icon name="branch" className="h-5 w-5 text-accent" /> The code asks: <code className="rounded-md border border-line bg-surface px-1.5 font-mono text-sm font-normal">{conditionText(branch)}</code>
              </p>
              <p className="mt-1 text-sm text-muted">{waiting ? 'The story waits here. Pick an answer to see where each one leads.' : 'Pick the other answer to see the other path.'}</p>
              <div className="mt-3 grid gap-2">
                {options.map(({ outcome, next: target }) => {
                  const picked = answered.has(branch.id) && choices[branch.id] === outcome.id;
                  return (
                    <button
                      key={outcome.id}
                      type="button"
                      onClick={() => choose(branch.id, outcome.id)}
                      aria-pressed={picked}
                      className={`flex min-h-[48px] items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-left transition-all hover:-translate-y-px hover:border-accent hover:shadow-card ${focusRing} ${picked ? 'border-accent bg-surface' : 'border-line bg-surface'}`}
                    >
                      <span className="w-9 shrink-0 font-semibold text-ink">{outcome.label}</span>
                      <span className="flex-1 text-[15px] text-muted">{target ? `→ ${target.title}` : '→ nothing more happens'}</span>
                      {outcome.id === usual ? <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">usual path</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step.concepts.length ? (
            <div className="mt-7">
              <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted">Ideas in this step</p>
              <div className="flex flex-wrap gap-2">
                {step.concepts.map((id) => (
                  <ConceptChip
                    key={id}
                    id={id}
                    concept={concepts[id]}
                    pressed={inlineConcepts && openConcept === id}
                    onOpen={(conceptId) => {
                      if (inlineConcepts) setOpenConcept(openConcept === conceptId ? undefined : conceptId);
                      onConceptOpen?.(conceptId);
                    }}
                  />
                ))}
              </div>
              {inlineConcepts && openConcept && concepts[openConcept] ? (
                <div className="mt-3 rounded-xl border border-line bg-surface-2 p-4">
                  <p className="font-semibold text-ink">{concepts[openConcept]!.name}</p>
                  <p className="mt-1 text-sm text-muted">{concepts[openConcept]!.oneLiner}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink">{concepts[openConcept]!.explainer}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <details className="mt-5 lg:hidden">
            <summary className={`inline-flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-lg px-1 font-medium text-accent hover:underline ${focusRing}`}>
              <Icon name="code" className="h-4 w-4" /> Show me the code
            </summary>
            <div className="mt-2">
              <ConfidenceBadge confidence={step.confidence} />
            </div>
            <CodePanel code={step.code} className="mt-2" />
          </details>
        </div>
        <div className="hidden min-w-0 lg:block">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <Icon name="code" className="h-3.5 w-3.5" /> The real code
            </p>
            <ConfidenceBadge confidence={step.confidence} />
          </div>
          <CodePanel code={step.code} />
        </div>
      </div>

      {/* Steps and controls */}
      <div className="border-t border-line bg-surface-2/40 px-4 pb-4 pt-4 sm:px-8">
        <ol className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 py-1" aria-label="Steps">
          {steps.map((item, itemIndex) => {
            const current = itemIndex === position;
            const done = itemIndex < position;
            const unknown = item.confidence === 'gap';
            return (
              <li key={item.id} className="flex shrink-0 items-center gap-1">
                {itemIndex > 0 ? <span className={`h-0.5 w-3 rounded-full ${done || current ? 'bg-accent' : 'bg-line'}`} aria-hidden="true" /> : null}
                <button
                  ref={(element) => void (dots.current[itemIndex] = element)}
                  type="button"
                  onClick={() => setIndex(itemIndex)}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`Step ${itemIndex + 1}: ${item.title}${unknown ? ' (unknown part)' : ''}`}
                  title={item.title}
                  className={[
                    'relative grid h-9 w-9 place-items-center rounded-full border-2 text-[13px] font-semibold tabular-nums transition-all',
                    focusRing,
                    unknown ? 'border-dashed border-danger/70 bg-danger-soft text-danger' : current ? 'border-accent bg-accent text-on-accent' : done ? 'border-accent bg-surface text-accent' : 'border-line bg-surface text-muted hover:border-accent/60',
                  ].join(' ')}
                >
                  {unknown ? '?' : itemIndex + 1}
                  {branchAt(feature, item.id) ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warning" aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-3 flex items-center gap-2">
          <ControlButton label="Back" icon="back" onClick={back} disabled={position === 0} />
          <ControlButton label={playing ? 'Pause' : 'Play'} icon={playing ? 'pause' : 'play'} onClick={() => setPlaying(!playing)} primary disabled={atEnd} />
          <ControlButton label={waiting ? 'Next (usual path)' : 'Next'} icon="next" onClick={next} disabled={atEnd} trailingIcon>
            {waiting ? 'Next' : undefined}
          </ControlButton>
          <span className="ml-2 hidden text-xs text-muted md:inline">Tip: use ← → keys</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={replay} aria-label="Replay" title="Replay" className={`grid h-11 w-11 place-items-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-ink ${focusRing}`}>
              <Icon name="replay" className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
              className={`h-11 min-w-[48px] rounded-lg px-2 text-sm font-medium tabular-nums text-muted transition-colors hover:bg-surface hover:text-ink ${focusRing}`}
              aria-label={`Speed ${speed} times. Change speed`}
            >
              {speed}×
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ControlButton({ label, icon, onClick, disabled, primary, trailingIcon, children }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean; primary?: boolean; trailingIcon?: boolean; children?: ReactNode }) {
  const text = children ?? label;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors sm:px-4 ${focusRing} disabled:cursor-not-allowed disabled:opacity-40 ${primary ? 'bg-accent text-on-accent shadow-card hover:bg-accent/90' : 'border border-line bg-surface text-ink hover:border-accent/60'}`}
    >
      {trailingIcon ? null : <Icon name={icon} className="h-4 w-4" />}
      <span className={primary ? '' : 'hidden sm:inline'}>{text}</span>
      {trailingIcon ? <Icon name={icon} className="h-4 w-4" /> : null}
    </button>
  );
}
