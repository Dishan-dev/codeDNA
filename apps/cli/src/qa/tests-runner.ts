import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { QaCheck, QaSuite } from '@codedna/shared';
import type { QaRunner } from './types.js';

type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The package manager the project uses, from the nearest lockfile (a monorepo keeps it higher up). */
export function packageManagerOf(root: string): PackageManager {
  for (let dir = root; ; dir = dirname(dir)) {
    const found = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (found) return found[1];
    if (dirname(dir) === dir) return 'npm';
  }
}

/** The project's own `test` script, if it has a real one (npm's placeholder doesn't count). */
export async function testScriptOf(root: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
    const script = manifest.scripts?.test;
    if (typeof script !== 'string' || !script.trim() || /no test specified/i.test(script)) return undefined;
    return script;
  } catch {
    return undefined;
  }
}

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  /** Names of failing tests or files, when the output shows them. */
  failures: string[];
}

const number = (text: string | undefined) => (text ? Number(text) : 0);
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

/** Read pass/fail counts from the output of Vitest, Jest, Mocha or node:test. */
export function parseTestOutput(raw: string): TestCounts | undefined {
  const output = stripAnsi(raw);
  const failures = [...output.matchAll(/^\s*(?:FAIL|×|✗|✕|not ok \d+ -)\s+(.+)$/gm)].map((match) => match[1]!.trim()).filter((name, index, all) => all.indexOf(name) === index);
  // Vitest: "Tests  2 failed | 10 passed (12)"; Jest: "Tests:       1 failed, 3 skipped, 9 passed, 13 total"
  const tests = /^\s*Tests:?\s+(.+)$/m.exec(output)?.[1];
  if (tests && /\d+\s+(?:passed|failed)/.test(tests))
    return {
      passed: number(/(\d+)\s+passed/.exec(tests)?.[1]),
      failed: number(/(\d+)\s+failed/.exec(tests)?.[1]),
      skipped: number(/(\d+)\s+(?:skipped|todo|pending)/.exec(tests)?.[1]),
      failures,
    };
  // Mocha: "12 passing", "1 failing", "2 pending"
  const passing = /^\s*(\d+)\s+passing/m.exec(output);
  if (passing) return { passed: number(passing[1]), failed: number(/^\s*(\d+)\s+failing/m.exec(output)?.[1]), skipped: number(/^\s*(\d+)\s+pending/m.exec(output)?.[1]), failures };
  // node:test (TAP): "# pass 3", "# fail 1"
  const pass = /^# pass (\d+)/m.exec(output);
  if (pass) return { passed: number(pass[1]), failed: number(/^# fail (\d+)/m.exec(output)?.[1]), skipped: number(/^# skipped (\d+)/m.exec(output)?.[1]), failures };
  return undefined;
}

/** Run a command in the project and collect its output, with a time limit. */
function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    // Windows starts package managers through their .cmd shims, which need a shell, so the command
    // goes as one line. It is only fixed words ("pnpm test"), never text from the project.
    const options = { cwd, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
    const child = process.platform === 'win32' ? spawn([command, ...args].join(' '), { ...options, shell: true }) : spawn(command, args, options);
    let output = '';
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 400_000) output = output.slice(-300_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\n${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

const tail = (text: string, lines: number) => stripAnsi(text).trimEnd().split('\n').slice(-lines);

/** Runs the project's own test script, exactly as its developers do. */
export const testsRunner: QaRunner = {
  id: 'tests',
  title: 'Your tests',
  unavailable: async (context) => ((await testScriptOf(context.root)) ? undefined : 'This project has no test script in package.json.'),
  plan: async (context) => [{ text: `Run your tests: ${packageManagerOf(context.root)} test  (the “test” script: ${await testScriptOf(context.root)})`, runsProjectCode: true }],
  run: async (context): Promise<QaSuite> => {
    const startedAt = new Date();
    const manager = packageManagerOf(context.root);
    context.log(`Running ${manager} test…`);
    const result = await runCommand(manager, ['test'], context.root, context.timeoutMs);
    const durationMs = Date.now() - startedAt.getTime();
    const counts = parseTestOutput(result.output);
    const checks: QaCheck[] = [];
    if (result.timedOut) checks.push({ id: 'tests:run', title: 'Tests finished in time', status: 'failed', detail: `The tests were stopped after ${Math.round(context.timeoutMs / 1000)} seconds. They may be waiting in watch mode.`, evidence: tail(result.output, 15), durationMs });
    else if (counts) {
      checks.push({
        id: 'tests:run',
        title: counts.failed ? `${counts.failed} test${counts.failed === 1 ? '' : 's'} failed` : `All ${counts.passed} tests passed`,
        status: counts.failed || result.code ? 'failed' : 'passed',
        detail: `${counts.passed} passed, ${counts.failed} failed${counts.skipped ? `, ${counts.skipped} skipped` : ''}.`,
        ...(counts.failed || result.code ? { evidence: tail(result.output, 25) } : {}),
        durationMs,
      });
      counts.failures.slice(0, 30).forEach((name, index) => checks.push({ id: `tests:failure:${index}`, title: name, status: 'failed' }));
    } else
      checks.push({
        id: 'tests:run',
        title: result.code === 0 ? 'The test script finished without errors' : 'The test script failed',
        status: result.code === 0 ? 'passed' : 'failed',
        detail: result.code === 0 ? 'CodeDNA couldn’t read test counts from the output, but the script ended successfully.' : `It ended with exit code ${String(result.code)}.`,
        evidence: tail(result.output, 25),
        durationMs,
      });
    return { runner: 'tests', title: 'Your tests', status: checks.some((check) => check.status === 'failed') ? 'failed' : 'passed', note: `${manager} test`, checks, startedAt: startedAt.toISOString(), durationMs };
  },
};
