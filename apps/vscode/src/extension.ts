import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { join, relative, isAbsolute, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { realpath } from 'node:fs/promises';
import { Minimatch } from 'minimatch';
import { analyzeImpact } from '@codedna/core/impact';
import type { UIFlowAnalysis } from '@codedna/core';
import type { AnalysisResult, LearningPlan } from '@codedna/shared';
import {
  acquireWithDeadline,
  DEFAULT_LIMITS,
  normalizeRelative,
  supportedPath,
  type LocalSnapshot,
  type SnapshotProvider,
} from './snapshot.js';
import { validMessage, position } from './protocol.js';
import { AnalysisCoordinator } from './coordinator.js';
import { readWorkspaceFile } from './secure-read.js';
import {
  chooseFolder,
  currentFileImpact,
  ProgressStore,
} from './workspace-logic.js';

type Results = {
  result: AnalysisResult;
  uiFlow: UIFlowAnalysis;
  learning: LearningPlan;
};
const cancelled = () => new Error('Analysis cancelled');
function localPath(
  folder: vscode.WorkspaceFolder,
  uri: vscode.Uri,
): string | null {
  if (folder.uri.scheme !== 'file' || uri.scheme !== 'file') return null;
  const path = relative(folder.uri.fsPath, uri.fsPath);
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
    return null;
  return normalizeRelative(path.split(sep).join('/'));
}
function providerFor(folder: vscode.WorkspaceFolder): SnapshotProvider {
  const uriFor = (path: string) =>
    vscode.Uri.joinPath(folder.uri, ...path.split('/'));
  return {
    async list(max, signal) {
      const source = new vscode.CancellationTokenSource();
      const abort = () => source.cancel();
      signal.addEventListener('abort', abort, { once: true });
      try {
        const uris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(
            folder,
            '**/{*.ts,*.tsx,*.js,*.jsx,tsconfig.json,jsconfig.json}',
          ),
          undefined,
          max,
          source.token,
        );
        if (signal.aborted) throw cancelled();
        const excluded =
          vscode.workspace
            .getConfiguration('search', folder.uri)
            .get<Record<string, boolean>>('exclude') ?? {};
        const patterns = Object.entries(excluded)
          .filter(([, enabled]) => enabled === true)
          .map(
            ([pattern]) =>
              new Minimatch(pattern, { dot: true, matchBase: true }),
          );
        const isExcluded = (path: string) => {
          const parts = path.split('/');
          return patterns.some((pattern) =>
            parts.some((_, i) =>
              pattern.match(parts.slice(0, i + 1).join('/')),
            ),
          );
        };
        return {
          paths: uris
            .map((uri) => localPath(folder, uri))
            .filter((p): p is string => p !== null && !isExcluded(p)),
          limited: uris.length >= max,
        };
      } finally {
        signal.removeEventListener('abort', abort);
        source.dispose();
      }
    },
    async safe(path) {
      if (normalizeRelative(path) !== path) return false;
      const parts = path.split('/');
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const stat = await vscode.workspace.fs.stat(uriFor(current));
        const safe = (stat.type & vscode.FileType.SymbolicLink) === 0;
        if (!safe) return false;
      }
      const [root, target] = await Promise.all([
        realpath(folder.uri.fsPath),
        realpath(uriFor(path).fsPath),
      ]);
      const resolved = relative(root, target);
      return (
        !!resolved &&
        !isAbsolute(resolved) &&
        resolved !== '..' &&
        !resolved.startsWith(`..${sep}`)
      );
    },
    async read(path, signal) {
      if (signal.aborted) throw cancelled();
      return readWorkspaceFile(
        folder.uri.fsPath,
        path,
        DEFAULT_LIMITS.maxFileBytes,
        signal,
      );
    },
  };
}
function runWorker(
  extensionPath: string,
  snapshot: LocalSnapshot,
  signal: AbortSignal,
): Promise<Results> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled());
      return;
    }
    const worker = new Worker(join(extensionPath, 'dist', 'worker.cjs'), {
      workerData: snapshot,
    });
    let done = false;
    const timer = setTimeout(
      () => finish(new Error('Analysis timed out')),
      30000,
    );
    const abort = () => finish(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    const finish = (error?: Error, value?: Results) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error);
      else if (value) resolve(value);
    };
    worker.once('message', (value: Results | { error: string }) => {
      if ('error' in value) finish(new Error(value.error));
      else finish(undefined, value);
    });
    worker.once('error', () => finish(new Error('Analysis worker failed')));
    worker.once('exit', (code) => {
      if (code !== 0) finish(new Error('Analysis worker stopped'));
    });
  });
}
export function activate(context: vscode.ExtensionContext) {
  let folder: vscode.WorkspaceFolder | undefined,
    panel: vscode.WebviewPanel | undefined,
    current: { snapshot: LocalSnapshot; value: Results } | undefined,
    mode: 'Architecture' | 'UI Flow' | 'Impact Analysis' | 'Learning Mode' =
      'Architecture',
    selection: string | undefined,
    impact: ReturnType<typeof analyzeImpact> | undefined;
  let attempt = 0;
  const folders = new Map<string, vscode.WorkspaceFolder>();
  const progress = new ProgressStore();
  const coordinator = new AnalysisCoordinator<LocalSnapshot, Results>(
    async (key, signal) => {
      const chosen = folders.get(key);
      if (!chosen) throw new Error('Workspace folder is unavailable');
      return acquireWithDeadline(providerFor(chosen), key, signal);
    },
    (snapshot, signal) => runWorker(context.extensionPath, snapshot, signal),
  );
  let viewStatus: 'ready' | 'empty' | 'loading' | 'error' | 'stale' = 'empty';
  let viewMessage: string | undefined;
  const publish = (status?: typeof viewStatus, message?: string) => {
    if (status) {
      viewStatus = status;
      viewMessage = message;
    }
    if (!panel) return;
    void panel.webview.postMessage({
      version: 1,
      type: 'state',
      status: viewStatus,
      ...(viewMessage ? { message: viewMessage } : {}),
      mode,
      selection,
      impact,
      ...(current
        ? {
            files: current.snapshot.snapshot.files.map((f) => f.path),
            result: current.value.result,
            uiFlow: current.value.uiFlow,
            learning: current.value.learning,
            complete: current.snapshot.complete,
            diagnostics: current.snapshot.diagnostics,
            identity: current.snapshot.snapshot.id,
            progress: progress.get(current.snapshot.snapshot.id),
          }
        : {}),
    });
  };
  const openPanel = () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      return;
    }
    panel = vscode.window.createWebviewPanel(
      'codedna.explorer',
      'CodeDNA Explorer',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      },
    );
    const nonce = randomBytes(18).toString('base64');
    const script = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'),
    );
    const style = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'),
    );
    panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none';"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${style}"></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
    panel.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!validMessage(message) || !vscode.workspace.isTrusted) return;
        if (message.type === 'ready') {
          publish(current ? 'ready' : 'empty');
          return;
        }
        if (message.type === 'refresh') {
          await runAnalysis(true);
          return;
        }
        if (message.type === 'mode') {
          mode = message.mode;
          publish();
          return;
        }
        if (message.type === 'progress') {
          if (!current) return;
          progress.set(
            current.snapshot.snapshot.id,
            current.value.learning,
            message,
          );
          publish();
          return;
        }
        if (
          !folder ||
          !current ||
          normalizeRelative(message.path) !== message.path ||
          !current.snapshot.snapshot.files.some((f) => f.path === message.path)
        )
          return;
        if (message.type === 'select') {
          selection = message.path;
          publish();
          return;
        }
        if (message.type === 'impact') {
          selection = message.path;
          mode = 'Impact Analysis';
          impact = analyzeImpact(current.value.result, message.path, {
            uiFlowGraph: current.value.uiFlow.graph,
            uiFlowDiagnostics: current.value.uiFlow.diagnostics,
            snapshotComplete: current.snapshot.complete,
          });
          publish();
          return;
        }
        if (message.type === 'open') {
          try {
            const provider = providerFor(folder);
            if (!(await provider.safe(message.path))) return;
            const uri = vscode.Uri.joinPath(
              folder.uri,
              ...message.path.split('/'),
            );
            const document = await vscode.workspace.openTextDocument(uri);
            const start = {
              line: message.line ?? 1,
              column: message.column ?? 1,
            };
            const requested = position({
              path: message.path,
              start,
              end: start,
            });
            const line = Math.min(
              requested.line,
              Math.max(0, document.lineCount - 1),
            );
            const column = Math.min(
              requested.column,
              document.lineAt(line).text.length,
            );
            await vscode.window.showTextDocument(document, {
              selection: new vscode.Range(line, column, line, column),
              preview: true,
            });
          } catch {
            void vscode.window.showWarningMessage(
              'CodeDNA could not open this file. It may have moved or been deleted.',
            );
          }
        }
      },
      undefined,
      context.subscriptions,
    );
    panel.onDidDispose(
      () => {
        panel = undefined;
      },
      undefined,
      context.subscriptions,
    );
  };
  const choose = async (preferActive = false) => {
    const available = (vscode.workspace.workspaceFolders ?? []).filter(
      (f) => f.uri.scheme === 'file',
    );
    const active = vscode.window.activeTextEditor?.document.uri;
    const matched = active
      ? vscode.workspace.getWorkspaceFolder(active)
      : undefined;
    const currentMatch = available.find(
      (folder) => folder.uri.toString() === matched?.uri.toString(),
    );
    return chooseFolder(
      vscode.workspace.isTrusted,
      available,
      currentMatch,
      preferActive,
      async (folders) => {
        const picked = await vscode.window.showQuickPick(
          folders.map((folder) => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder,
          })),
          { placeHolder: 'Select the workspace folder to analyze' },
        );
        return picked?.folder;
      },
    );
  };
  const runAnalysis = async (force = false, preferActive = false) => {
    const thisAttempt = ++attempt;
    try {
      const chosen = await choose(preferActive);
      if (!chosen || thisAttempt !== attempt) return;
      const key = chosen.uri.toString();
      if (folder?.uri.toString() !== key) {
        current = undefined;
        impact = undefined;
        selection = undefined;
      }
      folders.set(key, chosen);
      folder = chosen;
      openPanel();
      publish('loading');
      const data = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `CodeDNA: analyzing ${chosen.name}`,
          cancellable: true,
        },
        async (_progress, token) => {
          const dispose = token.onCancellationRequested(() =>
            coordinator.invalidate(key),
          );
          try {
            return await coordinator.run(key, force);
          } finally {
            dispose.dispose();
          }
        },
      );
      if (thisAttempt !== attempt || folder?.uri.toString() !== key) return;
      current = data;
      impact = undefined;
      selection = undefined;
      publish('ready');
    } catch (error) {
      if (thisAttempt !== attempt) return;
      const message =
        error instanceof Error ? error.message : 'Analysis failed';
      if (message !== 'Analysis cancelled')
        void vscode.window.showErrorMessage(`CodeDNA: ${message}`);
      publish('error', message);
    }
  };
  const commands: Record<string, () => unknown> = {
    'codedna.analyzeWorkspace': () => runAnalysis(false),
    'codedna.openExplorer': () => {
      openPanel();
      publish(current ? 'ready' : 'empty');
    },
    'codedna.refreshAnalysis': () => runAnalysis(true),
    'codedna.currentFileImpact': async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showWarningMessage('Open a source file first.');
        return;
      }
      const owner = vscode.workspace.getWorkspaceFolder(uri);
      if (!owner) {
        void vscode.window.showWarningMessage(
          'The active file is outside a workspace.',
        );
        return;
      }
      const path = localPath(owner, uri);
      if (!path) return;
      if (!current || folder?.uri.toString() !== owner.uri.toString())
        await runAnalysis(false, true);
      if (
        !current ||
        folder?.uri.toString() !== owner.uri.toString() ||
        !current.snapshot.snapshot.files.some((f) => f.path === path)
      ) {
        void vscode.window.showWarningMessage(
          'The current file is not in the analyzed snapshot.',
        );
        return;
      }
      selection = path;
      mode = 'Impact Analysis';
      impact = currentFileImpact(
        current.value.result,
        current.snapshot.snapshot,
        current.value.uiFlow,
        current.snapshot.complete,
        path,
      );
      openPanel();
      publish();
    },
  };
  for (const [id, handler] of Object.entries(commands))
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const changed = (uri: vscode.Uri) => {
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (!owner) return;
    const path = localPath(owner, uri);
    if (!path || !supportedPath(path)) return;
    coordinator.invalidate(owner.uri.toString());
    if (folder?.uri.toString() !== owner.uri.toString()) return;
    attempt++;
    current = undefined;
    impact = undefined;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(
      () =>
        publish(
          'stale',
          'Workspace files changed. Refresh analysis to continue.',
        ),
      500,
    );
  };
  watcher.onDidChange(changed, undefined, context.subscriptions);
  watcher.onDidCreate(changed, undefined, context.subscriptions);
  watcher.onDidDelete(changed, undefined, context.subscriptions);
  context.subscriptions.push(watcher, {
    dispose() {
      if (debounce) clearTimeout(debounce);
      coordinator.dispose();
    },
  });
}
export function deactivate() {}
