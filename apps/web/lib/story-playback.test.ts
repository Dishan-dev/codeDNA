import { describe, expect, it } from 'vitest';
import type { BehaviorStory, StoryStep } from '@codedna/shared';
import { advanceStory, retreatStory, startTrail, trailTo } from './story-playback';

const loc = { path: 'a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };
const step = (id: string, next: string[]): StoryStep => ({ id, flowStepId: id, role: 'handoff', title: id, narrative: '', why: '', certainty: 'verified', file: 'a.ts', location: loc, evidenceIds: [], next: next.map((stepId) => ({ stepId, label: stepId })) });
const story: BehaviorStory = {
  schemaVersion: '1.0', id: 's', behaviorId: 'b', title: 't', overview: '', evidence: [], limitations: [], truncated: false,
  steps: [step('a', ['b', 'c']), step('b', ['d']), step('c', []), step('d', ['a'])],
};

describe('behavior story navigation', () => {
  it('starts at the first step and stops for a branch choice', () => {
    const start = startTrail(story);
    expect(start).toEqual(['a']);
    expect(advanceStory(story, start)).toEqual({ trail: ['a'], reason: 'choose-branch' });
    expect(advanceStory(story, start, 'zzz').reason).toBe('choose-branch');
  });
  it('follows a chosen branch, single links, and reports end and cycles', () => {
    const b = advanceStory(story, ['a'], 'b');
    expect(b).toEqual({ trail: ['a', 'b'], reason: 'advanced' });
    const d = advanceStory(story, b.trail);
    expect(d.trail).toEqual(['a', 'b', 'd']);
    expect(advanceStory(story, d.trail)).toEqual({ trail: ['a', 'b', 'd'], reason: 'cycle' });
    expect(advanceStory(story, ['a', 'c'])).toEqual({ trail: ['a', 'c'], reason: 'end' });
  });
  it('steps back without leaving the first step', () => {
    expect(retreatStory(['a', 'b'])).toEqual(['a']);
    expect(retreatStory(['a'])).toEqual(['a']);
  });
  it('re-enters at a step with a valid path, ignoring unknown ids', () => {
    expect(trailTo(story, 'd')).toEqual(['a', 'b', 'd']);
    expect(trailTo(story, undefined)).toEqual(['a']);
    expect(trailTo(story, 'missing')).toEqual(['a']);
    expect(trailTo({ ...story, steps: [] }, 'a')).toEqual([]);
  });
});
