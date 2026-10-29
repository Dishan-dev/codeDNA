import { describe, expect, it } from 'vitest';
import { validMessage, position } from './protocol.js';
import { validState } from './webview/state.js';
describe('webview protocol', () => {
  it('accepts valid versioned requests and rejects arbitrary commands and unsafe paths', () => {
    expect(
      validMessage({
        version: 1,
        type: 'open',
        path: 'src/a.ts',
        line: 12,
        column: 2,
      }),
    ).toBe(true);
    for (const value of [
      null,
      { version: 2, type: 'ready' },
      { version: 1, type: 'execute', command: 'rm' },
      { version: 1, type: 'open', path: '../secret' },
      { version: 1, type: 'open', path: '/secret' },
      { version: 1, type: 'open', path: 'x.ts', line: -1 },
      { version: 1, type: 'refresh', command: 'other' },
      { version: 1, type: 'mode', mode: 'evil' },
    ])
      expect(validMessage(value)).toBe(false);
  });
  it('validates bounded learning progress messages', () => {
    expect(
      validMessage({
        version: 1,
        type: 'progress',
        step: 1,
        completed: ['step'],
        answers: { question: 'choice' },
      }),
    ).toBe(true);
    expect(
      validMessage({
        version: 1,
        type: 'progress',
        step: 999,
        completed: [],
        answers: {},
      }),
    ).toBe(false);
    expect(
      validMessage({
        version: 1,
        type: 'progress',
        step: 0,
        completed: [],
        answers: { x: { bad: true } },
      }),
    ).toBe(false);
  });
  it('converts source coordinates to VS Code zero-based positions', () =>
    expect(
      position({
        path: 'a.ts',
        start: { line: 3, column: 5 },
        end: { line: 3, column: 6 },
      }),
    ).toEqual({ line: 2, column: 4 }));
  it('validates and serializes graph state', () => {
    const graph = {
      schemaVersion: '1.0',
      nodes: [
        {
          id: 'file:a.ts',
          label: 'a.ts',
          metadata: { confidence: 1, evidence: [] },
        },
      ],
      edges: [],
    };
    const state = {
      version: 1,
      type: 'state',
      status: 'ready',
      mode: 'Architecture',
      files: ['a.ts'],
      result: { dependencyGraph: graph, diagnostics: [] },
      uiFlow: { graph: { ...graph, nodes: [] }, diagnostics: [] },
      learning: { steps: [], warnings: [] },
    };
    expect(validState(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(
      validState({
        ...state,
        result: {
          dependencyGraph: { nodes: 'invalid', edges: [] },
          diagnostics: [],
        },
      }),
    ).toBe(false);
  });
});
