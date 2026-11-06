import type { ReactNode } from 'react';

const base = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40';

/** The two button looks every lesson screen uses. */
export const buttonClass = (kind: 'primary' | 'secondary' | 'quiet' = 'primary') =>
  `${base} ${kind === 'primary' ? 'bg-accent text-on-accent shadow-card hover:bg-accent/90' : kind === 'secondary' ? 'border border-line bg-surface text-ink hover:border-accent/60' : 'px-3 text-muted hover:text-ink'}`;

export type ActionTone = 'neutral' | 'success' | 'retry';

const TONES: Record<ActionTone, string> = {
  neutral: 'border-line bg-surface/95',
  success: 'border-success/40 bg-success-soft',
  retry: 'border-warning/40 bg-warning-soft',
};

/**
 * The bar at the bottom of every lesson screen: what's going on (left) and what to do next
 * (right). It sticks to the bottom of the window, so the main button is always in the same place.
 */
export function ActionBar({ status, tone = 'neutral', children }: { status?: ReactNode; tone?: ActionTone; children: ReactNode }) {
  return (
    <div className="sticky bottom-4 z-20 mt-8">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border p-3.5 pl-5 shadow-lift backdrop-blur transition-colors ${TONES[tone]}`}>
        <div className="min-w-0 flex-1 text-[15px] text-ink" aria-live="polite">
          {status}
        </div>
        <div className="flex flex-wrap justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}
