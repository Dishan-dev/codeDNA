'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureDiscovery } from '@codedna/shared';

const ROW_HEIGHT = 62;
const WINDOW = 14;
export function FeatureWorkspace({
  discovery,
  selectedId,
  onSelect,
  onSource,
  onArchitecture,
  onSimulation,
}: {
  discovery: FeatureDiscovery;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSource: (path: string, line: number) => void;
  onArchitecture: (path: string) => void;
  onSimulation: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selected =
    discovery.features.find((item) => item.id === selectedId) ??
    discovery.features[0];
  const filtered = useMemo(
    () =>
      discovery.features.filter((item) =>
        `${item.name} ${item.files.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [discovery, query],
  );
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3);
  const visible = filtered.slice(start, start + WINDOW);
  const symbolMap = useMemo(
    () => new Map(discovery.symbols.map((item) => [item.id, item])),
    [discovery],
  );
  useEffect(() => {
    const index = filtered.findIndex((item) => item.id === selectedId);
    if (index >= 0 && listRef.current)
      listRef.current.scrollTop = index * ROW_HEIGHT;
  }, [selectedId, filtered]);
  return (
    <div className="feature-workspace guided-page">
      <header className="guided-heading">
        <span className="guide-eyebrow">03 / FEATURES</span>
        <h2>How is a feature built?</h2>
        <p>
          Choose a detected route or exported function. Connections below come
          from supported static source patterns.
        </p>
      </header>
      <div className="feature-layout">
        <section className="feature-column" aria-label="Feature choices">
          <label htmlFor="feature-search">Find a feature</label>
          <input
            id="feature-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setScrollTop(0);
            }}
            placeholder="Search routes, functions or files"
          />
          <p>{filtered.length} matching entries</p>
          <div
            className="feature-list"
            ref={listRef}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            role="list"
            aria-label="Detected features"
          >
            <div style={{ height: start * ROW_HEIGHT }} aria-hidden="true" />
            {visible.map((item) => (
              <div role="listitem" key={item.id}>
                <button
                  type="button"
                  aria-current={selected?.id === item.id ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <strong>{item.name}</strong>
                  <small>{item.kind}</small>
                </button>
              </div>
            ))}
            <div
              style={{
                height:
                  Math.max(0, filtered.length - start - visible.length) *
                  ROW_HEIGHT,
              }}
              aria-hidden="true"
            />
          </div>
          {!filtered.length && (
            <p>No matches. Try a different name or file path.</p>
          )}
        </section>
        <section
          className="feature-column feature-detail"
          aria-label="Selected feature"
        >
          {selected ? (
            <>
              <span className="guide-eyebrow">SELECTED FEATURE</span>
              <h2>{selected.name}</h2>
              <p>{selected.description.text}</p>
              <p className="guided-muted">
                {selected.kind} · {selected.coverage} ·{' '}
                {selected.routes.length
                  ? selected.routes.join(', ')
                  : 'No route association established'}
              </p>
              <button
                type="button"
                className="guide-action"
                onClick={() => onSimulation(selected.id)}
              >
                Walk through this feature →
              </button>
              <div className="feature-summary">
                <h3>Where it starts</h3>
                {selected.files[0] ? (
                  <button
                    type="button"
                    className="guide-entry"
                    onClick={() => onSource(selected.files[0]!, 1)}
                  >
                    {selected.files[0]} →
                  </button>
                ) : (
                  <p>No source entry is available.</p>
                )}
                <h3>Focused implementation map</h3>
                <div
                  className="feature-flow"
                  aria-label="Focused implementation map"
                >
                  <strong>{selected.name}</strong>
                  {selected.relationships.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        onSource(item.location.path, item.location.start.line)
                      }
                    >
                      {item.kind} →{' '}
                      {symbolMap.get(item.targetId ?? '')?.name ??
                        'source target'}{' '}
                      <small>
                        {item.location.path}:{item.location.start.line}
                      </small>
                    </button>
                  ))}
                  {!selected.relationships.length && (
                    <p>
                      No direct supported symbol relationship was established. A
                      file import does not prove a call.
                    </p>
                  )}
                </div>
              </div>
              <details className="guided-secondary">
                <summary>All files, references and unresolved evidence</summary>
                <h3>Related files</h3>
                {selected.files.map((file) => (
                  <button
                    className="guide-entry"
                    key={file}
                    type="button"
                    onClick={() => onSource(file, 1)}
                  >
                    {file} →
                  </button>
                ))}
                <h3>Symbols</h3>
                {selected.symbols.map((id) => {
                  const symbol = symbolMap.get(id);
                  return (
                    symbol && (
                      <button
                        type="button"
                        className="guide-entry"
                        key={id}
                        onClick={() =>
                          onSource(symbol.file, symbol.location.start.line)
                        }
                      >
                        {symbol.name} · {symbol.kind}{' '}
                        <small>
                          {symbol.file}:{symbol.location.start.line}
                        </small>
                      </button>
                    )
                  );
                })}
                <h3>References</h3>
                {selected.relationships.map((item) => (
                  <button
                    key={item.id}
                    className="guide-entry"
                    type="button"
                    onClick={() =>
                      onSource(item.location.path, item.location.start.line)
                    }
                  >
                    {item.kind} at {item.location.path}:
                    {item.location.start.line}
                  </button>
                ))}
                <h3>Unresolved references</h3>
                {selected.unresolved.length ? (
                  selected.unresolved.map((item) => (
                    <button
                      key={item.id}
                      className="guide-entry"
                      type="button"
                      onClick={() =>
                        onSource(item.location.path, item.location.start.line)
                      }
                    >
                      {item.kind} at {item.location.path}:
                      {item.location.start.line}
                    </button>
                  ))
                ) : (
                  <p>None detected within supported patterns.</p>
                )}
                <button
                  className="guide-more"
                  type="button"
                  onClick={() => onArchitecture(selected.files[0] ?? '')}
                >
                  View its module in Architecture →
                </button>
              </details>
            </>
          ) : (
            <>
              <h2>No supported feature found</h2>
              <p>Try exploring the repository structure in Architecture.</p>
              <button
                className="guide-action"
                type="button"
                onClick={() => onArchitecture('')}
              >
                Explore Architecture →
              </button>
            </>
          )}
          <details className="guided-secondary">
            <summary>Analysis limits</summary>
            <ul>
              {discovery.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
