'use client';
import { useMemo } from 'react';
import type { ActionIndex, FeatureDiscovery } from '@codedna/shared';
import { reverseReach } from '@codedna/core/trace-view';
import { TierBadge } from './tier-badge';
import { CodeText } from './code-text';

/** Who reaches this? Every detected user action that reaches a function, and what can't be resolved. */
export function ReachView({
  index,
  symbolId,
  features,
  onTrace,
  onOverview,
}: {
  index: ActionIndex;
  symbolId: string | undefined;
  features: FeatureDiscovery;
  onTrace: (actionId: string, stepId: string) => void;
  onOverview: () => void;
}) {
  const reach = useMemo(() => (symbolId ? reverseReach(index, symbolId, features.relationships, features.symbols) : undefined), [index, symbolId, features]);
  if (!reach)
    return (
      <div className="flow-page">
        <nav className="flow-crumb" aria-label="Breadcrumb"><button type="button" onClick={onOverview}>Overview</button> / Who reaches this?</nav>
        <section className="flow-card flow-empty" role="alert">
          <h1>No traced function selected</h1>
          <p>Open a trace and choose “Who else reaches this?” on a step that calls a function.</p>
        </section>
      </div>
    );
  const userRows = reach.actions;
  const pageCount = reach.pages.filter((page) => page !== 'API routes').length;
  return (
    <div className="flow-page" data-testid="reach-view">
      <nav className="flow-crumb" aria-label="Breadcrumb"><button type="button" onClick={onOverview}>Overview</button> / Who reaches this?</nav>
      <div className="flow-title">
        <h1>Who reaches <span className="flow-mono flow-h1-symbol">{reach.symbol}()</span>?</h1>
        <p>
          <span className="flow-mono flow-small">{reach.file}:{reach.line}</span> · {userRows.length} action{userRows.length === 1 ? '' : 's'} reach{userRows.length === 1 ? 'es' : ''} this function
          {reach.unresolvedCallers.length ? `, plus ${reach.unresolvedCallers.length} caller${reach.unresolvedCallers.length === 1 ? '' : 's'} CodeDNA can’t resolve` : ''}.
        </p>
      </div>
      {reach.pages.length > 0 && (
        <div className="flow-card flow-impact">
          <b>Changing this function affects:</b>
          <ul className="flow-chips" aria-label="Affected pages">{reach.pages.map((page) => <li key={page} className="flow-chip">{page}</li>)}</ul>
          <span className="flow-note">— {pageCount} page{pageCount === 1 ? '' : 's'}{reach.pages.length > pageCount ? ' and API routes' : ''}, {userRows.length} action{userRows.length === 1 ? '' : 's'}</span>
        </div>
      )}
      {reach.partial && <p className="flow-notice" role="status">The analysis is partial or a trace hit a limit, so some callers may be missing.</p>}
      <ul className="flow-card flow-actions" aria-label="Actions that reach this function">
        {userRows.map((row) => (
          <li key={row.actionId} className="flow-action" data-testid="reach-row">
            <div className="flow-action__name"><b>{row.label}</b><code>{row.pageRoute}</code></div>
            <ol className="flow-path" aria-label="Path">
              {row.path.map((label, offset) => <li key={`${offset}:${label}`} className={offset === row.path.length - 1 ? 'is-end' : ''}>{label}</li>)}
            </ol>
            <TierBadge tier={row.tier} />
            <button type="button" className="flow-go" onClick={() => onTrace(row.actionId, row.stepId)} aria-label={`Trace ${row.label}`}>Trace →</button>
          </li>
        ))}
        {reach.unresolvedCallers.map((caller) => (
          <li key={`${caller.file}:${caller.line}`} className="flow-action is-gap" data-testid="reach-gap">
            <div className="flow-action__name"><b className="flow-gap-text">Unresolved caller</b><code>{caller.file}:{caller.line}</code></div>
            <p className="flow-action__reason"><CodeText text={caller.reason} /></p>
            <TierBadge tier="gap" />
          </li>
        ))}
        {!userRows.length && !reach.unresolvedCallers.length && <li className="flow-pad flow-note">No detected user action reaches this function.</li>}
      </ul>
      {reach.otherCallers.length > 0 && (
        <details className="flow-limits">
          <summary>{reach.otherCallers.length} other static caller{reach.otherCallers.length === 1 ? '' : 's'} no detected action reaches</summary>
          <ul>{reach.otherCallers.map((caller) => <li key={`${caller.file}:${caller.line}`}><code>{caller.name}</code> at {caller.file}:{caller.line}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
