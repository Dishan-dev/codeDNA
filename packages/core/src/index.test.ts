import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from './index.js';

describe('analyzeSnapshot', () => {
  it('returns an empty result for the supplied snapshot', () => {
    const result = analyzeSnapshot({ schemaVersion: '1.0', id: 'repo@revision', files: [] });
    expect(result.snapshotId).toBe('repo@revision');
    expect(result.dependencyGraph.nodes).toEqual([]);
    expect(result.uiFlowGraph.edges).toEqual([]);
  });
});
