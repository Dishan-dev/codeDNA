import ts from 'typescript';
import type {
  AnalysisDiagnostic,
  AnalysisMetadata,
  SourceLocation,
  UIFlowEdge,
  UIFlowNode,
  UINavigationEvent,
  UINavigationKind,
} from '@codedna/shared';
import { sourceLocation } from '../source.js';
import { discoverNextAppRoots } from './app-roots.js';
import type {
  UIFlowContext,
  UIFlowFrameworkAdapter,
  UIFlowAnalysis,
} from './index.js';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dir = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const componentFile = /(?:^|\/)page\.(?:ts|tsx|js|jsx)$/;
const isCode = /\.(?:ts|tsx|js|jsx)$/;
interface Route {
  id: string;
  path: string;
  source: string;
  segments: string[];
  shape: string;
  node: UIFlowNode;
}
interface Bindings {
  links: Set<string>;
  routers: Set<string>;
  redirects: Set<string>;
}
interface Action {
  kind: UINavigationKind;
  destination?: string;
  location: SourceLocation;
}
function loc(file: ts.SourceFile, node: ts.Node) {
  return sourceLocation(file, node.getStart(file), node.end);
}
function metadata(
  description: string,
  location: SourceLocation,
  confidence = 1,
): AnalysisMetadata {
  return { confidence, evidence: [{ description, location }] };
}
function segmentShape(segment: string): string {
  if (/^\[\[\.\.\.[^[\]/]+\]\]$/.test(segment)) return '[[...]]';
  if (/^\[\.\.\.[^[\]/]+\]$/.test(segment)) return '[...]';
  if (/^\[[^[\]/]+\]$/.test(segment)) return '[]';
  return segment;
}
function isCatchAll(segment: string) {
  return (
    segmentShape(segment) === '[...]' || segmentShape(segment) === '[[...]]'
  );
}
function matchRoute(route: Route, path: string): number | null {
  const parts = path === '/' ? [] : path.slice(1).split('/');
  let i = 0;
  let score = 0;
  for (const segment of route.segments) {
    const shape = segmentShape(segment);
    if (shape === '[[...]]') {
      score += 1;
      i = parts.length;
      break;
    }
    if (shape === '[...]') {
      if (i >= parts.length) return null;
      score += 2;
      i = parts.length;
      break;
    }
    if (i >= parts.length) return null;
    if (shape === '[]') score += 3;
    else {
      if (segment !== parts[i]) return null;
      score += 10;
    }
    i++;
  }
  return i === parts.length ? score : null;
}
function literal(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}
function imports(file: ts.SourceFile): Bindings {
  const links = new Set<string>(),
    routers = new Set<string>(),
    redirects = new Set<string>();
  for (const statement of file.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (statement.moduleSpecifier.text === 'next/link' && clause.name)
        links.add(clause.name.text);
      if (
        statement.moduleSpecifier.text === 'next/navigation' &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings)
      )
        for (const entry of clause.namedBindings.elements)
          if (!entry.isTypeOnly) {
            const original = entry.propertyName?.text ?? entry.name.text;
            if (original === 'useRouter') routers.add(entry.name.text);
            if (original === 'redirect' || original === 'permanentRedirect')
              redirects.add(entry.name.text);
          }
    }
  return { links, routers, redirects };
}
export function exportedBody(
  file: ts.SourceFile,
  name: string,
): ts.Node | undefined {
  let local = name;
  if (name === 'default') {
    const assignment = file.statements.find(ts.isExportAssignment);
    if (assignment && !assignment.isExportEquals) {
      if (ts.isIdentifier(assignment.expression))
        local = assignment.expression.text;
      else return assignment.expression;
    }
  }
  for (const statement of file.statements) {
    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    const isExport =
      modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    const isDefault =
      modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
    if (
      ts.isFunctionDeclaration(statement) &&
      ((name === 'default' && isDefault) ||
        (statement.name?.text === local && (isExport || local !== name)))
    )
      return statement;
    if (ts.isVariableStatement(statement) && (isExport || local !== name))
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === local &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        )
          return declaration.initializer;
  }
  return undefined;
}
function actions(file: ts.SourceFile, root: ts.Node): Action[] {
  const bindings = imports(file);
  const routers = new Set<string>();
  const result: Action[] = [];
  const declarations = new Map<string, number>();
  function names(name: ts.BindingName) {
    if (ts.isIdentifier(name))
      declarations.set(name.text, (declarations.get(name.text) ?? 0) + 1);
    else
      for (const element of name.elements)
        if (ts.isBindingElement(element)) names(element.name);
  }
  function collect(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)
    ) {
      if (!ts.isBindingElement(node)) names(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      names(node.name);
    ts.forEachChild(node, collect);
  }
  collect(root);
  for (const name of bindings.links)
    if (declarations.has(name)) bindings.links.delete(name);
  for (const name of bindings.routers)
    if (declarations.has(name)) bindings.routers.delete(name);
  for (const name of bindings.redirects)
    if (declarations.has(name)) bindings.redirects.delete(name);
  function findRouters(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      declarations.get(node.name.text) === 1 &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      bindings.routers.has(node.initializer.expression.text)
    )
      routers.add(node.name.text);
    ts.forEachChild(node, findRouters);
  }
  findRouters(root);
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      bindings.links.has(node.tagName.text)
    ) {
      const attr = node.attributes.properties.find(
        (prop) => ts.isJsxAttribute(prop) && prop.name.getText(file) === 'href',
      );
      let destination: string | undefined;
      if (
        !node.attributes.properties.some(ts.isJsxSpreadAttribute) &&
        attr &&
        ts.isJsxAttribute(attr) &&
        attr.initializer
      )
        destination = ts.isStringLiteral(attr.initializer)
          ? attr.initializer.text
          : ts.isJsxExpression(attr.initializer)
            ? literal(attr.initializer.expression)
            : undefined;
      result.push({
        kind: 'link',
        ...(destination !== undefined ? { destination } : {}),
        location: loc(file, attr ?? node),
      });
    }
    if (ts.isCallExpression(node)) {
      let kind: UINavigationKind | undefined;
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        routers.has(node.expression.expression.text) &&
        ['push', 'replace', 'back'].includes(node.expression.name.text)
      )
        kind = node.expression.name.text as UINavigationKind;
      if (
        ts.isIdentifier(node.expression) &&
        bindings.redirects.has(node.expression.text)
      )
        kind = 'redirect';
      if (kind) {
        const destination = literal(node.arguments[0]);
        result.push({
          kind,
          ...(destination !== undefined ? { destination } : {}),
          location: loc(file, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}
export function resolveLocal(
  from: string,
  spec: string,
  files: ReadonlyMap<string, unknown>,
): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const parts = dir(from).split('/').filter(Boolean);
  for (const part of spec.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  const base = parts.join('/');
  const substitutions = /\.js$/.test(base)
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base]
    : [base];
  for (const stem of substitutions)
    for (const suffix of [
      '',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '/index.ts',
      '/index.tsx',
      '/index.js',
      '/index.jsx',
    ])
      if (files.has(stem + suffix)) return stem + suffix;
  return undefined;
}
export function renderedImports(
  file: ts.SourceFile,
  root: ts.Node,
  context: UIFlowContext,
): { path: string; exported: string }[] {
  const candidates = new Map<string, { path: string; exported: string }>();
  for (const statement of file.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      const path = resolveLocal(
        file.fileName.slice(1),
        statement.moduleSpecifier.text,
        context.files,
      );
      if (!path) continue;
      const clause = statement.importClause;
      if (clause.name)
        candidates.set(clause.name.text, { path, exported: 'default' });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
        for (const binding of clause.namedBindings.elements)
          if (!binding.isTypeOnly)
            candidates.set(binding.name.text, {
              path,
              exported: binding.propertyName?.text ?? binding.name.text,
            });
    }
  const found = new Map<string, { path: string; exported: string }>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      const match = candidates.get(node.tagName.text);
      if (match) found.set(`${match.path}#${match.exported}`, match);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return [...found.values()];
}
export const nextAppRouterAdapter: UIFlowFrameworkAdapter = {
  id: 'next-app-router',
  analyze(context: UIFlowContext): UIFlowAnalysis {
    const diagnostics: AnalysisDiagnostic[] = [];
    const parsedDiagnostics = new Set<string>();
    const report = (
      code: string,
      message: string,
      location?: SourceLocation,
    ) => {
      const id = `ui-diagnostic:${code}:${encodeURIComponent(location ? `${location.path}:${location.start.line}:${location.start.column}` : message)}`;
      diagnostics.push({
        id,
        code,
        severity: 'warning',
        message,
        ...(location ? { location } : {}),
      });
    };
    const parse = (path: string) => {
      const source = context.parse(path);
      if (source && !parsedDiagnostics.has(path)) {
        parsedDiagnostics.add(path);
        const problems = (
          source as ts.SourceFile & {
            parseDiagnostics: readonly ts.Diagnostic[];
          }
        ).parseDiagnostics;
        for (const problem of problems) {
          const start = problem.start ?? 0;
          report(
            `TS${problem.code}`,
            ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
            sourceLocation(source, start, start + (problem.length ?? 0)),
          );
        }
      }
      return source;
    };
    const all = [...context.files.keys()].filter((path) => isCode.test(path));
    const candidates = discoverNextAppRoots(all);
    // Preserve root-level app/src-app precedence for existing single-app snapshots.
    const rootApp = all.some((path) => path.startsWith('app/'));
    const srcApp = all.some((path) => path.startsWith('src/app/'));
    if (rootApp && srcApp)
      report(
        'ui-app-root-ambiguous',
        'Both app/ and src/app/ are present; only app/ is analyzed.',
      );
    let root: string | undefined;
    if (context.appRoot !== undefined) {
      if (candidates.includes(context.appRoot)) root = context.appRoot;
      else
        report(
          'ui-app-root-invalid',
          'The selected App Router root was not found in the snapshot.',
        );
    } else if (
      candidates.length > 1 &&
      !(
        rootApp &&
        srcApp &&
        candidates.every(
          (candidate) => candidate === 'app' || candidate === 'src/app',
        )
      )
    ) {
      report(
        'ui-app-root-ambiguous',
        `Multiple App Router roots were found: ${candidates.join(', ')}. Select an application root to analyze.`,
      );
    } else {
      root = rootApp ? 'app' : srcApp ? 'src/app' : candidates[0];
    }
    if (!root)
      return {
        graph: {
          schemaVersion: '1.0',
          nodes: [],
          edges: [],
          navigationEvents: [],
        },
        diagnostics,
      };
    const routes: Route[] = [];
    for (const path of all.filter(
      (path) => path.startsWith(`${root}/`) && componentFile.test(path),
    )) {
      const file = parse(path)!;
      const pieces = path
        .slice(root.length + 1)
        .split('/')
        .slice(0, -1);
      const segments: string[] = [];
      let unsupported = false;
      for (const part of pieces) {
        if (part.startsWith('@') || /^\((?:\.|\.\.|\.\.\.)\)/.test(part)) {
          report(
            'ui-route-unsupported',
            `Parallel or intercepting route is not modeled: ${path}`,
            sourceLocation(file, 0, 0),
          );
          unsupported = true;
          break;
        }
        if (part.startsWith('(') && part.endsWith(')')) continue;
        if (
          (part.includes('[') || part.includes(']')) &&
          segmentShape(part) === part
        ) {
          report(
            'ui-route-unsupported',
            `Unsupported route segment: ${part}`,
            sourceLocation(file, 0, 0),
          );
          unsupported = true;
          break;
        }
        segments.push(part);
      }
      if (unsupported) continue;
      if (segments.slice(0, -1).some(isCatchAll)) {
        report(
          'ui-route-unsupported',
          `Catch-all segment must be last: ${path}`,
          sourceLocation(file, 0, 0),
        );
        continue;
      }
      const routePath = segments.length ? `/${segments.join('/')}` : '/';
      const id = `screen:${path}`;
      const boundaries: {
        kind: 'layout' | 'loading' | 'error';
        path: string;
      }[] = [];
      let folder = dir(path);
      while (folder === root || folder.startsWith(`${root}/`)) {
        for (const kind of ['layout', 'loading', 'error'] as const)
          for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
            const candidate = `${folder}/${kind}.${ext}`;
            if (context.files.has(candidate))
              boundaries.push({ kind, path: candidate });
          }
        if (folder === root) break;
        folder = dir(folder);
      }
      const node: UIFlowNode = {
        id,
        label: routePath,
        framework: 'next-app-router',
        routePath,
        sourceFile: path,
        boundaries,
        location: sourceLocation(file, 0, 0),
        metadata: metadata(
          'App Router page convention',
          sourceLocation(file, 0, 0),
        ),
      };
      routes.push({
        id,
        path: routePath,
        source: path,
        segments,
        shape: segments.map(segmentShape).join('/'),
        node,
      });
    }
    routes.sort((a, b) => cmp(a.source, b.source));
    const shapes = new Map<string, Route[]>();
    for (const route of routes) {
      const group = shapes.get(route.shape) ?? [];
      group.push(route);
      shapes.set(route.shape, group);
    }
    const colliding = new Set<string>();
    const collision = (group: Route[]) => {
      for (const route of group) {
        colliding.add(route.id);
        report(
          'ui-route-collision',
          `Ambiguous route pattern ${route.path}: ${group
            .map((r) => r.source)
            .sort(cmp)
            .join(', ')}`,
          route.node.location,
        );
      }
    };
    for (const group of shapes.values()) if (group.length > 1) collision(group);
    for (const route of routes)
      if (
        route.segments.length &&
        segmentShape(route.segments[route.segments.length - 1]!) === '[[...]]'
      ) {
        const prefix = route.segments.slice(0, -1).map(segmentShape).join('/');
        const conflicts = shapes.get(prefix);
        if (conflicts?.length) collision([route, ...conflicts]);
      }
    const buckets = new Map<string, Route[]>();
    for (const route of routes) {
      const first = route.segments[0];
      const key = !first ? '/' : segmentShape(first) !== first ? '*' : first;
      const list = buckets.get(key) ?? [];
      list.push(route);
      buckets.set(key, list);
    }

    const usages = new Map<
      string,
      { path: string; exported: string; routes: Set<string> }
    >();
    const pageRoots = new Map<string, ts.Node>();
    for (const route of routes) {
      const source = parse(route.source)!;
      const body = exportedBody(source, 'default');
      if (!body) {
        report(
          'ui-page-unsupported',
          `Cannot establish the default page component: ${route.source}`,
          route.node.location,
        );
        continue;
      }
      pageRoots.set(route.id, body);
      for (const item of renderedImports(source, body, context)) {
        const key = `${item.path}#${item.exported}`;
        let usage = usages.get(key);
        if (!usage) {
          usage = { ...item, routes: new Set() };
          usages.set(key, usage);
        }
        usage.routes.add(route.id);
      }
    }
    const componentImporters = new Map<string, Set<string>>();
    if (usages.size)
      for (const path of all) {
        const file = context.parse(path);
        if (!file) continue;
        const observe = (spec: string) => {
          const target = resolveLocal(path, spec, context.files);
          if (target) {
            const set = componentImporters.get(target) ?? new Set<string>();
            set.add(path);
            componentImporters.set(target, set);
          }
        };
        const visitImport = (node: ts.Node) => {
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          )
            observe(node.moduleSpecifier.text);
          else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === 'require')) &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          )
            observe(node.arguments[0].text);
          ts.forEachChild(node, visitImport);
        };
        visitImport(file);
      }
    const byId = new Map(routes.map((route) => [route.id, route]));
    const events: UINavigationEvent[] = [];
    const edges: UIFlowEdge[] = [];
    function addAction(route: Route, action: Action, shared: boolean) {
      const location = action.location;
      const id = `navigation:${encodeURIComponent(location.path)}:${location.start.line}:${location.start.column}:${action.kind}:${encodeURIComponent(route.id)}`;
      let resolution: UINavigationEvent['resolution'] = 'unresolved';
      let target: Route | undefined;
      const destination = action.destination;
      if (action.kind === 'back') {
        resolution = 'dynamic';
        report(
          'ui-navigation-history',
          'History navigation has no statically known destination.',
          location,
        );
      } else if (destination === undefined) {
        resolution = 'dynamic';
        report(
          'ui-navigation-dynamic',
          `Nonliteral ${action.kind} destination cannot be resolved.`,
          location,
        );
      } else if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(destination))
        resolution = 'external';
      else if (destination.startsWith('/') && !destination.startsWith('//')) {
        const pathname =
          destination.split(/[?#]/, 1)[0]!.replace(/\/$/, '') || '/';
        const first = pathname === '/' ? '/' : pathname.slice(1).split('/')[0]!;
        const candidates = [
          ...(buckets.get(first) ?? []),
          ...(buckets.get('*') ?? []),
        ];
        const matches = candidates
          .map((route) => ({ route, score: matchRoute(route, pathname) }))
          .filter((m): m is { route: Route; score: number } => m.score !== null)
          .sort(
            (a, b) => b.score - a.score || cmp(a.route.source, b.route.source),
          );
        if (
          matches.length &&
          (matches.length === 1 || matches[0]!.score > matches[1]!.score) &&
          !colliding.has(matches[0]!.route.id)
        ) {
          target = matches[0]!.route;
          resolution = 'internal';
        } else {
          report(
            matches.length
              ? 'ui-navigation-ambiguous'
              : 'ui-navigation-unresolved',
            `Cannot uniquely resolve ${destination}.`,
            location,
          );
        }
      } else
        report(
          'ui-navigation-unresolved',
          `Cannot resolve relative or empty destination ${JSON.stringify(destination)}.`,
          location,
        );
      const evidence = metadata(
        shared
          ? `Navigation in directly rendered, uniquely attributed component for ${route.source}`
          : `Navigation in page component ${route.source}`,
        location,
        shared ? 0.8 : 1,
      );
      const event: UINavigationEvent = {
        id,
        sourceId: route.id,
        kind: action.kind,
        resolution,
        location,
        metadata: evidence,
        ...(destination !== undefined ? { destination } : {}),
        ...(target ? { targetId: target.id } : {}),
      };
      events.push(event);
      if (target)
        edges.push({
          id: `edge:${id}`,
          sourceId: route.id,
          targetId: target.id,
          kind: action.kind,
          location,
          metadata: evidence,
          ...(destination !== undefined ? { destination } : {}),
        });
    }
    for (const route of routes) {
      const body = pageRoots.get(route.id);
      if (body)
        for (const action of actions(parse(route.source)!, body))
          addAction(route, action, false);
    }
    for (const usage of usages.values()) {
      const source = parse(usage.path);
      if (!source) continue;
      const body = exportedBody(source, usage.exported);
      if (!body) continue;
      const detected = actions(source, body);
      if (!detected.length) continue;
      const onlyRoute =
        usage.routes.size === 1 ? byId.get([...usage.routes][0]!) : undefined;
      const importers = componentImporters.get(usage.path) ?? new Set<string>();
      if (
        !onlyRoute ||
        [...importers].some((path) => path !== onlyRoute.source)
      ) {
        for (const action of detected) {
          report(
            'ui-shared-ambiguous',
            `Shared navigation component ${usage.path} has multiple or indirect importers; attribution is ambiguous.`,
            action.location,
          );
          events.push({
            id: `navigation:unattributed:${encodeURIComponent(action.location.path)}:${action.location.start.line}:${action.location.start.column}:${action.kind}`,
            kind: action.kind,
            resolution:
              action.destination === undefined || action.kind === 'back'
                ? 'dynamic'
                : /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(action.destination)
                  ? 'external'
                  : 'unresolved',
            ...(action.destination !== undefined
              ? { destination: action.destination }
              : {}),
            location: action.location,
            metadata: metadata(
              'Navigation in a shared component with ambiguous screen attribution',
              action.location,
              0.5,
            ),
          });
        }
        continue;
      }
      const route = byId.get([...usage.routes][0]!);
      if (route) for (const action of detected) addAction(route, action, true);
    }
    events.sort((a, b) => cmp(a.id, b.id));
    edges.sort((a, b) => cmp(a.id, b.id));
    diagnostics.sort((a, b) => cmp(a.id, b.id));
    return {
      graph: {
        schemaVersion: '1.0',
        nodes: routes.map((route) => route.node),
        edges,
        navigationEvents: events,
      },
      diagnostics,
    };
  },
};
