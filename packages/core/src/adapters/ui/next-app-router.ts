import ts from 'typescript';
import type { AnalysisDiagnostic, PageRoute } from '@codedna/shared';
import type { ParsedFile } from '../../snapshot/parse.js';
import { diagnostic } from '../../snapshot/validate.js';

const ROUTE_FILE = /^(page|layout|route)\.(?:tsx|ts|jsx|js)$/;
const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface NextRoutes {
  routes: PageRoute[];
  /** Folders that hold an App Router tree, e.g. `app` or `apps/web/src/app`. */
  appRoots: string[];
  diagnostics: AnalysisDiagnostic[];
}

/** The first `app` folder (optionally inside `src`) on the path is the App Router root. */
function splitAppPath(path: string): { root: string; dirs: string[]; name: string } | undefined {
  const parts = path.split('/');
  const name = parts.pop()!;
  const index = parts.indexOf('app');
  if (index < 0) return undefined;
  return { root: parts.slice(0, index + 1).join('/'), dirs: parts.slice(index + 1), name };
}

/** Route groups, parallel slots and private folders follow Next.js file conventions. */
function routeFromDirs(dirs: readonly string[]): { route: string; dynamic: boolean } | 'private' | 'intercepting' {
  const kept: string[] = [];
  for (const dir of dirs) {
    if (dir.startsWith('_')) return 'private';
    if (/^\(\.{1,3}\)/.test(dir)) return 'intercepting';
    if (/^\(.+\)$/.test(dir) || dir.startsWith('@')) continue;
    kept.push(dir);
  }
  return { route: `/${kept.join('/')}`, dynamic: kept.some((dir) => /^\[.+\]$/.test(dir)) };
}

/** Exported HTTP method handlers: functions, consts and `export { handler as GET }`. */
export function exportedMethods(source: ts.SourceFile): string[] {
  const methods = new Set<string>();
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && exported(statement)) methods.add(statement.name.text);
    else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) methods.add(declaration.name.text);
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) methods.add(element.name.text);
    }
  }
  return [...methods].filter((name) => HTTP_METHODS.has(name)).sort();
}

/** Pages, layouts and route handlers from Next.js App Router file conventions. */
export function findNextRoutes(files: readonly ParsedFile[]): NextRoutes {
  const routes: PageRoute[] = [];
  const diagnostics: AnalysisDiagnostic[] = [];
  const roots = new Set<string>();
  const layouts = new Map<string, string>();
  const candidates: { file: ParsedFile; root: string; dirs: string[]; kind: 'page' | 'layout' | 'route' }[] = [];

  for (const file of files) {
    const fileName = file.path.slice(file.path.lastIndexOf('/') + 1);
    const match = ROUTE_FILE.exec(fileName);
    if (!match) continue;
    const split = splitAppPath(file.path);
    if (!split) continue;
    candidates.push({ file, root: split.root, dirs: split.dirs, kind: match[1] as 'page' | 'layout' | 'route' });
    roots.add(split.root);
    if (match[1] === 'layout') layouts.set(file.path.slice(0, file.path.lastIndexOf('/')), file.path);
  }

  for (const { file, root, dirs, kind } of candidates) {
    const route = routeFromDirs(dirs);
    if (route === 'private') continue;
    if (route === 'intercepting') {
      diagnostics.push(diagnostic('intercepting-route', 'info', `${file.path} is an intercepting route; CodeDNA does not build lessons for those yet.`, file.path));
      continue;
    }
    if (kind === 'layout') {
      routes.push({ id: `layout:${file.path}`, kind: 'layout', route: route.route, file: file.path, dynamic: route.dynamic });
      continue;
    }
    if (kind === 'route') {
      const methods = exportedMethods(file.source);
      if (!methods.length) diagnostics.push(diagnostic('route-no-methods', 'info', `${file.path} exports no HTTP method handlers CodeDNA recognises.`, file.path));
      routes.push({ id: `route:${file.path}`, kind: 'route-handler', route: route.route, file: file.path, dynamic: route.dynamic, methods });
      continue;
    }
    // Layouts wrap a page from the root folder down to the page's own folder.
    const chain: string[] = [];
    for (let depth = 0; depth <= dirs.length; depth++) {
      const folder = [root, ...dirs.slice(0, depth)].join('/');
      const layout = layouts.get(folder);
      if (layout) chain.push(layout);
    }
    routes.push({ id: `page:${file.path}`, kind: 'page', route: route.route, file: file.path, dynamic: route.dynamic, ...(chain.length ? { layouts: chain } : {}) });
  }

  return {
    routes: routes.sort((a, b) => compare(a.route, b.route) || compare(a.kind, b.kind) || compare(a.file, b.file)),
    appRoots: [...roots].sort(compare),
    diagnostics,
  };
}
