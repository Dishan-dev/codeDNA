import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UiHandler } from './server.js';

export class CliError extends Error {}

/** The learning UI next to this CLI in the CodeDNA workspace (apps/web). */
export const defaultWebDir = () => fileURLToPath(new URL('../../web', import.meta.url));

type NextFactory = (options: { dev: boolean; dir: string; quiet?: boolean }) => {
  prepare: () => Promise<void>;
  getRequestHandler: () => UiHandler;
};

/** Serve the already-built web app with Next.js in production mode. Only CodeDNA's own app runs. */
export async function loadWebUi(webDir: string = defaultWebDir()): Promise<UiHandler> {
  if (!existsSync(join(webDir, '.next', 'BUILD_ID'))) throw new CliError('The CodeDNA learning app isn’t built yet. Run “pnpm build” in the CodeDNA folder, then try again.');
  process.env.NODE_ENV ??= 'production';
  // On the learner's own machine, importing a public GitHub repo is fine to allow.
  process.env.CODEDNA_GITHUB_IMPORT ??= 'on';
  delete process.env.CODEDNA_DIST_DIR;
  const required = createRequire(join(webDir, 'package.json'))('next') as NextFactory | { default: NextFactory };
  const next = typeof required === 'function' ? required : required.default;
  const app = next({ dev: false, dir: webDir, quiet: true });
  await app.prepare();
  return app.getRequestHandler();
}

/** Open the default browser at a localhost URL. Failure is fine: the URL is printed too. */
export function openBrowser(url: string): void {
  if (!/^http:\/\/localhost:\d+\/[\w/-]*$/.test(url)) return;
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // The URL is already printed for the learner to open.
  }
}
