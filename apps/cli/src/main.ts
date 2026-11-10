import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { buildLearningPlan, buildRepoBundle, githubRepoId, repoKey } from '@codedna/core';
import { AnalysisWorkerError, readLocalSnapshot, runAnalysis } from '@codedna/node';
import { QA_WORKFLOW_PATH, qaTargetOf, qaWorkflowYaml, type RepoAnalysis, type RepoBundle } from '@codedna/shared';
import { RUNNERS, checkOwnership, formatMarkdown, formatReport, newRunId, pruneRuns, reportPath, runQa, saveReport } from './qa/index.js';
import { readAccount } from './qa/journeys-runner.js';
import { createLiveQa, createProjectStore } from './qa/live.js';
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
  /** Asks a yes/no question; tests answer it. Defaults to the terminal, or “no” when there is none. */
  confirm?: (question: string) => Promise<boolean>;
  /** Environment variables (GitHub Actions' step summary and run address). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Checks a deployed site's ownership file; tests stand in for the network. */
  fetch?: typeof fetch;
}

const HELP = `CodeDNA — understand how your app works, from its real code.

Usage:
  codedna [folder] [--port <number>] [--no-open]
  codedna analyze [folder] [--json | --plan] [--out <file>]
  codedna qa [folder] [--url <address>] [--interact] [--only tests,walk,journeys,flows] [--yes]
  codedna ci [folder] [--force]

  (no command)  Read the app in [folder] (default: this folder), build lessons from it and
                open them in your browser at http://localhost. On its QA flows page you can
                test each flow with one click.
  analyze       Print a summary of the app’s features instead.
  qa            Check the app: run its own tests, and with --url try each traced page and flow
                of your running or deployed app in a hidden browser. Shows the plan and asks
                before anything runs. Results go to .codedna/qa-report.json and the QA flows page.
  ci            Add a GitHub Actions workflow (${QA_WORKFLOW_PATH}) that tests every flow
                of your deployed site after each deploy and every night.
  --url <a>     With qa: your app, e.g. http://localhost:3000 or https://my-app.vercel.app.
                A deployed site is only looked at (pages opened, links followed, nothing sent)
                unless it agrees to more with --interact.
  --interact    With qa: run each flow fully: fill forms with test data, press their buttons,
                then try them empty, with wrong formats, very long text, emoji and a double
                press, step by step with screenshots. This sends data to that app, so use a
                test copy. Deleting, paying and signing out are always skipped. A deployed
                site must publish /.well-known/codedna.txt containing “codedna: allow-testing”.
  --only <r>    With qa: run only some checks: “tests”, “walk” (pages), “journeys” (user
                journeys end to end), “flows” (each feature’s cases), or a list like
                journeys,flows. Journeys sign in with a test account when a page asks: set
                CODEDNA_QA_EMAIL and CODEDNA_QA_PASSWORD, or save one on the QA flows page.
  --header <h>  With qa: send a header to your app only, e.g. a preview's protection bypass
                ("x-vercel-protection-bypass: …"). Can be given more than once.
  --github <r>  With qa: the report is for the GitHub repo owner/name, so it loads on that
                repo's page in CodeDNA (CI uses this).
  --markdown <f> With qa: also save a Markdown summary (for a pull-request comment).
  --yes         With qa: don’t ask before running.
  --timeout <s> With qa: longest each check may take, in seconds (default 600).
  --force       With ci: replace the workflow if it is already there.
  --json        With analyze: print the full analysis as JSON.
  --plan        With analyze: print the learning plan (lessons and challenges) as JSON.
  --out <file>  With analyze: save the JSON to a file.
  --port <n>    Port for the local page (default 3737, or the next free one).
  --no-open     Don’t open the browser.

Your code is read on this computer only and nothing is uploaded. Only “codedna qa” (and the Test
buttons on the local QA flows page) runs anything from your project or acts in your app.`;

