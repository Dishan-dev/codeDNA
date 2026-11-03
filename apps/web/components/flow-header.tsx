'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ActionIndex } from '@codedna/shared';
import { searchIndex, type SearchHit } from '@codedna/core/trace-view';

export interface AdvancedItem { id: string; label: string; hint: string }

/** Disclosure menu for the developer tools that are no longer in the primary flow. */
export function AdvancedMenu({ items, onSelect }: { items: AdvancedItem[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (event: MouseEvent) => { if (!list.current?.parentElement?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const entries = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); entries[(index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus(); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); entries[event.key === 'Home' ? 0 : entries.length - 1]?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  };
  return (
    <div className="flow-menu">
      <button ref={button} type="button" className="flow-hbtn" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Advanced tools <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul id={id} ref={list} role="menu" aria-label="Advanced tools" className="flow-menu__list" onKeyDown={onKey}>
          {items.map((item) => (
            <li key={item.id} role="none">
              <button type="button" role="menuitem" onClick={() => { setOpen(false); onSelect(item.id); }}>
                {item.label}<small>{item.hint}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search actions, pages and traced functions. */
export function ActionSearch({ index, onHit }: { index: ActionIndex | undefined; onHit: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState('');
  const results = useRef<HTMLUListElement>(null);
  const hits = index ? searchIndex(index, query) : [];
  const listId = useId();
  const choose = (hit: SearchHit) => { setQuery(''); onHit(hit); };
  return (
    <div className="flow-search" role="search">
      <label htmlFor={`${listId}-input`} className="sr-only">Search actions</label>
      <input id={`${listId}-input`} type="search" autoComplete="off" value={query} disabled={!index}
        placeholder={index ? 'Search actions, pages and functions' : 'Search is unavailable for this session'}
        aria-controls={hits.length ? listId : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
          if (event.key === 'ArrowDown' && hits.length) { event.preventDefault(); results.current?.querySelector('button')?.focus(); }
          if (event.key === 'Enter' && hits[0]) choose(hits[0]);
        }} />
      {query.trim() && (
        <ul id={listId} ref={results} className="flow-search__results" aria-label="Search results"
          onKeyDown={(event) => {
            const buttons = [...(results.current?.querySelectorAll('button') ?? [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
            if (event.key === 'Escape') setQuery('');
          }}>
          {hits.map((hit) => (
            <li key={`${hit.kind}:${hit.actionId ?? hit.pageId ?? hit.symbolId}`}>
              <button type="button" onClick={() => choose(hit)}><span>{hit.label}</span><span className="flow-mono flow-note">{hit.detail}</span></button>
            </li>
          ))}
          {!hits.length && <li className="flow-note flow-search__none">No matching actions, pages or functions.</li>}
        </ul>
      )}
    </div>
  );
}
