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
import {
  exportedBody,
  renderedImports,
  resolveLocal,
} from './next-app-router.js';
import type {
  UIFlowAnalysis,
  UIFlowContext,
  UIFlowFrameworkAdapter,
} from './index.js';

const code = /\.(?:ts|tsx|js|jsx)$/;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dirname = (path: string) =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const place = (file: ts.SourceFile, node: ts.Node) =>
  sourceLocation(file, node.getStart(file), node.end);
const metadata = (
  description: string,
  location: SourceLocation,
  confidence = 1,
): AnalysisMetadata => ({ confidence, evidence: [{ description, location }] });
const platform = /\.(?:ios|android|native|web)\.(?:ts|tsx|js|jsx)$/;
const roots = /^(?:src\/)?app\//;
interface Bindings {
  links: Set<string>;
  redirects: Set<string>;
  hooks: Set<string>;
  routers: Set<string>;
}
interface Route {
  id: string;
  path: string;
  source: string;
  segments: string[];
  node: UIFlowNode;
  index: boolean;
  platformVariant: boolean;
}
interface Action {
  kind: UINavigationKind;
  destination?: string;
  location: SourceLocation;
  relativeSupported: boolean;
}
function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function routerImports(file: ts.SourceFile): Bindings {
  const result: Bindings = {
    links: new Set(),
    redirects: new Set(),
    hooks: new Set(),
    routers: new Set(),
  };
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'expo-router' ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    )
      continue;
    const named = statement.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const item of named.elements) {
      if (item.isTypeOnly) continue;
      const original = item.propertyName?.text ?? item.name.text;
      if (original === 'Link') result.links.add(item.name.text);
      if (original === 'Redirect') result.redirects.add(item.name.text);
      if (original === 'useRouter') result.hooks.add(item.name.text);
      if (original === 'router') result.routers.add(item.name.text);
    }
  }
  return result;
}
/** A used Expo Router value import inside a route root is source evidence. */
export function hasExpoRouterEvidence(context: UIFlowContext): boolean {
  for (const path of context.files.keys()) {
    if (!roots.test(path) || !code.test(path)) continue;
    const file = context.parse(path);
    if (!file) continue;
    const names = new Set<string>();
    for (const statement of file.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== 'expo-router' ||
        !statement.importClause ||
        statement.importClause.isTypeOnly
      )
        continue;
      const named = statement.importClause.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const item of named.elements)
          if (
            !item.isTypeOnly &&
            [
              'Link',
              'Redirect',
              'router',
              'useRouter',
              'Stack',
              'Tabs',
              'Slot',
              'Drawer',
            ].includes(item.propertyName?.text ?? item.name.text)
          )
            names.add(item.name.text);
    }
    if (!names.size) continue;
    let used = false;
    for (const statement of file.statements)
      if (!ts.isImportDeclaration(statement))
        walk(statement, (node) => {
          if (ts.isIdentifier(node) && names.has(node.text)) used = true;
        });
    if (used) return true;
  }
  return false;
}
export function hasNextSourceEvidence(context: UIFlowContext): boolean {
  for (const path of context.files.keys()) {
    if (!roots.test(path) || !code.test(path)) continue;
    const file = context.parse(path);
    if (!file) continue;
    if (
      file.statements.some(
        (statement) =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          /^next\//.test(statement.moduleSpecifier.text) &&
          !!statement.importClause &&
          !statement.importClause.isTypeOnly,
      )
    )
      return true;
  }
  return false;
}
function actions(file: ts.SourceFile, root: ts.Node): Action[] {
  const bindings = routerImports(file),
    declarations = new Map<string, number>();
  const count = (name: ts.BindingName) => {
    if (ts.isIdentifier(name))
      declarations.set(name.text, (declarations.get(name.text) ?? 0) + 1);
    else
      for (const item of name.elements)
        if (ts.isBindingElement(item)) count(item.name);
  };
  walk(root, (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node))
      count(node.name);
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      count(node.name);
  });
  for (const set of [
    bindings.links,
    bindings.redirects,
    bindings.hooks,
    bindings.routers,
  ])
    for (const name of set) if (declarations.has(name)) set.delete(name);
  walk(root, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      declarations.get(node.name.text) === 1 &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      bindings.hooks.has(node.initializer.expression.text)
    )
      bindings.routers.add(node.name.text);
  });
  const found: Action[] = [];
  const literal = (node: ts.Node | undefined) =>
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : undefined;
  walk(root, (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      (bindings.links.has(node.tagName.text) ||
        bindings.redirects.has(node.tagName.text))
    ) {
      const attr = node.attributes.properties.find(
        (p): p is ts.JsxAttribute =>
          ts.isJsxAttribute(p) && p.name.getText(file) === 'href',
      );
      const relativeOption = node.attributes.properties.some(
        (p) =>
          ts.isJsxAttribute(p) &&
          p.name.getText(file) === 'relativeToDirectory',
      );
      const value = attr?.initializer;
      const destination = node.attributes.properties.some(
        ts.isJsxSpreadAttribute,
      )
        ? undefined
        : value && ts.isJsxExpression(value)
          ? literal(value.expression)
          : literal(value);
      found.push({
        kind: bindings.redirects.has(node.tagName.text) ? 'redirect' : 'link',
        ...(destination !== undefined ? { destination } : {}),
        location: place(file, attr ?? node),
        relativeSupported: !relativeOption,
      });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      bindings.routers.has(node.expression.expression.text)
    ) {
      const method = node.expression.name.text;
      if (!['push', 'replace', 'navigate', 'back'].includes(method)) return;
      const destination = literal(node.arguments[0]);
      found.push({
        kind: method as UINavigationKind,
        ...(destination !== undefined ? { destination } : {}),
        location: place(file, node),
        relativeSupported: node.arguments.length < 2,
      });
    }
  });
  return found;
}
function shape(part: string): string {
  return /^\[\.\.\.[^\]]+\]$/.test(part)
    ? '[...]'
    : /^\[[^\].]+\]$/.test(part)
      ? '[]'
      : part;
}
function match(route: Route, path: string): number | undefined {
  const parts = path.split('/').filter(Boolean);
  let i = 0,
    score = 0;
  for (const segment of route.segments) {
    const key = shape(segment);
    if (key === '[...]') {
      if (i >= parts.length) return undefined;
      i = parts.length;
      score += 1;
      break;
    }
    if (i >= parts.length) return undefined;
    if (key === '[]') score += 3;
    else if (segment === parts[i]) score += 10;
    else return undefined;
    i++;
  }
  return i === parts.length ? score : undefined;
}
function destinationPath(
  destination: string,
  route: Route,
  allowed: boolean,
): string | undefined {
  const clean = destination.split(/[?#]/, 1)[0]!;
  if (clean.startsWith('/')) return clean.replace(/\/$/, '') || '/';
  if (
    !allowed ||
    !(clean.startsWith('./') || clean.startsWith('../') || clean === '..') ||
    route.segments.some((s) => shape(s) !== s) ||
    (route.index && route.path !== '/')
  )
    return undefined;
  const parts = route.segments.slice(0, -1);
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return '/' + parts.join('/');
}

export const expoRouterAdapter: UIFlowFrameworkAdapter = {
  id: 'expo-router',
  analyze(context): UIFlowAnalysis {
    const diagnostics: AnalysisDiagnostic[] = [],
      routes: Route[] = [],
      events: UINavigationEvent[] = [],
      edges: UIFlowEdge[] = [];
    const report = (codeName: string, message: string, loc?: SourceLocation) =>
      diagnostics.push({
        id: `expo:${codeName}:${encodeURIComponent(loc ? `${loc.path}:${loc.start.line}:${loc.start.column}` : message)}`,
        code: `expo-${codeName}`,
        severity: 'warning',
        message,
        ...(loc ? { location: loc } : {}),
      });
    const parsed = new Set<string>();
    const parse = (path: string) => {
      const file = context.parse(path);
      if (file && !parsed.has(path)) {
        parsed.add(path);
        const problems = (
          file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
        ).parseDiagnostics;
        for (const issue of problems) {
          const start = issue.start ?? 0;
          report(
            `TS${issue.code}`,
            ts.flattenDiagnosticMessageText(issue.messageText, '\n'),
            sourceLocation(file, start, start + (issue.length ?? 0)),
          );
        }
      }
      return file;
    };
    const all = [...context.files.keys()].filter((p) => code.test(p));
    const hasApp = all.some((p) => p.startsWith('app/')),
      hasSrc = all.some((p) => p.startsWith('src/app/'));
    if (hasApp && hasSrc)
      report(
        'app-root-ambiguous',
        'Both app/ and src/app/ exist; only src/app/ is analyzed.',
      );
    const root = hasSrc ? 'src/app' : hasApp ? 'app' : undefined;
    if (!root)
      return {
        framework: 'expo-router',
        graph: {
          schemaVersion: context.snapshot.schemaVersion,
          nodes: [],
          edges: [],
          navigationEvents: [],
        },
        diagnostics,
      };
    const routeFiles = all.filter((path) => path.startsWith(`${root}/`));
    const variantBases = new Set(
      all.filter((p) => platform.test(p)).map((p) => p.replace(platform, '')),
    );
    for (const path of routeFiles) {
      const file = parse(path)!;
      const loc = sourceLocation(file, 0, 0);
      if (platform.test(path)) {
        report(
          'platform-unsupported',
          `Platform-specific route or layout is not analyzed: ${path}`,
          loc,
        );
        continue;
      }
      if (
        /\.d\.ts$|\.(?:test|spec)\.(?:tsx?|jsx?)$/.test(path) ||
        /(?:^|\/)(?:__tests__|__mocks__)(?:\/|$)/.test(path)
      )
        continue;
      const name = path.slice(path.lastIndexOf('/') + 1).replace(code, '');
      if (name === '_layout') continue;
      const parts = path.slice(root.length + 1).split('/');
      parts.pop();
      if (name !== 'index') parts.push(name);
      const segments: string[] = [];
      let unsupported = false;
      for (const part of parts) {
        if (/^\([^(),]+\)$/.test(part)) continue;
        if (
          !part ||
          part.startsWith('+') ||
          part.startsWith('_') ||
          /[()]/.test(part) ||
          ((part.includes('[') || part.includes(']')) && shape(part) === part)
        ) {
          report(
            'route-unsupported',
            `Unsupported Expo route convention in ${path}.`,
            loc,
          );
          unsupported = true;
          break;
        }
        segments.push(part);
      }
      if (unsupported) continue;
      if (segments.slice(0, -1).some((s) => shape(s) === '[...]')) {
        report(
          'route-unsupported',
          `Catch-all must be the final segment: ${path}.`,
          loc,
        );
        continue;
      }
      const body = exportedBody(file, 'default');
      if (
        !body ||
        !(
          ts.isFunctionDeclaration(body) ||
          ts.isArrowFunction(body) ||
          ts.isFunctionExpression(body)
        )
      ) {
        report(
          'screen-unsupported',
          `No statically identifiable default screen component: ${path}.`,
          loc,
        );
        continue;
      }
      const routePath = '/' + segments.join('/'),
        id = `screen:expo:${path}`;
      const boundaries: NonNullable<UIFlowNode['boundaries']> = [];
      let folder = dirname(path);
      while (folder === root || folder.startsWith(`${root}/`)) {
        for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
          const candidate = `${folder}/_layout.${ext}`;
          if (context.files.has(candidate))
            boundaries.push({ kind: 'layout', path: candidate });
        }
        if (folder === root) break;
        folder = dirname(folder);
      }
      const node: UIFlowNode = {
        id,
        label: routePath,
        framework: 'expo-router',
        routePath,
        sourceFile: path,
        boundaries,
        location: loc,
        metadata: metadata(
          'Expo Router file convention and default screen export',
          loc,
        ),
      };
      routes.push({
        id,
        path: routePath,
        source: path,
        segments,
        node,
        index: name === 'index',
        platformVariant: variantBases.has(path.replace(code, '')),
      });
    }
    routes.sort((a, b) => cmp(a.source, b.source));
    const shapes = new Map<string, Route[]>(),
      buckets = new Map<string, Route[]>(),
      colliding = new Set<string>();
    for (const route of routes) {
      const key = route.segments.map(shape).join('/'),
        group = shapes.get(key) ?? [];
      group.push(route);
      shapes.set(key, group);
      const first = route.segments[0],
        bucketKey = !first ? '/' : shape(first) !== first ? '*' : first,
        bucket = buckets.get(bucketKey) ?? [];
      bucket.push(route);
      buckets.set(bucketKey, bucket);
    }
    for (const group of shapes.values())
      if (group.length > 1)
        for (const route of group) {
          colliding.add(route.id);
          report(
            'route-collision',
            `Ambiguous Expo route ${route.path}: ${group.map((r) => r.source).join(', ')}.`,
            route.node.location,
          );
        }
    const usages = new Map<
      string,
      { path: string; exported: string; routes: Set<string> }
    >();
    for (const route of routes) {
      const file = parse(route.source)!,
        body = exportedBody(file, 'default')!;
      for (const item of renderedImports(file, body, context)) {
        const key = `${item.path}#${item.exported}`,
          usage = usages.get(key) ?? { ...item, routes: new Set<string>() };
        usage.routes.add(route.id);
        usages.set(key, usage);
      }
    }
    const importers = new Map<string, Set<string>>();
    if (usages.size)
      for (const path of all) {
        const file = context.parse(path);
        if (!file) continue;
        walk(file, (node) => {
          let spec: string | undefined;
          if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
          )
            spec = node.moduleSpecifier.text;
          else if (
            ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
              (ts.isIdentifier(node.expression) &&
                node.expression.text === 'require')) &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          )
            spec = node.arguments[0].text;
          if (!spec) return;
          const target = resolveLocal(path, spec, context.files);
          if (!target) return;
          const set = importers.get(target) ?? new Set<string>();
          set.add(path);
          importers.set(target, set);
        });
      }
    const add = (action: Action, route?: Route, shared = false) => {
      const loc = action.location,
        dest = action.destination;
      const id = `navigation:expo:${encodeURIComponent(loc.path)}:${loc.start.line}:${loc.start.column}:${action.kind}:${route ? encodeURIComponent(route.id) : 'unattributed'}`;
      let resolution: UINavigationEvent['resolution'] =
        action.kind === 'back'
          ? 'unresolved'
          : dest === undefined
            ? 'dynamic'
            : /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(dest)
              ? 'external'
              : 'unresolved';
      let target: Route | undefined;
      if (
        route &&
        dest !== undefined &&
        resolution === 'unresolved' &&
        action.kind !== 'back'
      ) {
        const path = destinationPath(dest, route, action.relativeSupported);
        if (path !== undefined) {
          const first = path === '/' ? '/' : path.slice(1).split('/')[0]!;
          const matches = [
            ...(buckets.get(first) ?? []),
            ...(buckets.get('*') ?? []),
          ]
            .map((candidate) => ({
              route: candidate,
              score: match(candidate, path),
            }))
            .filter(
              (m): m is { route: Route; score: number } =>
                m.score !== undefined,
            )
            .sort(
              (a, b) =>
                b.score - a.score || cmp(a.route.source, b.route.source),
            );
          if (
            matches.length &&
            (matches.length === 1 || matches[0]!.score > matches[1]!.score) &&
            !colliding.has(matches[0]!.route.id)
          ) {
            target = matches[0]!.route;
            resolution = 'internal';
          }
        }
      }
      if (!route)
        report(
          'shared-ambiguous',
          'Navigation has ambiguous screen attribution because its component is shared, indirect, or platform-dependent.',
          loc,
        );
      else if (resolution === 'dynamic' || resolution === 'unresolved')
        report(
          action.kind === 'back'
            ? 'history-navigation'
            : 'navigation-unresolved',
          action.kind === 'back'
            ? 'History navigation has no statically known destination.'
            : 'Navigation destination could not be uniquely resolved.',
          loc,
        );
      const info = metadata(
        route
          ? shared
            ? `Navigation in uniquely attributed component rendered by ${route.source}`
            : `Navigation in Expo screen ${route.source}`
          : 'Navigation with ambiguous screen attribution',
        loc,
        route ? (shared ? 0.8 : 1) : 0.5,
      );
      events.push({
        id,
        kind: action.kind,
        resolution,
        location: loc,
        metadata: info,
        ...(route ? { sourceId: route.id } : {}),
        ...(target ? { targetId: target.id } : {}),
        ...(dest !== undefined ? { destination: dest } : {}),
      });
      if (route && target)
        edges.push({
          id: `edge:${id}`,
          sourceId: route.id,
          targetId: target.id,
          kind: action.kind,
          location: loc,
          metadata: info,
          ...(dest !== undefined ? { destination: dest } : {}),
        });
    };
    const byId = new Map(routes.map((route) => [route.id, route]));
    for (const route of routes) {
      if (route.platformVariant) {
        report(
          'platform-ambiguous',
          `Screen has platform-specific alternatives; navigation is not attributed: ${route.source}.`,
          route.node.location,
        );
        const file = parse(route.source)!;
        for (const action of actions(file, exportedBody(file, 'default')!))
          add(action);
        continue;
      }
      const file = parse(route.source)!;
      for (const action of actions(file, exportedBody(file, 'default')!))
        add(action, route);
    }
    for (const usage of usages.values()) {
      const file = parse(usage.path),
        body = file && exportedBody(file, usage.exported);
      if (!file || !body) continue;
      const found = actions(file, body);
      if (!found.length) continue;
      const componentHasVariants = variantBases.has(
        usage.path.replace(code, ''),
      );
      const route =
        usage.routes.size === 1 ? byId.get([...usage.routes][0]!) : undefined;
      if (
        !route ||
        route.platformVariant ||
        componentHasVariants ||
        [...(importers.get(usage.path) ?? [])].some((p) => p !== route.source)
      )
        for (const action of found) add(action);
      else for (const action of found) add(action, route, true);
    }
    events.sort((a, b) => cmp(a.id, b.id));
    edges.sort((a, b) => cmp(a.id, b.id));
    diagnostics.sort((a, b) => cmp(a.id, b.id));
    return {
      framework: 'expo-router',
      graph: {
        schemaVersion: context.snapshot.schemaVersion,
        nodes: routes.map((r) => r.node),
        edges,
        navigationEvents: events,
      },
      diagnostics,
    };
  },
};
