'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { buildStaticFlow } from '@codedna/core/static-flow';
import type {
  FeatureDiscovery,
  RepositorySnapshot,
  SourceLocation,
} from '@codedna/shared';
import { advanceStaticFlow } from '@/lib/static-playback';

function SourceExcerpt({
  snapshot,
  location,
}: {
  snapshot: RepositorySnapshot;
  location: SourceLocation;
}) {
  const source = useMemo(
    () => snapshot.files.find((item) => item.path === location.path),
    [snapshot, location.path],
  );
  const lines = useMemo(() => source?.content.split(/\r?\n/) ?? [], [source]);
  if (!source)
    return (
      <p>Source text for {location.path} is unavailable in this snapshot.</p>
    );
  const last =
    location.end.column === 1 && location.end.line > location.start.line
      ? location.end.line - 1
      : location.end.line;
  const start = Math.max(0, location.start.line - 5),
    end = Math.min(lines.length, last + 4);
  return (
    <pre className="simulation-source">
      <code>
        {lines.slice(start, end).map((line, index) => {
          const number = start + index + 1;
          return (
            <span
              key={number}
              className={
                number >= location.start.line && number <= last
                  ? 'source-line-highlight'
                  : undefined
              }
            >
              <span className="simulation-line-number">{number}</span>
              {line}
              {'\n'}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
export function SimulationWorkspace({
  discovery,
  snapshot,
  featureId,
  complete,
  onFeature,
  onBackFeatures,
  onBackArchitecture,
}: {
  discovery: FeatureDiscovery;
  snapshot: RepositorySnapshot;
  featureId: string | null;
  complete: boolean;
  onFeature: (id: string) => void;
  onBackFeatures: () => void;
  onBackArchitecture: (path: string) => void;
}) {
  const activeId = featureId ?? discovery.features[0]?.id ?? '';
  const feature = discovery.features.find((item) => item.id === activeId);
  const flow = useMemo(
    () => buildStaticFlow(discovery, activeId, { snapshotComplete: complete }),
    [discovery, activeId, complete],
  );
  const [trail, setTrail] = useState<string[]>(() =>
    flow.steps[0] ? [flow.steps[0].id] : [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () => flow.steps[0]?.id ?? null,
  );
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    setTrail(flow.steps[0] ? [flow.steps[0].id] : []);
    setSelectedId(flow.steps[0]?.id ?? null);
    setChoices({});
    setPlaying(false);
  }, [flow.id, flow.steps]);
  const steps = useMemo(
    () => new Map(flow.steps.map((step) => [step.id, step])),
    [flow],
  );
  const current = steps.get(trail.at(-1) ?? '');
  const selected = steps.get(selectedId ?? '') ?? current;
  const branches = current?.branches ?? [];
  const chosen =
    branches.length === 1
      ? branches[0]
      : branches.find((item) => item.id === choices[current?.id ?? '']);
  const advance = useCallback(() => {
    const next = advanceStaticFlow(flow, trail, choices);
    if (next.reason === 'advanced' || next.reason === 'cycle') {
      setTrail(next.trail);
      setSelectedId(next.trail.at(-1) ?? null);
    }
    if (next.reason !== 'advanced') setPlaying(false);
  }, [flow, choices, trail]);
  useEffect(() => {
    if (!playing) return;
    if (!chosen || trail.length >= 100) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(advance, 1100 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, chosen, trail, speed, advance]);
  const previous = () => {
    if (trail.length <= 1) return;
    setPlaying(false);
    setTrail((items) => items.slice(0, -1));
    setSelectedId(trail.at(-2) ?? null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      advance();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    }
    if (event.key === ' ') {
      event.preventDefault();
      setPlaying((value) => !value);
    }
  };
  const relation = flow.relationships
    .concat(flow.unresolved)
    .find((item) => item.id === selected?.relationshipId);
  return (
    <div
      className="simulation-workspace guided-page"
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Static Walkthrough"
    >
      <header className="guided-heading simulation-header">
        <nav aria-label="Walkthrough location">
          <button type="button" onClick={onBackFeatures}>
            Features
          </button>
          <span>›</span>
          <strong>{feature?.name ?? 'Static Walkthrough'}</strong>
        </nav>
        <h2>Follow a source-backed path</h2>
        <p>
          Static references only. Repository code is not executed; this is not
          runtime order.
        </p>
      </header>
      <div className="simulation-main">
        <label htmlFor="simulation-feature">Feature to explore</label>
        <select
          id="simulation-feature"
          value={activeId}
          onChange={(event) => onFeature(event.target.value)}
        >
          <option value="" disabled>
            Select an entry
          </option>
          {discovery.features.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.kind}
            </option>
          ))}
        </select>
        {current ? (
          <>
            <div className="simulation-focus" role="status">
              <span className="guide-eyebrow">
                STEP {trail.length} / STATIC PATH
              </span>
              <h3>
                {current.symbolId
                  ? (discovery.symbols.find(
                      (symbol) => symbol.id === current.symbolId,
                    )?.name ?? 'Source symbol')
                  : 'Entry file'}
              </h3>
              <p>{current.explanation}</p>
              <small>
                {current.file}:{current.location.start.line} ·{' '}
                {current.verification}
              </small>
            </div>
            <div
              className="simulation-path"
              aria-label="Current source-backed path"
            >
              {trail.slice(-3).map((id, index) => {
                const step = steps.get(id);
                return (
                  step && (
                    <div
                      key={`${id}:${index}`}
                      className={
                        id === current.id &&
                        index === trail.slice(-3).length - 1
                          ? 'is-current'
                          : ''
                      }
                    >
                      <strong>
                        {step.symbolId
                          ? (discovery.symbols.find(
                              (symbol) => symbol.id === step.symbolId,
                            )?.name ?? 'Source symbol')
                          : 'Entry file'}
                      </strong>
                      <small>
                        {step.file}:{step.location.start.line}
                      </small>
                    </div>
                  )
                );
              })}
            </div>
            {branches.length > 1 && (
              <fieldset className="simulation-branches">
                <legend>Choose a detected reference</legend>
                {branches.map((branch) => (
                  <button
                    type="button"
                    key={branch.id}
                    aria-pressed={chosen?.id === branch.id}
                    onClick={() =>
                      setChoices((value) => ({
                        ...value,
                        [current.id]: branch.id,
                      }))
                    }
                  >
                    {branch.label}
                    {branch.condition ? ` · if ${branch.condition}` : ''}
                  </button>
                ))}
              </fieldset>
            )}
            {branches.length === 1 && (
              <p className="guided-muted">
                Next reference: {branches[0]!.label}
                {branches[0]!.condition
                  ? ` · condition: ${branches[0]!.condition}`
                  : ''}
              </p>
            )}
            {!branches.length && (
              <p className="guided-muted">
                This supported path stops here. Other runtime behavior may
                exist.
              </p>
            )}
            <div
              className="simulation-controls"
              aria-label="Walkthrough playback"
            >
              <button
                type="button"
                onClick={previous}
                disabled={trail.length <= 1}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setPlaying((value) => !value)}
                disabled={!chosen}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button type="button" onClick={advance} disabled={!chosen}>
                Next
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setTrail([flow.steps[0]!.id]);
                  setSelectedId(flow.steps[0]!.id);
                }}
              >
                Restart
              </button>
              <label htmlFor="simulation-speed">Speed</label>
              <select
                id="simulation-speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="2">2×</option>
              </select>
            </div>
            <p className="sr-only" aria-live="polite">
              Current step: {current.explanation}
            </p>
            {trail.length >= 100 && (
              <p role="status">
                Playback stopped at the visit limit. Restart to explore another
                branch.
              </p>
            )}
          </>
        ) : (
          <p>
            No callable entry could be established. Select an exported function
            or inspect the source.
          </p>
        )}
        <div className="simulation-secondary">
          <details>
            <summary>Source and evidence for this step</summary>
            {selected && (
              <>
                <p>{selected.explanation}</p>
                <p>
                  {selected.location.path}:{selected.location.start.line}:
                  {selected.location.start.column} · {selected.verification}
                </p>
                <SourceExcerpt
                  snapshot={snapshot}
                  location={selected.location}
                />
                {relation && (
                  <>
                    <h3>Why this connection exists</h3>
                    <p>
                      {relation.evidence
                        .map((item) => item.description)
                        .join(' ')}
                    </p>
                    {relation.condition && (
                      <p>
                        Condition: {relation.condition.description}. It was not
                        evaluated.
                      </p>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="guide-more"
                  onClick={() => onBackArchitecture(selected.file)}
                >
                  Open source in Architecture →
                </button>
              </>
            )}
          </details>
          <details>
            <summary>Timeline and other detected references</summary>
            <div
              className="simulation-outline"
              aria-label="Walkthrough outline"
            >
              {flow.steps.map((step, index) => (
                <button
                  type="button"
                  key={step.id}
                  aria-current={selected?.id === step.id ? 'step' : undefined}
                  onClick={() => setSelectedId(step.id)}
                >
                  <span>{index + 1}</span>
                  {step.explanation}
                  <small>
                    {step.file}:{step.location.start.line}
                  </small>
                </button>
              ))}
            </div>
            <p>Detected references are not an execution trace.</p>
          </details>
          <details>
            <summary>Analysis limits</summary>
            <ul>
              {flow.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        </div>
        <button type="button" className="guide-more" onClick={onBackFeatures}>
          Return to selected feature
        </button>
      </div>
    </div>
  );
}
