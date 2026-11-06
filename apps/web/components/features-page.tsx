'use client';
import Link from 'next/link';
import { Icon } from '@codedna/learn-ui';
import type { EntryKind, Feature } from '@codedna/shared';
import { cn } from '@/lib/utils';
import { isMain, pageText, partIcon, partsOf, uniqueFlows } from '@/lib/flows';
import { useRepo } from './repo-shell';
import { ButtonLink, Card, Difficulty, PageHeader, focus } from './ui';

const KIND: Record<EntryKind, string> = {
  'event-handler': 'Button or input',
  'form-action': 'Form',
  link: 'Link',
  'route-handler': 'API route',
  'server-action': 'Server function',
};

function FeatureCard({ feature, count }: { feature: Feature; count: number }) {
  const { bundle, base } = useRepo();
  const gaps = feature.steps.filter((step) => step.confidence === 'gap').length;
  const where = pageText(feature);
  return (
    <li>
      <Link
        href={`${base}/story/${bundle.slugs[feature.id]}`}
        className="block h-full rounded-2xl border border-line bg-surface p-5 shadow-card transition-all hover:border-accent/40 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{KIND[feature.entryKind]}</p>
        <h4 className="mt-1 font-semibold text-ink">{feature.title}</h4>
        {feature.codeName || where ? (
          <p className="mt-0.5 truncate text-[12px] text-muted">
            {where}
            {where && feature.codeName ? ' · ' : null}
            {feature.codeName ? <code className="font-mono">{feature.codeName}</code> : null}
          </p>
        ) : null}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{feature.steps.length} steps</span>
          {count > 1 ? <span>in {count} places</span> : null}
          <Difficulty level={feature.difficulty} />
          {gaps ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <Icon name="unknown" className="h-4 w-4" /> {gaps} unknown part{gaps === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>
      </Link>
    </li>
  );
}

/** Small details and links, folded: one line each, still one click from their story. */
function Details({ features }: { features: Feature[] }) {
  const { bundle, base } = useRepo();
  if (!features.length) return null;
  const unique = uniqueFlows(features);
  return (
    <details className="group mt-3 rounded-xl border border-dashed border-line">
      <summary className={cn('flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-[14px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden', focus)}>
        <Icon name="next" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
        {features.length} small detail{features.length === 1 ? '' : 's'} and link{features.length === 1 ? '' : 's'}
      </summary>
      <ul className="flex flex-wrap gap-2 px-3 pb-3">
        {unique.map(({ feature, count }) => (
          <li key={feature.id}>
            <Link href={`${base}/story/${bundle.slugs[feature.id]}`} title={pageText(feature)} className={cn('inline-flex min-h-[32px] max-w-[300px] items-center rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-accent/50', focus)}>
              <span className="truncate">{feature.title}</span>
              {count > 1 ? <span className="ml-1 shrink-0 text-muted">×{count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FeaturesPage() {
  const { bundle, base } = useRepo();
  // Grouped by big part, then area: the same parts as the learning path and the map.
  const byId = new Map(bundle.features.map((feature) => [feature.id, feature]));
  const parts = partsOf(bundle)
    .map((part) => ({
      ...part,
      areas: part.areas
        .map((area) => ({ title: area.title, features: area.featureIds.map((id) => byId.get(id)).filter((feature): feature is Feature => !!feature) }))
        .filter((area) => area.features.length),
    }))
    .filter((part) => part.areas.length);
  return (
    <>
      <PageHeader title="Features">Everything people can do in {bundle.name}, part by part. The main tasks come first; small details like typing are folded. Open one to watch its story.</PageHeader>
      {parts.length === 0 ? (
        <Card className="mt-8 max-w-2xl">
          <h2 className="text-lg font-semibold text-ink">No features found</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">CodeDNA didn’t find anything a person can do here yet, such as a button with a click handler, a form or an API route.</p>
          <ButtonLink href={base} variant="secondary" className="mt-4">
            Back to the overview
          </ButtonLink>
        </Card>
      ) : null}
      <div className="mt-8 space-y-10">
        {parts.map((part, partIndex) => {
          const single = part.areas.length === 1 && part.areas[0]!.title === part.title;
          return (
            <section key={part.title} aria-labelledby={`part-${partIndex}`}>
              <h2 id={`part-${partIndex}`} className="flex items-center gap-2.5 border-b border-line pb-2 text-lg font-semibold tracking-tight text-ink">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden="true">
                  <Icon name={partIcon(part.title)} className="h-4 w-4" />
                </span>
                {part.title}
              </h2>
              <div className="mt-4 space-y-6">
                {part.areas.map((area) => {
                  const main = area.features.filter(isMain);
                  const rest = area.features.filter((feature) => !isMain(feature));
                  return (
                    <section key={area.title} aria-label={area.title}>
                      {single ? null : <h3 className="text-[15px] font-semibold text-ink">{area.title}</h3>}
                      {main.length ? <ul className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', !single && 'mt-2.5')}>{uniqueFlows(main).map(({ feature, count }) => <FeatureCard key={feature.id} feature={feature} count={count} />)}</ul> : null}
                      <Details features={rest} />
                    </section>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
