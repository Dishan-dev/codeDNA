'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActionIndex, RepositorySnapshot, TraceStep } from '@codedna/shared';
import { hydrateTrace, visibleSteps } from '@codedna/core/trace-view';
import { TierBadge } from './tier-badge';
import { CodeText } from './code-text';
import { TraceCodePanel } from './trace-code-panel';
import { moveStep } from '@/lib/flow-state';
import { COUNT_ORDER } from '@/lib/tiers';

/** Short "reached only when" note for a conditional step. */
function conditionNote(step: TraceStep, steps: readonly TraceStep[]): string | null {
  const last = step.when?.at(-1);
  if (!last) return null;
  const decision = steps.find((item) => item.branch?.id === last.branchId);
  if (!decision?.branch) return null;
  const condition = decision.branch.condition.replace(/^if \((.*)\)$/, '$1');
  return `Only when ${condition} is ${last.option === 'then' ? 'true' : 'false'}`;
}

/**
 * Action Trace: the static walkthrough for one user action. Steps on the left, the source for the
 * selected step on the right. Step selection and branch choices stay in sync with the URL.
 */
export function ActionTrace({
  index,
  snapshot,
  actionId,
  stepId,
  onStep,
  onPage,
  onPages,
  onReach,
  permalink,
}: {
  index: ActionIndex;
  snapshot: RepositorySnapshot;
  actionId: string;
  stepId: string | undefined;
  onStep: (stepId: string) => void;
  onPage: (pageId: string) => void;
  onPages: () => void;
  onReach: (symbolId: string) => void;
  permalink: (stepId: string | undefined) => string;
}) {
  const action = index.actions.find((item) => item.id === actionId);
  const trace = useMemo(() => (action ? hydrateTrace(index, action.traceId, snapshot.files) : undefined), [index, action, snapshot.files]);
  const [choices, setChoices] = useState<Record<string, 'then' | 'else'>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const rail = useRef<HTMLOListElement>(null);
  useEffect(() => { setChoices({}); setCopied(null); }, [actionId]);
  const steps = useMemo(() => (trace ? visibleSteps(trace.steps, choices) : []), [trace, choices]);
  const ids = useMemo(() => steps.map((step) => step.id), [steps]);
  const current = steps.find((step) => step.id === stepId) ?? steps[0];
  const position = current ? ids.indexOf(current.id) : -1;
  const go = useCallback((delta: 1 | -1) => {
    const next = moveStep(ids, current?.id, delta);
    if (next && next !== current?.id) onStep(next);
  }, [ids, current, onStep]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('[role="menu"]'))) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go]);
  useEffect(() => {
    rail.current?.querySelector('[aria-current="step"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [current?.id]);

  if (!action || !trace)
    return (
      <div className="flow-page">
        <nav className="flow-crumb" aria-label="Breadcrumb"><button type="button" onClick={onPages}>Pages</button></nav>
        <section className="flow-card flow-empty" role="alert">
          <h1>This trace isn’t available</h1>
          <p>The link may come from a different commit or an analysis that has since changed. Pick the action again from its page.</p>
          <button type="button" className="flow-button" onClick={onPages}>Back to pages</button>
        </section>
      </div>
    );

  const hidden = trace.steps.length - steps.length;
  const copy = async () => {
    const link = permalink(current?.id);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
    } catch {
      setCopied(link);
    }
  };
  return (
    <div className="flow-page" data-testid="action-trace">
      <nav className="flow-crumb" aria-label="Breadcrumb">
        <button type="button" onClick={onPages}>Pages</button> / <button type="button" className="flow-mono" onClick={() => onPage(action.pageId)}>{action.pageRoute}</button> / <span aria-current="page">{action.label}</span>
      </nav>
      <div className="flow-row-between flow-row-end">
        <div className="flow-title">
          <h1>{action.label}</h1>
          <div className="flow-meta">
            <span>{trace.steps.length} step{trace.steps.length === 1 ? '' : 's'} ·</span>
            {COUNT_ORDER.filter((tier) => trace.tierCounts[tier]).map((tier) => <TierBadge key={tier} tier={tier} count={trace.tierCounts[tier]} />)}
            <span className="flow-note" data-testid="static-label">
              {trace.commit ? `Static analysis of commit ${trace.commit.slice(0, 12)}` : 'Static analysis of this snapshot (no commit recorded)'} — nothing was executed.
            </span>
          </div>
        </div>
        <div className="flow-controls">
          <button type="button" className="flow-ctrl" onClick={() => go(-1)} disabled={position <= 0}>← Previous</button>
          <span className="flow-note flow-counter" aria-live="polite">Step {position + 1} of {steps.length}</span>
          <button type="button" className="flow-ctrl flow-ctrl--primary" onClick={() => go(1)} disabled={position >= steps.length - 1}>Next →</button>
          <button type="button" className="flow-ctrl" onClick={copy}>Copy link</button>
        </div>
      </div>
      {copied && (
        <p className="flow-copied" role="status">
          <label>Link to this step <input readOnly value={copied} onFocus={(event) => event.currentTarget.select()} data-testid="trace-permalink" /></label>
        </p>
      )}
      {trace.partial && <p className="flow-notice" role="status">{trace.limitations.slice(1).join(' ')}</p>}
      <div className="flow-trace">
        <div className="flow-steps-wrap">
          <ol className="flow-steps" ref={rail} aria-label="Trace steps">
            {steps.map((step, offset) => {
              const isCurrent = step.id === current?.id;
              const nextGap = steps[offset + 1]?.tier === 'gap';
              const note = conditionNote(step, trace.steps);
              return (
                <li key={step.id} className={`flow-step${isCurrent ? ' is-current' : ''}${step.tier === 'gap' ? ' is-gap' : ''}`} style={{ ['--depth' as string]: Math.min(step.depth, 4) }} data-testid="trace-step">
                  <div className="flow-step__rail" aria-hidden="true">
                    <span className="flow-step__dot">{offset + 1}</span>
                    {offset < steps.length - 1 && <span className={`flow-step__line${step.tier === 'gap' || nextGap ? ' is-dashed' : ''}`} />}
                  </div>
                  <div className="flow-step__body">
                    <button type="button" className="flow-step__select" aria-current={isCurrent ? 'step' : undefined} onClick={() => onStep(step.id)}>
                      <span className="flow-step__title"><b>{step.title}</b><TierBadge tier={step.tier} /></span>
                      <code className="flow-step__code">{step.code}</code>
                      <span className="flow-step__plain"><CodeText text={step.plainText} /></span>
                      {note && <span className="flow-step__when">{note}</span>}
                    </button>
                    {step.branch && (
                      <div className="flow-branch" role="group" aria-label={`Branch ${step.branch.condition}`}>
                        <code className="flow-branch__cond">{step.branch.condition}</code>
                        {step.branch.options.map((option) => (
                          <button key={option.id} type="button" aria-pressed={choices[step.branch!.id] === option.id}
                            onClick={() => setChoices((value) => {
                              const next = { ...value };
                              if (next[step.branch!.id] === option.id) delete next[step.branch!.id];
                              else next[step.branch!.id] = option.id;
                              return next;
                            })}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {hidden > 0 && (
            <p className="flow-note">
              {hidden} step{hidden === 1 ? ' is' : 's are'} hidden by your branch choice. <button type="button" className="flow-link" onClick={() => setChoices({})}>Show all paths</button>
            </p>
          )}
          <details className="flow-limits">
            <summary>What this trace can’t tell you</summary>
            <ul>{[...trace.limitations, ...index.limitations.slice(1)].map((text) => <li key={text}>{text}</li>)}</ul>
          </details>
        </div>
        <TraceCodePanel step={current} onReach={onReach} />
      </div>
    </div>
  );
}
