'use client';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '@codedna/learn-ui';
import {
  JOURNEYS_FILE,
  type Feature,
  type Journey,
  type JourneyStep,
} from '@codedna/shared';
import type { FlowState } from '@/lib/qa-flows';
import {
  firstNodeOf,
  journeyCounts,
  type JourneysState,
  type JourneyView,
  type NodeView,
} from '@/lib/qa-journeys';
import type { LiveQa } from '@/lib/qa-live';
import { cn } from '@/lib/utils';
import { STATE, STEP_ICON } from './qa-state';
import { useRepo } from './repo-shell';
import { Card, focus } from './ui';

const label = 'text-[12px] font-semibold uppercase tracking-wider text-muted';
const smallButton = cn(
  'inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
  focus,
);
const primaryButton = cn(
  'inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-medium text-on-accent shadow-card hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50',
  focus,
);
const ran = (state: FlowState) =>
  state === 'passed' || state === 'failed' || state === 'warning';

/** The line between two points: solid once reached, red into the point that broke. */
function Connector({
  state,
  className,
}: {
  state: FlowState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'h-0.5 w-5 shrink-0 sm:w-6',
        state === 'failed'
          ? 'bg-danger'
          : ran(state)
            ? 'bg-success/60'
            : state === 'running'
              ? 'bg-accent/60'
              : 'border-t-2 border-dashed border-line bg-transparent',
        className,
      )}
      aria-hidden="true"
    />
  );
}

function httpTone(status?: number, error?: string) {
  if (error || status === undefined) return 'bg-danger-soft text-danger';
  if (status >= 400) return 'bg-danger-soft text-danger';
  if (status >= 300) return 'bg-surface-2 text-muted';
  return 'bg-success-soft text-success';
}

