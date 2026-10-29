import ts from 'typescript';
import type {
  AnalysisDiagnostic,
  SourceLocation,
  UIFlowEdge,
  UIFlowNode,
  UINavigationEvent,
  UINavigationKind,
} from '@codedna/shared';
import { sourceLocation } from '../source.js';
import type { UIFlowContext, UIFlowFrameworkAdapter } from './index.js';

const code = /\.(?:tsx?|jsx?)$/;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
type Bindings = Map<string, string>;
type Component = { file: string; name: string; imported: boolean };
type Route = {
  node: UIFlowNode;
  path: string;
  levels: string[];
  sources: { file: string; node: ts.Node }[];
};
const location = (file: ts.SourceFile, node: ts.Node): SourceLocation =>
  sourceLocation(file, node.getStart(file), node.end);
const evidence = (description: string, loc: SourceLocation) => ({
  confidence: 1,
  evidence: [{ description, location: loc }],
});
function imports(file: ts.SourceFile): Bindings {
  const result = new Map<string, string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/^react-router(?:-dom)?$/.test(statement.moduleSpecifier.text) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const item of named.elements)
        if (!item.isTypeOnly)
          result.set(item.name.text, item.propertyName?.text ?? item.name.text);
  }
  return result;
}
function tagName(
  node: ts.JsxTagNameExpression,
  bindings: Bindings,
): string | undefined {
  return ts.isIdentifier(node) ? bindings.get(node.text) : undefined;
}
function walk(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (child) => walk(child, fn));
}
function routeEvidence(file: ts.SourceFile): boolean {
  const bindings = imports(file);
  let found = false;
  walk(file, (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ['Routes', 'Route'].includes(tagName(node.tagName, bindings) ?? '')
    )
      found = true;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['createBrowserRouter', 'createRoutesFromElements'].includes(
        bindings.get(node.expression.text) ?? '',
      )
    )
      found = true;
  });
  return found;
}
export function hasReactRouterEvidence(context: UIFlowContext): boolean {
  for (const path of context.files.keys())
    if (code.test(path)) {
      const file = context.parse(path);
      if (file && routeEvidence(file)) return true;
    }
  return false;
}
function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isJsxExpression(node)) return literal(node.expression);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return literal(node.expression);
  return undefined;
}
function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}
function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const item of object.properties)
    if (
      ts.isPropertyAssignment(item) &&
      (ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)) &&
      item.name.text === name
    )
      return item.initializer;
  return undefined;
}
function attribute(
  attrs: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attrs.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}
