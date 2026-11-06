'use client';
import { useEffect, useRef, useState } from 'react';
import type { Concept, ConceptCheck, ConceptUse } from '@codedna/shared';
import { ActionBar, buttonClass } from './action-bar.js';
import { ChoiceList } from './choice-list.js';
import { CodePanel } from './code-panel.js';
import { Icon } from './icons.js';
import { CONCEPT_TINT } from './meta.js';
import { RichText } from './rich-text.js';

export interface ConceptStepsProps {
  concept: Concept;
  check?: ConceptCheck | undefined;
  /** Real places in the learner's app that use this concept, this lesson's first. */
  uses: readonly ConceptUse[];
  onChecked?: (correct: boolean) => void;
  /** Called when the learner finishes this idea. */
  onDone: () => void;
  doneLabel: string;
}

type Phase = 'idea' | 'code' | 'check';
const PHASE_LABEL: Record<Phase, string> = { idea: 'The idea', code: 'In your app', check: 'Quick check' };

/**
 * One concept, taught in three short screens: the idea in plain words, where it is in the
 * learner's own code, then a quick check. The check sits on its own screen, so the answer
 * isn't on show while the learner answers.
 */
export function ConceptSteps({ concept, check, uses, onChecked, onDone, doneLabel }: ConceptStepsProps) {
  const phases: Phase[] = ['idea', ...(uses.length ? (['code'] as const) : []), ...(check ? (['check'] as const) : [])];
  const [phase, setPhase] = useState<Phase>('idea');
  const [reached, setReached] = useState(0);
  const [selected, setSelected] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(false);
  const answer = useRef<HTMLDivElement>(null);
  // Bring the answer into view: it can sit below the bar at the bottom of the window.
  useEffect(() => {
    if (revealed) answer.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [revealed]);
  const at = phases.indexOf(phase);
  const go = (next: Phase) => {
    setPhase(next);
    setReached((value) => Math.max(value, phases.indexOf(next)));
  };
  const nextPhase = phases[at + 1];
  const right = revealed && selected === check?.answerId;
  const tint = CONCEPT_TINT[concept.id];

  return (
    <div>
      <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-4 sm:px-7">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: tint }} aria-hidden="true">
            {concept.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-ink">{concept.name}</h2>
            <p className="text-sm text-muted">Level {concept.level} idea</p>
          </div>
          <ol className="flex items-center gap-1" aria-label="Parts of this idea">
            {phases.map((item, index) => {
              const current = item === phase;
              const done = index < at || (index <= reached && !current);
              return (
                <li key={item} className="flex items-center gap-1">
                  {index > 0 ? <span className={`h-0.5 w-4 rounded-full ${index <= reached ? 'bg-accent' : 'bg-line'}`} aria-hidden="true" /> : null}
                  <button
                    type="button"
                    onClick={() => go(item)}
                    disabled={index > reached}
                    aria-current={current ? 'step' : undefined}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed ${current ? 'bg-accent text-on-accent' : done ? 'bg-accent-soft text-accent hover:bg-accent-soft/70' : 'bg-surface-2 text-muted'}`}
                  >
                    {done ? <Icon name="done" className="h-3.5 w-3.5" /> : <span aria-hidden="true">{index + 1}</span>}
                    <span className={current ? '' : 'hidden sm:inline'}>{PHASE_LABEL[item]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        <div key={phase} className="animate-pop p-5 sm:p-7">
          {phase === 'idea' ? (
            <div className="space-y-5">
              <p className="text-2xl font-semibold leading-snug tracking-tight text-ink">
                {concept.oneLiner}
              </p>
              <p className="max-w-prose text-[17px] leading-relaxed text-ink/90">{concept.explainer}</p>
              <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft/40 p-4">
                <Icon name="lightbulb" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <p className="font-semibold text-ink">Why it matters</p>
                  <p className="mt-0.5 text-[15px] leading-relaxed text-ink">{concept.whyItMatters}</p>
                </div>
              </div>
            </div>
          ) : null}

          {phase === 'code' ? (
            <div className="space-y-4">
              <p className="text-[17px] leading-relaxed text-ink">
                Here’s <strong>{concept.name.toLowerCase()}</strong> in your own app. The highlighted line is the part to look at.
              </p>
              {uses.slice(0, 2).map((use) => (
                <CodePanel key={`${use.code.path}:${use.code.highlightLine}`} code={use.code} />
              ))}
            </div>
          ) : null}

          {phase === 'check' && check ? (
            <section aria-labelledby={`check-${concept.id}`} className="space-y-4">
              <h3 id={`check-${concept.id}`} className="text-xl font-semibold leading-snug text-ink">
                {check.prompt}
              </h3>
              <ChoiceList options={check.options} selected={selected} onSelect={setSelected} revealed={revealed} answerId={check.answerId} label={check.prompt} mono={!!check.code} />
              {revealed ? (
                <div ref={answer} className={`animate-pop rounded-xl border p-4 ${right ? 'border-success/40 bg-success-soft/60' : 'border-warning/40 bg-warning-soft/50'}`}>
                  <p className="font-semibold text-ink">{right ? 'Right!' : 'Not quite — here’s the answer.'}</p>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink">
                    <RichText text={check.explanation} />
                  </p>
                  {check.code ? <CodePanel code={check.code} className="mt-3" /> : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </article>

      <ActionBar
        tone={phase === 'check' && revealed ? (right ? 'success' : 'retry') : 'neutral'}
        status={
          phase === 'idea' ? (
            <span className="text-muted">{nextPhase === 'code' ? 'Next: see it in your own code.' : nextPhase === 'check' ? 'Next: a quick check.' : 'That’s the idea.'}</span>
          ) : phase === 'code' ? (
            <span className="text-muted">{check ? 'Next: a quick check to make it stick.' : 'That’s where it lives in your app.'}</span>
          ) : revealed ? (
            <span className="font-medium">{right ? 'Nice — you’ve got this idea.' : 'Read the answer, then try again or move on.'}</span>
          ) : (
            <span className="text-muted">{selected ? 'Ready? Check your answer.' : 'Pick an answer.'}</span>
          )
        }
      >
        {phase !== 'check' ? (
          <button type="button" onClick={() => (nextPhase ? go(nextPhase) : onDone())} className={buttonClass('primary')}>
            {nextPhase === 'code' ? 'Show me in my app' : nextPhase === 'check' ? 'Check myself' : doneLabel}
            {nextPhase ? <Icon name="next" className="h-4 w-4" /> : null}
          </button>
        ) : !revealed ? (
          <>
            <button type="button" onClick={onDone} className={buttonClass('quiet')}>
              Skip
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => {
                setRevealed(true);
                onChecked?.(selected === check?.answerId);
              }}
              className={buttonClass('primary')}
            >
              Check
            </button>
          </>
        ) : (
          <>
            {!right ? (
              <button
                type="button"
                onClick={() => {
                  setRevealed(false);
                  setSelected(undefined);
                }}
                className={buttonClass('secondary')}
              >
                Try again
              </button>
            ) : null}
            <button type="button" onClick={onDone} className={buttonClass('primary')}>
              {doneLabel}
            </button>
          </>
        )}
      </ActionBar>
    </div>
  );
}
