'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { answerQuestion } from '@codedna/core/ask';
import { describeDisclosure } from '@codedna/core/ai-grounding';
import { retrieveEvidence } from '@codedna/core/evidence';
import type { AiStatus, Answer, AnswerAction, Behavior, BehaviorDiscovery, BehaviorStory, FeatureDiscovery, RepositorySnapshot, RepositoryUnderstanding } from '@codedna/shared';
import { requestAiAnswer } from '@/lib/ask-client';
import { CERTAINTY_LABEL } from '@/lib/story-playback';

type AiState = { state: 'off' } | { state: 'loading'; files: string[]; excerpts: number } | { state: 'done'; answer: Answer; files: string[]; excerpts: number } | { state: 'error'; message: string };
interface Message { id: number; question: string; answer: Answer; ai: AiState }

function AnswerView({ answer, onAction, label }: { answer: Answer; onAction: (action: AnswerAction) => void; label: string }) {
  return (
    <article className="ask-answer" aria-label={label}>
      <div className="story-meta">
        <span>{answer.origin === 'ai' ? 'AI explanation' : 'From detected behaviors'}</span>
        <span className={`certainty certainty--${answer.certainty}`}>{CERTAINTY_LABEL[answer.certainty]}</span>
      </div>
      <p>{answer.text}</p>
      {answer.details && <pre className="ask-details">{answer.details}</pre>}
      {answer.actions.length > 0 && (
        <div className="story-actions">
          {answer.actions.map((action, index) => <button key={`${action.kind}:${action.label}:${index}`} type="button" onClick={() => onAction(action)}>{action.label}</button>)}
        </div>
      )}
      {answer.evidence.length > 0 && (
        <details>
          <summary>Supporting evidence ({answer.evidence.length})</summary>
          {answer.evidence.map((item) => (
            <figure key={item.id}>
              <figcaption>{item.path}{item.location ? `:${item.location.start.line}` : ''}</figcaption>
              <pre><code>{item.excerpt}</code></pre>
            </figure>
          ))}
        </details>
      )}
      {answer.notes.length > 0 && <ul className="ask-notes">{answer.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
    </article>
  );
}

export function AskWorkspace({
  snapshot, features, understanding, discovery, ai, selected, selectedLabel, initial, storyFor, onAction, onClearContext, onAdvanced,
}: {
  snapshot: RepositorySnapshot; features: FeatureDiscovery; understanding: RepositoryUnderstanding; discovery: BehaviorDiscovery; ai: AiStatus;
  selected: { behaviorId?: string; stepId?: string }; selectedLabel: string | null; initial: { question: string; nonce: number } | null;
  storyFor: (behavior: Behavior) => BehaviorStory; onAction: (action: AnswerAction) => void; onClearContext: () => void; onAdvanced: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [consent, setConsent] = useState(false);
  const counter = useRef(0);
  const handled = useRef(-1);
  const aiReady = ai.configured && useAi && consent;

  const ask = useCallback((text: string) => {
    const clean = text.trim().slice(0, 500);
    if (!clean) return;
    const answer = answerQuestion(clean, { snapshot, discovery: features, understanding, behaviors: discovery, story: storyFor, selected });
    const id = ++counter.current;
    setMessages((list) => [...list, { id, question: clean, answer, ai: { state: 'off' } }]);
    if (!aiReady) return;
    const behaviorId = selected.behaviorId ?? answer.actions.find((action) => action.kind === 'story')?.behaviorId;
    const behavior = discovery.behaviors.find((item) => item.id === behaviorId);
    const story = behavior ? storyFor(behavior) : undefined;
    const bundle = retrieveEvidence({ snapshot, discovery: features, understanding, question: clean, ...(behavior ? { behavior } : {}), ...(story ? { story } : {}), ...(selected.stepId && behavior && selected.behaviorId === behavior.id ? { stepId: selected.stepId } : {}) });
    const disclosure = describeDisclosure(bundle);
    if (!bundle.items.length) { setMessages((list) => list.map((m) => (m.id === id ? { ...m, ai: { state: 'error', message: 'No repository evidence matched, so nothing was sent to the AI provider.' } } : m))); return; }
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, ai: { state: 'loading', files: disclosure.files, excerpts: disclosure.excerpts } } : m)));
    void requestAiAnswer(clean, bundle, discovery.behaviors.map((b) => ({ id: b.id, title: b.title })), true).then((result) => {
      setMessages((list) => list.map((m) => (m.id === id ? { ...m, ai: result.ok ? { state: 'done', answer: result.answer, files: disclosure.files, excerpts: disclosure.excerpts } : { state: 'error', message: `${result.message} The evidence-based answer above is still available.` } } : m)));
    });
  }, [snapshot, features, understanding, discovery, storyFor, selected, aiReady]);

  useEffect(() => {
    if (initial && initial.nonce !== handled.current) { handled.current = initial.nonce; ask(initial.question); }
  }, [initial, ask]);

  const submit = (event: FormEvent) => { event.preventDefault(); ask(question); setQuestion(''); };
  const suggestions = [...(discovery.behaviors[0] ? discovery.behaviors[0].suggestedQuestions.slice(0, 2) : []), 'What does this application do?'];
  return (
    <div className="u-page ask" data-testid="ask">
      <header className="u-hero">
        <span className="guide-eyebrow">ASK CODEDNA</span>
        <h2>Ask about this repository</h2>
        <p className="u-intro">Answers come from detected behaviors and the code behind them, with the evidence shown.</p>
      </header>
      {selectedLabel && (
        <p className="ask-context">Asking about: <strong>{selectedLabel}</strong> <button type="button" onClick={onClearContext}>Clear</button></p>
      )}
      <section className="ask-ai" aria-label="AI explanations">
        {!ai.configured ? (
          <p>{ai.enabled ? 'AI answers are not available here.' : 'AI is turned off.'} {ai.reason ?? ''} Questions are answered from detected behaviors only.</p>
        ) : (
          <>
            <label><input type="checkbox" checked={useAi} onChange={(e) => { setUseAi(e.target.checked); if (!e.target.checked) setConsent(false); }} /> Use AI for fuller answers ({ai.provider}, {ai.model})</label>
            {useAi && (
              <div className="ask-consent">
                <p>
                  For each question, CodeDNA retrieves up to 12 short excerpts of source and documentation lines (obvious secrets redacted) and sends them with your question to {ai.external ? 'an external service' : 'a service on this machine'}. Your whole repository is never sent. You will see which files were used.
                </p>
                <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I allow CodeDNA to send these excerpts{ai.external ? ' to the external AI provider' : ''}.</label>
              </div>
            )}
          </>
        )}
      </section>
      <div className="ask-thread" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className="ask-turn">
            <p className="ask-question">{m.question}</p>
            <AnswerView answer={m.answer} onAction={onAction} label="Answer from detected behaviors" />
            {m.ai.state === 'loading' && <p className="ask-status">Asking the AI provider with {m.ai.excerpts} excerpt{m.ai.excerpts === 1 ? '' : 's'} from {m.ai.files.join(', ')}…</p>}
            {m.ai.state === 'error' && <p className="ask-status" role="status">{m.ai.message}</p>}
            {m.ai.state === 'done' && (
              <>
                <AnswerView answer={m.ai.answer} onAction={onAction} label="AI explanation" />
                <p className="ask-status">Sent {m.ai.excerpts} excerpt{m.ai.excerpts === 1 ? '' : 's'} from: {m.ai.files.join(', ')}</p>
              </>
            )}
          </div>
        ))}
      </div>
      {messages.length === 0 && (
        <div className="ask-suggestions">
          <h3>Try asking</h3>
          <ul className="u-questions">{suggestions.map((text) => <li key={text}><button type="button" onClick={() => ask(text)}>{text}</button></li>)}</ul>
        </div>
      )}
      <form className="ask-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="ask-input">Your question</label>
        <input id="ask-input" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="What happens when …?" />
        <button type="submit" disabled={!question.trim()}>Ask</button>
      </form>
      <p className="ask-foot"><button type="button" onClick={onAdvanced}>Advanced developer tools</button></p>
    </div>
  );
}