interface Options {
  command: 'learn' | 'analyze' | 'qa' | 'ci';
  url?: string;
  target?: 'local' | 'deployed';
  interact: boolean;
  only?: string[];
  headers: Record<string, string>;
  github?: { owner: string; repo: string };
  markdown?: string;
  force: boolean;
  yes: boolean;
  timeout: number;
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
  const options: Options = { command: 'learn', json: false, plan: false, port: 3737, open: true, interact: false, yes: false, timeout: 600, headers: {}, force: false };
  if (args[0] === 'analyze' || args[0] === 'learn' || args[0] === 'qa' || args[0] === 'ci') options.command = args.shift() as Options['command'];
  while (args.length) {
    const arg = args.shift()!;
    if (arg === '--json') options.json = true;
    else if (arg === '--plan') options.plan = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--interact') options.interact = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--url' || arg === '--only' || arg === '--timeout' || arg === '--header' || arg === '--github' || arg === '--markdown') {
      const value = args.shift();
      const examples: Record<string, string> = {
        '--url': 'codedna qa --url http://localhost:3000',
        '--only': 'codedna qa --only tests',
        '--timeout': 'codedna qa --timeout 300',
        '--header': 'codedna qa --header "x-vercel-protection-bypass: abc123"',
        '--github': 'codedna qa --github acme/shop',
        '--markdown': 'codedna qa --markdown qa.md',
      };
      if (!value) return `“${arg}” needs a value, for example: ${examples[arg]}`;
      if (arg === '--url') {
        const target = qaTargetOf(value);
        if ('problem' in target) return `“--url”: ${target.problem}`;
        options.url = target.url;
        options.target = target.kind;
      } else if (arg === '--only') {
        const ids = value.split(',').map((item) => item.trim()).filter(Boolean);
        if (!ids.length || ids.some((item) => !RUNNERS.some((runner) => runner.id === item))) return `“--only” takes ${RUNNERS.map((runner) => `“${runner.id}”`).join(', ')}, or a list like walk,flows.`;
        options.only = ids;
      } else if (arg === '--header') {
        const match = /^([A-Za-z0-9-]{1,64}):\s*(.{1,500})$/.exec(value);
        if (!match || /^(?:host|cookie|content-length|connection)$/i.test(match[1]!)) return '“--header” takes one header like "x-vercel-protection-bypass: abc123".';
        options.headers[match[1]!.toLowerCase()] = match[2]!.trim();
      } else if (arg === '--github') {
        const match = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(value);
        if (!match) return '“--github” takes owner/name, like acme/shop.';
        options.github = { owner: match[1]!, repo: match[2]! };
      } else if (arg === '--markdown') options.markdown = value;
      else {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds < 10 || seconds > 3600) return '“--timeout” needs a number of seconds between 10 and 3600.';
        options.timeout = seconds;
      }
    }
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
  if (options.command !== 'qa' && (options.url || options.interact || options.only || options.yes || options.github || options.markdown || Object.keys(options.headers).length)) return '“--url”, “--interact”, “--only”, “--header”, “--github”, “--markdown” and “--yes” go with “codedna qa”.';
  if (options.command !== 'ci' && options.force) return '“--force” goes with “codedna ci”.';
  if ((options.command === 'qa' || options.command === 'ci') && (options.json || options.plan)) return '“--json” and “--plan” go with “codedna analyze”.';
  if (options.interact && !options.url) return '“--interact” needs your app’s address: add --url http://localhost:3000.';
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

/** Ask on the terminal; with no terminal (a script, CI) the answer is no, so nothing runs unasked. */
async function askTerminal(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await terminal.question(`${question} [y/N] `)).trim());
  } finally {
    terminal.close();
  }
}

