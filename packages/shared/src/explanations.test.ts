import { describe, expect, it } from 'vitest';
import { describeDependency } from './explanations.js';
const edge = {
  id: 'e',
  sourceId: 'a',
  targetId: 'b',
  metadata: { confidence: 1, evidence: [] },
};
describe('dependency explanations', () => {
  it('explains source-level import and dynamic import without asserting runtime calls', () => {
    expect(
      describeDependency({ ...edge, kind: 'import' }, 'a.ts', 'b.ts'),
    ).toContain('does not prove');
    expect(
      describeDependency({ ...edge, kind: 'dynamic-import' }, 'a.ts', 'b.ts'),
    ).toContain('may load');
  });
  it('identifies aggregated group links as summaries', () => {
    expect(
      describeDependency(
        { ...edge, id: 'group-edge:x', specifier: '2 source dependencies' },
        'app',
        'core',
      ),
    ).toContain('Expand the groups');
  });
});
