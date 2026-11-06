'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@codedna/learn-ui';
import type { Feature } from '@codedna/shared';
import { areasOf, hopsOf, isMain, pageText, partsOf, uniqueFlows, whereText, type HopKind } from '@/lib/flows';
import { cn } from '@/lib/utils';
import { FlowStrip, HOP_STYLE } from './flow-strip';
import { useRepo } from './repo-shell';
import { Card, PageHeader, focus } from './ui';

const LEGEND: { kind: HopKind; label: string }[] = [
  { kind: 'start', label: 'What the person does' },
  { kind: 'check', label: 'A check' },
  { kind: 'logic', label: 'The app’s own code' },
  { kind: 'server', label: 'The server' },
  { kind: 'data', label: 'Data read or saved' },
  { kind: 'service', label: 'Another service' },
  { kind: 'unknown', label: 'Decided while the app runs' },
  { kind: 'end', label: 'What they see at the end' },
];

/** One flow: its name, where it starts, and the line it takes through the app. */
function FlowRow({ feature, href, lessonHref }: { feature: Feature; href: string | undefined; lessonHref: string | undefined }) {
  const hops = hopsOf(feature);
  const [playing, setPlaying] = useState(false);
  return (
    <li className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{feature.title}</p>
          <p className="text-[12px] text-muted">
            {pageText(feature) ?? whereText(feature)}
            {feature.codeName ? (
              <>
                {' · in the code: '}
                <code className="font-mono text-ink/80">{feature.codeName}</code>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[13px]">
          {lessonHref ? (
            <Link href={lessonHref} className={cn('font-medium text-accent hover:underline', focus)}>
              Lesson
            </Link>
          ) : null}
          {href ? (
            <Link href={href} className={cn('font-medium text-accent hover:underline', focus)}>
              Watch →
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex items-start gap-2">
        <button
          type="button"
          onClick={() => setPlaying(true)}
          disabled={playing}
          aria-label={`Play the path of “${feature.title}”`}
          className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line text-accent hover:border-accent/50 disabled:opacity-60', focus)}
        >
          <Icon name="play" className="h-3.5 w-3.5" />
        </button>
        <FlowStrip hops={hops} playing={playing} onDone={() => setPlaying(false)} label={`The path of “${feature.title}”`} />
      </div>
    </li>
  );
}

/**
 * The whole app on one page: its parts, and every flow in each part as a line from what the
 * person does to where it ends. Links between pages are folded away, since they only move around.
 */
export function AppMap() {
  const { bundle, base } = useRepo();
  const [showLinks, setShowLinks] = useState<Record<string, boolean>>({});
  const byId = new Map(bundle.features.map((feature) => [feature.id, feature]));
  const lessonOf = new Map(Object.values(bundle.plan.lessons).map((lesson) => [lesson.featureId, lesson.id]));
  const storyHref = (id: string) => (bundle.slugs[id] ? `${base}/story/${bundle.slugs[id]}` : undefined);
  const areas = areasOf(bundle);
  const parts = partsOf(bundle).filter((part) => part.featureIds.some((id) => byId.get(id)?.entryKind !== 'link'));
  const featuresIn = (featureIds: readonly string[]) => featureIds.map((id) => byId.get(id)).filter((feature): feature is Feature => !!feature);
  const linkOnly = areas
    .map((area) => ({ title: area.title, features: featuresIn(area.featureIds) }))
    .filter(({ features }) => features.length && features.every((feature) => feature.entryKind === 'link'))
    .map(({ title, features }) => ({ title, links: features }));
  const flows = bundle.features.filter((feature) => feature.entryKind !== 'link');
  const data = new Set(flows.flatMap((feature) => hopsOf(feature).filter((hop) => hop.kind === 'data').map((hop) => hop.label.replace(/^(?:Saves|Reads) /, ''))));

  return (
    <>
      <PageHeader title="App map">
        Every flow in {bundle.name}, part by part. Each line runs from what a person does to where it ends: the screen, the server or the data.
      </PageHeader>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="The app in numbers">
        {[
          `${parts.length} part${parts.length === 1 ? '' : 's'}`,
          `${flows.filter(isMain).length} main task${flows.filter(isMain).length === 1 ? '' : 's'}`,
          `${flows.length - flows.filter(isMain).length} small detail${flows.length - flows.filter(isMain).length === 1 ? '' : 's'}`,
          data.size ? `${data.size} kind${data.size === 1 ? '' : 's'} of data` : null,
          `${bundle.plan.path.length} lesson${bundle.plan.path.length === 1 ? '' : 's'}`,
        ]
          .filter((text): text is string => !!text)
          .map((text) => (
          <li key={text} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink shadow-card">
            {text}
          </li>
        ))}
      </ul>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label="What the colours mean">
        {LEGEND.map((item) => (
          <li key={item.kind} className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cn('h-3 w-3 rounded-full border', HOP_STYLE[item.kind])} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>

      {flows.length === 0 ? (
        <Card className="mt-8 max-w-2xl">
          <h2 className="text-lg font-semibold text-ink">No flows to draw yet</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">CodeDNA didn’t find anything a person can do here, such as a button with a click handler, a form or an API route.</p>
        </Card>
      ) : null}

      <div className="mt-8 space-y-6">
        {areas.map((area) => {
          const features = featuresIn(area.featureIds);
          const actions = features.filter((feature) => feature.entryKind !== 'link');
          // The same button drawn twice (desktop and mobile menus) is drawn once.
          const main = uniqueFlows(actions.filter(isMain)).map(({ feature }) => feature);
          // Small details and links are folded together: they only move around or tidy the screen.
          const links = features.filter((feature) => !isMain(feature));
          // Parts with only links get one shared card at the end, instead of a card saying "0 flows".
          if (!actions.length) return null;
          return (
            <Card as="section" key={area.title} className="p-4 sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  {area.section && area.section !== area.title ? <p className="text-[12px] font-semibold uppercase tracking-wider text-accent">{area.section}</p> : null}
                  <h2 className="text-lg font-semibold tracking-tight text-ink">{area.title}</h2>
                  <p className="text-[14px] text-muted">{area.summary}</p>
                </div>
                <span className="text-[13px] text-muted">
                  {main.length} main task{main.length === 1 ? '' : 's'}
                  {area.lessonIds.length ? ` · ${area.lessonIds.length} lesson${area.lessonIds.length === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              {main.length ? (
                <ul className="mt-4 space-y-2.5">
                  {main.map((feature) => {
                    const lessonId = lessonOf.get(feature.id);
                    return <FlowRow key={feature.id} feature={feature} href={storyHref(feature.id)} lessonHref={lessonId ? `${base}/learn/${lessonId}` : undefined} />;
                  })}
                </ul>
              ) : null}
              {links.length ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowLinks({ ...showLinks, [area.title]: !showLinks[area.title] })}
                    aria-expanded={!!showLinks[area.title]}
                    className={cn('inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-accent hover:underline', focus)}
                  >
                    <Icon name="next" className={cn('h-3.5 w-3.5 transition-transform', showLinks[area.title] && 'rotate-90')} />
                    {links.length} small detail{links.length === 1 ? '' : 's'} and link{links.length === 1 ? '' : 's'}
                  </button>
                  {showLinks[area.title] ? (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {links.map((feature) => (
                        <li key={feature.id} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink">
                          {feature.title}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
        {linkOnly.length ? (
          <Card as="section" className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Links between pages</h2>
            <p className="text-[14px] text-muted">These parts only have links that move people to another page. Nothing else happens there.</p>
            <ul className="mt-3 space-y-2">
              {linkOnly.map(({ title, links }) => (
                <li key={title} className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[13px] font-semibold text-ink">{title}</span>
                  {links.map((feature) => (
                    <span key={feature.id} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink">
                      {feature.title}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
