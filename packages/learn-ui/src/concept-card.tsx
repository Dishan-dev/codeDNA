'use client';
import { useState, type ReactNode } from 'react';
import type { Concept, ConceptCheck, ConceptUse } from '@codedna/shared';
import { ChoiceList } from './choice-list.js';
import { CodePanel } from './code-panel.js';
import { RichText } from './rich-text.js';
import { Icon } from './icons.js';
import { CONCEPT_TINT } from './meta.js';

export interface ConceptCardProps {
  concept: Concept;
  check?: ConceptCheck | undefined;
  /** Real places in the learner's app that use this concept. */
  uses: readonly ConceptUse[];
  /** Links to lessons and features that use it, rendered by the host app. */
  related?: ReactNode;
  onChecked?: (correct: boolean) => void;
  headingLevel?: 'h2' | 'h3';
}

/** Name, one-liner, a short explainer, the concept in the learner's own code, why it matters, one mini check. */
export function ConceptCard({ concept, check, uses, related, onChecked, headingLevel: Heading = 'h2' }: ConceptCardProps) {
  const [selected, setSelected] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(false);
  const shown = uses.slice(0, 2);
  const correct = revealed && selected === check?.answerId;
  return (
    <article className="space-y-5">
      <header>
        <p className="flex items-center gap-2 text-sm font-medium text-muted">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CONCEPT_TINT[concept.id] }} aria-hidden="true" />
          Concept · level {concept.level}
        </p>
        <Heading className="mt-1 text-2xl font-semibold tracking-tight text-ink">{concept.name}</Heading>
        <p className="mt-1 text-lg text-muted">{concept.oneLiner}</p>
      </header>
      <p className="max-w-prose text-base leading-relaxed text-ink">{concept.explainer}</p>

      {shown.length ? (
        <section>
          <h3 className="font-semibold text-ink">In your app</h3>
          <div className="mt-2 space-y-3">
            {shown.map((use) => (
              <CodePanel key={`${use.code.path}:${use.code.highlightLine}`} code={use.code} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4">
        <h3 className="flex items-center gap-2 font-semibold text-ink">
          <Icon name="lightbulb" className="h-4 w-4 text-warning" /> Why it matters
        </h3>
        <p className="mt-1 text-[15px] leading-relaxed text-ink">{concept.whyItMatters}</p>
      </section>

      {check ? (
        <section aria-labelledby={`check-${concept.id}`}>
          <h3 id={`check-${concept.id}`} className="font-semibold text-ink">
            Quick check
          </h3>
          <p className="mb-3 mt-1 text-[15px] text-ink">{check.prompt}</p>
          <ChoiceList options={check.options} selected={selected} onSelect={setSelected} revealed={revealed} answerId={check.answerId} label={check.prompt} mono={!!check.code} />
          <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
            {!revealed ? (
              <button
                type="button"
                disabled={!selected}
                onClick={() => {
                  setRevealed(true);
                  onChecked?.(selected === check.answerId);
                }}
                className="min-h-[44px] rounded-xl bg-accent px-5 font-medium text-on-accent hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Check
              </button>
            ) : (
              <>
                <p className={`font-medium ${correct ? 'text-success' : 'text-ink'}`}>{correct ? 'Right!' : 'Not quite — here’s the answer.'}</p>
                <p className="w-full text-[15px] leading-relaxed text-muted">
                  <RichText text={check.explanation} />
                </p>
                {!correct ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRevealed(false);
                      setSelected(undefined);
                    }}
                    className="min-h-[44px] rounded-xl border border-line px-4 font-medium text-ink hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Try again
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}

      {related ? (
        <section>
          <h3 className="font-semibold text-ink">Also used in</h3>
          <div className="mt-2">{related}</div>
        </section>
      ) : null}
    </article>
  );
}
