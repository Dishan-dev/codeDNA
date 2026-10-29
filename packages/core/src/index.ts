import ts from 'typescript';
import type {
  AnalysisDiagnostic,
  AnalysisResult,
  DependencyEdge,
  DependencyKind,
  DependencyNode,
  RepositorySnapshot,
  SourceLocation,
} from '@codedna/shared';
import { validateSnapshot, type AnalysisOptions } from './validation.js';
export { SnapshotValidationError } from './validation.js';
export type { AnalysisOptions } from './validation.js';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const isConfig = (p: string) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(p);
const fileId = (path: string) => `file:${path}`;
const packageId = (name: string) => `package:${name}`;
const dirname = (p: string) =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const location = (
  file: ts.SourceFile,
  start: number,
  end: number,
): SourceLocation => {
  const a = file.getLineAndCharacterOfPosition(start);
  const b = file.getLineAndCharacterOfPosition(end);
  return {
    path: file.fileName.slice(1),
    start: { line: a.line + 1, column: a.character + 1 },
    end: { line: b.line + 1, column: b.character + 1 },
  };
};
interface Config {
  options: ts.CompilerOptions;
  patterns: string[];
  directory: string;
}

/** Analyze only the supplied snapshot; no files are read from the host filesystem. */
export function analyzeSnapshot(
  snapshot: RepositorySnapshot,
  options: AnalysisOptions = {},
): AnalysisResult {
  const checked = validateSnapshot(snapshot, options);
  const files = new Map(checked.files.map((f) => [`/${f.path}`, f.content]));
  const dirs = new Set<string>(['/']);
  for (const path of files.keys()) {
    let dir = dirname(path);
    while (dir) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: (p) => files.has(p),
    readFile: (p) => files.get(p),
    directoryExists: (p) => dirs.has(p),
    getCurrentDirectory: () => '/',
    useCaseSensitiveFileNames: true,
  };
  const diagnostics: AnalysisDiagnostic[] = [];
  const report = (
    code: string,
    message: string,
    loc?: SourceLocation,
    severity: 'error' | 'warning' = 'error',
  ) => {
    const pos = loc
      ? `${loc.path}:${loc.start.line}:${loc.start.column}`
      : 'snapshot';
    const diagnostic: AnalysisDiagnostic = {
      id: `diagnostic:${encodeURIComponent(pos)}:${code}:${encodeURIComponent(message)}`,
      code,
      severity,
      message,
    };
    if (loc) diagnostic.location = loc;
    diagnostics.push(diagnostic);
  };
  const configs = new Map<string, Config>();
  for (const file of checked.files.filter((f) => isConfig(f.path))) {
    const parsed = ts.parseConfigFileTextToJson(file.path, file.content);
    const configSource = ts.createSourceFile(
      `/${file.path}`,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JSON,
    );
    if (parsed.error) {
      report(
        'config',
        ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'),
        location(
          configSource,
          parsed.error.start ?? 0,
          (parsed.error.start ?? 0) + (parsed.error.length ?? 0),
        ),
      );
      continue;
    }
    const raw = parsed.config as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      report(
        'config',
        `Invalid configuration: ${file.path}`,
        location(configSource, 0, 0),
      );
      continue;
    }
    const obj = raw as Record<string, unknown>;
    if (obj.extends !== undefined || obj.references !== undefined)
      report(
        'config-unsupported',
        `Configuration extends and project references are not supported: ${file.path}`,
        location(configSource, 0, 0),
        'warning',
      );
    if (
      obj.compilerOptions !== undefined &&
      (!obj.compilerOptions ||
        typeof obj.compilerOptions !== 'object' ||
        Array.isArray(obj.compilerOptions))
    ) {
      report(
        'config',
        `Invalid compilerOptions: ${file.path}`,
        location(configSource, 0, 0),
      );
      continue;
    }
    const converted = ts.convertCompilerOptionsFromJson(
      obj.compilerOptions ?? {},
      `/${dirname(file.path)}`,
      file.path,
    );
    for (const d of converted.errors)
      report(
        'config',
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        location(configSource, 0, 0),
      );
    const compilerOptions: ts.CompilerOptions = {
      moduleResolution: ts.ModuleResolutionKind.Node10,
      allowJs: true,
      ...converted.options,
    };
    const paths = compilerOptions.paths ?? {};
    configs.set(dirname(file.path), {
      options: compilerOptions,
      patterns: Object.keys(paths),
      directory: `/${dirname(file.path)}`,
    });
  }
  const findConfig = (path: string): Config => {
    let dir = dirname(path);
    while (true) {
      const config = configs.get(dir);
      if (config) return config;
      if (!dir) break;
      dir = dirname(dir);
    }
    return {
      options: {
        moduleResolution: ts.ModuleResolutionKind.Node10,
        allowJs: true,
      },
      patterns: [],
      directory: '/',
    };
  };
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  for (const file of checked.files)
    if (!isConfig(file.path)) {
      const id = fileId(file.path);
      nodes.set(id, {
        id,
        label: file.path,
        kind: 'file',
        metadata: { confidence: 1, evidence: [] },
      });
    }
  for (const file of checked.files) {
    if (isConfig(file.path)) continue;
    const scriptKind = file.path.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : file.path.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : file.path.endsWith('.js')
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS;
    const source = ts.createSourceFile(
      `/${file.path}`,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const parseDiagnostics = (
      source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    for (const d of parseDiagnostics) {
      const start = d.start ?? 0;
      report(
        `TS${d.code}`,
        ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        location(source, start, start + (d.length ?? 0)),
      );
    }
    const config = findConfig(file.path);
    const add = (
      kind: DependencyKind,
      node: ts.Node,
      specifier: string | undefined,
    ) => {
      const start = node.getStart(source);
      const loc = location(source, start, node.end);
      if (specifier === undefined) {
        report(
          'unresolved-dynamic',
          `Nonliteral ${kind} cannot be resolved`,
          loc,
          'warning',
        );
        return;
      }
      const resolved = ts.resolveModuleName(
        specifier,
        source.fileName,
        config.options,
        { ...host, getCurrentDirectory: () => config.directory },
      ).resolvedModule;
      let target: string | undefined;
      if (resolved && files.has(resolved.resolvedFileName))
        target = fileId(resolved.resolvedFileName.slice(1));
      const alias = config.patterns.some((pattern) => {
        const parts = pattern.split('*');
        return parts.length === 1
          ? specifier === pattern
          : parts.length === 2 &&
              specifier.startsWith(parts[0]!) &&
              specifier.endsWith(parts[1]!) &&
              specifier.length >= parts[0]!.length + parts[1]!.length;
      });
      if (
        !target &&
        !specifier.startsWith('.') &&
        !specifier.startsWith('/') &&
        !alias &&
        !specifier.includes('\\') &&
        !/^[A-Za-z]+:\/\//.test(specifier) &&
        specifier.length
      ) {
        const parts = specifier.split('/');
        const name = specifier.startsWith('@')
          ? parts.slice(0, 2).join('/')
          : parts[0]!;
        if (
          name &&
          (!specifier.startsWith('@') || (parts.length > 1 && !!parts[1]))
        ) {
          target = packageId(name);
          if (!nodes.has(target))
            nodes.set(target, {
              id: target,
              label: name,
              kind: 'external',
              metadata: { confidence: 1, evidence: [] },
            });
        }
      }
      if (!target) {
        report(
          'unresolved-module',
          `Cannot resolve ${kind} ${JSON.stringify(specifier)}`,
          loc,
          'warning',
        );
        return;
      }
      const id = `edge:${encodeURIComponent(file.path)}:${start}:${kind}:${encodeURIComponent(target)}`;
      edges.push({
        id,
        sourceId: fileId(file.path),
        targetId: target,
        kind,
        specifier,
        location: loc,
        metadata: {
          confidence: 1,
          evidence: [{ description: `${kind} ${specifier}`, location: loc }],
        },
      });
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        add('import', node.moduleSpecifier, node.moduleSpecifier.text);
      else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        add('re-export', node.moduleSpecifier, node.moduleSpecifier.text);
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        const kind =
          node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? 'dynamic-import'
            : 'require';
        const arg = node.arguments[0];
        add(
          kind,
          node,
          arg && ts.isStringLiteralLike(arg) ? arg.text : undefined,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const orderedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  edges.sort((a, b) => compare(a.id, b.id));
  diagnostics.sort((a, b) => compare(a.id, b.id));
  return {
    schemaVersion: '1.0',
    snapshotId: checked.id,
    diagnostics,
    dependencyGraph: { schemaVersion: '1.0', nodes: orderedNodes, edges },
    uiFlowGraph: { schemaVersion: '1.0', nodes: [], edges: [] },
  };
}
