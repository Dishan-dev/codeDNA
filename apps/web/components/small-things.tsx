'use client';
import Link from 'next/link';
import { Icon } from '@codedna/learn-ui';
import type { Feature } from '@codedna/shared';
import { isMain, pageText, uniqueFlows } from '@/lib/flows';
import { cn } from '@/lib/utils';
import { useRepo } from './repo-shell';
import { focus } from './ui';

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Everything in an area that isn't a lesson: other main tasks first, then the small details, folded. */
export function SmallThings({ features, label, open }: { features: Feature[]; label?: string; open?: boolean }) {
  const { bundle, base } = useRepo();
  if (!features.length) return null;
  const main = features.filter(isMain);
  const details = features.length - main.length;
  const summary = label ?? [main.length ? plural(main.length, 'more task') : null, details ? plural(details, 'small detail') : null].filter(Boolean).join(' and ');
  return (
    <details className="group rounded-xl border border-dashed border-line bg-surface/60" open={open}>
      <summary className={cn('flex min-h-[44px] cursor-pointer list-none items-center gap-2 rounded-xl px-3 text-[13.5px] text-muted hover:text-ink [&::-webkit-details-marker]:hidden', focus)}>
        <Icon name="next" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <ul className="flex flex-wrap gap-1.5 px-3 pb-3">
        {uniqueFlows([...main, ...features.filter((feature) => !isMain(feature))]).map(({ feature, count }) => {
          const slug = bundle.slugs[feature.id];
          const content = (
            <>
              {isMain(feature) ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" /> : null}
              <span className="max-w-[220px] truncate">{feature.title}</span>
              {count > 1 ? <span className="shrink-0 text-muted">×{count}</span> : null}
            </>
          );
          return (
            <li key={feature.id}>
              {slug ? (
                <Link href={`${base}/story/${slug}`} title={pageText(feature)} className={cn('inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink hover:border-accent/50', focus)}>
                  {content}
                </Link>
              ) : (
                <span className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-line px-2 text-[12.5px] text-ink">{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
