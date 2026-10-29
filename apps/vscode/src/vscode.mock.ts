import { vi } from 'vitest';
export const commands = { registerCommand: vi.fn() };
export const window = {
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  activeTextEditor: undefined,
};
const disposable = { dispose: vi.fn() };
export const workspace = {
  isTrusted: false,
  workspaceFolders: [],
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: vi.fn(),
    onDidCreate: vi.fn(),
    onDidDelete: vi.fn(),
    ...disposable,
  })),
};
