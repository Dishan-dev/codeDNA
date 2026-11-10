'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Icon, RichText } from '@codedna/learn-ui';
import type { Feature } from '@codedna/shared';
import { pageText } from '@/lib/flows';
import { KIND_LABEL, SEVERITY_ORDER, scanQuality, type Severity } from '@/lib/quality';
import { cn } from '@/lib/utils';
import { QaResults, RunQaHelp } from './qa-results';
import { useRepo } from './repo-shell';
import { Card, PageHeader, focus } from './ui';

const SEVERITY: Record<Severity, { label: string; chip: string; dot: string }> = {
  high: {
    label: 'High',
    chip: 'bg-danger-soft text-danger',
    dot: 'bg-danger',
  },
  medium: {
    label: 'Medium',
    chip: 'bg-warning-soft text-warning',
    dot: 'bg-warning',
  },
  low: { label: 'Low', chip: 'bg-surface-2 text-muted', dot: 'bg-muted' },
};
const TRIED_KEY = (id: string) => `codedna:qa-tried:${id}`;
type Tab = 'findings' | 'edge' | 'runs';

/**
 * Quality: a QA scan read from the code. Findings say where a flow is risky; edge cases say what
 * to try, made from the real conditions on each flow, and tick off as you test them.
 */
export function QualityPage() {
  const { bundle, base, qa } = useRepo();
  const report = useMemo(() => scanQuality(bundle), [bundle]);
  const byId = useMemo(() => new Map<string, Feature>(bundle.features.map((feature) => [feature.id, feature])), [bundle.features]);
  const runs = qa.report ? qa.report.suites.reduce((sum, suite) => sum + suite.checks.length, 0) : 0;
  const [tab, setTab] = useState<Tab>('findings');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [tried, setTried] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TRIED_KEY(bundle.id));
      if (saved) setTried(new Set(JSON.parse(saved) as string[]));
    } catch {
      // Storage may be blocked; ticks then last for this visit.
    }
  }, [bundle.id]);
  const toggle = (key: string) =>
    setTried((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(TRIED_KEY(bundle.id), JSON.stringify([...next]));
      } catch {
        // Keeping the ticks is only a convenience.
      }
      return next;
    });
  const totalCases = [...report.edgeCases.values()].reduce((sum, cases) => sum + cases.length, 0);
  const triedCount = [...report.edgeCases].reduce((sum, [id, cases]) => sum + cases.filter((item) => tried.has(`${id}|${item}`)).length, 0);
  const findings = report.findings.filter((finding) => severity === 'all' || finding.severity === severity);
  const storyHref = (id: string) => (bundle.slugs[id] ? `${base}/story/${bundle.slugs[id]}` : undefined);

  return (
    <>
      <PageHeader eyebrow={<span className="text-[12px] font-semibold uppercase tracking-wider text-accent">Deliver</span>} title="Quality">
        Where flows are risky and the edge cases worth trying, read from the code — and, when you run the QA agent on your computer, what your tests and a real browser found.
      </PageHeader>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {SEVERITY_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={tab === 'findings' && severity === level}
            onClick={() => {
              setTab('findings');
              setSeverity(severity === level ? 'all' : level);
            }}
            className={cn('rounded-2xl border bg-surface p-4 text-left shadow-card transition-colors', tab === 'findings' && severity === level ? 'border-accent' : 'border-line hover:border-accent/40', focus)}
          >
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <span className={cn('h-2.5 w-2.5 rounded-full', SEVERITY[level].dot)} aria-hidden="true" />
              {`${SEVERITY[level].label} risk`}
            </span>
            <span className="mt-1 block text-[30px] font-semibold tabular-nums leading-tight text-ink">{report.counts[level]}</span>
          </button>
        ))}
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <span className="text-[13px] text-muted">Flows scanned</span>
          <span className="mt-1 block text-[30px] font-semibold tabular-nums leading-tight text-ink">{report.scanned}</span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <span className="text-[13px] text-muted">Edge cases tried</span>
          <span className="mt-1 block text-[30px] font-semibold tabular-nums leading-tight text-ink">
            {triedCount}
            <span className="text-[18px] font-medium text-muted">{` / ${totalCases}`}</span>
          </span>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div role="tablist" aria-label="Quality views" className="inline-flex gap-1 rounded-xl border border-line bg-surface-2 p-1">
            {(
              [
                ['findings', `Findings · ${report.findings.length}`],
                ['edge', `Edge cases · ${totalCases}`],
                ['runs', qa.report ? `Test runs · ${runs}` : 'Test runs'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls="quality-panel"
                onClick={() => setTab(id)}
                className={cn('h-9 rounded-lg px-4 text-[14px] font-medium', tab === id ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink', focus)}
              >
                {label}
              </button>
            ))}
          </div>

          <div id="quality-panel" role="tabpanel" className="mt-4">
            {tab === 'runs' ? (
              <QaResults qa={qa} />
            ) : tab === 'findings' ? (
              findings.length ? (
                <ul className="space-y-2.5">
                  {findings.map((finding) => {
                    const feature = finding.featureId ? byId.get(finding.featureId) : undefined;
                    const href = finding.featureId ? storyHref(finding.featureId) : undefined;
                    const cases = finding.featureId ? (report.edgeCases.get(finding.featureId) ?? []) : [];
                    return (
                      <li key={finding.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', SEVERITY[finding.severity].chip)}>{SEVERITY[finding.severity].label}</span>
                          <span className="text-[12.5px] font-medium text-muted">{KIND_LABEL[finding.kind]}</span>
                        </div>
                        <h3 className="mt-2 text-[16px] font-semibold leading-snug text-ink">{finding.title}</h3>
                        <p className="mt-1 text-[14px] leading-relaxed text-muted">
                          <RichText text={finding.plain} />
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
                          {finding.where ? <code className="font-mono text-[12px] text-muted">{finding.where}</code> : null}
                          {feature && pageText(feature) ? <span className="text-muted">{pageText(feature)}</span> : null}
                          {href ? (
                            <Link href={href} className={cn('font-medium text-accent hover:underline', focus)}>
                              See the flow →
                            </Link>
                          ) : null}
                          {cases.length ? (
                            <button type="button" onClick={() => setTab('edge')} className={cn('font-medium text-accent hover:underline', focus)}>
                              {`${cases.length} edge case${cases.length === 1 ? '' : 's'} to try`}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Card className="p-6 text-[14px] text-muted">No findings at this level. That means nothing stood out when reading the code, not that it’s tested.</Card>
              )
            ) : totalCases ? (
              <ul className="space-y-3">
                {[...report.edgeCases].map(([id, cases]) => {
                  const feature = byId.get(id);
                  if (!feature) return null;
                  const done = cases.filter((item) => tried.has(`${id}|${item}`)).length;
                  return (
                    <li key={id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="text-[16px] font-semibold text-ink">{feature.title}</h3>
                        <span className="text-[12.5px] tabular-nums text-muted">{`${done} of ${cases.length} tried`}</span>
                      </div>
                      {pageText(feature) ? <p className="text-[13px] text-muted">{pageText(feature)}</p> : null}
                      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                        {cases.map((item) => {
                          const key = `${id}|${item}`;
                          const checked = tried.has(key);
                          return (
                            <li key={item}>
                              <label
                                className={cn(
                                  'flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[13.5px] transition-colors',
                                  checked ? 'border-success/40 bg-success-soft/50 text-ink' : 'border-line hover:border-accent/40',
                                )}
                              >
                                <input type="checkbox" checked={checked} onChange={() => toggle(key)} className="h-4 w-4 shrink-0 accent-[rgb(var(--color-success))]" />
                                <span className={checked ? 'line-through decoration-muted' : ''}>{item}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Card className="p-6 text-[14px] text-muted">No edge cases yet: the flows here don’t have conditions CodeDNA can turn into clear things to try.</Card>
            )}
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <Icon name="code" className="h-4 w-4 text-accent" /> How this scan works
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Every finding and edge case is read from the code CodeDNA traced: missing sign-in or data checks, requests with no error handling, and the conditions each flow tests. It doesn’t run the app, so a finding is
              a place to look, not a proven bug.
            </p>
          </Card>
          {tab === 'runs' && !qa.report ? null : (
            <Card className="p-5">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Icon name="terminal" className="h-4 w-4 text-accent" /> The QA agent
              </h2>
              <div className="mt-3">
                <RunQaHelp compact />
              </div>
              {qa.report ? (
                <button type="button" onClick={() => setTab('runs')} className={cn('mt-3 text-[13px] font-medium text-accent hover:underline', focus)}>
                  See the last run →
                </button>
              ) : null}
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
