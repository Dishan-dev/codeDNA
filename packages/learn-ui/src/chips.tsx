import type { Concept, ConceptId, Confidence } from '@codedna/shared';
import { Icon } from './icons.js';
import { CONCEPT_TINT, CONFIDENCE } from './meta.js';

/** A concept's name with its tint dot. A button when it opens the concept. */
export function ConceptChip({ id, concept, onOpen, pressed }: { id: ConceptId; concept?: Concept | undefined; onOpen?: ((id: ConceptId) => void) | undefined; pressed?: boolean | undefined }) {
  const content = (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CONCEPT_TINT[id] }} aria-hidden="true" />
      {concept?.name ?? id}
    </>
  );
  const style = 'inline-flex min-h-[30px] items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-ink';
  if (!onOpen) return <span className={style}>{content}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      aria-pressed={pressed}
      title={concept?.oneLiner}
      className={`${style} min-h-[40px] transition-colors hover:border-accent hover:bg-accent-soft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${pressed ? 'border-accent bg-accent-soft' : ''}`}
    >
      {content}
    </button>
  );
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  resolved: 'border-success/40 bg-success-soft text-success',
  conventional: 'border-success/40 bg-success-soft text-success',
  heuristic: 'border-warning/40 bg-warning-soft text-warning',
  gap: 'border-dashed border-danger/60 bg-danger-soft text-danger',
};

/** How sure CodeDNA is, in friendly words. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[confidence]}`} title={CONFIDENCE[confidence].hint}>
      <Icon name={confidence === 'gap' ? 'unknown' : 'done'} className="h-3.5 w-3.5" />
      {CONFIDENCE[confidence].label}
    </span>
  );
}
