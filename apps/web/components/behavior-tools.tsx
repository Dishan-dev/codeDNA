'use client';
import { useCallback, useMemo, useState } from 'react';
import { discoverBehaviors } from '@codedna/core/behaviors';
import { buildBehaviorStory } from '@codedna/core/stories';
import type { AnswerAction, Behavior, BehaviorStory, FeatureDiscovery, RepositorySnapshot, RepositoryUnderstanding } from '@codedna/shared';
import { useAiStatus } from '@/lib/ask-client';
import { StoryWorkspace } from './story-workspace';
import { AskWorkspace } from './ask-workspace';

/**
 * Behavior stories and Ask CodeDNA, now under Advanced tools. Loaded on demand so their analysis
 * and UI stay out of the Explorer's first load. Switching between the two keeps the selection.
 */
export function BehaviorTools({
  screen,
  snapshot,
  understanding,
  features,
  complete,
  onScreen,
  onSource,
  onArchitecture,
  onAdvanced,
}: {
  screen: 'stories' | 'ask';
  snapshot: RepositorySnapshot;
  understanding: RepositoryUnderstanding;
  features: FeatureDiscovery;
  complete: boolean;
  onScreen: (screen: 'stories' | 'ask') => void;
  onSource: (path: string, line: number) => void;
  onArchitecture: (path: string) => void;
  onAdvanced: () => void;
}) {
  const ai = useAiStatus();
  const behaviors = useMemo(() => discoverBehaviors(snapshot, understanding, features, complete), [snapshot, understanding, features, complete]);
  const [behaviorId, setBehaviorId] = useState<string | null>(null);
  const [storyStepId, setStoryStepId] = useState<string | null>(null);
  const [askRequest, setAskRequest] = useState<{ question: string; nonce: number } | null>(null);
  const stories = useMemo(() => new Map<string, BehaviorStory>(), [snapshot, features, complete]);
  const storyFor = useCallback((behavior: Behavior) => {
    const cached = stories.get(behavior.id);
    if (cached) return cached;
    const built = buildBehaviorStory(behavior, features, snapshot, complete);
    stories.set(behavior.id, built);
    return built;
  }, [stories, features, snapshot, complete]);
  const openStory = useCallback((id: string, stepId?: string) => { setBehaviorId(id); setStoryStepId(stepId ?? null); onScreen('stories'); }, [onScreen]);
  const askQuestion = useCallback((question: string) => { setAskRequest({ question, nonce: Date.now() }); onScreen('ask'); }, [onScreen]);
  const handleAction = useCallback((action: AnswerAction) => {
    if ((action.kind === 'story' || action.kind === 'unresolved') && action.behaviorId) openStory(action.behaviorId, action.stepId);
    else if (action.kind === 'source' && action.path) onSource(action.path, action.line ?? 1);
    else if (action.kind === 'architecture') onArchitecture(action.path ?? '');
    else if (action.kind === 'ask' && action.question) askQuestion(action.question);
  }, [openStory, onSource, onArchitecture, askQuestion]);
  const selectedBehavior = behaviors.behaviors.find((item) => item.id === behaviorId);
  const selectedStep = selectedBehavior ? storyFor(selectedBehavior).steps.find((item) => item.id === storyStepId) : undefined;
  const selectedLabel = selectedBehavior ? (selectedStep ? `${selectedBehavior.title} › ${selectedStep.title}` : selectedBehavior.title) : null;
  if (screen === 'stories')
    return (
      <StoryWorkspace discovery={behaviors} features={features} snapshot={snapshot} complete={complete}
        behaviorId={behaviorId} stepId={storyStepId}
        onSelect={(id) => { setBehaviorId(id); setStoryStepId(null); }}
        onBack={() => { setBehaviorId(null); setStoryStepId(null); }}
        onStep={setStoryStepId} onAsk={askQuestion}
        onSource={onSource} onArchitecture={onArchitecture} onAdvanced={onAdvanced} />
    );
  return (
    <AskWorkspace snapshot={snapshot} features={features} understanding={understanding} discovery={behaviors} ai={ai}
      selected={{ ...(behaviorId ? { behaviorId } : {}), ...(storyStepId ? { stepId: storyStepId } : {}) }}
      selectedLabel={selectedLabel} initial={askRequest} storyFor={storyFor}
      onAction={handleAction} onClearContext={() => { setBehaviorId(null); setStoryStepId(null); }} onAdvanced={onAdvanced} />
  );
}
