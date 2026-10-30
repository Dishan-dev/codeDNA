const assert = require('node:assert/strict');
const vscode = require('vscode');
const { join } = require('node:path');
exports.run = async () => {
  const extension = vscode.extensions.getExtension('codedna.codedna-vscode');
  assert.ok(extension, 'extension is available');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    'codedna.analyzeWorkspace',
    'codedna.openExplorer',
    'codedna.currentFileImpact',
    'codedna.refreshAnalysis',
  ])
    assert.ok(commands.includes(command), `${command} is registered`);
  assert.equal(vscode.workspace.isTrusted, true);
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  await vscode.commands.executeCommand('codedna.analyzeWorkspace');
  assert.ok(
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.label === 'CodeDNA Explorer'),
    ),
    'explorer panel opened',
  );
  const document = await vscode.workspace.openTextDocument(
    join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'app.ts'),
  );
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('codedna.currentFileImpact');
  await vscode.commands.executeCommand('codedna.refreshAnalysis');
  console.log(
    'Extension host passed: activation, commands, trusted analysis, impact and refresh.',
  );
};
