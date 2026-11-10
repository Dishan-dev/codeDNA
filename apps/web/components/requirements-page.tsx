'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Icon, type IconName } from '@codedna/learn-ui';
import { ACCEPT, DocumentError, FORMATS_TEXT, readDocument } from '@/lib/documents';
import { matchRequirements, parseRequirements, type CoverageStatus, type RequirementMatch } from '@/lib/requirements';
import { cn } from '@/lib/utils';
import { useRepo } from './repo-shell';
import { Card, PageHeader, focus } from './ui';

interface SavedDoc {
  name: string;
  text: string;
  at: string;
}

const KEY = (id: string) => `codedna:srs:${id}`;
/** Long enough for a large SRS, small enough for browser storage. */
const MAX_TEXT = 400_000;

export const STATUS_LOOK: Record<CoverageStatus, { label: string; icon: IconName; chip: string; bar: string }> = {
  built: {
    label: 'Built',
    icon: 'done',
    chip: 'bg-success-soft text-success',
    bar: 'bg-success',
  },
  partial: {
    label: 'Partly built',
    icon: 'logic',
    chip: 'bg-warning-soft text-warning',
    bar: 'bg-warning',
  },
  missing: {
    label: 'Not found',
    icon: 'unknown',
    chip: 'bg-danger-soft text-danger',
    bar: 'bg-danger/70',
  },
};

/** A sample brief for the Snackshop starter, so the page can be tried without a document. */
const SNACKSHOP_SAMPLE = `# Snackshop — client requirements

## Ordering
FR-1 The customer shall be able to place an order from the checkout page.
FR-2 The customer can apply a coupon code to get a discount.
FR-3 Customers must be able to save snacks to their favourites.
FR-4 The customer can search snacks by name.

## Back office
FR-5 Admins can export orders as a report.
FR-6 The system shall send a confirmation email after each order.
FR-7 Users shall reset their password by email.`;

