import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from './vscode.mock.js';
import { activate } from './extension.js';
describe('extension activation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('registers the four commands and blocks untrusted analysis', async () => {
    const handlers = new Map<string, () => unknown>();
    vscode.commands.registerCommand.mockImplementation(
      (id: string, fn: () => unknown) => {
        handlers.set(id, fn);
        return { dispose() {} };
      },
    );
    const subscriptions: { dispose(): unknown }[] = [];
    activate({ subscriptions } as never);
    expect([...handlers.keys()].sort()).toEqual([
      'codedna.analyzeWorkspace',
      'codedna.currentFileImpact',
      'codedna.openExplorer',
      'codedna.refreshAnalysis',
    ]);
    await handlers.get('codedna.analyzeWorkspace')!();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Trust this workspace'),
    );
    expect(subscriptions.length).toBeGreaterThanOrEqual(5);
  });
});
