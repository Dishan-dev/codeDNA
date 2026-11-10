'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { Brand, ButtonLink } from './ui';

const RUNGS = 14;
const LINES = ['Reading the code…', 'Following each feature…', 'Building the lessons…', 'Testing every user journey…', 'Polishing the screens…'];

/**
 * A strand of DNA, turning: two rows of dots that swap front and back, joined by rungs. Pure CSS.
 * Each rung starts a little later than the last, so the twist travels along the strand. With
 * reduced motion it rests as a still helix.
 */
function Helix() {
  return (
    <div className="codedna-helix" aria-hidden="true">
      {Array.from({ length: RUNGS }, (_, index) => {
        const phase = (index / RUNGS) * Math.PI * 2;
        const style = {
          '--delay': `${(-index / RUNGS) * 2.4}s`,
          // The still pose for reduced motion: the same helix, frozen.
          '--y': `${Math.sin(phase) * 26}px`,
          '--depth': `${0.55 + 0.45 * ((Math.cos(phase) + 1) / 2)}`,
          '--rung': `${Math.abs(Math.sin(phase))}`,
        } as CSSProperties;
        return (
          <span key={index} className="codedna-helix-rung" style={style}>
            <span className="codedna-helix-line" />
            <span className="codedna-helix-dot codedna-helix-a" />
            <span className="codedna-helix-dot codedna-helix-b" />
          </span>
        );
      })}
    </div>
  );
}

/** What visitors see on any page but the landing page while CodeDNA is in developer mode. */
export function DeveloperMode() {
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setLine((now) => (now + 1) % LINES.length), 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center px-4 py-3 sm:px-6">
        <Brand />
      </header>
      <main id="main" className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-2xl flex-col items-center justify-center px-4 pb-16 text-center sm:px-6">
        <Helix />
        <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-accent">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="codedna-ping absolute inline-flex h-full w-full rounded-full bg-accent" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Developer mode
        </p>
        <h1 className="mt-5 text-balance text-[32px] font-bold leading-tight tracking-tight text-ink sm:text-[40px]">CodeDNA is being built</h1>
        <p className="mt-3 max-w-lg text-pretty text-[16px] leading-relaxed text-muted">Learning from real apps, checking requirements and testing every user journey are almost ready. The full app opens here soon.</p>
        <div className="mt-8 w-full max-w-sm">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="codedna-build-bar h-full w-1/3 rounded-full bg-accent" />
          </div>
          <p className="mt-3 h-5 font-mono text-[13px] text-muted" aria-live="polite">
            <span key={line} className="codedna-rise inline-block">
              {LINES[line]}
            </span>
          </p>
        </div>
        <ButtonLink href="/" variant="secondary" className="mt-10">
          Back to the home page
        </ButtonLink>
      </main>
    </>
  );
}
