'use client';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { Icon, pathStates, type IconName } from '@codedna/learn-ui';
import { partCounts, partHue, partIcon, partsOf } from '@/lib/flows';
import { nextSteps, type NextStep } from '@/lib/next-steps';
import { cn } from '@/lib/utils';
import { useRepo } from './repo-shell';
import { Card, ProgressRing, focus } from './ui';

const TONE: Record<NextStep['tone'], string> = {
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent',
  muted: 'bg-surface-2 text-muted',
};

function Metric({ href, icon, label, value, note, children }: { href: string; icon: IconName; label: string; value: ReactNode; note: string; children?: ReactNode }) {
  return (
    <Link href={href} className={cn('group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lift', focus)}>
      {children ?? (
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
          <Icon name={icon} className="h-6 w-6" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-muted">{label}</span>
        <span className="mt-0.5 block text-[26px] font-semibold leading-tight tabular-nums text-ink">{value}</span>
        <span className="block truncate text-[12.5px] text-muted">{note}</span>
      </span>
    </Link>
  );
}

/** One page that says where a project stands: learning, requirements, quality, and what to do next. */
export function OverviewPage() {
  const { bundle, base, progress, status } = useRepo();
  const parts = useMemo(() => partsOf(bundle), [bundle]);
  const features = useMemo(() => new Map(bundle.features.map((feature) => [feature.id, feature])), [bundle.features]);
  const next = pathStates(bundle.plan, progress).find((item) => item.state === 'next')?.lessonId;
  const steps = nextSteps(bundle, status, next);
  const short = bundle.name.replace(/^.*\//, '');
  const qa = status.qa;

  return (
    <>
      <header className="rounded-3xl border border-line bg-gradient-to-br from-accent-soft/70 via-surface to-surface px-5 py-7 shadow-card sm:px-8 sm:py-9">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Overview</p>
        <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight text-ink sm:text-[42px]">{short}</h1>
        <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-ink/80">{bundle.plan.summary.sentence}</p>
        <ul className="mt-5 flex flex-wrap gap-2 text-[13px] text-muted" aria-label="About this project">
          <li className="rounded-lg bg-surface-2 px-3 py-1.5">{bundle.framework.label}</li>
          <li className="rounded-lg bg-surface-2 px-3 py-1.5">{`${bundle.stats.files} files`}</li>
          <li className="rounded-lg bg-surface-2 px-3 py-1.5">{`${bundle.features.length} flows traced`}</li>
          <li className="rounded-lg bg-surface-2 px-3 py-1.5">{`${parts.length} part${parts.length === 1 ? '' : 's'}`}</li>
        </ul>
      </header>

      <section aria-label="Where it stands" className="mt-6 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <Metric href={base} icon="book" label="Learning" value={`${status.lessons.done}/${status.lessons.total}`} note={status.lessons.total ? 'lessons done' : 'no lessons yet'}>
          <ProgressRing value={status.lessons.done} total={status.lessons.total} label="Lessons done" size={56} />
        </Metric>
        <Metric href={`${base}/requirements`} icon="form" label="Requirements" value={status.coverage === undefined ? '—' : `${status.coverage}%`} note={status.coverage === undefined ? 'no document checked yet' : 'covered by the code'} />
        <Metric href={`${base}/quality`} icon="check" label="Risky flows" value={status.risks} note="high and medium, from the code" />
        <Metric href={`${base}/quality`} icon="terminal" label="Last QA run" value={qa ? (qa.failed ? `${qa.failed} failed` : `${qa.passed} passed`) : '—'} note={qa ? `${new Date(qa.at).toLocaleDateString()} · ${qa.warning} to look at` : 'not run yet'} />
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section aria-labelledby="next-heading">
          <h2 id="next-heading" className="text-[20px] font-semibold tracking-tight text-ink">
            What to do next
          </h2>
          {steps.length ? (
            <ol className="mt-4 space-y-3">
              {steps.map((step) => (
                <li key={step.id}>
                  <Link href={`${base}${step.path}`} className={cn('group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors hover:border-accent/40 sm:p-5', focus)}>
                    <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', TONE[step.tone])} aria-hidden="true">
                      <Icon name={step.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15.5px] font-semibold text-ink">{step.title}</span>
                      <span className="block text-[13.5px] leading-relaxed text-muted">{step.text}</span>
                    </span>
                    <Icon name="next" className="h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <Card className="mt-4 p-6 text-[14px] text-muted">Nothing waiting: every lesson is done, the requirements are covered and the last QA run passed.</Card>
          )}
        </section>

        <section aria-labelledby="parts-heading">
          <h2 id="parts-heading" className="text-[20px] font-semibold tracking-tight text-ink">
            How it’s put together
          </h2>
          <ul className="mt-4 space-y-2.5">
            {parts.map((part) => {
              const counts = partCounts(part, features);
              return (
                <li key={part.title} style={{ ['--part' as string]: partHue(parts, part.title) }}>
                  <Link href={base} className={cn('flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-[rgb(var(--part)/0.5)]', focus)}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgb(var(--part)/0.12)] text-[rgb(var(--part))]" aria-hidden="true">
                      <Icon name={partIcon(part.title)} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{part.title}</span>
                      <span className="block text-[12.5px] text-muted">{`${counts.main} main task${counts.main === 1 ? '' : 's'} · ${counts.pages} page${counts.pages === 1 ? '' : 's'} · ${part.lessonIds.length} lesson${part.lessonIds.length === 1 ? '' : 's'}`}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
