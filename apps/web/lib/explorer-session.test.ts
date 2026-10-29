import { describe, expect, it } from 'vitest';
import type { UIFlowAnalysis } from '@codedna/core';
import { screenForFile } from './explorer-session';
describe('screen and file selection', () => {
  it('maps a screen source file to its stable ID without inventing a screen', () => {
    const analysis: UIFlowAnalysis = {
      graph: {
        schemaVersion: '1.0',
        nodes: [
          {
            id: 'screen:app/page.tsx',
            label: '/',
            sourceFile: 'app/page.tsx',
            metadata: { confidence: 1, evidence: [] },
          },
        ],
        edges: [],
      },
      diagnostics: [],
    };
    expect(screenForFile('app/page.tsx', analysis)).toBe('screen:app/page.tsx');
    expect(screenForFile('app/helper.ts', analysis)).toBeNull();
    analysis.graph.nodes.push({
      ...analysis.graph.nodes[0]!,
      id: 'screen:other',
    });
    expect(screenForFile('app/page.tsx', analysis)).toBeNull();
  });
});
