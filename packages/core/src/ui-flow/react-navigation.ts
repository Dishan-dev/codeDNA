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
import {
  resolveLocal,
  renderedImports,
  exportedBody,
} from './next-app-router.js';
import type {
  UIFlowAnalysis,
  UIFlowContext,
  UIFlowFrameworkAdapter,
} from './index.js';

const code = /\.(?:tsx?|jsx?)$/;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const loc = (file: ts.SourceFile, node: ts.Node) =>
  sourceLocation(file, node.getStart(file), node.end);
const info = (
  description: string,
  location: SourceLocation,
  confidence = 1,
) => ({ confidence, evidence: [{ description, location }] });
function walk(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  ts.forEachChild(node, (child) => walk(child, fn));
}
const factories: Record<string, string> = {
  '@react-navigation/native-stack': 'createNativeStackNavigator',
  '@react-navigation/stack': 'createStackNavigator',
  '@react-navigation/bottom-tabs': 'createBottomTabNavigator',
  '@react-navigation/drawer': 'createDrawerNavigator',
};
interface Navigator {
  id: string;
  name: string;
  kind: string;
  file: string;
  decl: ts.VariableDeclaration;
  parents: Set<string>;
  registrations: Registration[];
}
interface Component {
  file: string;
  name: string;
  body?: ts.Node;
  navigator?: Navigator;
}
interface Registration {
  id: string;
  name: string;
  navigator: Navigator;
  node: UIFlowNode;
  component?: Component;
  child?: Navigator;
  declaration: ts.Node;
}
interface Action {
  kind: UINavigationKind;
  destination?: string;
  nested?: string[];
  location: SourceLocation;
  dynamic: boolean;
}
function factoryImports(file: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const s of file.statements) {
    if (
      !ts.isImportDeclaration(s) ||
      !ts.isStringLiteral(s.moduleSpecifier) ||
      !s.importClause ||
      s.importClause.isTypeOnly
    )
      continue;
    const expected = factories[s.moduleSpecifier.text],
      named = s.importClause.namedBindings;
    if (!expected || !named || !ts.isNamedImports(named)) continue;
    for (const item of named.elements)
      if (
        !item.isTypeOnly &&
        (item.propertyName?.text ?? item.name.text) === expected
      )
        imports.set(item.name.text, expected);
  }
  return imports;
}
function declarations(
  file: ts.SourceFile,
): { name: string; kind: string; node: ts.VariableDeclaration }[] {
  const imports = factoryImports(file),
    result: { name: string; kind: string; node: ts.VariableDeclaration }[] = [];
  for (const statement of file.statements)
    if (ts.isVariableStatement(statement))
      for (const decl of statement.declarationList.declarations)
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression)
        ) {
          const kind = imports.get(decl.initializer.expression.text);
          if (kind) result.push({ name: decl.name.text, kind, node: decl });
        }
  return result;
}
export function hasReactNavigationEvidence(context: UIFlowContext): boolean {
  for (const path of context.files.keys())
    if (code.test(path)) {
      const file = context.parse(path);
      if (file && declarations(file).length) return true;
    }
  return false;
}
function literal(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (
    ts.isJsxExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return literal(node.expression);
  return undefined;
}
function prop(
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
function jsxAttr(
  attrs: ts.JsxAttributes,
  name: string,
): ts.JsxAttribute | undefined {
  return attrs.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}
function expression(
  attr: ts.JsxAttribute | undefined,
): ts.Expression | undefined {
  const init = attr?.initializer;
  if (!init) return undefined;
  return ts.isJsxExpression(init) ? init.expression : init;
}
function localBody(file: ts.SourceFile, name: string): ts.Node | undefined {
  if (name === 'default') return exportedBody(file, name);
  for (const s of file.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name && s.body)
      return s;
    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        if (
          ts.isIdentifier(d.name) &&
          d.name.text === name &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) ||
            ts.isFunctionExpression(d.initializer))
        )
          return d.initializer;
  }
  return undefined;
}
function importRef(
  context: UIFlowContext,
  file: ts.SourceFile,
  name: string,
): { file: string; name: string } | undefined {
  for (const s of file.statements) {
    if (
      !ts.isImportDeclaration(s) ||
      !ts.isStringLiteral(s.moduleSpecifier) ||
      !s.importClause ||
      s.importClause.isTypeOnly
    )
      continue;
    let exported: string | undefined;
    if (s.importClause.name?.text === name) exported = 'default';
    const bindings = s.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const item of bindings.elements)
        if (!item.isTypeOnly && item.name.text === name)
          exported = item.propertyName?.text ?? item.name.text;
    if (exported) {
      const target = resolveLocal(
        file.fileName.slice(1),
        s.moduleSpecifier.text,
        context.files,
      );
      return target ? { file: target, name: exported } : undefined;
    }
  }
  return undefined;
}
function resolveComponent(
  context: UIFlowContext,
  path: string,
  name: string,
  navigators: Map<string, Navigator>,
  requireExport = false,
  seen = new Set<string>(),
): Component | undefined {
  const key = `${path}#${name}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const file = context.parse(path);
  if (!file) return undefined;
  const nav = navigators.get(key);
  if (nav) {
    if (
      requireExport &&
      (!ts.isVariableStatement(nav.decl.parent.parent) ||
        !nav.decl.parent.parent.modifiers?.some(
          (m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword,
        ))
    )
      return undefined;
    return { file: path, name, navigator: nav };
  }
  if (!requireExport) {
    const imported = importRef(context, file, name);
    if (imported)
      return resolveComponent(
        context,
        imported.file,
        imported.name,
        navigators,
        true,
        seen,
      );
  }
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly || element.name.text !== name) continue;
        const original = element.propertyName?.text ?? element.name.text;
        if (
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          const target = resolveLocal(
            path,
            statement.moduleSpecifier.text,
            context.files,
          );
          if (target)
            return resolveComponent(
              context,
              target,
              original,
              navigators,
              true,
              seen,
            );
        } else
          return resolveComponent(
            context,
            path,
            original,
            navigators,
            false,
            seen,
          );
      }
    if (
      name === 'default' &&
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    )
      return resolveComponent(
        context,
        path,
        statement.expression.text,
        navigators,
        false,
        seen,
      );
  }
  const body = requireExport ? exportedBody(file, name) : localBody(file, name);
  return body ? { file: path, name, body } : undefined;
}
function hookNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@react-navigation/native' &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      const named = statement.importClause.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const item of named.elements)
          if (
            !item.isTypeOnly &&
            (item.propertyName?.text ?? item.name.text) === 'useNavigation'
          )
            names.add(item.name.text);
    }
  return names;
}
function actions(
  file: ts.SourceFile,
  root: ts.Node,
  screenProps: boolean,
): Action[] {
  const hooks = hookNames(file),
    navs = new Set<string>(),
    counts = new Map<string, number>();
  const count = (name: ts.BindingName) => {
    if (ts.isIdentifier(name))
      counts.set(name.text, (counts.get(name.text) ?? 0) + 1);
    else
      for (const item of name.elements)
        if (ts.isBindingElement(item)) count(item.name);
  };
  walk(root, (node) => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node))
      count(node.name);
    else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    )
      count(node.name);
  });
  for (const name of hooks) if (counts.has(name)) hooks.delete(name);
  if (
    screenProps &&
    (ts.isFunctionDeclaration(root) ||
      ts.isArrowFunction(root) ||
      ts.isFunctionExpression(root))
  ) {
    const p = root.parameters[0];
    if (p && ts.isObjectBindingPattern(p.name))
      for (const item of p.name.elements)
        if (
          ts.isIdentifier(item.name) &&
          (item.propertyName?.getText(file) ?? item.name.text) ===
            'navigation' &&
          counts.get(item.name.text) === 1
        )
          navs.add(item.name.text);
  }
  walk(root, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      counts.get(node.name.text) === 1 &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      hooks.has(node.initializer.expression.text)
    )
      navs.add(node.name.text);
  });
  const result: Action[] = [];
  walk(root, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      !navs.has(node.expression.expression.text)
    )
      return;
    const method = node.expression.name.text;
    if (!['navigate', 'push', 'replace', 'goBack', 'reset'].includes(method))
      return;
    const kind: UINavigationKind =
      method === 'goBack'
        ? 'back'
        : method === 'reset'
          ? 'history'
          : (method as UINavigationKind);
    const destination = literal(node.arguments[0]);
    let dynamic =
        method === 'reset' ||
        (method !== 'goBack' && destination === undefined),
      nested: string[] | undefined;
    const options = node.arguments[1];
    if (options && method !== 'goBack' && method !== 'reset') {
      if (ts.isObjectLiteralExpression(options)) {
        if (options.properties.some(ts.isSpreadAssignment)) dynamic = true;
        const child = prop(options, 'screen');
        if (child) {
          const target = literal(child);
          if (target !== undefined) nested = [target];
          else dynamic = true;
        }
        if (
          child &&
          prop(options, 'initial') &&
          prop(options, 'initial')?.kind !== ts.SyntaxKind.TrueKeyword
        )
          dynamic = true;
        if (child && prop(options, 'params')) {
          const params = prop(options, 'params');
          if (
            params &&
            ts.isObjectLiteralExpression(params) &&
            prop(params, 'screen')
          )
            dynamic = true;
        }
      } else dynamic = true;
    }
    result.push({
      kind,
      location: loc(file, node),
      dynamic,
      ...(destination !== undefined ? { destination } : {}),
      ...(nested ? { nested } : {}),
    });
  });
  return result;
}
export const reactNavigationAdapter: UIFlowFrameworkAdapter = {
  id: 'react-navigation',
  analyze(context): UIFlowAnalysis {
    const diagnostics: AnalysisDiagnostic[] = [],
      edges: UIFlowEdge[] = [],
      events: UINavigationEvent[] = [];
    const report = (
      codeName: string,
      message: string,
      location?: SourceLocation,
    ) =>
      diagnostics.push({
        id: `react-navigation:${codeName}:${encodeURIComponent(location ? `${location.path}:${location.start.line}:${location.start.column}` : message)}`,
        code: `react-navigation-${codeName}`,
        severity: 'warning',
        message,
        ...(location ? { location } : {}),
      });
    const files = [...context.files.keys()].filter((p) => code.test(p)),
      navigators = new Map<string, Navigator>(),
      parsed = new Set<string>();
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
    for (const path of files) {
      const file = parse(path)!;
      for (const item of declarations(file)) {
        const id = `navigator:${path}#${item.name}`;
        navigators.set(`${path}#${item.name}`, {
          id,
          name: item.name,
          kind: item.kind,
          file: path,
          decl: item.node,
          parents: new Set(),
          registrations: [],
        });
      }
    }
    const register = (
      nav: Navigator,
      file: ts.SourceFile,
      node: ts.Node,
      name: string | undefined,
      component: ts.Expression | undefined,
      group?: string,
    ) => {
      if (!name || !component || !ts.isIdentifier(component)) {
        report(
          'registration-dynamic',
          'Screen name and component must be statically identifiable.',
          loc(file, node),
        );
        return;
      }
      const resolved = resolveComponent(
        context,
        file.fileName.slice(1),
        component.text,
        navigators,
      );
      if (!resolved)
        report(
          'component-unresolved',
          `Cannot statically resolve screen component ${component.text}.`,
          loc(file, node),
        );
      const id = `screen:react-navigation:${encodeURIComponent(nav.id)}:${encodeURIComponent(name)}:${node.getStart(file)}`;
      const location = loc(file, node),
        screen: UIFlowNode = {
          id,
          label: name,
          framework: 'react-navigation',
          ...(resolved ? { sourceFile: resolved.file } : {}),
          navigator: {
            id: nav.id,
            name: nav.name,
            kind: nav.kind,
            ...(group ? { group } : {}),
          },
          location,
          metadata: info('React Navigation screen registration', location),
        };
      nav.registrations.push({
        id,
        name,
        navigator: nav,
        node: screen,
        declaration: node,
        ...(resolved ? { component: resolved } : {}),
      });
    };
    for (const nav of navigators.values()) {
      const file = parse(nav.file)!,
        call = nav.decl.initializer as ts.CallExpression,
        arg = call.arguments[0];
      const readScreens = (
        object: ts.Expression | undefined,
        group?: string,
      ) => {
        if (!object) return;
        if (!ts.isObjectLiteralExpression(object)) {
          report(
            'registration-dynamic',
            'Static screen configuration must be an object literal.',
            loc(file, object),
          );
          return;
        }
        for (const item of object.properties) {
          if (
            !ts.isPropertyAssignment(item) &&
            !ts.isShorthandPropertyAssignment(item)
          ) {
            report(
              'registration-dynamic',
              'Spread or computed screen configuration is unsupported.',
              loc(file, item),
            );
            continue;
          }
          const name =
            ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)
              ? item.name.text
              : undefined;
          let value: ts.Expression = ts.isShorthandPropertyAssignment(item)
            ? item.name
            : item.initializer;
          if (ts.isObjectLiteralExpression(value))
            value = prop(value, 'screen') ?? value;
          register(nav, file, item, name, value, group);
        }
      };
      if (arg) {
        if (ts.isObjectLiteralExpression(arg)) {
          readScreens(prop(arg, 'screens'));
          const groups = prop(arg, 'groups');
          if (groups && ts.isObjectLiteralExpression(groups))
            for (const group of groups.properties) {
              if (
                ts.isPropertyAssignment(group) &&
                (ts.isIdentifier(group.name) ||
                  ts.isStringLiteral(group.name)) &&
                ts.isObjectLiteralExpression(group.initializer)
              )
                readScreens(
                  prop(group.initializer, 'screens'),
                  group.name.text,
                );
              else
                report(
                  'registration-dynamic',
                  'Dynamic navigator groups are unsupported.',
                  loc(file, group),
                );
            }
          else if (groups)
            report(
              'registration-dynamic',
              'Dynamic navigator groups are unsupported.',
              loc(file, groups),
            );
        } else
          report(
            'registration-dynamic',
            'Navigator configuration must be a static object.',
            loc(file, arg),
          );
      }
      const visit = (node: ts.Node, inside: boolean, group?: string) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
          const opening = ts.isJsxElement(node) ? node.openingElement : node;
          const tag = opening.tagName;
          const belongs =
            ts.isPropertyAccessExpression(tag) &&
            ts.isIdentifier(tag.expression) &&
            tag.expression.text === nav.name;
          const part = belongs ? tag.name.text : undefined;
          const active = inside || part === 'Navigator';
          if (part === 'Screen' && inside) {
            if (opening.attributes.properties.some(ts.isJsxSpreadAttribute))
              report(
                'registration-dynamic',
                'Spread screen registration is unsupported.',
                loc(file, opening),
              );
            else
              register(
                nav,
                file,
                opening,
                literal(jsxAttr(opening.attributes, 'name')?.initializer),
                expression(jsxAttr(opening.attributes, 'component')),
                group,
              );
          }
          if (ts.isJsxElement(node))
            for (const child of node.children)
              visit(
                child,
                active,
                part === 'Group'
                  ? (literal(
                      jsxAttr(opening.attributes, 'navigationKey')?.initializer,
                    ) ?? group)
                  : group,
              );
          return;
        }
        if (inside && ts.isJsxExpression(node) && node.expression)
          report(
            'registration-dynamic',
            'Dynamic navigator children cannot be resolved.',
            loc(file, node),
          );
        if (!inside)
          ts.forEachChild(node, (child) => visit(child, false, group));
      };
      visit(file, false);
    }
    for (const nav of navigators.values())
      for (const registration of nav.registrations) {
        let child = registration.component?.navigator;
        if (!child && registration.component?.body) {
          const component = registration.component,
            file = parse(component.file)!;
          const candidates = new Set<Navigator>();
          walk(component.body!, (node) => {
            if (
              (ts.isJsxOpeningElement(node) ||
                ts.isJsxSelfClosingElement(node)) &&
              ts.isPropertyAccessExpression(node.tagName) &&
              node.tagName.name.text === 'Navigator' &&
              ts.isIdentifier(node.tagName.expression)
            ) {
              const candidate = navigators.get(
                `${component.file}#${node.tagName.expression.text}`,
              );
              if (candidate) candidates.add(candidate);
            }
          });
          if (candidates.size === 1) child = [...candidates][0];
          else if (candidates.size > 1)
            report(
              'nested-ambiguous',
              'Component contains multiple navigators; hierarchy is ambiguous.',
              loc(file, component.body!),
            );
        }
        if (child && child !== nav) {
          registration.child = child;
          child.parents.add(nav.id);
        }
      }
    for (const nav of navigators.values())
      for (const registration of nav.registrations)
        if (nav.parents.size)
          registration.node.navigator!.parentIds = [...nav.parents].sort(cmp);
    const byNavId = new Map([...navigators.values()].map((n) => [n.id, n]));
    const allRegs = [...navigators.values()]
      .flatMap((n) => n.registrations)
      .sort((a, b) => cmp(a.id, b.id));
    const registrationsByName = new Map<string, Map<string, Registration[]>>();
    for (const nav of navigators.values()) {
      const names = new Map<string, Registration[]>();
      registrationsByName.set(nav.id, names);
      for (const r of nav.registrations) {
        const list = names.get(r.name) ?? [];
        list.push(r);
        names.set(r.name, list);
      }
      for (const group of names.values())
        if (group.length > 1)
          for (const r of group)
            report(
              'screen-collision',
              `Screen ${r.name} is registered multiple times in ${nav.name}.`,
              r.node.location,
            );
    }
    const lookup = (nav: Navigator, name: string): Registration | undefined => {
      const visited = new Set<string>();
      let current: Navigator | undefined = nav;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const matches = registrationsByName.get(current.id)?.get(name) ?? [];
        if (matches.length)
          return matches.length === 1 ? matches[0] : undefined;
        if (current.parents.size !== 1) return undefined;
        current = byNavId.get([...current.parents][0]!);
      }
      return undefined;
    };
    const bodies = new Map<
      string,
      {
        file: string;
        node: ts.Node;
        owners: Set<Registration>;
        screenProps: boolean;
      }
    >();
    for (const r of allRegs)
      if (r.component?.body && !r.child) {
        const c = r.component,
          body = c.body!,
          key = `${c.file}:${body.pos}:${body.end}`;
        const entry = bodies.get(key) ?? {
          file: c.file,
          node: body,
          owners: new Set<Registration>(),
          screenProps: true,
        };
        entry.owners.add(r);
        bodies.set(key, entry);
      }
    // Include directly rendered imported components, but only attribute when ownership is unique.
    for (const entry of [...bodies.values()]) {
      const file = parse(entry.file)!;
      for (const item of renderedImports(file, entry.node, context)) {
        const body = resolveComponent(
          context,
          item.path,
          item.exported,
          navigators,
          true,
        )?.body;
        if (!body) continue;
        const key = `${item.path}:${body.pos}:${body.end}`,
          existing = bodies.get(key) ?? {
            file: item.path,
            node: body,
            owners: new Set<Registration>(),
            screenProps: false,
          };
        for (const owner of entry.owners) existing.owners.add(owner);
        bodies.set(key, existing);
      }
    }
    for (const entry of bodies.values()) {
      const file = parse(entry.file)!;
      for (const action of actions(file, entry.node, entry.screenProps)) {
        const owner =
          entry.owners.size === 1 ? [...entry.owners][0] : undefined;
        let resolution: UINavigationEvent['resolution'] = action.dynamic
            ? 'dynamic'
            : 'unresolved',
          target: Registration | undefined;
        if (
          owner &&
          action.destination &&
          !action.dynamic &&
          action.kind !== 'back' &&
          action.kind !== 'history'
        ) {
          target = lookup(owner.navigator, action.destination);
          if (action.nested) {
            const child = target?.child;
            const matches = child
              ? (registrationsByName.get(child.id)?.get(action.nested[0]!) ??
                [])
              : [];
            target =
              matches.length === 1 && !matches[0]!.child
                ? matches[0]
                : undefined;
          } else if (target?.child) target = undefined;
          if (target) resolution = 'internal';
        }
        if (!owner)
          report(
            'source-ambiguous',
            'Navigation component is registered or rendered by multiple screens.',
            action.location,
          );
        else if (resolution !== 'internal')
          report(
            action.kind === 'back' || action.kind === 'history'
              ? 'history-unresolved'
              : 'destination-unresolved',
            action.kind === 'back' || action.kind === 'history'
              ? 'History or reset navigation is not resolved statically.'
              : 'Navigation destination is dynamic, ambiguous, or outside known navigator scope.',
            action.location,
          );
        const id = `navigation:react-navigation:${encodeURIComponent(action.location.path)}:${action.location.start.line}:${action.location.start.column}:${action.kind}`;
        const metadata = info(
          owner
            ? `React Navigation action attributed to ${owner.name} in ${owner.navigator.name}`
            : 'React Navigation action in a shared component',
          action.location,
          owner ? (entry.screenProps ? 1 : 0.8) : 0.5,
        );
        events.push({
          id,
          kind: action.kind,
          resolution,
          location: action.location,
          metadata,
          ...(owner ? { sourceId: owner.id } : {}),
          ...(target ? { targetId: target.id } : {}),
          ...(action.destination !== undefined
            ? { destination: action.destination }
            : {}),
          ...(action.destination && action.nested
            ? { navigationPath: [action.destination, ...action.nested] }
            : {}),
        });
        if (owner && target)
          edges.push({
            id: `edge:${id}`,
            sourceId: owner.id,
            targetId: target.id,
            kind: action.kind,
            location: action.location,
            metadata,
            ...(action.destination !== undefined
              ? { destination: action.destination }
              : {}),
            ...(action.destination && action.nested
              ? { navigationPath: [action.destination, ...action.nested] }
              : {}),
          });
      }
    }
    events.sort((a, b) => cmp(a.id, b.id));
    edges.sort((a, b) => cmp(a.id, b.id));
    diagnostics.sort((a, b) => cmp(a.id, b.id));
    return {
      framework: 'react-navigation',
      graph: {
        schemaVersion: context.snapshot.schemaVersion,
        nodes: allRegs.map((r) => r.node),
        edges,
        navigationEvents: events,
      },
      diagnostics,
    };
  },
};