function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: NodeView;
  selected: boolean;
  onSelect: () => void;
}) {
  const look = STATE[node.state];
  const http = node.result?.http;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${node.label}: ${look.label}${http ? `, ${http.method} answered ${http.status ?? 'nothing'}` : ''}`}
      data-node={node.id}
      className={cn(
        'group flex w-[96px] shrink-0 flex-col items-center rounded-xl px-1 pb-1 pt-0.5 text-center',
        focus,
      )}
    >
      <span
        className={cn(
          'relative grid h-11 w-11 place-items-center rounded-full border-2 transition-shadow',
          look.node,
          node.state === 'failed' &&
            'shadow-[0_0_0_5px_rgb(var(--color-danger)/0.15)]',
          node.state === 'running' && 'motion-safe:animate-pulse',
          selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
        )}
      >
        <Icon name={STEP_ICON[node.kind]} className="h-5 w-5" />
        {ran(node.state) ? (
          <span
            className={cn(
              'absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-surface',
              look.dot,
            )}
            aria-hidden="true"
          >
            <Icon name={look.icon} className="h-2.5 w-2.5 text-surface" />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'mt-1.5 line-clamp-2 text-[11.5px] leading-tight',
          node.state === 'failed'
            ? 'font-semibold text-danger'
            : 'text-ink group-hover:text-accent',
        )}
      >
        {node.label}
      </span>
      {http ? (
        <span
          className={cn(
            'mt-1 rounded px-1.5 py-px font-mono text-[10.5px] font-semibold',
            httpTone(http.status, http.error),
          )}
        >
          {http.status ?? 'no answer'}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The journey as a map, left to right: each step a station, each point what the browser does.
 * Points light up as a run goes, and the one that broke is red with its HTTP answer.
 */
function JourneyMap({
  view,
  selected,
  onSelect,
}: {
  view: JourneyView;
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const focusId = view.stations
    .flatMap((station) => station.nodes)
    .find((node) => node.state === 'running' || node.state === 'failed')?.id;
  useEffect(() => {
    const element = box.current;
    const node = focusId
      ? element?.querySelector<HTMLElement>(`[data-node="${focusId}"]`)
      : undefined;
    // Bring the point being tested (or the broken one) into view; otherwise start at the beginning.
    if (element)
      element.scrollLeft = node
        ? Math.max(0, node.offsetLeft - element.clientWidth / 2)
        : 0;
  }, [focusId, view.journey.id]);
  return (
    <div
      ref={box}
      className="relative overflow-x-auto rounded-2xl border border-line bg-bg/50 p-4 sm:p-5"
      role="region"
      aria-label="Journey map"
      tabIndex={0}
    >
      <ol className="flex w-max items-start">
        {view.stations.map((station, index) => (
          <li key={station.station.step} className="flex items-start">
            {index > 0 ? (
              <Connector
                state={station.nodes[0]?.state ?? 'untested'}
                className="mt-[94px]"
              />
            ) : null}
            <div className="flex flex-col">
              <div className="mb-2 h-12 max-w-[min(100%,320px)] px-1">
                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted">
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full text-[10.5px] tabular-nums',
                      STATE[station.state].chip,
                    )}
                  >
                    {index + 1}
                  </span>
                  {station.station.page ? (
                    <code className="truncate font-mono normal-case tracking-normal">
                      {station.station.page}
                    </code>
                  ) : null}
                </p>
                <p
                  className="mt-1 truncate text-[13.5px] font-semibold text-ink"
                  title={station.station.title}
                >
                  {station.station.title}
                </p>
              </div>
              <ol
                className={cn(
                  'flex items-start rounded-2xl border px-2 py-3',
                  station.state === 'failed'
                    ? 'border-danger/40 bg-danger-soft/20'
                    : 'border-line/80 bg-surface/70',
                )}
              >
                {station.nodes.length ? (
                  station.nodes.map((node, at) => (
                    <li key={node.id} className="flex items-start">
                      {at > 0 ? (
                        <Connector state={node.state} className="mt-[22px]" />
                      ) : null}
                      <NodeButton
                        node={node}
                        selected={selected === node.id}
                        onSelect={() => onSelect(node.id)}
                      />
                    </li>
                  ))
                ) : (
                  <li className="max-w-[220px] px-2 text-[12.5px] leading-snug text-danger">
                    {station.station.problem}
                  </li>
                )}
              </ol>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Everything about one point: what happened, the HTTP request, the line of code and the screenshot. */
function NodeDetail({
  view,
  node,
  local,
}: {
  view: JourneyView;
  node: NodeView;
  local: boolean;
}) {
  const { bundle, base, qa } = useRepo();
  const feature = node.featureId
    ? bundle.features.find((item) => item.id === node.featureId)
    : undefined;
  const traced =
    node.featureStepId && feature
      ? feature.steps.find((step) => step.id === node.featureStepId)
      : undefined;
  const slug = feature ? bundle.slugs[feature.id] : undefined;
  const result = node.result;
  const shotPath =
    result?.screenshot ??
    (node.state === 'failed' ? view.check?.screenshot : undefined);
  const shot = shotPath
    ? local
      ? `/api/local/qa-shot/${encodeURIComponent(bundle.id)}/${shotPath}`
      : qa.shots?.[shotPath]
    : undefined;
  const look = STATE[node.state];
  const station = view.stations.find((item) => item.station.step === node.step);
  return (
    <section
      aria-label="This point"
      className={cn(
        'rounded-2xl border p-4 sm:p-5',
        node.state === 'failed'
          ? 'border-danger/40 bg-danger-soft/30'
          : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-full border-2',
              look.node,
            )}
            aria-hidden="true"
          >
            <Icon name={STEP_ICON[node.kind]} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-ink">{node.label}</h3>
            <p className="text-[12.5px] text-muted">{`Step ${node.step + 1}: ${station?.station.title ?? ''}${node.extra ? ' · signing in on the way' : ''}`}</p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold',
            look.chip,
          )}
        >
          <Icon name={look.icon} className="h-3.5 w-3.5" />
          {look.label}
        </span>
      </div>
      <p className="mt-3 break-words text-[14px] leading-relaxed text-ink">
        {result?.detail ??
          (node.state === 'running'
            ? 'Testing this point now…'
            : 'Not tested yet. Run the journey to see what happens here.')}
      </p>
      {result?.http ? (
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 rounded-xl border border-line bg-code p-3 font-mono text-[12px] sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted">Request</dt>
          <dd className="min-w-0 break-all text-ink">{`${result.http.method} ${result.http.url}`}</dd>
          <dt className="text-muted">Answer</dt>
          <dd>
            <span
              className={cn(
                'rounded px-1.5 py-px font-semibold',
                httpTone(result.http.status, result.http.error),
              )}
            >
              {result.http.status ?? result.http.error ?? 'no answer'}
            </span>
          </dd>
          {result.http.durationMs !== undefined ? (
            <>
              <dt className="text-muted">Time</dt>
              <dd className="text-ink">{`${result.http.durationMs} ms`}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {traced ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
          <span className="text-muted">In the code:</span>
          <span className="font-medium text-ink">{traced.title}</span>
          <code className="font-mono text-[11.5px] text-muted">{`${traced.code.path}:${traced.code.highlightLine}`}</code>
          {slug ? (
            <Link
              href={`${base}/story/${slug}`}
              className={cn('font-medium text-accent hover:underline', focus)}
            >
              See this step →
            </Link>
          ) : null}
        </p>
      ) : null}
      {shot ? (
        <figure className="mt-4">
          {/* A local file served by the CLI, or a data URL from a GitHub run, so a plain img. */}
          <img
            src={shot}
            alt={`The page at “${node.label}” in ${view.journey.title}`}
            className="max-h-[440px] w-full rounded-xl border border-line object-cover object-top"
            loading="lazy"
          />
          <figcaption className="mt-1.5 text-[12px] text-muted">
            The page at this point.
          </figcaption>
        </figure>
      ) : shotPath ? (
        <p className="mt-3 text-[12.5px] text-muted">{`A screenshot was saved as .codedna/qa/${shotPath}.`}</p>
      ) : null}
    </section>
  );
}

const describeStep = (step: JourneyStep, byKey: Map<string, Feature>) => {
  if (step.kind === 'open')
    return { title: `Open ${step.page}`, sub: 'By its address' };
  const feature = byKey.get(step.featureKey);
  return feature
    ? {
        title: feature.title,
        sub: [feature.page, feature.entryKind === 'link' ? 'link' : undefined]
          .filter(Boolean)
          .join(' · '),
      }
    : { title: 'A feature that’s gone', sub: 'No longer in the code' };
};

/** Rename, reorder, remove and add steps. Saved to codedna.journeys.json (or this browser). */
function JourneyEditor({
  journey,
  original,
  features,
  onSave,
  onCancel,
}: {
  journey: Journey;
  original?: Journey;
  features: readonly Feature[];
  onSave: (journey: Journey | undefined) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(journey.title);
  const [steps, setSteps] = useState<JourneyStep[]>(journey.steps);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const addId = useId();
  const byKey = useMemo(
    () => new Map(features.map((feature) => [feature.key, feature])),
    [features],
  );
  const pages = useMemo(
    () =>
      [
        ...new Set(
          features
            .map((feature) => feature.page)
            .filter((page): page is string => !!page && !/[[(]/.test(page)),
        ),
      ].sort(),
    [features],
  );
  const choices = useMemo(() => {
    const usable = features.filter(
      (feature) =>
        (feature.page &&
          feature.entryKind !== 'route-handler' &&
          feature.entryKind !== 'server-action' &&
          feature.importance !== 'detail') ||
        feature.entryKind === 'link',
    );
    const groups = new Map<string, Feature[]>();
    for (const feature of usable)
      groups.set(feature.area ?? feature.section ?? 'Other', [
        ...(groups.get(feature.area ?? feature.section ?? 'Other') ?? []),
        feature,
      ]);
    return [...groups];
  }, [features]);
  const custom = journey.id.startsWith('custom-');
  const move = (index: number, by: number) =>
    setSteps((now) => {
      const next = [...now];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  const commit = async (value: Journey | undefined) => {
    setBusy(true);
    const reason = await onSave(value);
    setBusy(false);
    setProblem(reason);
  };
  return (
    <div className="space-y-4 rounded-2xl border border-accent/40 bg-surface p-4 sm:p-5">
      <div>
        <label htmlFor={titleId} className={label}>
          Journey name
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className={cn(
            'mt-2 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink',
            focus,
          )}
        />
      </div>
      <div>
        <p className={label}>Steps, in order</p>
        <ol className="mt-2 space-y-2">
          {steps.map((step, index) => {
            const text = describeStep(step, byKey);
            return (
              <li
                key={`${index}-${step.kind === 'open' ? step.page : step.featureKey}`}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[11.5px] font-semibold tabular-nums text-accent">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {text.title}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {text.sub}
                  </span>
                </span>
                <button
                  type="button"
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink disabled:opacity-30',
                    focus,
                  )}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move step ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink disabled:opacity-30',
                    focus,
                  )}
                  disabled={index === steps.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move step ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger',
                    focus,
                  )}
                  onClick={() =>
                    setSteps((now) => now.filter((_, at) => at !== index))
                  }
                  aria-label={`Remove step ${index + 1}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <label htmlFor={addId} className="sr-only">
          Add a step
        </label>
        <select
          id={addId}
          value=""
          onChange={(event) => {
            const [kind, ...rest] = event.target.value.split(':');
            const value = rest.join(':');
            if (kind === 'open')
              setSteps((now) => [...now, { kind: 'open', page: value }]);
            if (kind === 'feature')
              setSteps((now) => [
                ...now,
                { kind: 'feature', featureKey: value },
              ]);
          }}
          className={cn(
            'mt-2 h-10 w-full rounded-xl border border-dashed border-line bg-surface px-3 text-[13.5px] text-ink',
            focus,
          )}
        >
          <option value="">+ Add a step…</option>
          <optgroup label="Open a page">
            {pages.map((page) => (
              <option
                key={page}
                value={`open:${page}`}
              >{`Open ${page}`}</option>
            ))}
          </optgroup>
          {choices.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map((feature) => (
                <option
                  key={feature.key}
                  value={`feature:${feature.key}`}
                >{`${feature.title}${feature.page ? ` (${feature.page})` : ''}`}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {problem ? (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] text-danger"
        >
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !title.trim() || !steps.length}
          onClick={() =>
            void commit({
              ...journey,
              title: title.trim(),
              steps,
              edited: true,
            })
          }
        >
          Save journey
        </button>
        <button type="button" className={smallButton} onClick={onCancel}>
          Cancel
        </button>
        <span className="flex-1" />
        {original && journey.edited ? (
          <button
            type="button"
            className={smallButton}
            disabled={busy}
            onClick={() => void commit(original)}
          >
            Reset to CodeDNA’s version
          </button>
        ) : null}
        <button
          type="button"
          className={smallButton}
          disabled={busy}
          onClick={() =>
            void commit({ ...journey, hidden: !journey.hidden, edited: true })
          }
        >
          {journey.hidden ? 'Show this journey' : 'Hide this journey'}
        </button>
        {custom ? (
          <button
            type="button"
            className={cn(smallButton, 'border-danger/40 text-danger')}
            disabled={busy}
            onClick={() => void commit(undefined)}
          >
            Delete journey
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The test account journeys sign in with: saved on this computer only, the password never shown again. */
function TestAccount({
  state,
  local,
}: {
  state: JourneysState;
  local: boolean;
}) {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string>();
  if (!local)
    return (
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-ink">Test account:</span> journeys
        that need signing in use the repo secrets{' '}
        <code className="font-mono text-ink">CODEDNA_QA_EMAIL</code> and{' '}
        <code className="font-mono text-ink">CODEDNA_QA_PASSWORD</code>{' '}
        (Settings → Secrets and variables → Actions). Use a test account, never
        a real person’s.
      </p>
    );
  if (state.account && !changing)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <Icon name="lock" className="h-4 w-4 text-success" />{' '}
          {`Signs in as ${state.account}`}
        </span>
        <span>when a page asks. Saved on this computer only.</span>
        <button
          type="button"
          className={cn('font-medium text-accent hover:underline', focus)}
          onClick={() => setChanging(true)}
        >
          Change
        </button>
        <button
          type="button"
          className={cn('font-medium text-muted hover:text-ink', focus)}
          onClick={() => void state.removeAccount().then(setProblem)}
        >
          Remove
        </button>
      </div>
    );
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void state.saveAccount(email, password).then((reason) => {
          setProblem(reason);
          if (!reason) {
            setPassword('');
            setChanging(false);
          }
        });
      }}
    >
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-medium text-ink">Test account</span> — journeys
        sign in with it whenever a page asks. Use a test account, never a real
        person’s. It’s saved in your project’s git-ignored{' '}
        <code className="font-mono text-ink">.codedna</code> folder, and the
        password never comes back to this page.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label htmlFor={emailId} className={label}>
            Email or user name
          </label>
          <input
            id={emailId}
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={cn(
              'mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13.5px] text-ink',
              focus,
            )}
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <label htmlFor={passwordId} className={label}>
            Password
          </label>
          <input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={cn(
              'mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[13.5px] text-ink',
              focus,
            )}
          />
        </div>
        <button
          type="submit"
          className={smallButton}
          disabled={!email.trim() || !password}
        >
          Save account
        </button>
        {changing ? (
          <button
            type="button"
            className={smallButton}
            onClick={() => setChanging(false)}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
    </form>
  );
}

/**
 * User journeys: features joined in the order a person uses them, each drawn as a map that lights
 * up point by point as it runs, with the broken point red and its HTTP answer beside it.
 */
export function JourneysView({
  views,
  state,
  live,
  canRun,
  onRun,
}: {
  views: JourneyView[];
  state: JourneysState;
  live: LiveQa;
  canRun: boolean;
  onRun: (journeyIds: string[]) => void;
}) {
  const { bundle } = useRepo();
  const local = live.available;
  const [filter, setFilter] = useState<
    'all' | 'failed' | 'warning' | 'untested'
  >('all');
  const [selected, setSelected] = useState<string>();
  const [node, setNode] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = views.filter((view) => !view.journey.hidden);
  const hidden = views.filter((view) => view.journey.hidden);
  const counts = journeyCounts(shown);
  const firstBroken = shown.find((view) => view.state === 'failed') ?? shown[0];
  const view = views.find(
    (item) => item.journey.id === (selected ?? firstBroken?.journey.id),
  );
  const running = view?.state === 'running';
  // While a journey runs, follow the point being tested; otherwise keep what was picked.
  const autoNode = view ? firstNodeOf(view) : undefined;
  const current =
    view?.stations
      .flatMap((station) => station.nodes)
      .find(
        (item) => item.id === (running ? autoNode?.id : (node ?? autoNode?.id)),
      ) ?? autoNode;
  const visible = (item: JourneyView) =>
    filter === 'all' || item.state === filter;
  const original = view
    ? state.original.find((journey) => journey.id === view.journey.id)
    : undefined;
  const editsText = `${JSON.stringify(state.edits, null, 2)}\n`;

  const groups = new Map<string, JourneyView[]>();
  for (const item of shown.filter(visible)) {
    const key = item.journey.section ?? item.journey.area ?? 'Journeys';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const select = (id: string) => {
    setSelected(id);
    setNode(undefined);
    setEditing(false);
  };
  const saveOne = async (journey: Journey | undefined, id: string) => {
    const next = journey
      ? state.journeys.some((item) => item.id === id)
        ? state.journeys.map((item) => (item.id === id ? journey : item))
        : [...state.journeys, journey]
      : state.journeys.filter((item) => item.id !== id);
    const reason = await state.save(next);
    if (!reason) {
      setEditing(false);
      if (!journey) setSelected(undefined);
    }
    return reason;
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['all', 'User journeys', shown.length, 'bg-accent'],
            ['failed', 'Broke', counts.failed, STATE.failed.dot],
            ['warning', 'To look at', counts.warning, STATE.warning.dot],
            ['untested', 'Not tested yet', counts.untested, STATE.untested.dot],
          ] as const
        ).map(([id, text, value, dot]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(filter === id ? 'all' : id)}
            className={cn(
              'rounded-2xl border bg-surface p-4 text-left shadow-card transition-colors',
              filter === id
                ? 'border-accent'
                : 'border-line hover:border-accent/40',
              focus,
            )}
          >
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <span
                className={cn('h-2.5 w-2.5 rounded-full', dot)}
                aria-hidden="true"
              />
              {text}
            </span>
            <span className="mt-1 block text-[28px] font-semibold tabular-nums leading-tight text-ink">
              {value}
            </span>
          </button>
        ))}
      </div>

      <Card className="p-4 sm:p-5">
        <TestAccount state={state} local={local} />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <nav
          aria-label="Journeys"
          className="space-y-5 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-muted">{`${shown.length} journeys from the code`}</p>
            <button
              type="button"
              className={smallButton}
              onClick={() => {
                const id = `custom-${Date.now().toString(36)}`;
                void saveOne(
                  {
                    id,
                    title: 'New journey',
                    steps: [{ kind: 'open', page: '/' }],
                    edited: true,
                  },
                  id,
                ).then((reason) => {
                  if (!reason) {
                    setSelected(id);
                    setEditing(true);
                  }
                });
              }}
            >
              + New journey
            </button>
          </div>
          {[...groups].map(([group, items]) => (
            <section key={group}>
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">
                {group}
              </h2>
              <ul className="mt-2 space-y-1">
                {items.map((item) => {
                  const look = STATE[item.state];
                  const pages = item.stations
                    .map((station) => station.station.page)
                    .filter((page): page is string => !!page);
                  const route = [...new Set(pages)];
                  return (
                    <li key={item.journey.id}>
                      <button
                        type="button"
                        onClick={() => select(item.journey.id)}
                        aria-current={
                          view?.journey.id === item.journey.id
                            ? 'true'
                            : undefined
                        }
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          view?.journey.id === item.journey.id
                            ? 'border-accent bg-accent-soft/60'
                            : 'border-transparent hover:bg-surface-2',
                          focus,
                        )}
                      >
                        <span
                          className={cn(
                            'h-2.5 w-2.5 shrink-0 rounded-full',
                            look.dot,
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink">
                            {item.journey.title}
                            {item.journey.edited ? (
                              <span className="ml-1.5 text-[11px] font-normal text-muted">
                                edited
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate font-mono text-[11.5px] text-muted">{`${item.journey.steps.length} steps · ${route.length > 1 ? `${route[0]} → ${route.at(-1)}` : (route[0] ?? '')}`}</span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                            look.chip,
                          )}
                        >
                          {look.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {!groups.size ? (
            <p className="text-[13.5px] text-muted">
              No journeys at this level.
            </p>
          ) : null}
          {hidden.length ? (
            <details>
              <summary
                className={cn(
                  'cursor-pointer text-[13px] font-medium text-muted',
                  focus,
                )}
              >{`Hidden (${hidden.length})`}</summary>
              <ul className="mt-2 space-y-1">
                {hidden.map((item) => (
                  <li key={item.journey.id}>
                    <button
                      type="button"
                      onClick={() => select(item.journey.id)}
                      className={cn(
                        'w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-ink',
                        focus,
                      )}
                    >
                      {item.journey.title}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </nav>

        <div className="min-w-0">
          {view ? (
            <Card className="space-y-5 p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[24px] font-semibold tracking-tight text-ink">
                    {view.journey.title}
                  </h2>
                  <p className="mt-0.5 text-[13.5px] text-muted">
                    {[
                      view.journey.section,
                      view.journey.area !== view.journey.section
                        ? view.journey.area
                        : undefined,
                      `${view.journey.steps.length} steps`,
                      view.journey.hidden ? 'hidden' : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold',
                      STATE[view.state].chip,
                    )}
                  >
                    <Icon
                      name={STATE[view.state].icon}
                      className="h-3.5 w-3.5"
                    />
                    {STATE[view.state].label}
                  </span>
                  {!editing ? (
                    <button
                      type="button"
                      className={smallButton}
                      onClick={() => setEditing(true)}
                    >
                      Edit journey
                    </button>
                  ) : null}
                  {local ? (
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={!canRun || live.running}
                      onClick={() => onRun([view.journey.id])}
                    >
                      <Icon name="play" className="h-3.5 w-3.5" /> Test this
                      journey
                    </button>
                  ) : null}
                </div>
              </div>
              {view.destructive ? (
                <p className="rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning">
                  One step could change data for good (delete, pay, transfer or
                  sign out), so a run always stops before it.
                </p>
              ) : null}
              {editing ? (
                <JourneyEditor
                  key={view.journey.id}
                  journey={view.journey}
                  {...(original ? { original } : {})}
                  features={bundle.features}
                  onSave={(journey) => saveOne(journey, view.journey.id)}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <>
                  <JourneyMap
                    view={view}
                    {...(current ? { selected: current.id } : {})}
                    onSelect={setNode}
                  />
                  {view.check?.detail ? (
                    <p className="text-[13.5px] text-muted">{`Last run: ${view.check.detail}`}</p>
                  ) : null}
                  {current ? (
                    <NodeDetail
                      view={view}
                      node={current}
                      local={local || false}
                    />
                  ) : null}
                </>
              )}
              {state.savedIn === 'browser' && state.edits.journeys.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-3 text-[12.5px] text-muted">
                  <span className="min-w-0 flex-1">{`Your journey changes are saved in this browser. To use them in CI and on your computer, add ${JOURNEYS_FILE} to the root of your repo.`}</span>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() =>
                      void navigator.clipboard
                        ?.writeText(editsText)
                        .then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        })
                    }
                  >
                    <span aria-live="polite">
                      {copied ? 'Copied' : `Copy ${JOURNEYS_FILE}`}
                    </span>
                  </button>
                </div>
              ) : state.savedIn === 'project' && view.journey.edited ? (
                <p className="text-[12.5px] text-muted">{`Changes are saved in ${JOURNEYS_FILE} in your project. Commit it so CI runs the same journeys.`}</p>
              ) : null}
            </Card>
          ) : (
            <Card className="p-6 text-[14px] text-muted">
              CodeDNA found no journeys it can run in a browser. Add one with
              “New journey”.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
