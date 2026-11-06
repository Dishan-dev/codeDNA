import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@codedna/learn-ui';
import { cn } from '@/lib/utils';

export const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-[#7c6cf6] text-white shadow-card', className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M7 3c0 6 10 6 10 12s-10 3-10 6" />
        <path d="M17 3c0 6-10 6-10 12" opacity=".55" />
        <path d="M8.5 7h7M8.5 17h7" />
      </svg>
    </span>
  );
}

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className={cn('inline-flex min-h-[44px] items-center gap-2.5 rounded-lg text-[15px] font-semibold tracking-tight text-ink', focus)} aria-label="CodeDNA home">
      <Logo />
      <span className={compact ? 'hidden sm:inline' : ''}>CodeDNA</span>
    </Link>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  icon,
  size = 'md',
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet';
  icon?: IconName;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-[15px] font-medium transition-all',
        size === 'lg' ? 'h-12 px-6' : 'px-4',
        variant === 'primary' && 'bg-accent text-on-accent shadow-card hover:bg-accent/90 hover:shadow-lift',
        variant === 'secondary' && 'border border-line bg-surface text-ink shadow-card hover:border-accent/50',
        variant === 'quiet' && 'px-2 text-accent hover:underline',
        focus,
        className,
      )}
    >
      {icon ? <Icon name={icon} className="h-4 w-4" /> : null}
      {children}
    </Link>
  );
}

export function Card({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cn('rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6', className)}>{children}</Tag>;
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex min-h-[28px] items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink', className)}>{children}</span>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs font-semibold uppercase tracking-[0.12em] text-muted', className)}>{children}</p>;
}

/** A ring that fills with progress; the number is always written inside. */
export function ProgressRing({ value, total, label, size = 64 }: { value: number; total: number; label: string; size?: number }) {
  const ratio = total ? value / total : 0;
  const circumference = 2 * Math.PI * 26;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value} of ${total}`}>
      <svg viewBox="0 0 64 64" className="-rotate-90" style={{ width: size, height: size }} aria-hidden="true">
        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="6" className="stroke-line" />
        <circle cx="32" cy="32" r="26" fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-accent transition-[stroke-dashoffset] duration-700" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums text-ink" aria-hidden="true">
        {value}/{total}
      </span>
    </div>
  );
}

/** Difficulty as dots with a written label. */
export function Difficulty({ level }: { level: 1 | 2 | 3 }) {
  const label = ['Easy', 'Medium', 'Harder'][level - 1];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span key={dot} className={cn('h-1.5 w-1.5 rounded-full', dot <= level ? 'bg-accent' : 'bg-line')} />
        ))}
      </span>
      {label}
    </span>
  );
}

export function PageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {children ? <div className="mt-3 text-muted">{children}</div> : null}
    </div>
  );
}

/** Page title block used across repo screens. */
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-[34px]">{title}</h1>
        {children ? <div className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
