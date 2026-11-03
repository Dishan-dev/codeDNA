'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionIndex } from '@codedna/shared';
import { TierBadge } from './tier-badge';
import { PageRows } from './page-rows';
import { filterActions, groupByComponent, type ActionFilter } from '@/lib/flow-state';
import { tierCount } from '@/lib/tiers';

const PAGE_SIZE = 60;

/** Page Action Inventory: every detected action on one page, grouped by component. */
export function PageInventory({
  index,
  pageId,
  onPage,
  onPages,
  onTrace,
}: {
  index: ActionIndex;
  pageId: string | undefined;
  onPage: (pageId: string) => void;
  onPages: () => void;
  onTrace: (actionId: string) => void;
}) {
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [shown, setShown] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);
  const page = index.pages.find((item) => item.id === pageId);
  const actions = useMemo(() => index.actions.filter((action) => action.pageId === pageId), [index, pageId]);
  const filtered = useMemo(() => filterActions(actions, filter), [actions, filter]);
  useEffect(() => { setShown(PAGE_SIZE); }, [pageId, filter]);
  // Progressive rendering keeps long inventories cheap: more rows mount as the list end scrolls into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || shown >= filtered.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setShown((value) => value + PAGE_SIZE); });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown, filtered.length]);

  if (!page)
    return (
      <div className="flow-page" data-testid="flow-pages">
        <header className="flow-intro"><h1>Pages</h1><p className="flow-lead">Pick a page to see everything a user can do there.</p></header>
        <section className="flow-card"><PageRows pages={index.pages} onPage={onPage} /></section>
      </div>
    );

  const groups = groupByComponent(filtered.slice(0, shown));
  const counts: Record<ActionFilter, number> = { all: actions.length, data: filterActions(actions, 'data').length, gap: filterActions(actions, 'gap').length };
  const api = page.kind === 'api';
  return (
    <div className="flow-page" data-testid="flow-inventory">
      <nav className="flow-crumb" aria-label="Breadcrumb">
        <button type="button" onClick={onPages}>Pages</button> / <span className="flow-mono" aria-current="page">{page.route}</span>
      </nav>
      <div className="flow-row-between flow-row-end">
        <div className="flow-title">
          <h1 className="flow-mono flow-h1-route">{page.route}</h1>
          <p>
            {api ? `${actions.length} route handler${actions.length === 1 ? '' : 's'} no page renders` : `${actions.length} thing${actions.length === 1 ? '' : 's'} a user can do on this page`} · <span className="flow-mono flow-small">{page.file}</span>
          </p>
        </div>
        <div className="flow-filters" role="group" aria-label="Filter actions">
          {(['all', 'data', 'gap'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === 'all' ? 'All' : value === 'data' ? 'Changes data' : 'Has gaps'} {counts[value]}
            </button>
          ))}
        </div>
      </div>
      {!actions.length && <p className="flow-card flow-pad">CodeDNA found no event handlers, form actions or links on this page. Server-rendered pages may have none.</p>}
      {actions.length > 0 && !filtered.length && <p className="flow-card flow-pad">No actions match this filter.</p>}
      <div className="flow-groups">
        {groups.map((group) => (
          <section key={`${group.file}:${group.component}`} className="flow-card" aria-label={`${group.component} in ${group.file}`}>
            <header className="flow-group-head">
              <h2 className="flow-mono">{api ? group.component : `<${group.component}>`}</h2>
              <span className="flow-mono flow-note">{group.file}</span>
            </header>
            <ul className="flow-actions">
              {group.actions.map((action) => (
                <li key={action.id} className="flow-action" data-testid="flow-action">
                  <div className="flow-action__name">
                    <b>{action.label}</b>
                    <code>{action.triggerCode} · line {action.line}</code>
                  </div>
                  <ul className="flow-chips" aria-label="Effects">
                    {action.effects.map((effect) => <li key={effect.evidenceId} className="flow-chip">{effect.label}</li>)}
                    {!action.effects.length && <li className="flow-note">No recognised effects</li>}
                  </ul>
                  <TierBadge tier={action.worstTier} {...(action.gapCount ? { label: tierCount('gap', action.gapCount).toUpperCase() } : {})} />
                  <button type="button" className="flow-go" onClick={() => onTrace(action.id)} aria-label={`Trace ${action.label}`}>Trace →</button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {shown < filtered.length && (
        <div ref={sentinel} className="flow-more">
          <button type="button" className="flow-button" onClick={() => setShown((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filtered.length - shown)} more of {filtered.length - shown}</button>
        </div>
      )}
      <p className="flow-note">
        Actions are found from the code itself (event handlers, form actions, links), so this list covers what CodeDNA supports. Anything it can’t follow is shown as a gap, never left out.
      </p>
    </div>
  );
}