function attrValue(
  attr: ts.JsxAttribute | undefined,
): ts.Expression | ts.StringLiteral | undefined {
  if (!attr?.initializer) return undefined;
  return ts.isJsxExpression(attr.initializer)
    ? attr.initializer.expression
    : attr.initializer;
}
function normalizedPath(parent: string, path: string): string | undefined {
  if (
    /[?#]/.test(path) ||
    path.split('/').some((p) => p === '.' || p === '..') ||
    (path.includes('*') && !/(?:^|\/)\*$/.test(path))
  )
    return undefined;
  const joined = path.startsWith('/') ? path : `${parent}/${path}`;
  const result = '/' + joined.split('/').filter(Boolean).join('/');
  if (
    path.startsWith('/') &&
    parent !== '/' &&
    result !== parent &&
    !result.startsWith(parent + '/')
  )
    return undefined;
  return result;
}
function resolveModule(
  context: UIFlowContext,
  from: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const parts = from.split('/');
  parts.pop();
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (part !== '.') parts.push(part);
  }
  const base = parts.join('/');
  const candidates = [
    base,
    ...['.tsx', '.ts', '.jsx', '.js'].map((e) => base + e),
    ...['.tsx', '.ts', '.jsx', '.js'].map((e) => `${base}/index${e}`),
  ];
  return candidates.find((p) => context.files.has(p));
}
function componentRef(
  context: UIFlowContext,
  file: ts.SourceFile,
  expression: ts.Expression | undefined,
): Component | undefined {
  if (!expression) return undefined;
  expression = unwrap(expression);
  if (ts.isJsxElement(expression))
    expression = expression.openingElement.tagName as ts.Expression;
  else if (ts.isJsxSelfClosingElement(expression))
    expression = expression.tagName as ts.Expression;
  if (!ts.isIdentifier(expression)) return undefined;
  const name = expression.text;
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause
    )
      continue;
    const clause = statement.importClause;
    let imported: string | undefined;
    if (clause.name?.text === name) imported = 'default';
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const item of named.elements)
        if (item.name.text === name && !item.isTypeOnly)
          imported = item.propertyName?.text ?? item.name.text;
    if (imported) {
      const path = resolveModule(
        context,
        file.fileName.slice(1),
        statement.moduleSpecifier.text,
      );
      return path ? { file: path, name: imported, imported: true } : undefined;
    }
  }
  return { file: file.fileName.slice(1), name, imported: false };
}
function componentBody(
  context: UIFlowContext,
  ref: Component,
): ts.Node | undefined {
  const file = context.parse(ref.file);
  if (!file) return undefined;
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body &&
      ((ref.name === 'default' &&
        statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
        )) ||
        statement.name?.text === ref.name)
    ) {
      if (
        ref.imported &&
        !statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        )
      )
        continue;
      return statement.body;
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === ref.name &&
          declaration.initializer &&
          (!ref.imported ||
            statement.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ExportKeyword,
            ))
        )
          return declaration.initializer;
      }
    if (ref.name === 'default' && ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression))
        return componentBody(context, {
          file: ref.file,
          name: statement.expression.text,
          imported: false,
        });
      return statement.expression;
    }
  }
  return undefined;
}
function constExpression(
  file: ts.SourceFile,
  name: string,
): ts.Expression | undefined {
  for (const statement of file.statements)
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.flags & ts.NodeFlags.Const
    )
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
          return declaration.initializer;
  return undefined;
}
function match(pattern: string, destination: string): number | undefined {
  const route = pattern.split('/').filter(Boolean),
    parts = destination.split('/').filter(Boolean);
  let score = 0,
    i = 0;
  for (const segment of route) {
    if (segment === '*') {
      score += 1;
      i = parts.length;
      break;
    }
    if (i >= parts.length) return undefined;
    if (segment.startsWith(':')) score += 3;
    else if (segment === parts[i]) score += 10;
    else return undefined;
    i++;
  }
  return i === parts.length ? score : undefined;
}
function relativePath(destination: string, route: Route): string | undefined {
  const path = destination.split(/[?#]/, 1)[0] ?? '';
  if (path.startsWith('/')) return normalizedPath('/', path);
  if (/[:*]/.test(route.path)) return undefined;
  const levels = [...route.levels];
  const parts = path.split('/');
  while (parts[0] === '..') {
    parts.shift();
    levels.pop();
  }
  while (parts[0] === '.') parts.shift();
  return normalizedPath('/', [...levels, ...parts].join('/'));
}

export const reactRouterAdapter: UIFlowFrameworkAdapter = {
  id: 'react-router',
  analyze(context) {
    const routes: Route[] = [],
      diagnostics: AnalysisDiagnostic[] = [],
      events: UINavigationEvent[] = [],
      edges: UIFlowEdge[] = [];
    const seen = new Set<string>();
    const diagnostic = (
      file: ts.SourceFile,
      node: ts.Node,
      codeName: string,
      message: string,
    ) => {
      const loc = location(file, node);
      diagnostics.push({
        id: `rr:${codeName}:${loc.path}:${node.getStart(file)}`,
        code: `rr-${codeName}`,
        severity: 'warning',
        message,
        location: loc,
      });
    };
    for (const path of context.files.keys()) {
      if (!code.test(path)) continue;
      const file = context.parse(path);
      if (!file) continue;
      const bindings = imports(file);
      if (!bindings.size) continue;
      const addRoute = (
        node: ts.Node,
        rawPath: string | undefined,
        index: boolean,
        parent: string,
        levels: string[],
        element: ts.Expression | undefined,
        children: boolean,
        loader?: ts.Expression,
        action?: ts.Expression,
      ) => {
        const path = index ? parent : normalizedPath(parent, rawPath ?? '');
        if (!path || (index && rawPath !== undefined)) {
          diagnostic(
            file,
            node,
            'unsupported-route',
            'The route path is invalid or cannot be resolved statically.',
          );
          return undefined;
        }
        const nextLevels =
          index || rawPath === undefined || rawPath === ''
            ? levels
            : rawPath.startsWith('/')
              ? [path.slice(1)]
              : [...levels, rawPath];
        // Parent routes with children are layouts; the leaf route is the screen.
        if (children || (rawPath === undefined && !index))
          return { path, levels: nextLevels };
        const loc = location(file, node),
          sources: Route['sources'] = [];
        let sourceFile = file.fileName.slice(1);
        if (element) {
          const unwrapped = unwrap(element);
          const opening = ts.isJsxElement(unwrapped)
            ? unwrapped.openingElement
            : ts.isJsxSelfClosingElement(unwrapped)
              ? unwrapped
              : undefined;
          if (opening && tagName(opening.tagName, bindings) === 'Navigate')
            sources.push({ file: sourceFile, node: unwrapped });
          else {
            const ref = componentRef(context, file, element),
              body = ref && componentBody(context, ref);
            if (ref && body) {
              sourceFile = ref.file;
              sources.push({ file: ref.file, node: body });
            } else
              diagnostic(
                file,
                node,
                'component-unresolved',
                'Route component source could not be resolved statically.',
              );
          }
        }
        for (const handler of [loader, action])
          if (handler) {
            const value = unwrap(handler);
            if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
              sources.push({ file: file.fileName.slice(1), node: value });
            else {
              const ref = componentRef(context, file, value),
                body = ref && componentBody(context, ref);
              if (ref && body) sources.push({ file: ref.file, node: body });
              else
                diagnostic(
                  file,
                  node,
                  'handler-unresolved',
                  'Route loader or action could not be resolved statically.',
                );
            }
          }
        const id = `screen:react-router:${loc.path}:${node.getStart(file)}`;
        routes.push({
          path,
          levels: nextLevels,
          sources,
          node: {
            id,
            label: path,
            routePath: path,
            framework: 'react-router',
            sourceFile,
            location: loc,
            metadata: evidence('React Router route declaration', loc),
          },
        });
        return { path, levels: nextLevels };
      };
      const jsxRoutes = (node: ts.Node, parent: string, levels: string[]) => {
        if (ts.isJsxFragment(node)) {
          for (const child of node.children) jsxRoutes(child, parent, levels);
          return;
        }
        if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return;
        const open = ts.isJsxElement(node) ? node.openingElement : node;
        if (tagName(open.tagName, bindings) !== 'Route') {
          diagnostic(
            file,
            node,
            'unsupported-route',
            'Unsupported element in route configuration.',
          );
          return;
        }
        if (open.attributes.properties.some(ts.isJsxSpreadAttribute)) {
          diagnostic(
            file,
            node,
            'unsupported-route',
            'Spread route properties cannot be resolved statically.',
          );
          return;
        }
        const pa = attribute(open.attributes, 'path'),
          ix = attribute(open.attributes, 'index');
        const p = literal(pa?.initializer),
          index =
            !!ix &&
            (!ix.initializer ||
              attrValue(ix)?.kind === ts.SyntaxKind.TrueKeyword);
        if (
          (pa && p === undefined) ||
          (ix && !index && attrValue(ix)?.kind !== ts.SyntaxKind.FalseKeyword)
        ) {
          diagnostic(
            file,
            node,
            'dynamic-route',
            'Dynamic route path or index cannot be resolved statically.',
          );
          return;
        }
        const children = ts.isJsxElement(node)
          ? node.children.filter(
              (c) =>
                ts.isJsxElement(c) ||
                ts.isJsxSelfClosingElement(c) ||
                ts.isJsxFragment(c) ||
                ts.isJsxExpression(c),
            )
          : [];
        const key = `${path}:${node.getStart(file)}`;
        if (seen.has(key)) return;
        seen.add(key);
        const el =
          attrValue(attribute(open.attributes, 'element')) ??
          attrValue(attribute(open.attributes, 'Component'));
        const next = addRoute(
          node,
          p,
          index,
          parent,
          levels,
          el,
          children.length > 0,
          attrValue(attribute(open.attributes, 'loader')),
          attrValue(attribute(open.attributes, 'action')),
        );
        if (next)
          for (const child of children) {
            if (ts.isJsxExpression(child)) {
              if (child.expression)
                diagnostic(
                  file,
                  child,
                  'dynamic-route',
                  'Dynamic route children cannot be resolved statically.',
                );
            } else jsxRoutes(child, next.path, next.levels);
          }
      };
      const objectRoutes = (
        expression: ts.Expression,
        parent: string,
        levels: string[],
        visited = new Set<string>(),
      ) => {
        expression = unwrap(expression);
        if (ts.isIdentifier(expression)) {
          if (visited.has(expression.text)) {
            diagnostic(
              file,
              expression,
              'dynamic-route',
              'Recursive route configuration is unsupported.',
            );
            return;
          }
          visited.add(expression.text);
          const value = constExpression(file, expression.text);
          if (value) objectRoutes(value, parent, levels, visited);
          else
            diagnostic(
              file,
              expression,
              'dynamic-route',
              'Route configuration is not a local constant array.',
            );
          return;
        }
        if (
          ts.isCallExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          bindings.get(expression.expression.text) ===
            'createRoutesFromElements' &&
          expression.arguments[0]
        ) {
          jsxRoutes(unwrap(expression.arguments[0]), parent, levels);
          return;
        }
        if (!ts.isArrayLiteralExpression(expression)) {
          diagnostic(
            file,
            expression,
            'dynamic-route',
            'Route configuration is not a static array.',
          );
          return;
        }
        for (const entry of expression.elements) {
          if (
            !ts.isObjectLiteralExpression(entry) ||
            entry.properties.some(ts.isSpreadAssignment)
          ) {
            diagnostic(
              file,
              entry,
              'dynamic-route',
              'Dynamic or spread route configuration is unsupported.',
            );
            continue;
          }
          const pe = property(entry, 'path'),
            ie = property(entry, 'index'),
            p = literal(pe),
            index = ie?.kind === ts.SyntaxKind.TrueKeyword;
          if (
            (pe && p === undefined) ||
            (ie && !index && ie.kind !== ts.SyntaxKind.FalseKeyword)
          ) {
            diagnostic(
              file,
              entry,
              'dynamic-route',
              'Dynamic route path or index cannot be resolved statically.',
            );
            continue;
          }
          const children = property(entry, 'children');
          const key = `${path}:${entry.getStart(file)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const next = addRoute(
            entry,
            p,
            index,
            parent,
            levels,
            property(entry, 'element') ?? property(entry, 'Component'),
            !!children,
            property(entry, 'loader'),
            property(entry, 'action'),
          );
          if (next && children)
            objectRoutes(children, next.path, next.levels, new Set(visited));
        }
      };
      const visit = (node: ts.Node) => {
        if (
          ts.isJsxElement(node) &&
          tagName(node.openingElement.tagName, bindings) === 'Routes'
        ) {
          for (const child of node.children) jsxRoutes(child, '/', []);
          return;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const api = bindings.get(node.expression.text),
            arg = node.arguments[0];
          if (api === 'createRoutesFromElements' && arg) {
            jsxRoutes(unwrap(arg), '/', []);
            return;
          }
          if (
            api === 'createBrowserRouter' &&
            arg &&
            !(
              ts.isCallExpression(arg) &&
              ts.isIdentifier(arg.expression) &&
              bindings.get(arg.expression.text) === 'createRoutesFromElements'
            )
          ) {
            objectRoutes(arg, '/', []);
            return;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      const parseDiagnostics =
        (
          file as ts.SourceFile & {
            parseDiagnostics?: readonly ts.Diagnostic[];
          }
        ).parseDiagnostics ?? [];
      for (const issue of parseDiagnostics) {
        const start = issue.start ?? 0;
        const loc = sourceLocation(file, start, start + (issue.length ?? 0));
        diagnostics.push({
          id: `rr:syntax:${path}:${start}`,
          code: 'rr-syntax',
          severity: 'warning',
          message: ts.flattenDiagnosticMessageText(issue.messageText, ' '),
          location: loc,
        });
      }
    }
    routes.sort((a, b) => compare(a.node.id, b.node.id));
    const shapes = new Map<string, Route[]>();
    for (const route of routes) {
      const shape = route.path
        .split('/')
        .map((p) => (p.startsWith(':') ? ':' : p))
        .join('/');
      const list = shapes.get(shape) ?? [];
      list.push(route);
      shapes.set(shape, list);
    }
    for (const group of shapes.values())
      if (group.length > 1)
        for (const route of group) {
          diagnostics.push({
            id: `rr:collision:${route.node.id}`,
            code: 'rr-collision',
            severity: 'warning',
            message: `Ambiguous React Router route pattern ${route.path}.`,
            location: route.node.location!,
          });
        }
    // Follow statically named JSX components from each screen. Shared bodies are
    // grouped below so their navigation cannot be attributed to multiple screens.
    for (const route of routes) {
      const known = new Set(
        route.sources.map((s) => `${s.file}:${s.node.pos}:${s.node.end}`),
      );
      for (let index = 0; index < route.sources.length; index++) {
        const source = route.sources[index]!;
        const sourceFile = context.parse(source.file)!;
        const sourceBindings = imports(sourceFile);
        walk(source.node, (node) => {
          if (
            !ts.isJsxOpeningElement(node) &&
            !ts.isJsxSelfClosingElement(node)
          )
            return;
          if (
            !ts.isIdentifier(node.tagName) ||
            sourceBindings.has(node.tagName.text)
          )
            return;
          const ref = componentRef(context, sourceFile, node.tagName);
          const body = ref && componentBody(context, ref);
          if (!ref || !body) return;
          const key = `${ref.file}:${body.pos}:${body.end}`;
          if (!known.has(key)) {
            known.add(key);
            route.sources.push({ file: ref.file, node: body });
          }
        });
      }
    }
    const routeBuckets = new Map<string, Route[]>();
    for (const route of routes) {
      const first = route.path.split('/').filter(Boolean)[0] ?? '';
      const key = first.startsWith(':') || first === '*' ? '*' : first;
      const bucket = routeBuckets.get(key) ?? [];
      bucket.push(route);
      routeBuckets.set(key, bucket);
    }
    const owners = new Map<string, Route[]>();
    for (const route of routes)
      for (const source of route.sources) {
        const key = `${source.file}:${source.node.pos}:${source.node.end}`;
        const group = owners.get(key) ?? [];
        if (!group.includes(route)) group.push(route);
        owners.set(key, group);
      }
    for (const [key, group] of owners) {
      const source = group[0]!.sources.find(
        (s) => `${s.file}:${s.node.pos}:${s.node.end}` === key,
      )!;
      const file = context.parse(source.file)!;
      const bindings = imports(file);
      const declarations = new Map<string, number>();
      walk(source.node, (node) => {
        if (
          (ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isFunctionDeclaration(node)) &&
          node.name &&
          ts.isIdentifier(node.name)
        ) {
          declarations.set(
            node.name.text,
            (declarations.get(node.name.text) ?? 0) + 1,
          );
        }
      });
      for (const name of bindings.keys())
        if (declarations.has(name)) bindings.delete(name);
      const navigators = new Set<string>();
      walk(source.node, (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          bindings.get(node.initializer.expression.text) === 'useNavigate' &&
          declarations.get(node.name.text) === 1
        )
          navigators.add(node.name.text);
      });
      const emit = (
        node: ts.Node,
        kind: UINavigationKind,
        dest: string | undefined,
        history = false,
        relativeSupported = true,
      ) => {
        const loc = location(file, node);
        const owner = group.length === 1 ? group[0] : undefined;
        let resolution: UINavigationEvent['resolution'] = history
          ? 'unresolved'
          : dest === undefined
            ? 'dynamic'
            : /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(dest)
              ? 'external'
              : 'unresolved';
        let target: Route | undefined;
        if (
          dest !== undefined &&
          resolution === 'unresolved' &&
          owner &&
          !history &&
          (relativeSupported || dest.startsWith('/'))
        ) {
          const absolute = relativePath(dest, owner);
          if (absolute !== undefined) {
            let best = -1;
            const matches: Route[] = [];
            const first = absolute.split('/').filter(Boolean)[0] ?? '';
            for (const candidate of [
              ...(routeBuckets.get(first) ?? []),
              ...(routeBuckets.get('*') ?? []),
            ]) {
              const score = match(candidate.path, absolute);
              if (score === undefined) continue;
              if (score > best) {
                best = score;
                matches.length = 0;
              }
              if (score === best) matches.push(candidate);
            }
            if (matches.length === 1) {
              target = matches[0];
              resolution = 'internal';
            }
          }
        }
        const id = `event:react-router:${loc.path}:${node.getStart(file)}:${kind}`;
        const metadata = evidence(
          'Statically detected React Router navigation',
          loc,
        );
        const event: UINavigationEvent = {
          id,
          kind,
          resolution,
          location: loc,
          metadata,
          ...(owner ? { sourceId: owner.node.id } : {}),
          ...(target ? { targetId: target.node.id } : {}),
          ...(dest !== undefined ? { destination: dest } : {}),
        };
        events.push(event);
        if (owner && target)
          edges.push({
            id: `edge:${id}:${target.node.id}`,
            sourceId: owner.node.id,
            targetId: target.node.id,
            kind,
            ...(dest !== undefined ? { destination: dest } : {}),
            location: loc,
            metadata,
          });
        if (!owner)
          diagnostic(
            file,
            node,
            'ambiguous-source',
            'Navigation occurs in a component or handler shared by multiple routes.',
          );
        else if (resolution === 'dynamic' || resolution === 'unresolved')
          diagnostic(
            file,
            node,
            history ? 'history-navigation' : 'unresolved-navigation',
            history
              ? 'History navigation has no statically known destination.'
              : 'Navigation destination could not be uniquely resolved.',
          );
      };
      walk(source.node, (node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const api = tagName(node.tagName, bindings);
          if (api === 'Link' || api === 'NavLink' || api === 'Navigate')
            emit(
              node,
              api === 'Navigate' ? 'redirect' : 'link',
              node.attributes.properties.some(ts.isJsxSpreadAttribute)
                ? undefined
                : literal(attribute(node.attributes, 'to')?.initializer),
              false,
              !attribute(node.attributes, 'relative') ||
                literal(attribute(node.attributes, 'relative')?.initializer) ===
                  'route',
            );
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const name = node.expression.text,
            api = bindings.get(name),
            arg = node.arguments[0];
          if (navigators.has(name)) {
            const history =
              !!arg &&
              (ts.isNumericLiteral(arg) ||
                (ts.isPrefixUnaryExpression(arg) &&
                  ts.isNumericLiteral(arg.operand)));
            const options = node.arguments[1],
              replace =
                options &&
                ts.isObjectLiteralExpression(options) &&
                property(options, 'replace')?.kind ===
                  ts.SyntaxKind.TrueKeyword;
            emit(
              node,
              history ? 'history' : replace ? 'replace' : 'push',
              history ? undefined : literal(arg),
              history,
              !options ||
                (ts.isObjectLiteralExpression(options) &&
                  !options.properties.some(ts.isSpreadAssignment) &&
                  (!property(options, 'relative') ||
                    literal(property(options, 'relative')) === 'route')),
            );
          } else if (
            api === 'redirect' ||
            api === 'redirectDocument' ||
            api === 'replace'
          )
            emit(
              node,
              api === 'replace' ? 'replace' : 'redirect',
              literal(arg),
              false,
              false,
            );
        }
      });
    }
    events.sort((a, b) => compare(a.id, b.id));
    edges.sort((a, b) => compare(a.id, b.id));
    diagnostics.sort((a, b) => compare(a.id, b.id));
    return {
      framework: 'react-router',
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
