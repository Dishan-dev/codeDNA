'use client';
import { useState, type FormEvent } from 'react';
import type { AiStatus, Behavior, BehaviorDiscovery, RepositoryUnderstanding } from '@codedna/shared';
import { CATEGORY_LABEL } from '@/lib/story-playback';

/** One question, one next action: what is this application, and what can I learn about it? */
export function UnderstandWorkspace({
  repositoryName,
  understanding,
  discovery,
  ai,
  onStory,
  onAsk,
  onAdvanced,
}: {
  repositoryName: string;
  understanding: RepositoryUnderstanding;
  discovery: BehaviorDiscovery;
  ai: AiStatus;
  onStory: (behaviorId: string) => void;
  onAsk: (question: string) => void;
  onAdvanced: () => void;
}) {
  const [question, setQuestion] = useState('');
  const behaviors = discovery.behaviors;
  const recommended = behaviors.find((item) => item.id === discovery.recommendedId);
  const capabilities = behaviors.filter((item) => item.id !== recommended?.id).slice(0, 4);
  const questions: { text: string; behavior: Behavior }[] = behaviors.slice(0, 4).map((behavior) => ({ text: behavior.suggestedQuestions[0]!, behavior }));
  const documented = understanding.introduction.certainty === 'documented';
  const counts = new Map<string, number>();
  for (const item of behaviors) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const plural: Record<string, [string, string]> = { page: ['page', 'pages'], api: ['API route', 'API routes'], interaction: ['interactive component', 'interactive components'], library: ['exported function', 'exported functions'], cli: ['command', 'commands'], entry: ['entry file', 'entry files'] };
  const found = [...counts].map(([category, n]) => `${n} ${plural[category]![n === 1 ? 0 : 1]}`);
  const intro = documented
    ? understanding.introduction.text
    : found.length
      ? `No documentation describes what ${repositoryName} is for. Its code exposes ${found.join(', ')}. Pick one below to see how it works.`
      : `No documentation describes what ${repositoryName} is for, and the analysis found no behavior it could trace.`;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (question.trim()) onAsk(question.trim());
  }
  return (
    <div className="u-page" data-testid="understand">
      <header className="u-hero">
        <span className="guide-eyebrow">UNDERSTAND</span>
        <h2>What is {repositoryName}?</h2>
        <p className="u-intro">{intro}</p>
        <small>{documented ? 'Described by the repository’s own documentation. Check it against the behaviors below.' : 'Generated from the detected routes and exports, not from a description written by the authors.'}</small>
      </header>

      {recommended ? (
        <section className="u-start" aria-labelledby="u-start-title">
          <span className="guide-eyebrow">RECOMMENDED STARTING POINT</span>
          <h3 id="u-start-title">{recommended.title}</h3>
          <p>{recommended.summary}</p>
          <button type="button" className="guide-action" onClick={() => onStory(recommended.id)}>Follow this story →</button>
        </section>
      ) : (
        <section className="u-start" aria-labelledby="u-start-title">
          <h3 id="u-start-title">No behavior could be traced</h3>
          <p>The available analysis did not support any behavior story for this repository. You can still inspect its structure with the advanced tools.</p>
          <button type="button" className="guide-action" onClick={onAdvanced}>Open advanced tools →</button>
        </section>
      )}

      {questions.length > 0 && (
        <section aria-labelledby="u-questions">
          <h3 id="u-questions">What would you like to understand?</h3>
          <ul className="u-questions">
            {questions.map(({ text, behavior }) => (
              <li key={behavior.id}>
                <button type="button" onClick={() => onStory(behavior.id)}>{text}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {capabilities.length > 0 && (
        <section aria-labelledby="u-capabilities">
          <h3 id="u-capabilities">Other things it does</h3>
          <div className="u-cards">
            {capabilities.map((behavior) => (
              <button key={behavior.id} type="button" className="u-card" onClick={() => onStory(behavior.id)}>
                <small>{CATEGORY_LABEL[behavior.category]}</small>
                <strong>{behavior.title}</strong>
                <span>{behavior.certainty === 'verified' ? 'Traced through supported references' : 'Partly traced'}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="u-ask" aria-labelledby="u-ask-title">
        <h3 id="u-ask-title">Ask CodeDNA</h3>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="u-ask-input">Ask a question about this repository</label>
          <input id="u-ask-input" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="How does authentication work?" />
          <button type="submit" disabled={!question.trim()}>Ask</button>
        </form>
        <small>
          {ai.configured
            ? 'Open-ended answers use your configured AI provider and ask your permission before anything is sent.'
            : 'AI is not configured, so answers come from detected behaviors and evidence only. Open-ended questions may not match.'}
        </small>
      </section>

      <footer className="u-foot">
        <button type="button" onClick={onAdvanced}>Advanced developer tools</button>
        {(discovery.limitations.length > 0 || understanding.limitations.length > 0) && (
          <details>
            <summary>What this overview cannot tell you</summary>
            <ul>{[...discovery.limitations, ...understanding.limitations].map((text) => <li key={text}>{text}</li>)}</ul>
          </details>
        )}
      </footer>
    </div>
  );
}
