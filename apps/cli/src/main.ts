import { writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildLearningPlan, buildRepoBundle, repoKey } from '@codedna/core';
import { AnalysisWorkerError, readLocalSnapshot, runAnalysis } from '@codedna/node';
import type { RepoAnalysis } from '@codedna/shared';
import { startLocalServer, type LocalServer, type UiHandler } from './server.js';
import { formatSummary } from './summary.js';
import { CliError, loadWebUi, openBrowser } from './web-ui.js';

export const VERSION = '0.0.0';
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
  /** Overrides for tests. */
  workerUrl?: URL;
  loadUi?: () => Promise<UiHandler>;
  open?: (url: string) => void;
  onServer?: (server: LocalServer) => void;
}

const HELP = `CodeDNA — understand how your app works, from its real code.

Usage:
  codedna [folder] [--port <number>] [--no-open]
  codedna analyze [folder] [--json | --plan] [--out <file>]

  (no command)  Read the app in [folder] (default: this folder), build lessons from it and
                open them in your browser at http://localhost.
  analyze       Print a summary of the app’s features instead.
  --json        With analyze: print the full analysis as JSON.
  --plan        With analyze: print the learning plan (lessons and challenges) as JSON.
  --out <file>  With analyze: save the JSON to a file.
  --port <n>    Port for the local page (default 3737, or the next free one).
  --no-open     Don’t open the browser.

Your code is read on this computer only. Nothing is uploaded and nothing in your project runs.`;

interface Options {
  command: 'learn' | 'analyze';
  folder?: string;
  json: boolean;
  plan: boolean;
  out?: string;
  port: number;
  open: boolean;
}

/** Parse arguments; returns a message for wrong usage. */
function parse(argv: readonly string[]): Options | string {
  const args = [...argv];
  const options: Options = { command: 'learn', json: false, plan: false, port: 3737, open: true };
  if (args[0] === 'analyze' || args[0] === 'learn') options.command = args.shift() as Options['command'];
  while (args.length) {
    const arg = args.shift()!;
    if (arg === '--json') options.json = true;
    else if (arg === '--plan') options.plan = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--out' || arg === '--port') {
      const value = args.shift();
      if (!value) return `“${arg}” needs a value, for example: ${arg === '--out' ? 'codedna analyze --out analysis.json' : 'codedna --port 4000'}`;
      if (arg === '--out') options.out = value;
      else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) return '“--port” needs a number between 1024 and 65535.';
        options.port = port;
      }
    } else if (arg.startsWith('-')) return `Unknown option “${arg}”. Run “codedna --help” to see what you can do.`;
    else if (options.folder) return 'Give CodeDNA one folder at a time.';
    else options.folder = arg;
  }
  if (options.command === 'learn' && (options.json || options.plan || options.out)) return '“--json”, “--plan” and “--out” go with “codedna analyze”.';
  return options;
}

/** Read and analyse a folder, with friendly progress lines. */
async function analyzeFolder(root: string, io: Io, quiet: boolean): Promise<RepoAnalysis | number> {
  const local = await readLocalSnapshot(root);
  if (!local.snapshot.files.length) {
    io.err(`CodeDNA found no TypeScript or JavaScript files in ${root}.`);
    return 1;
  }
  if (!quiet) io.out(`Reading your files… (${local.snapshot.files.length} files)`);
  if (!quiet) io.out('Finding features… Following the logic… Building lessons…');
  const analysis = await runAnalysis(local.snapshot, io.workerUrl ? { workerUrl: io.workerUrl } : {});
  if (!local.complete) analysis.limitations.push('This folder is bigger than CodeDNA reads at once; some files were left out.');
  return analysis;
}

/** Returns the process exit code: 0 success, 1 failure, 2 wrong usage. For `learn`, the server keeps running. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.out(HELP);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    io.out(VERSION);
    return 0;
  }
  const options = parse(argv);
  if (typeof options === 'string') {
    io.err(options);
    return 2;
  }

  const root = resolve(io.cwd, options.folder ?? '.');
  try {
    const quiet = options.command === 'analyze';
    const analysis = await analyzeFolder(root, io, quiet);
    if (typeof analysis === 'number') return analysis;

    if (options.command === 'analyze') {
      const plan = buildLearningPlan(analysis);
      const text = JSON.stringify(options.plan ? plan : analysis, null, 2);
      if (options.out) {
        await writeFile(resolve(io.cwd, options.out), `${text}\n`, 'utf8');
        io.err(`Saved the ${options.plan ? 'learning plan' : 'analysis'} to ${options.out}.`);
      }
      if (options.json || options.plan) io.out(text);
      else if (!options.out) io.out(formatSummary(basename(root), analysis, plan));
      return 0;
    }

    const name = analysis.name ?? basename(root);
    const bundle = buildRepoBundle(`local-${repoKey(name)}`, analysis, 'local', name);
    if (!analysis.supported) io.out(analysis.limitations[0] ?? 'CodeDNA can’t read this project yet.');
    const ui = await (io.loadUi ?? (() => loadWebUi()))();
    const server = await startLocalServer({ bundle, ui, port: options.port });
    io.onServer?.(server);
    const url = `${server.url}/r/${bundle.id}`;
    io.out('');
    io.out(`${bundle.plan.path.length} lesson${bundle.plan.path.length === 1 ? '' : 's'} ready for ${name}.`);
    io.out(`Open ${url}`);
    io.out('Your code stays on this computer. Press Ctrl+C to stop.');
    if (options.open) (io.open ?? openBrowser)(url);
    return 0;
  } catch (error) {
    if (error instanceof CliError) io.err(error.message);
    else if (error instanceof AnalysisWorkerError) io.err(error.code === 'timeout' ? 'Reading this app took too long. Try a smaller folder.' : `CodeDNA couldn’t read this app: ${error.message}`);
    else if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      // A bare word that isn't a folder is most likely a mistyped command.
      io.err(/^[a-z]+$/.test(options.folder ?? '') ? `Unknown command “${options.folder}”. Run “codedna --help” to see what you can do.` : `There is no folder at ${root}.`);
    else if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') io.err('Every port CodeDNA tried is busy. Try “--port 4000”.');
    else io.err(`Something went wrong: ${(error as Error).message}`);
    return 1;
  }
}
