import { describe, expect, it, vi } from 'vitest';
import { analyzeSnapshot, analyzeUIFlows } from '@codedna/core';
import type { RepositorySnapshot, LearningPlan } from '@codedna/shared';
import {
  chooseFolder,
  currentFileImpact,
  ProgressStore,
} from './workspace-logic.js';
const snapshot: RepositorySnapshot = {
  schemaVersion: '1.0',
  id: 'repo',
  revision: 'abc',
  files: [
    { id: 'a.ts', path: 'a.ts', content: `import './b'` },
    { id: 'b.ts', path: 'b.ts', content: 'export const b=1' },
  ],
};
describe('workspace coordination', () => {
  it('requires trust and explicitly asks when multiple roots are present', async () => {
    const pick = vi.fn(async (folders: readonly string[]) => folders[1]);
    await expect(
      chooseFolder(false, ['a'], undefined, false, pick),
    ).rejects.toThrow('Trust');
    expect(await chooseFolder(true, ['a', 'b'], undefined, false, pick)).toBe(
      'b',
    );
    expect(pick).toHaveBeenCalledOnce();
    expect(await chooseFolder(true, ['a', 'b'], 'a', true, pick)).toBe('a');
  });
  it('uses the active analyzed file as the impact target', () => {
    const result = analyzeSnapshot(snapshot),
      flow = analyzeUIFlows(snapshot);
    expect(
      currentFileImpact(result, snapshot, flow, true, 'b.ts')?.files.map(
        (f) => f.path,
      ),
    ).toEqual(['b.ts', 'a.ts']);
    expect(
      currentFileImpact(result, snapshot, flow, true, '../outside.ts'),
    ).toBeUndefined();
  });
  it('isolates bounded progress by identity and revision and rejects fabricated answers', () => {
    const plan: LearningPlan = {
      schemaVersion: '1.0',
      snapshotId: 'repo',
      warnings: [],
      steps: [
        {
          id: 'intro',
          kind: 'overview',
          title: 'Intro',
          explanation: '',
          objective: '',
          action: '',
          complexity: 'introductory',
          files: [],
          evidence: [],
          questions: [
            {
              id: 'q',
              prompt: '?',
              choices: [{ id: 'a', label: 'A' }],
              answerId: 'a',
              explanation: '',
              evidence: [],
            },
          ],
        },
      ],
    };
    const store = new ProgressStore();
    expect(
      store.set('repo@one', plan, {
        step: 0,
        completed: ['intro'],
        answers: { q: 'a' },
      }),
    ).toBe(true);
    expect(store.get('repo@two')).toBeUndefined();
    expect(
      store.set('repo@two', plan, {
        step: 0,
        completed: [],
        answers: { q: 'bad' },
      }),
    ).toBe(false);
    expect(store.get('repo@one')?.completed).toEqual(['intro']);
  });
});
