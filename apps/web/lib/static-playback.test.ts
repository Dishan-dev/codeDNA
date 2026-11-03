import { describe, expect, it } from 'vitest';
import type { StaticFlow } from '@codedna/shared';
import { advanceStaticFlow } from './static-playback';
const flow: StaticFlow = { schemaVersion: '1.0', id: 'flow', entryPointId: 'entry', verification: 'static-evidence-only', limitations: [], truncated: false, relationships: [], unresolved: [], steps: [
  { id: 'a', file: 'a.ts', location: { path: 'a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }, explanation: 'A', verification: 'source-evidenced', evidence: [], branches: [{ id: 'ab', label: 'B', targetStepId: 'b' }, { id: 'ac', label: 'C', targetStepId: 'c' }] },
  { id: 'b', file: 'b.ts', location: { path: 'b.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }, explanation: 'B', verification: 'source-evidenced', evidence: [], branches: [{ id: 'ba', label: 'A', targetStepId: 'a' }] },
  { id: 'c', file: 'c.ts', location: { path: 'c.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }, explanation: 'C', verification: 'source-evidenced', evidence: [], branches: [] },
] };
describe('static playback', () => {
  it('waits for an explicit branch choice', () => expect(advanceStaticFlow(flow, ['a'], {})).toMatchObject({ reason: 'choose-branch', trail: ['a'] }));
  it('follows the chosen reference and stops at cycles', () => {
    expect(advanceStaticFlow(flow, ['a'], { a: 'ac' })).toMatchObject({ reason: 'advanced', trail: ['a', 'c'] });
    expect(advanceStaticFlow(flow, ['a', 'b'], {})).toMatchObject({ reason: 'cycle', trail: ['a', 'b', 'a'] });
  });
  it('stops at a terminal or visit limit without adding steps', () => {
    expect(advanceStaticFlow(flow, ['c'], {})).toMatchObject({ reason: 'end', trail: ['c'] });
    expect(advanceStaticFlow(flow, ['a'], { a: 'ab' }, 1)).toMatchObject({ reason: 'visit-limit', trail: ['a'] });
  });
});
