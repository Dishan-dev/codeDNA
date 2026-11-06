'use client';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Challenge, CodeRef, Step } from '@codedna/shared';
import { ActionBar, buttonClass } from './action-bar.js';
import type { IconName } from './meta.js';
import { Celebration } from './celebration.js';
import { ChoiceList } from './choice-list.js';
import { CodePanel } from './code-panel.js';
import { RichText } from './rich-text.js';
import { Icon } from './icons.js';
import { XP } from './progress.js';

export interface ChallengeViewProps {
  challenge: Challenge;
  /** The lesson's story, to name the steps in an ordering challenge. */
  story: readonly Step[];
  /** Called on every check; the progress store only counts the first answer. */
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
  nextLabel?: string;
}

/** What each kind of challenge is called, and what to do, in one line. */
const KINDS: Record<Challenge['kind'], { label: string; icon: IconName; howTo: string }> = {
  predict: { label: 'Predict', icon: 'lightbulb', howTo: 'Read the highlighted code and guess what happens next.' },
  order: { label: 'Order the steps', icon: 'logic', howTo: 'The steps got mixed up. Put them back in the order they happen.' },
  'spot-bug': { label: 'Spot the bug', icon: 'unknown', howTo: 'Someone changed one line. Compare the two and find what would go wrong.' },
  'fill-gap': { label: 'Fill the gap', icon: 'code', howTo: 'One line is missing. Pick the line that belongs there.' },
};