/** `codedna qa`: show the plan, ask, run the checks, save the report. Exit code 1 when a check failed. */
async function qa(root: string, bundle: RepoBundle, options: Options, io: Io): Promise<number> {
  const runners = options.only ? RUNNERS.filter((runner) => options.only!.includes(runner.id)) : RUNNERS;
  const account = await readAccount(root, io.env ?? process.env);
  // A deployed site is someone's real app: sending it data needs the site's own agreement.
  if (options.interact && options.url && options.target === 'deployed') {
    const owner = await checkOwnership(new URL(options.url).origin, options.headers, io.fetch);
    if (owner !== true) {
      io.err(`Nothing ran. ${owner}`);
      io.err('Without --interact, CodeDNA can still look at every page and flow of the site without sending anything.');
      return 1;
    }
  }
  const outcome = await runQa({
    runners,
    version: VERSION,
    context: {
      root,
      bundle,
      runId: newRunId(),
      ...(options.url ? { appUrl: options.url, target: options.target ?? 'local' } : {}),
      ...(Object.keys(options.headers).length ? { headers: options.headers } : {}),
      interact: options.interact,
      ...(account ? { account } : {}),
      timeoutMs: options.timeout * 1000,
      log: io.out,
    },
    confirm: async (question) => {
      if (options.yes) return true;
      const answer = await (io.confirm ?? askTerminal)(question);
      if (!answer && !io.confirm && !process.stdin.isTTY) io.err('Nothing ran: there is no terminal to ask. Add --yes to run without asking.');
      return answer;
    },
  });
  if (outcome.kind === 'nothing') {
    io.err('There is nothing CodeDNA can check here yet:');
    for (const reason of outcome.reasons) io.err(`  • ${reason}`);
    return 1;
  }
  if (outcome.kind === 'declined') {
    io.out('Nothing ran.');
    return 0;
  }
  const path = options.out ? resolve(io.cwd, options.out) : reportPath(root);
  await saveReport(outcome.report, path);
  await pruneRuns(root, 5, outcome.report);
  io.out('');
  io.out(formatReport(outcome.report, bundle));
  io.out('');
  io.out(`Saved to ${path}.`);
  const env = io.env ?? process.env;
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  const markdown = formatMarkdown(outcome.report, bundle, runUrl);
  if (options.markdown) {
    const file = resolve(io.cwd, options.markdown);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, markdown, 'utf8');
  }
  // On GitHub Actions, the summary shows on the run's page.
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, markdown, 'utf8').catch(() => undefined);
  io.out('Run “codedna” in this folder to see each flow step by step on the QA flows page, or load the file there.');
  return outcome.report.suites.some((suite) => suite.status === 'failed') ? 1 : 0;
}

/** `codedna ci`: add the GitHub Actions workflow that runs QA after every deploy. */
async function ci(root: string, options: Options, io: Io): Promise<number> {
  const file = join(root, QA_WORKFLOW_PATH);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, qaWorkflowYaml(), { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      io.err(`${QA_WORKFLOW_PATH} is already there. Add --force to replace it.`);
      return 1;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      io.err(`There is no folder at ${root}.`);
      return 1;
    }
    throw error;
  }
  io.out(`Added ${QA_WORKFLOW_PATH}.`);
  io.out('');
  io.out('Commit and push it. From then on GitHub tests every flow of your site:');
  io.out('  • after each successful deploy (Vercel, Netlify and others tell GitHub), with a comment on the pull request,');
  io.out('  • every night, against the address in the repository variable CODEDNA_QA_URL,');
  io.out('  • and by hand, from the Actions tab.');
  io.out('It only looks by default. To also fill in forms with test data, publish /.well-known/codedna.txt');
  io.out('containing “codedna: allow-testing” on a test copy of the site, and set CODEDNA_QA_INTERACT to true.');
  return 0;
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
  if (options.command === 'ci') return await ci(root, options, io);
  try {
    const quiet = options.command !== 'learn';
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

    const name = options.github ? `${options.github.owner}/${options.github.repo}` : (analysis.name ?? basename(root));
    // With --github the report carries that repo's id, so it loads on the repo's page in CodeDNA.
    const bundle = buildRepoBundle(options.github ? githubRepoId(options.github.owner, options.github.repo) : `local-${repoKey(name)}`, analysis, 'local', name);
    if (options.command === 'qa') return await qa(root, bundle, options, io);
    if (!analysis.supported) io.out(analysis.limitations[0] ?? 'CodeDNA can’t read this project yet.');
    const ui = await (io.loadUi ?? (() => loadWebUi()))();
    const server = await startLocalServer({ bundle, ui, port: options.port, qaReportPath: reportPath(root), qaDir: join(root, '.codedna', 'qa'), qa: createLiveQa({ root, bundle, version: VERSION }), project: createProjectStore(root, bundle) });
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
