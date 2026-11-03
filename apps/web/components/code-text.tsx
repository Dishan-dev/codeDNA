/** Renders `backticked` identifiers in deterministic analysis text as inline code. */
export function CodeText({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={index} className="flow-inline-code">{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}
