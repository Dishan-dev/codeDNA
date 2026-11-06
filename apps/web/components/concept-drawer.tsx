'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { ConceptCard, Icon } from '@codedna/learn-ui';
import type { ConceptId, RepoBundle } from '@codedna/shared';

/**
 * The Concept Card as a side drawer. A native <dialog> gives focus trapping, Esc to close and
 * focus return for free. Closing never loses lesson progress.
 */
export function ConceptDrawer({ bundle, base, conceptId, onClose }: { bundle: RepoBundle; base: string; conceptId: ConceptId | undefined; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (conceptId && !element.open) element.showModal();
    if (!conceptId && element.open) element.close();
  }, [conceptId]);

  const concept = conceptId ? bundle.plan.concepts[conceptId] : undefined;
  const lessons = conceptId ? bundle.plan.path.map((id) => bundle.plan.lessons[id]!).filter((lesson) => lesson.concepts.includes(conceptId)) : [];
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label={concept ? `Concept: ${concept.name}` : 'Concept'}
      className="m-0 ml-auto h-full max-h-none w-full max-w-xl bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="h-full overflow-y-auto border-l border-line bg-surface p-5 text-ink shadow-2xl sm:p-7">
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={onClose} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            Close <span aria-hidden="true">✕</span>
          </button>
        </div>
        {concept ? (
          <ConceptCard
            key={concept.id}
            concept={concept}
            check={bundle.plan.conceptChecks[concept.id]}
            uses={bundle.plan.conceptUses.filter((use) => use.conceptId === concept.id)}
            related={
              lessons.length ? (
                <ul className="space-y-1">
                  {lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <Link href={`${base}/learn/${lesson.id}`} onClick={onClose} className="inline-flex min-h-[44px] items-center gap-2 text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                        <Icon name="book" className="h-4 w-4" /> {lesson.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : undefined
            }
          />
        ) : null}
      </div>
    </dialog>
  );
}