function OrderList({ ids, setIds, titleOf, revealed, correct }: { ids: string[]; setIds: (ids: string[]) => void; titleOf: (id: string) => string; revealed: boolean; correct: readonly string[] }) {
  const [dragging, setDragging] = useState<number | undefined>();
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setIds(next);
  };
  return (
    <ol className="grid gap-2" aria-label="Steps to put in order">
      {ids.map((id, index) => {
        const right = correct[index] === id;
        return (
          <li
            key={id}
            draggable={!revealed}
            onDragStart={(event: DragEvent) => {
              setDragging(index);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragging !== undefined) move(dragging, index);
              setDragging(undefined);
            }}
            className={[
              'flex min-h-[52px] items-center gap-3 rounded-xl border-2 bg-surface px-3 py-2',
              revealed ? (right ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft') : dragging === index ? 'border-accent' : 'border-line',
              revealed ? '' : 'cursor-grab',
            ].join(' ')}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-sm text-ink" aria-hidden="true">
              {index + 1}
            </span>
            <span className="flex-1 text-[15px] text-ink">{titleOf(id)}</span>
            {revealed ? (
              <span className={`shrink-0 text-sm font-medium ${right ? 'text-success' : 'text-danger'}`}>{right ? 'Right place' : `Should be #${correct.indexOf(id) + 1}`}</span>
            ) : (
              <span className="flex shrink-0 gap-1">
                <button type="button" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Move “${titleOf(id)}” up`} className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30">
                  <Icon name="back" className="h-4 w-4 rotate-90" />
                </button>
                <button type="button" onClick={() => move(index, index + 1)} disabled={index === ids.length - 1} aria-label={`Move “${titleOf(id)}” down`} className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30">
                  <Icon name="next" className="h-4 w-4 rotate-90" />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One challenge per screen: answer, check, get feedback with the real line, try again or move on. */
export function ChallengeView({ challenge, story, onAnswer, onNext, nextLabel = 'Next challenge' }: ChallengeViewProps) {
  const [selected, setSelected] = useState<string | undefined>();
  const [order, setOrder] = useState<string[]>(() => (challenge.kind === 'order' ? [...challenge.stepsShuffled] : []));
  const [revealed, setRevealed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [firstTryRight, setFirstTryRight] = useState(false);
  const [hint, setHint] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const titleOf = (id: string) => story.find((step) => step.id === id)?.title ?? id;
  const kind = KINDS[challenge.kind];

  const isRight = challenge.kind === 'order' ? order.every((id, index) => id === challenge.correct[index]) : selected === challenge.answerId;
  const canCheck = challenge.kind === 'order' || !!selected;

  useEffect(() => {
    if (!revealed) return;
    feedback.current?.focus({ preventScroll: true });
    feedback.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [revealed]);

  const check = () => {
    setRevealed(true);
    if (attempts === 0 && isRight) setFirstTryRight(true);
    setAttempts(attempts + 1);
    onAnswer(isRight);
  };
  const retry = () => {
    setRevealed(false);
    setSelected(undefined);
    if (challenge.kind === 'order') setOrder([...challenge.stepsShuffled]);
  };

  // Keys 1–9 pick an answer; Enter checks it, then tries again or moves on.
  const keys = useRef({ check, retry, onNext, canCheck, revealed, isRight });
  keys.current = { check, retry, onNext, canCheck, revealed, isRight };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      if (event.altKey || event.ctrlKey || event.metaKey || (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const state = keys.current;
      if (/^[1-9]$/.test(event.key) && challenge.kind !== 'order' && !state.revealed) {
        const option = challenge.options[Number(event.key) - 1];
        if (option) setSelected(option.id);
      } else if (event.key === 'Enter' && !(target && ['BUTTON', 'A', 'SUMMARY'].includes(target.tagName))) {
        event.preventDefault();
        if (!state.revealed) {
          if (state.canCheck) state.check();
        } else if (state.isRight) state.onNext();
        else state.retry();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [challenge]);

  const changed: CodeRef | undefined =
    challenge.kind === 'spot-bug'
      ? {
          path: 'Changed copy (not your real code)',
          startLine: challenge.codeRef.startLine,
          endLine: challenge.codeRef.startLine + challenge.mutated.split('\n').length - 1,
          highlightLine: revealed ? challenge.codeRef.startLine + challenge.changedLine - 1 : 0,
          excerpt: challenge.mutated,
        }
      : undefined;

  let status: ReactNode;
  if (!revealed)
    status = (
      <span className="text-muted">
        {challenge.kind === 'order' ? 'Put the steps in order, then check.' : selected ? 'Ready? Check your answer.' : 'Pick an answer.'}
        {challenge.kind === 'order' ? null : <span className="hidden md:inline"> Keys 1–{challenge.options.length} pick, Enter checks.</span>}
      </span>
    );
  else if (isRight) status = <Celebration text="That’s right!" {...(firstTryRight ? { xp: XP.correct } : {})} />;
  else status = <span className="font-medium">Almost — read why above, then try again.</span>;

  return (
    <div>
      <section aria-labelledby={`challenge-${challenge.id}`} className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
            <Icon name={kind.icon} className="h-3.5 w-3.5" />
            {kind.label}
          </p>
          <p className="text-sm text-muted">{kind.howTo}</p>
        </div>
        <h2 id={`challenge-${challenge.id}`} className="mt-4 text-xl font-semibold leading-snug tracking-tight text-ink sm:text-[22px]">
          <RichText text={challenge.prompt} />
        </h2>

        <div className="mt-5 space-y-4">
          {challenge.kind === 'predict' ? <CodePanel code={challenge.codeRef} /> : null}
          {challenge.kind === 'fill-gap' ? <CodePanel code={challenge.codeRef} {...(revealed ? {} : { hiddenLine: challenge.hiddenLine })} /> : null}
          {challenge.kind === 'spot-bug' && changed ? (
            <div className="grid gap-3">
              <CodePanel code={{ ...challenge.codeRef, highlightLine: revealed ? challenge.codeRef.highlightLine : 0 }} label={`Real code · ${challenge.codeRef.path}`} />
              <CodePanel code={changed} label="Changed copy — not your real code" />
            </div>
          ) : null}

          {challenge.kind === 'order' ? (
            <>
              <p className="text-sm text-muted">Drag the steps, or use the up and down buttons. Number 1 happens first.</p>
              <OrderList ids={order} setIds={setOrder} titleOf={titleOf} revealed={revealed} correct={challenge.correct} />
            </>
          ) : (
            <ChoiceList options={challenge.options} selected={selected} onSelect={setSelected} revealed={revealed} answerId={challenge.answerId} label={challenge.prompt} mono={challenge.kind === 'fill-gap'} />
          )}
          {challenge.kind === 'fill-gap' && !revealed ? (
            hint ? (
              <p className="flex items-center gap-1.5 rounded-xl bg-warning-soft/60 px-3 py-2 text-sm text-ink">
                <Icon name="lightbulb" className="h-4 w-4 shrink-0 text-warning" /> <RichText text={challenge.hint} />
              </p>
            ) : (
              <button type="button" onClick={() => setHint(true)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <Icon name="lightbulb" className="h-4 w-4" /> Show a hint
              </button>
            )
          ) : null}
        </div>

        <div ref={feedback} tabIndex={-1} className="outline-none">
          {revealed ? (
            <div className={`animate-pop mt-5 rounded-xl border p-4 ${isRight ? 'border-success/40 bg-success-soft/60' : 'border-warning/40 bg-warning-soft/50'}`}>
              <p className="font-semibold text-ink">{isRight ? 'Why it works' : 'Not quite.'}</p>
              <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-ink">
                <RichText text={challenge.explanation} />
              </p>
              {!isRight && challenge.kind !== 'predict' && challenge.kind !== 'fill-gap' ? (
                <details className="mt-3">
                  <summary className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 font-medium text-accent">
                    <Icon name="code" className="h-4 w-4" /> Show me the real line
                  </summary>
                  <CodePanel code={challenge.codeRef} className="mt-2" />
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <ActionBar tone={!revealed ? 'neutral' : isRight ? 'success' : 'retry'} status={status}>
        {!revealed ? (
          <button type="button" onClick={check} disabled={!canCheck} className={buttonClass('primary')}>
            Check answer
          </button>
        ) : (
          <>
            {!isRight ? (
              <button type="button" onClick={retry} className={buttonClass('primary')}>
                Try again
              </button>
            ) : null}
            <button type="button" onClick={onNext} className={buttonClass(isRight ? 'primary' : 'secondary')}>
              {nextLabel}
            </button>
          </>
        )}
      </ActionBar>
    </div>
  );
}
