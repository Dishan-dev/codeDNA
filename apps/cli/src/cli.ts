#!/usr/bin/env node
import { main } from './main.js';

const code = await main(process.argv.slice(2), {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  cwd: process.cwd(),
});
// `codedna` keeps serving lessons until Ctrl+C; other commands exit with their code.
if (code !== 0) process.exit(code);
