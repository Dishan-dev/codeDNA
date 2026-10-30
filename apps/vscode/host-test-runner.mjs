import { runTests } from '@vscode/test-electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const profile = await mkdtemp(resolve(tmpdir(), 'codedna-host-'));
try {
  delete process.env.ELECTRON_RUN_AS_NODE;
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE_PATH
      ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
      : {}),
    extensionDevelopmentPath: process.cwd(),
    extensionTestsPath: resolve('host-test.cjs'),
    launchArgs: [
      resolve('host-fixture'),
      '--disable-extensions',
      '--disable-workspace-trust',
      '--disable-gpu',
      '--user-data-dir',
      profile,
      '--extensions-dir',
      resolve(profile, 'extensions'),
    ],
  });
} finally {
  await rm(profile, { recursive: true, force: true });
}
