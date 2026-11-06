import ts from 'typescript';
import type { AnalysisDiagnostic, ImportEdge, ImportKind, RepositoryText } from '@codedna/shared';
import { lineOf, type ParsedFile } from '../snapshot/parse.js';
import { diagnostic } from '../snapshot/validate.js';
import { createResolution, matchesAlias, ROOT, type Resolution } from './host.js';

export interface ImportGraph {
  edges: ImportEdge[];
  diagnostics: AnalysisDiagnostic[];
  partial: boolean;
}
export interface ImportGraphOptions {
  deadline?: number;
  now?: () => number;
  /** Shared resolution, so the import graph and the call resolver agree. */
  resolution?: Resolution;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

interface Found {
  specifier: string | undefined;
  kind: ImportKind;
  node: ts.Node;
}
function collect(source: ts.SourceFile): Found[] {
  const found: Found[] = [];
  const literal = (node: ts.Expression | undefined) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined);
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) found.push({ specifier: literal(statement.moduleSpecifier), kind: statement.importClause?.isTypeOnly ? 'type' : 'static', node: statement });
    else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) found.push({ specifier: literal(statement.moduleSpecifier), kind: statement.isTypeOnly ? 'type' : 'reexport', node: statement });
    else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference))
      found.push({ specifier: literal(statement.moduleReference.expression), kind: 'require', node: statement });
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) found.push({ specifier: literal(node.arguments[0]), kind: 'dynamic', node });
      // A computed require() is usually a runtime plugin loader; it is recorded as unknown.
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1) found.push({ specifier: literal(node.arguments[0]), kind: 'require', node });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Bounded import graph: every edge has a location and a confidence tier. */
export function buildImportGraph(files: readonly ParsedFile[], manifests: readonly RepositoryText[], options: ImportGraphOptions = {}): ImportGraph {
  const now = options.now ?? Date.now;
  const resolution = options.resolution ?? createResolution(files, manifests);
  const diagnostics: AnalysisDiagnostic[] = options.resolution ? [] : [...resolution.diagnostics];
  const edges = new Map<string, ImportEdge>();
  let partial = false;
  for (const file of files) {
    if (file.language === 'json') continue;
    if (options.deadline !== undefined && now() > options.deadline) {
      partial = true;
      diagnostics.push(diagnostic('import-time-limit', 'warning', 'Reading imports took too long; some files were not linked.'));
      break;
    }
    for (const { specifier, kind, node } of collect(file.source)) {
      const line = lineOf(file.source, node.getStart(file.source));
      if (specifier === undefined) {
        const id = `import:${file.path}:${line}:<computed>`;
        edges.set(id, { id, from: file.path, specifier: node.getText(file.source).slice(0, 120), kind, line, confidence: 'gap' });
        continue;
      }
      const id = `import:${file.path}:${line}:${specifier}`;
      const resolved = resolution.resolve(specifier, file.path).resolvedModule;
      const target = resolved && !resolved.isExternalLibraryImport && resolved.resolvedFileName.startsWith(`${ROOT}/`) ? resolved.resolvedFileName.slice(ROOT.length + 1) : undefined;
      if (target) {
        edges.set(id, { id, from: file.path, specifier, kind, line, target, confidence: 'resolved' });
        continue;
      }
      if (specifier.startsWith('.') || specifier.startsWith('/') || matchesAlias(specifier, resolution.optionsFor(file.path))) {
        edges.set(id, { id, from: file.path, specifier, kind, line, confidence: 'gap' });
        diagnostics.push(diagnostic('import-unresolved', 'warning', `\`${specifier}\` imported in ${file.path} is not in this snapshot.`, file.path, line));
        continue;
      }
      edges.set(id, { id, from: file.path, specifier, kind, line, package: packageName(specifier), confidence: 'resolved' });
    }
  }
  return {
    edges: [...edges.values()].sort((a, b) => compare(a.from, b.from) || a.line - b.line || compare(a.specifier, b.specifier)),
    diagnostics,
    partial,
  };
}
