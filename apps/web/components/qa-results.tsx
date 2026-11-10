'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Icon, type IconName } from '@codedna/learn-ui';
import { qaTotals, type QaCheck, type QaStatus } from '@codedna/shared';
import type { QaReportState } from '@/lib/qa-results';
import { cn } from '@/lib/utils';
import { useRepo } from './repo-shell';
import { Card, focus } from './ui';

export const QA_STATUS: Record<QaStatus, { label: string; icon: IconName; chip: string; dot: string }> = {
  failed: { label: 'Failed', icon: 'unknown', chip: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  warning: { label: 'Look at', icon: 'logic', chip: 'bg-warning-soft text-warning', dot: 'bg-warning' },
  passed: { label: 'Passed', icon: 'done', chip: 'bg-success-soft text-success', dot: 'bg-success' },
  skipped: { label: 'Skipped', icon: 'next', chip: 'bg-surface-2 text-muted', dot: 'bg-muted' },
};
const ORDER: QaStatus[] = ['failed', 'warning', 'passed', 'skipped'];

export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-code py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{text}</code>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
        className={cn('h-8 shrink-0 rounded-lg border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-accent/50', focus)}
        aria-label={`Copy: ${text}`}
      >
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

/** How to run the QA agent, for the side of the page and the empty state. */
export function RunQaHelp({ compact }: { compact?: boolean }) {
  const { base } = useRepo();
  return (
    <div className={cn('space-y-2.5 text-[13px] leading-relaxed text-muted', compact && 'text-[12.5px]')}>
      <p>In your project folder, on your computer:</p>
      <Command text="codedna qa" />
      <p>runs your own tests. Add your app’s address — running on this computer or deployed — to also open each page and flow in a hidden browser:</p>
      <Command text="codedna qa --url http://localhost:3000" />
      <p>
        Add <code className="font-mono text-ink">--interact</code> to fill in forms with test data — only on a test copy, since it can change data. CodeDNA shows the plan and asks before anything runs. To test with one click, or on every deploy, see{' '}
        <Link href={`${base}/qa`} className={cn('font-medium text-accent hover:underline', focus)}>
          QA flows
        </Link>
        .
      </p>
      <p className="text-[12px]">
        Not on npm yet: from the CodeDNA folder use <code className="font-mono text-ink">pnpm codedna qa path/to/app</code>.
      </p>
    </div>
  );
}

function CheckRow({ check }: { check: QaCheck }) {
  const { bundle, base } = useRepo();
  const feature = check.featureId ? bundle.features.find((item) => item.id === check.featureId) : undefined;
  const slug = check.featureId ? bundle.slugs[check.featureId] : undefined;
  const look = QA_STATUS[check.status];
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', look.chip)}>
          <Icon name={look.icon} className="h-3 w-3" />
          {look.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-medium leading-snug text-ink">{check.title}</p>
          {check.detail ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{check.detail}</p> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            {check.page ? <code className="font-mono text-muted">{check.page}</code> : null}
            {feature && slug ? (
              <Link href={`${base}/story/${slug}`} className={cn('font-medium text-accent hover:underline', focus)}>
                {`See “${feature.title}” →`}
              </Link>
            ) : null}
            {check.durationMs !== undefined ? <span className="text-muted">{check.durationMs < 1000 ? `${check.durationMs} ms` : `${(check.durationMs / 1000).toFixed(1)} s`}</span> : null}
          </div>
          {check.evidence?.length ? (
            <details className="mt-2">
              <summary className={cn('cursor-pointer text-[12.5px] font-medium text-accent', focus)}>What CodeDNA saw</summary>
              <pre className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-code p-2.5 font-mono text-[11.5px] leading-5 text-ink" tabIndex={0}>
                {check.evidence.join('\n')}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** The "Test runs" view: the last QA report, or how to make one. */
export function QaResults({ qa }: { qa: QaReportState }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [filter, setFilter] = useState<QaStatus | 'all'>('all');
  const picker = (
    <>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="QA report file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void qa.loadFile(file).then(setProblem);
        }}
      />
      <button type="button" onClick={() => input.current?.click()} className={cn('inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[14px] font-medium text-ink hover:border-accent/50', focus)}>
        <Icon name="form" className="h-4 w-4" /> Load a report file
      </button>
    </>
  );
  const problemNote = problem ? (
    <p role="alert" className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-warning">
      {problem}
    </p>
  ) : null;

  if (qa.loading) return <p className="text-[14px] text-muted" role="status">Looking for test results…</p>;
  if (!qa.report)
    return (
      <Card className="p-6 sm:p-8">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
          <Icon name="terminal" className="h-6 w-6" />
        </span>
        <h3 className="mt-4 text-[18px] font-semibold text-ink">No test runs yet</h3>
        <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-muted">The QA agent runs on your computer, never on a server. Run it, then open CodeDNA from the same folder — or load the report file here.</p>
        <div className="mt-5 max-w-xl">
          <RunQaHelp />
        </div>
        <div className="mt-5">{picker}</div>
        {problemNote}
      </Card>
    );

  const report = qa.report;
  const totals = qaTotals(report);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-muted">
          {`Ran ${new Date(report.createdAt).toLocaleString()}`}
          {report.appUrl ? ` · against ${report.appUrl}` : ''}
          {` · ${qa.origin === 'local' ? 'from your project folder' : 'from a loaded file'}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {picker}
          {qa.origin === 'file' ? (
            <button type="button" onClick={qa.forget} className={cn('inline-flex h-10 items-center rounded-xl px-3 text-[14px] font-medium text-muted hover:text-ink', focus)}>
              Forget this report
            </button>
          ) : null}
        </div>
      </div>
      {problemNote}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDER.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={filter === status}
            onClick={() => setFilter(filter === status ? 'all' : status)}
            className={cn('rounded-2xl border bg-surface p-4 text-left shadow-card transition-colors', filter === status ? 'border-accent' : 'border-line hover:border-accent/40', focus)}
          >
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <span className={cn('h-2.5 w-2.5 rounded-full', QA_STATUS[status].dot)} aria-hidden="true" />
              {QA_STATUS[status].label}
            </span>
            <span className="mt-1 block text-[28px] font-semibold tabular-nums leading-tight text-ink">{totals[status]}</span>
          </button>
        ))}
      </div>
      {report.suites.map((suite) => {
        const checks = suite.checks.filter((check) => filter === 'all' || check.status === filter).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
        return (
          <section key={suite.runner} aria-labelledby={`suite-${suite.runner}`} className="rounded-2xl border border-line bg-surface-2/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`suite-${suite.runner}`} className="text-[16px] font-semibold text-ink">
                {suite.title}
              </h3>
              <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', QA_STATUS[suite.status].chip)}>{QA_STATUS[suite.status].label}</span>
              {suite.note ? <code className="font-mono text-[12px] text-muted">{suite.note}</code> : null}
            </div>
            {checks.length ? (
              <ul className="mt-3 space-y-2">
                {checks.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13.5px] text-muted">{suite.checks.length ? 'Nothing at this level.' : (suite.note ?? 'Nothing was checked.')}</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
