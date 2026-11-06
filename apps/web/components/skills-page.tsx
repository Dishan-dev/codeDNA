'use client';
import Link from 'next/link';
import { CONCEPT_TINT, Icon, masteryOf } from '@codedna/learn-ui';
import type { ConceptMastery } from '@codedna/shared';
import { cn } from '@/lib/utils';
import { MASTERY_LABEL } from './lesson-flow';
import { useRepo } from './repo-shell';
import { ButtonLink, Card, PageHeader } from './ui';

const LEVELS: { level: 1 | 2 | 3; title: string; text: string }[] = [
  { level: 1, title: 'Foundations', text: 'What the screen is made of and how it reacts to you.' },
  { level: 2, title: 'How data moves', text: 'Waiting, asking the server, checking and saving data.' },
  { level: 3, title: 'Keeping it safe', text: 'Making sure only the right people can do things.' },
];
const ORDER: readonly ConceptMastery[] = ['new', 'seen', 'practised', 'mastered'];

/** Four segments that fill as mastery grows; the state is always written next to it. */
function MasteryMeter({ mastery }: { mastery: ConceptMastery }) {
  const filled = ORDER.indexOf(mastery);
  return (
    <span className="flex items-center gap-2">
      <span className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((segment) => (
          <span key={segment} className={cn('h-1.5 w-6 rounded-full', segment <= filled ? (mastery === 'mastered' ? 'bg-success' : 'bg-accent') : 'bg-line')} />
        ))}
      </span>
      <span className={cn('text-sm font-medium', mastery === 'mastered' ? 'text-success' : mastery === 'new' ? 'text-muted' : 'text-ink')}>{MASTERY_LABEL[mastery]}</span>
    </span>
  );
}

export function SkillsPage() {
  const { bundle, progress, base, openConcept } = useRepo();
  const concepts = Object.values(bundle.plan.concepts);
  const counts = ORDER.map((state) => ({ state, count: concepts.filter((concept) => masteryOf(progress, concept.id) === state).length }));
  return (
    <>
      <PageHeader title="Skill map">The ideas behind {bundle.name}. Each one grows from seen to practised to mastered as you watch stories and answer challenges.</PageHeader>
      {concepts.length ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Your skills so far">
          {counts.map(({ state, count }) => (
            <li key={state} className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink shadow-card">
              {MASTERY_LABEL[state]}: <strong>{count}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {concepts.length === 0 ? (
        <Card className="mt-8 max-w-2xl">
          <h2 className="text-lg font-semibold text-ink">No ideas to show yet</h2>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">Ideas like state, server actions and validation appear here once CodeDNA finds features that use them.</p>
          <ButtonLink href={base} variant="secondary" className="mt-4">
            Back to the overview
          </ButtonLink>
        </Card>
      ) : null}
      <div className="mt-8 space-y-10">
        {LEVELS.map(({ level, title, text }) => {
          const items = concepts.filter((concept) => concept.level === level);
          if (!items.length) return null;
          return (
            <section key={level} aria-labelledby={`level-${level}`}>
              <h2 id={`level-${level}`} className="text-xl font-semibold text-ink">
                Level {level}: {title}
              </h2>
              <p className="mt-1 text-muted">{text}</p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((concept) => {
                  const lessons = bundle.plan.path.map((id) => bundle.plan.lessons[id]!).filter((lesson) => lesson.concepts.includes(concept.id));
                  const prerequisites = concept.prerequisites.map((id) => bundle.plan.concepts[id]?.name).filter(Boolean);
                  return (
                    <Card as="li" key={concept.id} className="flex flex-col p-5" >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="flex items-center gap-2 font-semibold text-ink">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CONCEPT_TINT[concept.id] }} aria-hidden="true" />
                          {concept.name}
                        </h3>
                      </div>
                      <div className="mt-2">
                        <MasteryMeter mastery={masteryOf(progress, concept.id)} />
                      </div>
                      <p className="mt-2 flex-1 text-[15px] text-muted">{concept.oneLiner}</p>
                      {prerequisites.length ? <p className="mt-2 text-sm text-muted">Builds on: {prerequisites.join(', ')}</p> : null}
                      {lessons.length ? (
                        <ul className="mt-3 space-y-0.5">
                          {lessons.map((lesson) => (
                            <li key={lesson.id}>
                              <Link href={`${base}/learn/${lesson.id}`} className="inline-flex min-h-[36px] items-center gap-1.5 text-sm text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                                <Icon name="book" className="h-3.5 w-3.5" /> {lesson.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <button type="button" onClick={() => openConcept(concept.id)} className="mt-3 min-h-[44px] self-start rounded-lg border border-line px-3 text-sm font-medium text-ink hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                        Open the card
                      </button>
                    </Card>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
