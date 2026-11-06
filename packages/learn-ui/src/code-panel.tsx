import type { CodeRef } from '@codedna/shared';

/** A real excerpt with line numbers; the step's lines are highlighted (with a marker, not colour alone). */
export function CodePanel({ code, hiddenLine, className, label }: { code: CodeRef; hiddenLine?: number; className?: string; label?: string }) {
  const lines = (code.excerpt ?? '').split('\n');
  const last = code.highlightEndLine ?? code.highlightLine;
  const highlighting = code.highlightLine > 0;
  const range = !highlighting ? `lines ${code.startLine}–${code.endLine}` : last > code.highlightLine ? `lines ${code.highlightLine}–${last}` : `line ${code.highlightLine}`;
  return (
    <figure className={`overflow-hidden rounded-xl border border-line bg-code shadow-card ${className ?? ''}`}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex shrink-0 gap-1" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
          </span>
          <span className="truncate font-mono font-medium text-ink">{label ?? code.path}</span>
        </span>
        <span className="shrink-0 text-muted">{range}</span>
      </figcaption>
      {/* Focusable, so keyboard users can scroll long lines sideways. */}
      <pre tabIndex={0} aria-label={`Code from ${label ?? code.path}`} className="overflow-x-auto py-3 text-[13px] leading-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <code className="block min-w-max font-mono">
          {lines.map((text, index) => {
            const number = code.startLine + index;
            const highlighted = highlighting && number >= code.highlightLine && number <= last;
            const hidden = number === hiddenLine;
            return (
              <span key={number} className={`flex pr-5 ${highlighted ? 'bg-accent-soft' : ''}`}>
                <span className={`w-[3px] shrink-0 ${highlighted ? 'bg-accent' : ''}`} aria-hidden="true" />
                <span className={`w-12 shrink-0 select-none pr-4 text-right ${highlighted ? 'text-accent' : 'text-muted/70'}`} aria-hidden="true">
                  {number}
                </span>
                {hidden ? (
                  <span className="rounded-md border border-dashed border-accent bg-surface px-2 text-muted">? missing line</span>
                ) : (
                  <span className="whitespace-pre text-ink">{text || ' '}</span>
                )}
                {highlighted && index === code.highlightLine - code.startLine ? <span className="sr-only"> (this step)</span> : null}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
