import type { TraceStep } from '@codedna/shared';
import { TIER_LABEL } from '@/lib/tiers';
import { CodeText } from './code-text';

/** Source for the selected step: excerpt with the step line highlighted, tier and why. */
export function TraceCodePanel({ step, onReach }: { step: TraceStep | undefined; onReach: (symbolId: string) => void }) {
  if (!step) return <aside className="flow-code" aria-label="Source for the selected step"><p className="flow-code__empty">Select a step to see its source.</p></aside>;
  return (
    <aside className="flow-code" aria-label="Source for the selected step" data-testid="trace-code">
      <div className="flow-code__head">
        <span>{step.file} · line {step.line}</span>
        <span>{TIER_LABEL[step.tier]}</span>
      </div>
      {step.excerpt.lines.length ? (
        <pre className="flow-code__body" tabIndex={0} aria-label={`${step.file}, lines ${step.excerpt.startLine} to ${step.excerpt.startLine + step.excerpt.lines.length - 1}`}>
          {step.excerpt.lines.map((line, offset) => {
            const number = step.excerpt.startLine + offset;
            const current = number === step.line;
            return (
              <span key={number} className={`flow-code__line${current ? ' is-current' : ''}`} {...(current ? { 'aria-current': 'true' as const } : {})}>
                <i aria-hidden="true">{number}</i>{line || ' '}
              </span>
            );
          })}
        </pre>
      ) : (
        <p className="flow-code__empty">The source for {step.file} is not in this snapshot.</p>
      )}
      <div className="flow-code__foot">
        <span><CodeText text={step.why} /></span>
        {step.possibleTargets?.length ? <span>Possible targets: {step.possibleTargets.map((target) => target.name ? `${target.name} (${target.file})` : target.file).join(', ')}</span> : null}
        {step.symbol && (
          <button type="button" className="flow-code__reach" onClick={() => onReach(step.symbol!.id)}>Who else reaches {step.symbol.name}? →</button>
        )}
      </div>
    </aside>
  );
}
