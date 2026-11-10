'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@codedna/learn-ui';
import type { QaCaseKind, QaStepKind, QaStepResult } from '@codedna/shared';
import { partHue, partsOf } from '@/lib/flows';
import { useLiveQa } from '@/lib/qa-live';
import {
  flowCounts,
  flowViews,
  plannedSteps,
  type CaseView,
  type FlowState,
  type FlowView,
} from '@/lib/qa-flows';
import { journeyViews, useJourneys } from '@/lib/qa-journeys';
import { cn } from '@/lib/utils';
import { JourneysView } from './journeys-view';
import { ConfirmSend, QaRunPanel, useRunSettings } from './qa-run-panel';
import { useRepo } from './repo-shell';
import { STATE, STEP_ICON } from './qa-state';
import { Card, PageHeader, focus } from './ui';

const ORDER: FlowState[] = [
  'running',
  'failed',
  'warning',
  'passed',
  'skipped',
  'untested',
  'unavailable',
];
type Filter = 'all' | 'failed' | 'warning' | 'untested';

/** A flow's steps as a strip of nodes: the one that broke is red, and everything after it grey. */
function StepStrip({
  steps,
}: {
  steps: { kind: QaStepKind; label: string; state: FlowState }[];
}) {
  const list = useRef<HTMLOListElement>(null);
  const broken = steps.findIndex((step) => step.state === 'failed');
  // On a narrow screen the strip scrolls; bring the step that broke into view.
  useEffect(() => {
    const box = list.current?.parentElement;
    const node =
      broken >= 0
        ? (list.current?.children[broken] as HTMLElement | undefined)
        : undefined;
    if (box && node)
      box.scrollLeft = Math.max(
        0,
        node.offsetLeft - box.clientWidth / 2 + node.offsetWidth / 2,
      );
  }, [broken, steps]);
  return (
    <ol
      ref={list}
      className="flex w-max min-w-full items-start justify-center"
      aria-label="Steps"
    >
      {steps.map((step, index) => (
        <li key={`${step.kind}-${index}`} className="flex items-start">
          {index > 0 ? (
            <span
              className={cn(
                'mt-[22px] h-0.5 w-3 shrink-0 sm:w-4',
                step.state === 'passed' ||
                  step.state === 'failed' ||
                  step.state === 'warning'
                  ? 'bg-line'
                  : 'border-t-2 border-dashed border-line bg-transparent',
              )}
              aria-hidden="true"
            />
          ) : null}
          <span className="flex w-[78px] shrink-0 flex-col items-center text-center">
            <span
              className={cn(
                'relative grid h-11 w-11 place-items-center rounded-2xl border-2',
                STATE[step.state].node,
                step.state === 'failed' &&
                  'shadow-[0_0_0_5px_rgb(var(--color-danger)/0.15)]',
              )}
            >
              <Icon name={STEP_ICON[step.kind]} className="h-5 w-5" />
              {step.state === 'failed' ||
              step.state === 'passed' ||
              step.state === 'warning' ? (
                <span
                  className={cn(
                    'absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border-2 border-surface',
                    STATE[step.state].dot,
                  )}
                  aria-hidden="true"
                >
                  <Icon
                    name={STATE[step.state].icon}
                    className="h-2.5 w-2.5 text-surface"
                  />
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'mt-2 text-[12px] leading-tight',
                step.state === 'failed'
                  ? 'font-semibold text-danger'
                  : 'text-ink',
              )}
            >
              {step.label}
            </span>
            <span className="sr-only">{`: ${STATE[step.state].label}`}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function StepRow({ step, view }: { step: QaStepResult; view: FlowView }) {
  const { base, bundle } = useRepo();
  const traced = step.featureStepId
    ? view.feature.steps.find((item) => item.id === step.featureStepId)
    : undefined;
  const slug = bundle.slugs[view.feature.id];
  const look = STATE[step.status];
  return (
    <li
      className={cn(
        'flex gap-3 rounded-xl border p-3',
        step.status === 'failed'
          ? 'border-danger/40 bg-danger-soft/40'
          : 'border-line bg-surface',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg',
          look.chip,
        )}
        aria-hidden="true"
      >
        <Icon name={look.icon} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">
          {step.label} <span className="sr-only">{`(${look.label})`}</span>
        </p>
        {step.detail ? (
          <p className="mt-0.5 break-words text-[13px] leading-relaxed text-muted">
            {step.detail}
          </p>
        ) : null}
        {traced && step.status !== 'passed' && step.status !== 'skipped' ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px]">
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
      </div>
    </li>
  );
}

function CaseDetail({
  view,
  item,
  local,
}: {
  view: FlowView;
  item: CaseView;
  local: boolean;
}) {
  const { bundle, qa } = useRepo();
  const check = item.check;
  const steps = check?.steps?.length
    ? check.steps.map((step) => ({
        kind: step.kind,
        label: step.label,
        state: step.status as FlowState,
      }))
    : plannedSteps(view.plan, item.kind).map((step) => ({
        ...step,
        state: (item.state === 'running' ? 'running' : 'untested') as FlowState,
      }));
  const shot = check?.screenshot
    ? local
      ? `/api/local/qa-shot/${encodeURIComponent(bundle.id)}/${check.screenshot}`
      : qa.shots?.[check.screenshot]
    : undefined;
  return (
    <div className="space-y-5">
      <div
        className="relative overflow-x-auto rounded-2xl border border-line bg-bg/50 p-4 sm:p-5"
        tabIndex={0}
        role="region"
        aria-label="Steps of this case"
      >
        <StepStrip steps={steps} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
            What should happen
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
            {item.expected}
          </p>
        </div>
        <div
          className={cn(
            'rounded-2xl border p-4',
            item.state === 'failed'
              ? 'border-danger/40 bg-danger-soft/40'
              : 'border-line bg-surface',
          )}
        >
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
            What happened
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
            {check?.detail ??
              (item.state === 'running'
                ? 'Testing now…'
                : item.acts
                  ? 'Not tested yet. This case sends data, so it runs in a full test.'
                  : 'Not tested yet.')}
          </p>
        </div>
      </div>
      {check?.inputs ? (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
            What was typed
          </p>
          <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {Object.entries(check.inputs).map(([name, value]) => (
              <div
                key={name}
                className="flex min-w-0 items-baseline gap-2 rounded-lg bg-surface-2/70 px-3 py-1.5 text-[13px]"
              >
                <dt className="shrink-0 text-muted">{name}</dt>
                <dd className="min-w-0 truncate font-mono text-[12px] text-ink">
                  {value === '' ? '(empty)' : value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {check?.steps?.length ? (
        <ol className="space-y-2" aria-label="Step by step">
          {check.steps.map((step, index) => (
            <StepRow key={`${step.kind}-${index}`} step={step} view={view} />
          ))}
        </ol>
      ) : null}
      {check?.evidence?.length ? (
        <details>
          <summary
            className={cn(
              'cursor-pointer text-[13px] font-medium text-accent',
              focus,
            )}
          >
            What the browser saw
          </summary>
          <pre
            className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-code p-3 font-mono text-[11.5px] leading-5 text-ink"
            tabIndex={0}
          >
            {check.evidence.join('\n')}
          </pre>
        </details>
      ) : null}
      {check?.screenshot ? (
        shot ? (
          <figure>
            {/* A local file served by the CLI, or a data URL from a GitHub run, so a plain img rather than next/image. */}
            <img
              src={shot}
              alt={`The page after “${item.title}” on ${view.feature.title}`}
              className="w-full rounded-2xl border border-line"
              loading="lazy"
            />
            <figcaption className="mt-1.5 text-[12px] text-muted">
              The page after the last step.
            </figcaption>
          </figure>
        ) : (
          <p className="text-[12.5px] text-muted">{`A screenshot was saved as .codedna/qa/${check.screenshot} (in your project, or in the CI run’s codedna-qa download). Open the project with “codedna” to see it here; runs started with Test all flows show the screenshots of what broke.`}</p>
        )
      ) : null}
    </div>
  );
}

/**
 * QA flows: every feature of the app, grouped by part, tested as a person would use it. Pick a
 * feature, pick a case, and the step strip shows exactly where it broke.
 */
export function QaFlowsPage() {
  const { bundle, qa } = useRepo();
  const live = useLiveQa(bundle, qa.refresh);
  const settings = useRunSettings();
  type RunAsk = {
    kind: 'flows' | 'journeys';
    featureIds?: string[];
    journeyIds?: string[];
  };
  const [asking, setAsking] = useState<RunAsk | undefined>();
  const [tab, setTabState] = useState<'journeys' | 'features'>('journeys');
  // Remembered in this browser, so coming back (e.g. from GitHub's sign-in) keeps the same view.
  useEffect(() => {
    try {
      if (window.localStorage.getItem('codedna:qa-tab') === 'features') setTabState('features');
    } catch {
      // Starts on journeys.
    }
  }, []);
  const setTab = (next: 'journeys' | 'features') => {
    setTabState(next);
    try {
      window.localStorage.setItem('codedna:qa-tab', next);
    } catch {
      // Kept for this visit only.
    }
  };
  const journeys = useJourneys(bundle, live);
  const journeyList = useMemo(
    () => journeyViews(journeys.journeys, bundle.features, qa.report, live.run),
    [journeys.journeys, bundle.features, qa.report, live.run],
  );
  const [runError, setRunError] = useState<string>();
  const views = useMemo(
    () => flowViews(bundle.features, qa.report, live.run),
    [bundle.features, qa.report, live.run],
  );
  const parts = useMemo(() => partsOf(bundle), [bundle]);
  const counts = useMemo(() => flowCounts(views.values()), [views]);
  const [filter, setFilter] = useState<Filter>('all');
  const firstBroken =
    [...views.values()].find((view) => view.state === 'failed') ??
    [...views.values()].find((view) => view.state !== 'unavailable') ??
    [...views.values()][0];
  const [selected, setSelected] = useState<string | undefined>();
  const [caseKind, setCaseKind] = useState<QaCaseKind | undefined>();
  useEffect(
    () => setSelected((now) => now ?? firstBroken?.feature.id),
    [firstBroken],
  );
  const view = selected ? views.get(selected) : undefined;
  const item = view
    ? (view.cases.find((entry) => entry.kind === caseKind) ??
      [...view.cases].sort(
        (a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state),
      )[0])
    : undefined;
  const shows = (state: FlowState) =>
    filter === 'all' ||
    state === filter ||
    (filter === 'untested' && state === 'untested');
  const testable = views.size - counts.unavailable;
  const local = qa.origin === 'local' || live.available;

  const start = async ({ kind, featureIds, journeyIds }: RunAsk) => {
    if (!('url' in settings.target)) return;
    setRunError(undefined);
    const problem = await live.start({
      url: settings.target.url,
      mode: settings.mode,
      kind,
      ...(featureIds ? { featureIds } : {}),
      ...(journeyIds ? { journeyIds } : {}),
    });
    if (problem) setRunError(problem);
  };
  // A full run sends data, so it asks first; looking only starts straight away.
  const requestRun = (ask: RunAsk) =>
    settings.mode === 'full' ? setAsking(ask) : void start(ask);
  const journeyTitle = (id?: string) =>
    journeys.journeys.find((journey) => journey.id === id)?.title;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="text-[12px] font-semibold uppercase tracking-wider text-accent">
            Deliver
          </span>
        }
        title="QA flows"
      >
        Every user journey of the app, run live in a real browser the way a
        person would use it — and each feature on its own with empty, wrong,
        very long and doubled input. Where something breaks, the map shows the
        exact point: the button, the request and the server’s answer.
      </PageHeader>

      <div
        className="mt-8 inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1"
        role="group"
        aria-label="What to test"
      >
        {(
          [
            ['journeys', 'User journeys', 'Features joined end to end'],
            ['features', 'Single features', 'Each one, case by case'],
          ] as const
        ).map(([id, text, note]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'rounded-xl px-4 py-2 text-left transition-colors',
              tab === id
                ? 'bg-accent-soft text-ink'
                : 'text-muted hover:text-ink',
              focus,
            )}
          >
            <span className="block text-[14px] font-semibold">{text}</span>
            <span className="block text-[12px] text-muted">{note}</span>
          </button>
        ))}
      </div>
      {qa.report ? (
        <p className="mt-3 text-[13px] text-muted">{`Last run ${new Date(qa.report.createdAt).toLocaleString()}${qa.report.appUrl ? ` on ${qa.report.appUrl}` : ''}${qa.report.mode === 'look' ? ' (looked only)' : ''}.`}</p>
      ) : null}

      <div className="mt-6">
        <QaRunPanel
          live={live}
          settings={settings}
          runLabel={tab === 'journeys' ? 'Test all journeys' : 'Test all flows'}
          nameOf={(run) =>
            run.kind === 'journeys'
              ? journeyTitle(run.current?.journeyId)
              : undefined
          }
          onRun={() =>
            requestRun({ kind: tab === 'journeys' ? 'journeys' : 'flows' })
          }
        />
        {runError ? (
          <p
            className="mt-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-3 text-[13px] leading-relaxed text-danger"
            role="alert"
          >
            {runError}
          </p>
        ) : null}
      </div>
      <ConfirmSend
        open={!!asking}
        url={'url' in settings.target ? settings.target.url : settings.url}
        deployed={
          'kind' in settings.target && settings.target.kind === 'deployed'
        }
        onCancel={() => setAsking(undefined)}
        onConfirm={() => {
          const ask = asking;
          setAsking(undefined);
          if (ask) void start(ask);
        }}
      />

      {tab === 'journeys' ? (
        <div className="mt-6">
          <JourneysView
            views={journeyList}
            state={journeys}
            live={live}
            canRun={!('problem' in settings.target)}
            onRun={(journeyIds) => requestRun({ kind: 'journeys', journeyIds })}
          />
        </div>
      ) : (
        <>
          <div className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ['all', 'Flows to test', testable, 'bg-accent'],
                  ['failed', 'Broke', counts.failed, STATE.failed.dot],
                  ['warning', 'To look at', counts.warning, STATE.warning.dot],
                  [
                    'untested',
                    'Not tested yet',
                    counts.untested,
                    STATE.untested.dot,
                  ],
                ] as const
              ).map(([id, label, value, dot]) => (
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
                    {label}
                  </span>
                  <span className="mt-1 block text-[28px] font-semibold tabular-nums leading-tight text-ink">
                    {value}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <nav
              aria-label="Features to test"
              className="space-y-5 xl:sticky xl:top-8 xl:max-h-[calc(100vh-4rem)] xl:self-start xl:overflow-y-auto xl:pr-1"
            >
              {parts.map((part) => {
                const items = part.areas
                  .flatMap((area) =>
                    area.featureIds.map((id) => ({
                      area: area.title,
                      view: views.get(id),
                    })),
                  )
                  .filter(
                    (entry): entry is { area: string; view: FlowView } =>
                      !!entry.view && shows(entry.view.state),
                  );
                if (!items.length) return null;
                const areas = [...new Set(items.map((entry) => entry.area))];
                return (
                  <section
                    key={part.title}
                    style={{ ['--part' as string]: partHue(parts, part.title) }}
                  >
                    <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-[rgb(var(--part))]">
                      <span
                        className="h-2 w-2 rounded-full bg-[rgb(var(--part))]"
                        aria-hidden="true"
                      />
                      {part.title}
                    </h2>
                    {areas.map((area) => (
                      <div key={area} className="mt-2">
                        {areas.length > 1 || area !== part.title ? (
                          <p className="mb-1 px-1 text-[12px] font-medium text-muted">
                            {area}
                          </p>
                        ) : null}
                        <ul className="space-y-1">
                          {items
                            .filter((entry) => entry.area === area)
                            .map(({ view: entry }) => {
                              const look = STATE[entry.state];
                              const ran = entry.cases.filter(
                                (one) => one.check,
                              ).length;
                              return (
                                <li key={entry.feature.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelected(entry.feature.id);
                                      setCaseKind(undefined);
                                    }}
                                    aria-current={
                                      selected === entry.feature.id
                                        ? 'true'
                                        : undefined
                                    }
                                    className={cn(
                                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                      selected === entry.feature.id
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
                                        {entry.feature.title}
                                      </span>
                                      <span className="block truncate text-[12px] text-muted">
                                        {entry.plan.unavailable
                                          ? 'Can’t be tested by itself'
                                          : `${entry.feature.page ?? ''} · ${ran ? `${ran} of ${entry.cases.length} cases run` : `${entry.cases.length} cases`}`}
                                      </span>
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
                      </div>
                    ))}
                  </section>
                );
              })}
            </nav>

            <div className="min-w-0">
              {view ? (
                <Card className="p-5 sm:p-7">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[24px] font-semibold tracking-tight text-ink">
                        {view.feature.title}
                      </h2>
                      <p className="mt-0.5 text-[13.5px] text-muted">
                        {[view.feature.page, view.feature.area]
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
                      {live.available && !view.plan.unavailable ? (
                        <button
                          type="button"
                          disabled={
                            live.running || 'problem' in settings.target
                          }
                          onClick={() =>
                            requestRun({
                              kind: 'flows',
                              featureIds: [view.feature.id],
                            })
                          }
                          className={cn(
                            'inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-medium text-on-accent shadow-card hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50',
                            focus,
                          )}
                        >
                          <Icon name="play" className="h-3.5 w-3.5" />{' '}
                          {settings.mode === 'full'
                            ? 'Test this flow'
                            : 'Look at this flow'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {view.plan.unavailable ? (
                    <p className="mt-5 rounded-xl border border-dashed border-line bg-surface-2/50 p-4 text-[14px] leading-relaxed text-muted">
                      {view.plan.unavailable}
                    </p>
                  ) : (
                    <>
                      <div
                        role="tablist"
                        aria-label="Cases"
                        className="mt-5 flex flex-wrap gap-2"
                      >
                        {view.cases.map((entry) => {
                          const active = entry.kind === item?.kind;
                          return (
                            <button
                              key={entry.kind}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              aria-controls="qa-case"
                              onClick={() => setCaseKind(entry.kind)}
                              className={cn(
                                'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-colors',
                                active
                                  ? 'border-accent bg-accent-soft text-ink'
                                  : 'border-line bg-surface text-muted hover:text-ink',
                                focus,
                              )}
                            >
                              <span
                                className={cn(
                                  'h-2 w-2 rounded-full',
                                  STATE[entry.state].dot,
                                )}
                                aria-hidden="true"
                              />
                              {entry.title}
                              <span className="sr-only">{`: ${STATE[entry.state].label}`}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div id="qa-case" role="tabpanel" className="mt-5">
                        {item ? (
                          <CaseDetail view={view} item={item} local={local} />
                        ) : null}
                      </div>
                    </>
                  )}
                </Card>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
