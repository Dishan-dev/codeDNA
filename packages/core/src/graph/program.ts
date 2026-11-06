import ts from 'typescript';
import type { ParsedFile } from '../snapshot/parse.js';
import type { ReadyFile } from '../snapshot/validate.js';
import { BASE_OPTIONS, toHostPath, toRepoPath, type Resolution } from './host.js';

const SCRIPT_KIND: Record<string, ts.ScriptKind> = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, json: ts.ScriptKind.JSON };
const kindOf = (path: string) => SCRIPT_KIND[/\.([cm]?)([jt]sx?|json)$/.exec(path)?.[2] ?? 'ts'] ?? ts.ScriptKind.TS;

export interface AnalysisProgram {
  program: ts.Program;
  checker: ts.TypeChecker;
  /** Source files parsed by the program, so checker queries and AST walks share nodes. */
  files: ParsedFile[];
  fileOf: (node: ts.Node) => ParsedFile | undefined;
}

/**
 * A TypeScript program over snapshot text only. No default library, no `@types`, no plugins and
 * no filesystem: packages are absent, so calls into them are recognised by name, not by type.
 */
export function createAnalysisProgram(files: readonly ReadyFile[], resolution: Resolution): AnalysisProgram {
  const sources = files.filter((file) => file.language !== 'json');
  const options: ts.CompilerOptions = { ...BASE_OPTIONS, noEmit: true, checkJs: false, skipLibCheck: true, noResolve: false };
  const host: ts.CompilerHost = {
    ...resolution.host,
    getSourceFile: (name, languageVersion) => {
      const text = resolution.texts.get(toRepoPath(name));
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true, kindOf(name));
    },
    getDefaultLibFileName: () => `${toHostPath('__no_lib__.d.ts')}`,
    writeFile: () => undefined,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    getCurrentDirectory: () => resolution.host.getCurrentDirectory!(),
    fileExists: resolution.host.fileExists,
    readFile: resolution.host.readFile,
    resolveModuleNameLiterals: (literals, containingFile) => literals.map((literal) => resolution.resolve(literal.text, toRepoPath(containingFile))),
  };
  const program = ts.createProgram({ rootNames: sources.map((file) => toHostPath(file.path)), options, host });
  const checker = program.getTypeChecker();
  const parsed: ParsedFile[] = [];
  const byFileName = new Map<string, ParsedFile>();
  for (const file of sources) {
    const source = program.getSourceFile(toHostPath(file.path));
    if (!source) continue;
    const item = { ...file, source };
    parsed.push(item);
    byFileName.set(source.fileName, item);
  }
  return { program, checker, files: parsed, fileOf: (node) => byFileName.get(node.getSourceFile().fileName) };
}
