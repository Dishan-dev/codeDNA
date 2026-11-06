'use client';
import dynamic from 'next/dynamic';
import { useCallback } from 'react';
import type { ConceptId, Step } from '@codedna/shared';
import { useRepo } from './repo-shell';
import { ButtonLink, PageHeader, PageMessage } from './ui';

// The player is the heaviest part of the page, so it loads on its own.
const StoryPlayer = dynamic(() => import('@codedna/learn-ui').then((module) => module.StoryPlayer), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-2xl border border-line bg-surface" aria-label="Loading the story" />,
});

/** Marks every concept on a shown step as "seen"; concept chips open the Concept Card drawer. */
export function useSeenConcepts() {
  const { dispatch, openConcept } = useRepo();
  const onStepShown = useCallback((step: Step) => step.concepts.forEach((conceptId) => dispatch({ type: 'concept.viewed', conceptId })), [dispatch]);
  const onConceptOpen = useCallback((conceptId: ConceptId) => openConcept(conceptId), [openConcept]);
  return { onStepShown, onConceptOpen };
}

export function StoryPage({ slug }: { slug: string }) {
  const { bundle, base } = useRepo();
  const { onStepShown, onConceptOpen } = useSeenConcepts();
  const featureId = Object.keys(bundle.slugs).find((id) => bundle.slugs[id] === slug);
  const feature = bundle.features.find((item) => item.id === featureId);
  if (!feature)
    return (
      <PageMessage title="That feature isn’t here">
        <p>The code may have changed since this link was made.</p>
        <ButtonLink href={`${base}/features`} className="mt-6">
          See all features
        </ButtonLink>
      </PageMessage>
    );
  const lesson = Object.values(bundle.plan.lessons).find((item) => item.featureId === feature.id);
  return (
    <div>
      <ButtonLink href={`${base}/features`} variant="quiet" icon="back" className="-ml-2 text-sm">
        All features
      </ButtonLink>
      <div className="mb-6 mt-3">
        <PageHeader
          eyebrow={feature.page ? <span className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-xs text-muted">{feature.page}</span> : undefined}
          title={feature.title}
          actions={
            lesson ? (
              <ButtonLink href={`${base}/learn/${lesson.id}`} variant="secondary" icon="book">
                Open the lesson
              </ButtonLink>
            ) : undefined
          }
        >
          Watch what happens, step by step. Use ← → to move and space to play.
        </PageHeader>
      </div>
      <StoryPlayer feature={feature} concepts={bundle.plan.concepts} onStepShown={onStepShown} onConceptOpen={onConceptOpen} inlineConcepts={false} />
    </div>
  );
}
