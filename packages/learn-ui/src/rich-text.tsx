import { Fragment } from 'react';

/**
 * Captions and explanations mark code with backticks (`session`). This renders those parts as
 * inline code and everything else as plain text. No HTML is ever interpreted.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={index} className="rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[0.86em] text-ink">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