function PercentRing({ value }: { value: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={`Requirements covered: ${value}%`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-surface-2" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className="stroke-accent transition-[stroke-dashoffset] duration-1000"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center" aria-hidden="true">
        <span>
          <span className="block text-[34px] font-semibold leading-none tabular-nums text-ink">{value}%</span>
          <span className="mt-1 block text-[12px] text-muted">covered</span>
        </span>
      </span>
    </div>
  );
}

/** Before a document: drop or paste one, with a plain account of how it is read. */
function Intake({ onDoc }: { onDoc: (doc: SavedDoc) => void }) {
  const { bundle } = useRepo();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [reading, setReading] = useState<string | undefined>();
  const read = (file: File) => {
    setProblem(undefined);
    setReading(file.name);
    readDocument(file)
      .then((content) => {
        // Only the text is kept, and only what fits in browser storage.
        const kept = content.slice(0, MAX_TEXT);
        if (!parseRequirements(kept).length) return setProblem('No requirements found in that file. Numbered items, bullets or “shall / must” sentences work best.');
        onDoc({ name: file.name, text: kept, at: new Date().toISOString() });
      })
      .catch((error: unknown) => setProblem(error instanceof DocumentError ? error.message : 'That file couldn’t be read.'))
      .finally(() => setReading(undefined));
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file) read(file);
  };
  const paste = () => {
    if (!parseRequirements(text).length) return setProblem('No requirements found yet. Put each one on its own line, numbered or as a bullet, or as a “shall / must” sentence.');
    onDoc({ name: 'Pasted requirements', text, at: new Date().toISOString() });
  };
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-5 sm:p-7">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn('flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors', over ? 'border-accent bg-accent-soft/50' : 'border-line bg-bg/40')}
        >
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent" aria-hidden="true">
            <Icon name="form" className="h-7 w-7" />
          </span>
          <p className="mt-4 text-[18px] font-semibold text-ink">Drop your SRS or client brief here</p>
          <p className="mt-1 text-[14px] text-muted">{FORMATS_TEXT}. It’s read in this browser and never uploaded.</p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!reading}
            className={cn('mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-on-accent shadow-card hover:opacity-95 disabled:cursor-wait disabled:opacity-70', focus)}
          >
            {reading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-on-accent/40 border-t-on-accent" aria-hidden="true" /> : null}
            {reading ? 'Reading…' : 'Choose a file'}
          </button>
          {reading ? (
            <p role="status" className="mt-3 text-[13px] text-muted">
              Reading {reading}…
            </p>
          ) : null}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Requirements file"
            onChange={(event) => {
              if (event.target.files?.[0]) read(event.target.files[0]);
              event.target.value = '';
            }}
          />
        </div>
        <div className="mt-6">
          <label htmlFor="srs-text" className="text-[14px] font-semibold text-ink">
            Or paste the requirements
          </label>
          <textarea
            id="srs-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={'FR-1 The customer shall be able to place an order.\nFR-2 Admins can export orders as a report.\n…'}
            className="mt-2 w-full rounded-xl border border-line bg-surface p-3 font-mono text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={paste} disabled={!text.trim()} className={cn('inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-[15px] font-semibold text-bg disabled:opacity-40', focus)}>
              <Icon name="check" className="h-4 w-4" /> Check coverage
            </button>
            {bundle.id === 'snackshop' ? (
              <button
                type="button"
                onClick={() =>
                  onDoc({
                    name: 'Snackshop sample brief',
                    text: SNACKSHOP_SAMPLE,
                    at: new Date().toISOString(),
                  })
                }
                className={cn('inline-flex h-11 items-center rounded-xl border border-line px-4 text-[14px] font-medium text-ink hover:border-accent/50', focus)}
              >
                Try the sample brief
              </button>
            ) : null}
          </div>
          {problem ? (
            <p role="alert" className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-[13.5px] text-warning">
              {problem}
            </p>
          ) : null}
        </div>
      </Card>
      <Card className="h-fit p-5 sm:p-6">
        <h2 className="text-[16px] font-semibold text-ink">How the check works</h2>
        <ol className="mt-4 space-y-4">
          {[
            ['form', 'Reads your document', 'Numbered items (FR-3, 2.1), bullets and “shall / must” sentences become requirements, grouped under their headings.'],
            ['branch', 'Matches them to the code', 'Each one is compared with the flows CodeDNA traced: their names, pages, steps and the data they touch.'],
            ['check', 'Shows coverage with evidence', 'Built, partly built or not found, with the flows and the words that matched, so you can judge each one.'],
          ].map(([icon, title, text], index) => (
            <li key={title} className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-[13px] font-semibold text-ink">{index + 1}</span>
              <span>
                <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Icon name={icon as IconName} className="h-4 w-4 text-accent" /> {title}
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 rounded-xl border border-line bg-surface-2/60 p-3 text-[12.5px] leading-relaxed text-muted">
          Matching is by meaning-bearing words and synonyms, not by understanding, so treat it as a strong hint. Your document is kept in this browser only and never sent anywhere.
        </p>
      </Card>
    </div>
  );
}

function MatchRow({ match }: { match: RequirementMatch }) {
  const { bundle, base } = useRepo();
  const look = STATUS_LOOK[match.status];
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold', look.chip)}>
          <Icon name={look.icon} className="h-3.5 w-3.5" />
          {look.label}
        </span>
        <span className="shrink-0 pt-1 font-mono text-[12px] text-muted">{match.requirement.id}</span>
        <p className="min-w-0 flex-1 basis-64 text-[15px] leading-relaxed text-ink">{match.requirement.text}</p>
        <span className="shrink-0 pt-1 text-[12.5px] tabular-nums text-muted" title="How much of the requirement’s meaning was found in the code">{`${Math.round(match.score * 100)}% match`}</span>
      </div>
      {match.features.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-0 sm:pl-[7.5rem]">
          <span className="text-[12.5px] text-muted">{match.status === 'missing' ? 'Closest flow:' : 'Built by:'}</span>
          {match.features.map(({ feature, words }) => (
            <Link
              key={feature.id}
              href={`${base}/story/${bundle.slugs[feature.id]}`}
              title={`Matched: ${words.join(', ')}`}
              className={cn('inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-line bg-bg/60 px-2.5 text-[13px] text-ink hover:border-accent/50', focus)}
            >
              <Icon name="play" className="h-3 w-3 text-accent" />
              {feature.title}
              {feature.pageTitle ? <span className="text-muted">{`· ${feature.pageTitle}`}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
      {match.missingWords.length && match.status !== 'built' ? (
        <p className="mt-2 text-[12.5px] text-muted sm:pl-[7.5rem]">
          Not found in the code: <span className="font-medium text-ink/80">{match.missingWords.join(', ')}</span>
        </p>
      ) : null}
    </li>
  );
}

/**
 * Requirements: how much of a requirements document the code already builds, what is partly
 * there and what is missing, each with the flows that build it.
 */
export function RequirementsPage() {
  const { bundle } = useRepo();
  const [doc, setDoc] = useState<SavedDoc | null>(null);
  const [filter, setFilter] = useState<CoverageStatus | 'all'>('all');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY(bundle.id));
      if (saved) setDoc(JSON.parse(saved) as SavedDoc);
    } catch {
      // Storage may be blocked; the document can be added again.
    }
  }, [bundle.id]);
  const save = (next: SavedDoc | null) => {
    setDoc(next);
    setFilter('all');
    try {
      if (next) window.localStorage.setItem(KEY(bundle.id), JSON.stringify(next));
      else window.localStorage.removeItem(KEY(bundle.id));
    } catch {
      // Keeping the document between visits is only a convenience.
    }
  };
  const coverage = useMemo(() => (doc ? matchRequirements(parseRequirements(doc.text), bundle.features) : null), [doc, bundle.features]);
  const groups = useMemo(() => {
    const map = new Map<string, RequirementMatch[]>();
    for (const match of coverage?.matches ?? []) map.set(match.requirement.group ?? 'Requirements', [...(map.get(match.requirement.group ?? 'Requirements') ?? []), match]);
    return [...map];
  }, [coverage]);

  return (
    <>
      <PageHeader
        eyebrow={<span className="text-[12px] font-semibold uppercase tracking-wider text-accent">Deliver</span>}
        title="Requirements"
        actions={
          doc ? (
            <button type="button" onClick={() => save(null)} className={cn('inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-[14px] font-medium text-ink hover:border-accent/50', focus)}>
              <Icon name="replay" className="h-4 w-4" /> Use another document
            </button>
          ) : null
        }
      >
        Check a requirements document against the code: how much is built, what’s partly there and what’s still missing.
      </PageHeader>

      {!doc || !coverage ? (
        <Intake onDoc={save} />
      ) : (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <Card className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-7">
              <PercentRing value={coverage.percent} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Icon name="form" className="h-4 w-4" />
                  <span className="truncate">{doc.name}</span>
                  <span aria-hidden="true">·</span>
                  {`${coverage.matches.length} requirements`}
                </p>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                  {(['built', 'partial', 'missing'] as const).map((status) => (
                    <span
                      key={status}
                      className={cn('h-full transition-[width] duration-700', STATUS_LOOK[status].bar)}
                      style={{
                        width: `${(coverage[status] / Math.max(1, coverage.matches.length)) * 100}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {(['built', 'partial', 'missing'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={filter === status}
                      onClick={() => setFilter(filter === status ? 'all' : status)}
                      className={cn('rounded-xl border p-3 text-left transition-colors', filter === status ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-accent/40', focus)}
                    >
                      <span className="block text-[24px] font-semibold tabular-nums leading-none text-ink">{coverage[status]}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">
                        <span className={cn('h-2 w-2 rounded-full', STATUS_LOOK[status].bar)} aria-hidden="true" />
                        {STATUS_LOOK[status].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {groups.map(([group, matches]) => {
              const shown = matches.filter((match) => filter === 'all' || match.status === filter);
              if (!shown.length) return null;
              return (
                <section key={group} aria-labelledby={`req-${group}`}>
                  <h2 id={`req-${group}`} className="mb-3 text-[17px] font-semibold tracking-tight text-ink">
                    {group}
                  </h2>
                  <ul className="space-y-2.5">
                    {shown.map((match) => (
                      <MatchRow key={`${match.requirement.id}:${match.requirement.text}`} match={match} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">By section</h2>
              <ul className="mt-3 space-y-3">
                {groups.map(([group, matches]) => {
                  const built = matches.filter((match) => match.status === 'built').length;
                  const partial = matches.filter((match) => match.status === 'partial').length;
                  const percent = Math.round(((built + partial / 2) / matches.length) * 100);
                  return (
                    <li key={group}>
                      <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
                        <span className="truncate font-medium text-ink">{group}</span>
                        <span className="shrink-0 tabular-nums text-muted">{`${percent}%`}</span>
                      </div>
                      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                        <span
                          className="h-full bg-success"
                          style={{
                            width: `${(built / matches.length) * 100}%`,
                          }}
                        />
                        <span
                          className="h-full bg-warning"
                          style={{
                            width: `${(partial / matches.length) * 100}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Reading the result</h2>
              <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
                <li>
                  <strong className="text-ink">Built</strong>: a traced flow covers most of what the requirement says.
                </li>
                <li>
                  <strong className="text-ink">Partly built</strong>: some of it is in the code; the missing words show what’s not.
                </li>
                <li>
                  <strong className="text-ink">Not found</strong>: nothing in the traced flows matches. It may be missing, or built in a way CodeDNA can’t read yet.
                </li>
              </ul>
              <p className="mt-3 text-[12px] text-muted">{`Checked ${new Date(doc.at).toLocaleString()} · kept in this browser only.`}</p>
            </Card>
          </aside>
        </div>
      )}
    </>
  );
}
