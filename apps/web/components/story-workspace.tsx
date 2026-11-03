'use client';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { buildBehaviorStory } from '@codedna/core/stories';
import type { Behavior, BehaviorDiscovery, FeatureDiscovery, RepositorySnapshot, StepRole } from '@codedna/shared';
import { CATEGORY_LABEL, CERTAINTY_LABEL, advanceStory, retreatStory, startTrail, trailTo } from '@/lib/story-playback';

const ROLE_LABEL: Record<StepRole, string> = {
  'user-action': 'User action', interface: 'Interface', request: 'Request', server: 'Server handling',
  handoff: 'Hand-off', start: 'Starting point', unresolved: 'Not resolved',
};
const PLAY_MS = 3500;

function BehaviorChooser({ discovery, onSelect, onAdvanced }: { discovery: BehaviorDiscovery; onSelect: (id: string) => void; onAdvanced: () => void }) {
  if (!discovery.behaviors.length)
    return (
      <div className="u-page">
        <h2>No behavior stories available</h2>
        <p>The available analysis did not support a step-by-step story for this repository.</p>
        <button type="button" className="guide-action" onClick={onAdvanced}>Open advanced tools →</button>
        <ul>{discovery.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
      </div>
    );
  return (
    <div className="u-page" data-testid="behavior-chooser">
      <header className="u-hero">
        <span className="guide-eyebrow">EXPLORE</span>
        <h2>Choose a behavior to follow</h2>
        <p className="u-intro">Each story walks through what the code connects, one step at a time.</p>
      </header>
      <div className="u-cards">
        {discovery.behaviors.map((behavior) => (
          <button key={behavior.id} type="button" className="u-card" onClick={() => onSelect(behavior.id)} data-recommended={behavior.id === discovery.recommendedId || undefined}>
            <small>{CATEGORY_LABEL[behavior.category]}{behavior.id === discovery.recommendedId ? ' · Recommended' : ''}</small>
            <strong>{behavior.title}</strong>
            <span>{behavior.coverage === 'partial' ? 'Partly traced: some links are unresolved' : 'Traced through supported references'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StoryPlayer({
  behavior, discovery, snapshot, complete, initialStepId, onStep, onBack, onAsk, onSource, onArchitecture,
}: {
  behavior: Behavior; discovery: FeatureDiscovery; snapshot: RepositorySnapshot; complete: boolean; initialStepId: string | undefined;
  onStep: (stepId: string) => void; onBack: () => void; onAsk: (question: string) => void;
  onSource: (path: string, line: number) => void; onArchitecture: (path: string) => void;
}) {
  const story = useMemo(() => buildBehaviorStory(behavior, discovery, snapshot, complete), [behavior, discovery, snapshot, complete]);
  const [trail, setTrail] = useState(() => trailTo(story, initialStepId));
  const [playing, setPlaying] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const step = story.steps.find((item) => item.id === trail.at(-1));
  const byId = new Map(story.steps.map((item) => [item.id, item]));
  const choices = step?.next ?? [];
  const atBranch = choices.length > 1;
  const atEnd = choices.length === 0;
  useEffect(() => { if (step) onStep(step.id); }, [step, onStep]);
  useEffect(() => {
    if (!playing) return;
    if (atBranch || atEnd) { setPlaying(false); return; }
    const timer = setTimeout(() => setTrail((current) => advanceStory(story, current).trail), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, trail, atBranch, atEnd, story]);
  if (!step) return <div className="u-page"><button type="button" onClick={onBack}>← All behaviors</button><p>This behavior has no steps to show.</p></div>;
  const evidence = step.evidenceIds.map((id) => story.evidence.find((item) => item.id === id)).filter((item) => !!item);
  const next = () => { setShowWhy(false); setShowCode(false); setTrail(advanceStory(story, trail).trail); };
  const go = (stepId: string) => { setShowWhy(false); setShowCode(false); setPlaying(false); setTrail(advanceStory(story, trail, stepId).trail); };
  const back = () => { setPlaying(false); setShowWhy(false); setShowCode(false); setTrail(retreatStory(trail)); };
  const onKey = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowRight' && !atBranch && !atEnd) { event.preventDefault(); next(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); back(); }
  };
  return (
    <div className="u-page story" onKeyDown={onKey} data-testid="story-player">
      <button type="button" className="story-back" onClick={onBack}>← All behaviors</button>
      <header className="u-hero">
        <span className="guide-eyebrow">{CATEGORY_LABEL[behavior.category].toUpperCase()}</span>
        <h2>{behavior.title}</h2>
        <p className="u-intro">{story.overview}</p>
      </header>
      <ol className="story-journey" aria-label="Path followed so far">
        {trail.map((id, index) => {
          const item = byId.get(id)!;
          return (
            <li key={id} className="story-node" data-role={item.role} aria-current={index === trail.length - 1 ? 'step' : undefined}>
              <span>{ROLE_LABEL[item.role]}</span>
            </li>
          );
        })}
      </ol>
      <section className="story-card" key={step.id} aria-labelledby="story-step-title">
        <div className="story-meta">
          <span>Step {trail.length}</span>
          <span className={`certainty certainty--${step.certainty}`}>{CERTAINTY_LABEL[step.certainty]}</span>
        </div>
        <h3 id="story-step-title" aria-live="polite">{step.title}</h3>
        <p className="story-narrative">{step.narrative}</p>
        {atBranch && (
          <div role="group" aria-label="Choose what to follow next" className="story-branches">
            <p>This step leads to more than one place. Which would you like to follow?</p>
            {choices.map((choice) => {
              const target = byId.get(choice.stepId);
              return (
                <button key={choice.stepId} type="button" onClick={() => go(choice.stepId)}>
                  {target?.title ?? choice.label}
                  {choice.condition ? <small> only if {choice.condition} (value not known)</small> : null}
                </button>
              );
            })}
          </div>
        )}
        {showWhy && <p className="story-why"><strong>Why does this happen?</strong> {step.why}</p>}
        {showCode && (
          <div className="story-code">
            {evidence.length ? evidence.map((item) => (
              <figure key={item.id}>
                <figcaption>{item.path}{item.location ? `:${item.location.start.line}` : ''}</figcaption>
                <pre><code>{item.excerpt}</code></pre>
              </figure>
            )) : <p>Source text for this step is not available in the snapshot.</p>}
            <button type="button" onClick={() => onSource(step.file, step.location.start.line)}>Open in source view</button>
            <button type="button" onClick={() => onArchitecture(step.file)}>View related architecture</button>
          </div>
        )}
      </section>
      <div className="story-controls" role="toolbar" aria-label="Story controls">
        <button type="button" onClick={back} disabled={trail.length <= 1}>Previous</button>
        <button type="button" className="primary" onClick={next} disabled={atBranch || atEnd}>Next</button>
        <button type="button" onClick={() => setPlaying((value) => !value)} disabled={atBranch || atEnd} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" onClick={() => { setPlaying(false); setTrail(startTrail(story)); }} disabled={trail.length <= 1}>Restart</button>
        <span className="story-progress" role="progressbar" aria-label="Story progress" aria-valuemin={0} aria-valuemax={story.steps.length} aria-valuenow={new Set(trail).size}>
          {new Set(trail).size} of {story.steps.length} steps seen
        </span>
      </div>
      <div className="story-actions">
        <button type="button" aria-expanded={showWhy} onClick={() => setShowWhy((value) => !value)}>Why does this happen?</button>
        <button type="button" aria-expanded={showCode} onClick={() => setShowCode((value) => !value)}>Show the code</button>
        <button type="button" onClick={() => onAsk(`Why is "${step.title}" needed?`)}>Ask about this step</button>
      </div>
      {atEnd && trail.length > 1 && <p className="story-end">That is as far as analysis could follow this path.</p>}
      <details className="story-limits">
        <summary>What this story cannot tell you</summary>
        <ul>{story.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
        <p>Its steps are references found in the code. They show what is connected, not that each step runs.</p>
      </details>
    </div>
  );
}

export function StoryWorkspace({
  discovery, features, snapshot, complete, behaviorId, stepId, onSelect, onBack, onStep, onAsk, onSource, onArchitecture, onAdvanced,
}: {
  discovery: BehaviorDiscovery; features: FeatureDiscovery; snapshot: RepositorySnapshot; complete: boolean;
  behaviorId: string | null; stepId: string | null;
  onSelect: (id: string) => void; onBack: () => void; onStep: (stepId: string) => void; onAsk: (question: string) => void;
  onSource: (path: string, line: number) => void; onArchitecture: (path: string) => void; onAdvanced: () => void;
}) {
  const behavior = discovery.behaviors.find((item) => item.id === behaviorId);
  if (!behavior) return <BehaviorChooser discovery={discovery} onSelect={onSelect} onAdvanced={onAdvanced} />;
  return (
    <StoryPlayer key={behavior.id} behavior={behavior} discovery={features} snapshot={snapshot} complete={complete}
      initialStepId={stepId ?? undefined} onStep={onStep} onBack={onBack} onAsk={onAsk} onSource={onSource} onArchitecture={onArchitecture} />
  );
}
