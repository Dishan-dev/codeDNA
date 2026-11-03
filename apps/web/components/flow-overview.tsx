'use client';
import type { ActionIndex, RepositoryUnderstanding } from '@codedna/shared';
import { TierBadge } from './tier-badge';
import { CodeText } from './code-text';
import { PageRows } from './page-rows';
import { LEGEND_ORDER, TIER_MEANING } from '@/lib/tiers';

/** Overview: what this is, how much CodeDNA can explain, where to start and where it gets stuck. */
export function FlowOverview({
  repositoryName,
  understanding,
  index,
  onPage,
  onGap,
  onAdvanced,
}: {
  repositoryName: string;
  understanding: RepositoryUnderstanding;
  index: ActionIndex;
  onPage: (pageId: string) => void;
  onGap: (actionId: string, file: string, line: number) => void;
  onAdvanced: () => void;
}) {
  const userActions = index.actions.filter((action) => action.triggerKind !== 'route-handler');
  const pages = index.pages.filter((page) => page.kind === 'page');
  const withGaps = userActions.filter((action) => action.gapCount > 0);
  const followed = userActions.filter((action) => action.worstTier === 'resolved' || action.worstTier === 'conventional').length;
  const guessed = userActions.filter((action) => action.worstTier === 'heuristic').length;
  const intro = understanding.introduction;
  const documented = intro.certainty === 'documented';
  const source = intro.evidence.find((item) => item.location)?.location?.path;
  const stack = [...new Set(understanding.technologies.map((claim) => claim.text.split(' is ')[0]!).filter(Boolean))].slice(0, 6);
  const gapItems = [...index.gaps].sort((a, b) => Number(a.pageRoute === 'API routes') - Number(b.pageRoute === 'API routes'));
  const coverageLabel = `${followed} followed end to end, ${guessed} include best-guess steps, ${withGaps.length} have gaps`;

  return (
    <div className="flow-page" data-testid="flow-overview">
      <header className="flow-intro">
        <h1>{repositoryName}</h1>
        <p className="flow-lead">
          {documented
            ? intro.text
            : `No README describes what ${repositoryName} is for. CodeDNA found ${pages.length} page${pages.length === 1 ? '' : 's'} and ${userActions.length} user action${userActions.length === 1 ? '' : 's'} in its code.`}
        </p>
        <p className="flow-note">
          {documented && source ? `From ${source}` : 'Generated from the detected pages and actions'}
          {stack.length ? ` · ${stack.join(' · ')}` : ''}
        </p>
      </header>

      {!pages.length && (
        <section className="flow-card flow-empty" aria-labelledby="flow-unsupported">
          <h2 id="flow-unsupported">CodeDNA couldn’t find any pages here</h2>
          <p>
            Page and action tracing supports Next.js App Router, React Router, Expo Router and React Navigation apps written in TypeScript or JavaScript.
            {index.apiRoutes ? ` It did find ${index.apiRoutes} API route handler${index.apiRoutes === 1 ? '' : 's'}, listed below.` : ' You can still explore the code structure with the advanced tools.'}
          </p>
          <button type="button" className="flow-button" onClick={onAdvanced}>Open advanced tools</button>
        </section>
      )}

      <div className="flow-stats">
        <div className="flow-card flow-stat"><b>{pages.length}</b><span>pages</span></div>
        <div className="flow-card flow-stat"><b>{userActions.length}</b><span>user actions</span></div>
        <div className="flow-card flow-stat"><b>{index.apiRoutes}</b><span>API routes</span></div>
        <div className="flow-card flow-stat flow-stat--gap"><b>{withGaps.length}</b><span>actions with gaps</span></div>
      </div>

      {userActions.length > 0 && (
        <section className="flow-card flow-coverage" aria-labelledby="flow-coverage-title">
          <div className="flow-row-between">
            <h2 id="flow-coverage-title">How much of this app CodeDNA can explain</h2>
            <span className="flow-note">{userActions.length} actions</span>
          </div>
          <div className="flow-bar" role="img" aria-label={coverageLabel}>
            {followed > 0 && <span className="flow-bar__followed" style={{ flex: followed }} />}
            {guessed > 0 && <span className="flow-bar__guess" style={{ flex: guessed }} />}
            {withGaps.length > 0 && <span className="flow-bar__gap" style={{ flex: withGaps.length }} />}
          </div>
          <p className="flow-coverage__legend">
            <span><b>{followed}</b> followed end to end (proven or framework rule)</span>
            <span><b>{guessed}</b> include best-guess steps</span>
            <span><b>{withGaps.length}</b> have gaps CodeDNA can’t follow</span>
          </p>
        </section>
      )}

      <div className="flow-two">
        <section className="flow-card flow-wide" aria-labelledby="flow-start">
          <div className="flow-card__head">
            <h2 id="flow-start">Start with a page</h2>
            <span className="flow-note">Pick a screen to see everything a user can do there</span>
          </div>
          <PageRows pages={index.pages} onPage={onPage} />
        </section>
        <div className="flow-side">
          <section className="flow-card flow-pad" aria-labelledby="flow-stuck">
            <h2 id="flow-stuck">Where CodeDNA gets stuck</h2>
            {gapItems.length ? (
              <ul className="flow-gaps">
                {gapItems.slice(0, 6).map((item) => (
                  <li key={`${item.actionId}:${item.file}:${item.line}`}>
                    <button type="button" className="flow-gap" onClick={() => onGap(item.actionId, item.file, item.line)}>
                      <b>{item.actionLabel} · {item.pageRoute}</b>
                      <span><CodeText text={item.reason} /></span>
                      <code>{item.file}:{item.line}</code>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flow-note">No gaps in the detected actions. That does not mean every path is covered: see the limits below.</p>
            )}
            {gapItems.length > 6 && <p className="flow-note">{gapItems.length - 6} more gaps are listed on their pages.</p>}
          </section>
          <section className="flow-card flow-pad" aria-labelledby="flow-legend">
            <h2 id="flow-legend">How CodeDNA knows</h2>
            <dl className="flow-legend">
              {LEGEND_ORDER.map((tier) => (
                <div key={tier}>
                  <dt><TierBadge tier={tier} /></dt>
                  <dd>{TIER_MEANING[tier]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <details className="flow-limits">
        <summary>What this analysis can’t tell you</summary>
        <ul>{index.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
      </details>
    </div>
  );
}
