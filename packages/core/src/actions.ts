import ts from 'typescript';
import type {
  ActionGap,
  ActionIndex,
  AnalysisResult,
  Effect,
  EffectKind,
  PageEntry,
  RepositorySnapshot,
  StoredTrace,
  StructuralTier,
  TierCounts,
  TraceStepData,
  TriggerKind,
  UIFlowGraph,
  UserAction,
} from '@codedna/shared';
import { validateSnapshot } from './validation.js';
import { parseSource, sourceLocation } from './source.js';

/**
 * Page → action → trace analysis. Bounded, syntactic and deterministic.
 *
 * Call resolution follows identifier bindings: declarations in scope, and named, default or
 * namespace imports whose module the TypeScript compiler resolved (see analyzeSnapshot). It does
 * not use the type checker, so "resolved" means "bound by name through resolved modules".
 */
export interface ActionAnalysisOptions {
  complete?: boolean;
  maxActions?: number;
  maxSteps?: number;
  maxDepth?: number;
  maxComponents?: number;
  timeBudgetMs?: number;
  now?: () => number;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TIER_RANK: Record<StructuralTier, number> = { resolved: 0, conventional: 1, heuristic: 2, gap: 3 };
export function weakestTier(tiers: Iterable<StructuralTier>): StructuralTier {
  let worst: StructuralTier = 'resolved';
  for (const tier of tiers) if (TIER_RANK[tier] > TIER_RANK[worst]) worst = tier;
  return worst;
}
export const emptyTierCounts = (): TierCounts => ({ resolved: 0, conventional: 0, heuristic: 0, gap: 0 });
const short = (text: string, max = 120) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
export function humanize(name: string): string {
  const stripped = name.replace(/^(?:handle|on)(?=[A-Z])/, '');
  const words = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}
const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
};
/** Literal text, or a template with `${…}` placeholders; undefined when computed. */
function literalText(node: ts.Expression | undefined): { text: string; templated: boolean } | undefined {
  if (!node) return undefined;
  const value = unwrap(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { text: value.text, templated: false };
  if (ts.isTemplateExpression(value)) return { text: value.head.text + value.templateSpans.map((span) => `\${…}${span.literal.text}`).join(''), templated: true };
  return undefined;
}
function collectNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : collectNames(element.name)));
}

interface Fn {
  id: string;
  name: string;
  file: string;
  node: ts.FunctionLikeDeclaration;
  line: number;
  serverAction: boolean;
}
interface Imp {
  kind: 'named' | 'default' | 'namespace';
  name: string;
  module: string;
  target?: string;
  pkg?: string;
}
interface FileInfo {
  path: string;
  source: ts.SourceFile;
  fns: Map<string, Fn>;
  values: Map<string, ts.Expression>;
  imports: Map<string, Imp>;
  exportsByName: Map<string, string>;
  reexports: Map<string, { module: string; name: string }>;
  stars: string[];
}
type Binding =
  | { kind: 'fn'; fn: Fn }
  | { kind: 'value'; info: FileInfo; name: string; value: ts.Expression }
  | { kind: 'external'; pkg: string; name: string }
  | { kind: 'namespace'; target: string }
  | { kind: 'missing'; module: string }
  | { kind: 'unknown-export'; file: string }
  | { kind: 'local'; decl: ts.VariableDeclaration | ts.FunctionDeclaration }
  | { kind: 'param' }
  | { kind: 'global' };
interface Route {
  method: string;
  route: string;
  segments: string[];
  fn: Fn;
}
interface Ctx {
  info: FileInfo;
  owner: string;
  depth: number;
  parentId: string | undefined;
  when: { branchId: string; option: 'then' | 'else' }[];
}
interface Walk {
  steps: TraceStepData[];
  visited: Set<ts.Node>;
  truncated: boolean;
  ids: Set<string>;
  chips: Map<string, { label: string; writes: boolean }>;
}

const PRISMA_WRITE = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);
const PRISMA_READ = new Set(['findMany', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy']);
const VALIDATE = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync']);
const LINK_PACKAGES = new Set(['next/link', 'react-router-dom', 'react-router', 'expo-router']);
const EVENT_VERB: Record<string, string> = { onClick: 'Clicking', onSubmit: 'Submitting', onChange: 'Changing', onInput: 'Typing into', onKeyDown: 'Pressing a key in', onKeyUp: 'Releasing a key in', onBlur: 'Leaving', onFocus: 'Focusing', onDoubleClick: 'Double-clicking', onSelect: 'Selecting' };
const USER_VERB: Record<string, string> = { onClick: 'clicks', onSubmit: 'submits', onChange: 'changes', onInput: 'types into', onKeyDown: 'presses a key in', onKeyUp: 'releases a key in', onBlur: 'leaves', onFocus: 'focuses', onDoubleClick: 'double-clicks', onSelect: 'selects' };
const routeSegments =(path: string) => path.split('/').filter(Boolean);
function routeFor(path: string): string | undefined {
  const match = /^(?:src\/)?app\/(?:(.+)\/)?route\.(?:ts|tsx|js|jsx)$/.exec(path);
  if (!match) return undefined;
  const parts = (match[1] ?? '').split('/').filter((part) => part && !/^\(.+\)$/.test(part) && !part.startsWith('@'));
  return `/${parts.join('/')}`;
}
function matchRoute(route: string[], url: string[]): number {
  let score = 0;
  for (let index = 0; index < route.length; index++) {
    const segment = route[index]!;
    if (/^\[\[?\.\.\./.test(segment)) return url.length >= index ? score : -1;
    const part = url[index];
    if (part === undefined) return -1;
    if (/^\[.+\]$/.test(segment)) continue;
    if (part.includes('${…}')) continue;
    if (part !== segment) return -1;
    score++;
  }
  return url.length === route.length ? score : -1;
}

/** Detect pages, the user actions on them and a bounded static trace for each action. */
export function analyzeActions(snapshot: RepositorySnapshot, result: AnalysisResult | undefined, flow: UIFlowGraph, options: ActionAnalysisOptions = {}): ActionIndex {
  const checked = validateSnapshot(snapshot, {});
  const complete = options.complete ?? true;
  const maxActions = options.maxActions ?? 400;
  const maxSteps = options.maxSteps ?? 40;
  const maxDepth = options.maxDepth ?? 6;
  const maxComponents = options.maxComponents ?? 40;
  const now = options.now ?? (() => Date.now());
  const deadline = now() + (options.timeBudgetMs ?? 4000);
  const limitations = [
    'Static analysis only: nothing was executed, and a trace is not proof that a step runs.',
    '“Proven” means the call is bound through a compiler-resolved import or a declaration in scope. It is not checked by the TypeScript type checker.',
    'Method calls on objects are followed only for recognised APIs (Prisma, zod, router, cookies, axios) and namespace imports.',
    'Handlers passed down through props are listed on the component that defines them.',
  ];
  if (!complete) limitations.push('The snapshot is partial; missing files may hide actions and steps.');
  let partial = !complete;

  const moduleTargets = new Map<string, Map<string, { file?: string; pkg?: string }>>();
  for (const edge of result?.dependencyGraph.edges ?? []) {
    if (!edge.sourceId.startsWith('file:') || edge.specifier === undefined) continue;
    const from = edge.sourceId.slice(5);
    const map = moduleTargets.get(from) ?? new Map();
    map.set(edge.specifier, edge.targetId.startsWith('file:') ? { file: edge.targetId.slice(5) } : { pkg: edge.targetId.slice(8) });
    moduleTargets.set(from, map);
  }

  const files = new Map<string, FileInfo>();
  for (const file of checked.files) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(file.path)) continue;
    const source = parseSource(file);
    if ((source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
      limitations.push(`Skipped malformed source: ${file.path}.`);
      continue;
    }
    const info: FileInfo = { path: file.path, source, fns: new Map(), values: new Map(), imports: new Map(), exportsByName: new Map(), reexports: new Map(), stars: [] };
    const fileServer = directive(source.statements, 'use server');
    const targets = moduleTargets.get(file.path);
    const addFn = (name: string, nameNode: ts.Node, node: ts.FunctionLikeDeclaration) => {
      const location = sourceLocation(source, nameNode.getStart(source), nameNode.getEnd());
      const body = node.body && ts.isBlock(node.body) ? node.body.statements : undefined;
      info.fns.set(name, { id: `symbol:${file.path}:${location.start.line}:${location.start.column}:${encodeURIComponent(name)}`, name, file: file.path, node, line: location.start.line, serverAction: fileServer || (!!body && directive(body, 'use server')) });
    };
    for (const statement of source.statements) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
      const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(statement) && statement.body) {
        const name = statement.name?.text ?? 'default';
        addFn(name, statement.name ?? statement, statement);
        if (exported) info.exportsByName.set(isDefault ? 'default' : name, name);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const init = unwrap(declaration.initializer);
          if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) addFn(declaration.name.text, declaration.name, init);
          else info.values.set(declaration.name.text, init);
          if (exported) info.exportsByName.set(declaration.name.text, declaration.name.text);
        }
      } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) info.exportsByName.set('default', statement.expression.text);
      else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const module = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
        if (!statement.exportClause && module) info.stars.push(module);
        else if (statement.exportClause && ts.isNamedExports(statement.exportClause))
          for (const element of statement.exportClause.elements) {
            const local = element.propertyName?.text ?? element.name.text;
            if (module) info.reexports.set(element.name.text, { module, name: local });
            else info.exportsByName.set(element.name.text, local);
          }
      } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
        const module = statement.moduleSpecifier.text;
        const target = targets?.get(module);
        const base = { module, ...(target?.file ? { target: target.file } : {}), ...(target?.pkg ? { pkg: target.pkg } : {}) };
        const clause = statement.importClause;
        if (clause?.name) info.imports.set(clause.name.text, { kind: 'default', name: 'default', ...base });
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) info.imports.set(clause.namedBindings.name.text, { kind: 'namespace', name: '*', ...base });
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) info.imports.set(element.name.text, { kind: 'named', name: element.propertyName?.text ?? element.name.text, ...base });
      }
    }
    files.set(file.path, info);
  }

  const resolveExport = (path: string, name: string, depth = 0): Binding | undefined => {
    const info = files.get(path);
    if (!info || depth > 4) return undefined;
    const local = info.exportsByName.get(name);
    if (local) {
      const fn = info.fns.get(local);
      if (fn) return { kind: 'fn', fn };
      const value = info.values.get(local);
      if (value) return { kind: 'value', info, name: local, value };
      const imported = info.imports.get(local);
      if (imported?.target) return resolveExport(imported.target, imported.kind === 'default' ? 'default' : imported.name, depth + 1);
      return undefined;
    }
    const re = info.reexports.get(name);
    if (re) {
      const target = moduleTargets.get(path)?.get(re.module)?.file;
      return target ? resolveExport(target, re.name, depth + 1) : undefined;
    }
    for (const star of info.stars) {
      const target = moduleTargets.get(path)?.get(star)?.file;
      const found = target ? resolveExport(target, name, depth + 1) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  const findLocal = (info: FileInfo, name: string, at: ts.Node): Binding | undefined => {
    for (let parent: ts.Node | undefined = at.parent; parent && parent !== info.source; parent = parent.parent) {
      if (ts.isFunctionLike(parent) && parent.parameters.some((parameter) => collectNames(parameter.name).includes(name))) return { kind: 'param' };
      if (ts.isCatchClause(parent) && parent.variableDeclaration && collectNames(parent.variableDeclaration.name).includes(name)) return { kind: 'param' };
      if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent) || ts.isForStatement(parent)) && parent.initializer && ts.isVariableDeclarationList(parent.initializer))
        for (const declaration of parent.initializer.declarations) if (collectNames(declaration.name).includes(name)) return { kind: 'local', decl: declaration };
      if (ts.isBlock(parent) || ts.isModuleBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent))
        for (const statement of parent.statements) {
          if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (collectNames(declaration.name).includes(name)) return { kind: 'local', decl: declaration };
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return { kind: 'local', decl: statement };
        }
    }
    return undefined;
  };
  const resolveName = (info: FileInfo, name: string, at: ts.Node): Binding => {
    const local = findLocal(info, name, at);
    if (local) return local;
    const fn = info.fns.get(name);
    if (fn) return { kind: 'fn', fn };
    const value = info.values.get(name);
    if (value) return { kind: 'value', info, name, value };
    const imported = info.imports.get(name);
    if (imported) {
      // The specifier, not the package: `next/navigation` and `next/link` are both package `next`.
      if (imported.pkg) return { kind: 'external', pkg: imported.module, name: imported.name };
      if (imported.target) {
        if (imported.kind === 'namespace') return { kind: 'namespace', target: imported.target };
        return resolveExport(imported.target, imported.kind === 'default' ? 'default' : imported.name) ?? { kind: 'unknown-export', file: imported.target };
      }
      return { kind: 'missing', module: imported.module };
    }
    return { kind: 'global' };
  };
  const hookBinding = (decl: ts.VariableDeclaration | ts.FunctionDeclaration, name: string, hooks: string[], position: number): { first?: string; init: ts.CallExpression } | undefined => {
    if (!ts.isVariableDeclaration(decl) || !decl.initializer) return undefined;
    const init = unwrap(decl.initializer);
    if (!ts.isCallExpression(init)) return undefined;
    const callee = unwrap(init.expression);
    const hook = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    if (!hooks.includes(hook)) return undefined;
    if (position < 0) return ts.isIdentifier(decl.name) && decl.name.text === name ? { init } : undefined;
    if (!ts.isArrayBindingPattern(decl.name)) return undefined;
    const element = decl.name.elements[position];
    if (!element || ts.isOmittedExpression(element) || !ts.isIdentifier(element.name) || element.name.text !== name) return undefined;
    const first = decl.name.elements[0];
    return { init, ...(first && !ts.isOmittedExpression(first) && ts.isIdentifier(first.name) ? { first: first.name.text } : {}) };
  };
  const localFunction = (decl: ts.VariableDeclaration | ts.FunctionDeclaration): ts.FunctionLikeDeclaration | undefined => {
    if (ts.isFunctionDeclaration(decl)) return decl.body ? decl : undefined;
    if (!decl.initializer) return undefined;
    let init = unwrap(decl.initializer);
    if (ts.isCallExpression(init) && ts.isIdentifier(unwrap(init.expression)) && (unwrap(init.expression) as ts.Identifier).text === 'useCallback' && init.arguments[0]) init = unwrap(init.arguments[0]);
    return ts.isArrowFunction(init) || ts.isFunctionExpression(init) ? init : undefined;
  };

  // API route handlers, including dynamic segments.
  const routes: Route[] = [];
  for (const info of files.values()) {
    const route = routeFor(info.path);
    if (!route) continue;
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const local = info.exportsByName.get(method);
      const fn = local ? info.fns.get(local) : undefined;
      if (fn) routes.push({ method, route, segments: routeSegments(route), fn });
    }
  }
  routes.sort((a, b) => compare(a.route, b.route) || compare(a.method, b.method));
  const pageFiles = new Map<string, string>();
  for (const node of flow.nodes) if (node.sourceFile && node.routePath && !pageFiles.has(node.routePath)) pageFiles.set(node.routePath, node.sourceFile);

  // ---- Trace walking ----------------------------------------------------------------------
  const addStep = (walk: Walk, ctx: Ctx, step: Omit<TraceStepData, 'id' | 'depth' | 'parentId' | 'when'> & { node: ts.Node; idKind?: string }, chip?: { label: string; writes: boolean }): string | undefined => {
    if (walk.steps.length >= maxSteps) {
      walk.truncated = true;
      return undefined;
    }
    const { node, idKind, ...data } = step;
    const location = sourceLocation(ctx.info.source, node.getStart(ctx.info.source), node.getEnd());
    let id = `step:${ctx.info.path}:${location.start.line}:${location.start.column}:${idKind ?? data.kind}`;
    for (let n = 2; walk.ids.has(id); n++) id = `step:${ctx.info.path}:${location.start.line}:${location.start.column}:${idKind ?? data.kind}:${n}`;
    walk.ids.add(id);
    walk.steps.push({ id, depth: ctx.depth, ...(ctx.parentId ? { parentId: ctx.parentId } : {}), ...(ctx.when.length ? { when: [...ctx.when] } : {}), ...data });
    if (chip) walk.chips.set(id, chip);
    return id;
  };
  const lineOf = (info: FileInfo, node: ts.Node) => info.source.getLineAndCharacterOfPosition(node.getStart(info.source)).line + 1;
  const code = (info: FileInfo, node: ts.Node, max = 120) => short(node.getText(info.source), max);
  const gap = (walk: Walk, ctx: Ctx, node: ts.Node, title: string, reason: string, possibleTargets?: TraceStepData['possibleTargets']) =>
    addStep(walk, ctx, { node, kind: 'gap', title, code: code(ctx.info, node), file: ctx.info.path, line: lineOf(ctx.info, node), tier: 'gap', plainText: reason, why: `Gap: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`, pathLabel: short(node.getText(ctx.info.source), 32), gapReason: reason, ...(possibleTargets?.length ? { possibleTargets } : {}) });
  const effect = (walk: Walk, ctx: Ctx, node: ts.Node, kind: EffectKind, tier: StructuralTier, title: string, plainText: string, why: string, chip: string, writes = false) =>
    addStep(walk, ctx, { node, kind: 'effect', effect: kind, title, code: code(ctx.info, node), file: ctx.info.path, line: lineOf(ctx.info, node), tier, plainText, why, pathLabel: short(chip, 32) }, { label: chip, writes });

  const enter = (walk: Walk, ctx: Ctx, fn: ts.FunctionLikeDeclaration, info: FileInfo, owner: string, stepId: string | undefined) => {
    const step = walk.steps.find((item) => item.id === stepId);
    if (walk.visited.has(fn)) {
      if (step) step.plainText += ' Its steps are already shown earlier in this trace.';
      return;
    }
    if (ctx.depth + 1 > maxDepth) {
      walk.truncated = true;
      if (step) step.plainText += ' (Not expanded: depth limit reached.)';
      return;
    }
    walk.visited.add(fn);
    walkBody(walk, { info, owner, depth: ctx.depth + 1, parentId: stepId, when: ctx.when }, fn);
  };
  const callFn = (walk: Walk, ctx: Ctx, node: ts.CallExpression, fn: Fn, how: string) => {
    const args = node.arguments.slice(0, 3).map((arg) => `\`${short(arg.getText(ctx.info.source), 40)}\``);
    const elsewhere = fn.file !== ctx.info.path ? ` in ${fn.file}` : '';
    const id = addStep(walk, ctx, {
      node, idKind: 'call', kind: 'call', title: `Calls ${fn.name}`, code: code(ctx.info, node), file: fn.file, line: fn.line, tier: 'resolved',
      plainText: `Calls \`${fn.name}\`${elsewhere}${args.length ? ` with ${args.join(', ')}` : ''}.${fn.serverAction ? ' It is a server action, so it runs on the server.' : ''}`,
      why: `Resolved call: ${ctx.owner} → ${fn.name} (${how})`, pathLabel: fn.name,
      symbol: { id: fn.id, name: fn.name, file: fn.file, line: fn.line }, callSite: { file: ctx.info.path, line: lineOf(ctx.info, node) },
    });
    const target = files.get(fn.file);
    if (id && target) enter(walk, ctx, fn.node, target, fn.name, id);
  };
  const possibleFromObject = (info: FileInfo, objectName: string, at: ts.Node): TraceStepData['possibleTargets'] => {
    const binding = resolveName(info, objectName, at);
    if (binding.kind !== 'value' || !ts.isObjectLiteralExpression(binding.value)) return [];
    const out: NonNullable<TraceStepData['possibleTargets']> = [];
    for (const property of binding.value.properties) {
      const ref = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) && ts.isIdentifier(unwrap(property.initializer)) ? (unwrap(property.initializer) as ts.Identifier) : undefined;
      if (!ref) continue;
      const target = resolveName(binding.info, ref.text, ref);
      if (target.kind === 'fn') out.push({ name: target.fn.name, file: target.fn.file, symbolId: target.fn.id });
      else if (target.kind === 'value') out.push({ name: target.name, file: target.info.path });
    }
    return out.slice(0, 8);
  };
  const envVariables = (info: FileInfo, node: ts.Expression): string[] => {
    const names = new Set<string>();
    const scan = (current: ts.Node, depth: number) => {
      if (ts.isPropertyAccessExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.getText(info.source) === 'process.env') names.add(current.name.text);
      if (ts.isIdentifier(current) && depth < 2) {
        const local = findLocal(info, current.text, current);
        if (local?.kind === 'local' && ts.isVariableDeclaration(local.decl) && local.decl.initializer) scan(local.decl.initializer, depth + 1);
      }
      ts.forEachChild(current, (child) => scan(child, depth));
    };
    scan(node, 0);
    return [...names];
  };
  const http = (walk: Walk, ctx: Ctx, node: ts.CallExpression, client: string, tier: StructuralTier, fixedMethod?: string) => {
    const url = literalText(node.arguments[0]);
    let method = fixedMethod ?? 'GET';
    const options = node.arguments[1] ? unwrap(node.arguments[1]) : undefined;
    if (!fixedMethod && options && ts.isObjectLiteralExpression(options))
      for (const property of options.properties)
        if (ts.isPropertyAssignment(property) && property.name.getText(ctx.info.source).replace(/['"]/g, '') === 'method') {
          const value = literalText(property.initializer);
          method = value && !value.templated ? value.text.toUpperCase() : '?';
        }
    if (!url) {
      const argument = node.arguments[0] ? short(node.arguments[0].getText(ctx.info.source), 40) : 'nothing';
      gap(walk, ctx, node, 'Request URL is computed', `The request URL comes from \`${argument}\`, which is only known at runtime, so CodeDNA can’t tell which endpoint is called.`);
      return;
    }
    const label = `${method === '?' ? 'request' : method} ${url.text}`;
    const id = effect(walk, ctx, node, 'http', tier, `Sends ${label}`, `Sends ${method === '?' ? 'a' : `a ${method}`} request to \`${url.text}\` with ${client}.`, tier === 'conventional' ? `${client} is a recognised HTTP API` : `Called through ${client}`, label, method !== 'GET');
    if (!id || !url.text.startsWith('/')) return;
    const path = routeSegments(url.text.split(/[?#]/)[0]!);
    const scored = routes.map((route) => ({ route, score: matchRoute(route.segments, path) })).filter((item) => item.score >= 0 && (method === '?' || item.route.method === method));
    const best = Math.max(-1, ...scored.map((item) => item.score));
    const matches = scored.filter((item) => item.score === best).map((item) => item.route);
    const child: Ctx = { ...ctx, depth: ctx.depth + 1, parentId: id };
    if (matches.length === 1) {
      const route = matches[0]!;
      const target = files.get(route.fn.file)!;
      const handled = addStep(walk, child, {
        node, idKind: 'route', kind: 'call', title: `Handled by ${route.method} ${route.route}`, code: code(ctx.info, node), file: route.fn.file, line: route.fn.line, tier: 'heuristic',
        plainText: `The URL text \`${url.text}\` matches the route handler \`${route.method}\` in ${route.fn.file}.`, why: `Best guess: URL text matched to ${route.fn.file} by route path`, pathLabel: `${route.method} ${route.fn.file}`,
        symbol: { id: route.fn.id, name: route.fn.name, file: route.fn.file, line: route.fn.line }, callSite: { file: ctx.info.path, line: lineOf(ctx.info, node) },
      });
      if (handled) enter(walk, child, route.fn.node, target, `${route.method} ${route.route}`, handled);
    } else if (matches.length > 1) gap(walk, child, node, 'Several routes match', `\`${url.text}\` matches ${matches.length} route handlers; CodeDNA can’t tell which one runs.`, matches.map((route) => ({ name: `${route.method} ${route.route}`, file: route.fn.file, symbolId: route.fn.id })));
    else gap(walk, child, node, 'No matching route handler', `No route handler in the snapshot matches \`${method === '?' ? '' : `${method} `}${url.text}\`. It may be served elsewhere.`);
  };

  const exits = (statement: ts.Statement): boolean => {
    if (ts.isBlock(statement)) return statement.statements.length > 0 && exits(statement.statements[statement.statements.length - 1]!);
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (ts.isExpressionStatement(statement)) {
      const expression = unwrap(statement.expression);
      return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && ['redirect', 'permanentRedirect', 'notFound'].includes(expression.expression.text);
    }
    return false;
  };
  const summary = (info: FileInfo, statement: ts.Statement) => {
    const first = ts.isBlock(statement) ? statement.statements[0] : statement;
    return first ? short(first.getText(info.source).replace(/;$/, ''), 56) : 'nothing';
  };
  const walkStatements = (walk: Walk, ctx: Ctx, statements: readonly ts.Statement[]) => {
    let current = ctx;
    for (const statement of statements) {
      if (walk.steps.length >= maxSteps) { walk.truncated = true; return; }
      if (ts.isIfStatement(statement)) {
        const branchId = handleIf(walk, current, statement);
        if (branchId) current = { ...current, when: [...current.when, { branchId, option: 'else' }] };
      } else visit(walk, current, statement);
    }
  };
  const handleIf = (walk: Walk, ctx: Ctx, node: ts.IfStatement): string | undefined => {
    visit(walk, ctx, node.expression);
    const condition = short(`if (${node.expression.getText(ctx.info.source)})`, 100);
    const location = sourceLocation(ctx.info.source, node.getStart(ctx.info.source), node.getEnd());
    const branchId = `branch:${ctx.info.path}:${location.start.line}:${location.start.column}`;
    const thenExits = exits(node.thenStatement);
    const yes = summary(ctx.info, node.thenStatement);
    const no = node.elseStatement ? summary(ctx.info, node.elseStatement) : 'continue';
    const before = walk.steps.length;
    const id = addStep(walk, ctx, {
      node, kind: 'decision', title: `Checks ${short(node.expression.getText(ctx.info.source), 60)}`, code: condition, file: ctx.info.path, line: location.start.line, tier: 'resolved',
      plainText: `When \`${short(node.expression.getText(ctx.info.source), 60)}\` is true it runs \`${yes}\`${thenExits ? ' and stops there' : ''}. Otherwise it ${node.elseStatement ? `runs \`${no}\`` : 'continues'}. Which branch runs depends on runtime values.`,
      why: `Condition written in ${ctx.owner}`, pathLabel: 'if',
      branch: { id: branchId, condition, options: [{ id: 'then', label: `Yes: ${yes}` }, { id: 'else', label: `No: ${no}` }] },
    });
    if (!id) return undefined;
    const inner = (statement: ts.Statement, option: 'then' | 'else') => {
      const branchCtx = { ...ctx, when: [...ctx.when, { branchId, option }] };
      if (ts.isBlock(statement)) walkStatements(walk, branchCtx, statement.statements);
      else if (ts.isIfStatement(statement)) handleIf(walk, branchCtx, statement);
      else visit(walk, branchCtx, statement);
    };
    inner(node.thenStatement, 'then');
    if (node.elseStatement) inner(node.elseStatement, 'else');
    const added = walk.steps.length - before - 1;
    if (added === 0 && !thenExits) {
      walk.steps.splice(before, 1);
      walk.ids.delete(id);
      return undefined;
    }
    return thenExits && !node.elseStatement ? branchId : undefined;
  };
  const visit = (walk: Walk, ctx: Ctx, node: ts.Node): void => {
    if (walk.steps.length >= maxSteps) { walk.truncated = true; return; }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    if (ts.isBlock(node)) return walkStatements(walk, ctx, node.statements);
    if (ts.isIfStatement(node)) { handleIf(walk, ctx, node); return; }
    if (ts.isCallExpression(node)) return handleCall(walk, ctx, node);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(unwrap(node.expression))) {
      const env = envVariables(ctx.info, node.argumentExpression);
      if (env.length) {
        const object = (unwrap(node.expression) as ts.Identifier).text;
        const targets = possibleFromObject(ctx.info, object, node);
        gap(walk, ctx, node, 'Implementation chosen at runtime', `The implementation is picked from \`${object}\` using the ${env.join(', ')} environment variable${env.length > 1 ? 's' : ''}, so CodeDNA can’t tell which one runs.${targets?.length ? ` Possible implementations: ${targets.map((t) => t.name ?? t.file).join(', ')}.` : ''}`, targets);
      }
    }
    ts.forEachChild(node, (child) => visit(walk, ctx, child));
  };
  const visitArgs = (walk: Walk, ctx: Ctx, node: ts.CallExpression) => node.arguments.forEach((arg) => visit(walk, ctx, arg));
  const handleCall = (walk: Walk, ctx: Ctx, node: ts.CallExpression): void => {
    const { info } = ctx;
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const spec = literalText(node.arguments[0]);
      const target = spec && !spec.templated ? moduleTargets.get(info.path)?.get(spec.text)?.file : undefined;
      gap(walk, ctx, node, 'Code loaded with dynamic import()', `This code is loaded at runtime with \`import()\`. CodeDNA doesn’t follow dynamically loaded code.${target ? ` It probably loads ${target}.` : ''}`, target ? [{ file: target }] : undefined);
      return;
    }
    const callee = unwrap(node.expression);
    if (ts.isElementAccessExpression(callee)) {
      const object = unwrap(callee.expression);
      const objectName = ts.isIdentifier(object) ? object.text : undefined;
      const env = envVariables(info, callee.argumentExpression);
      const targets = objectName ? possibleFromObject(info, objectName, node) : [];
      const text = short(callee.getText(info.source), 48);
      gap(walk, ctx, node, 'Called through a runtime key', env.length ? `\`${text}()\` picks a function using the ${env.join(', ')} environment variable, so CodeDNA can’t tell which one runs.` : `Called through \`${text}()\`; the key is only known at runtime, so CodeDNA can’t tell which function runs.${targets?.length ? ` Possible targets: ${targets.map((t) => t.name ?? t.file).join(', ')}.` : ''}`, targets);
      visit(walk, ctx, callee.argumentExpression);
      return visitArgs(walk, ctx, node);
    }
    if (ts.isIdentifier(callee)) {
      const name = callee.text;
      const binding = resolveName(info, name, callee);
      if (binding.kind === 'global') {
        if (name === 'fetch') http(walk, ctx, node, '`fetch`', 'conventional');
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'fn') {
        callFn(walk, ctx, node, binding.fn, binding.fn.file === info.path ? 'declared in this file' : `imported from ${binding.fn.file}`);
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'external') {
        const destination = literalText(node.arguments[0]);
        const where = destination ? destination.text : 'a computed address';
        if (binding.pkg === 'next/navigation' && ['redirect', 'permanentRedirect'].includes(binding.name)) effect(walk, ctx, node, 'redirect', 'conventional', `Redirects to ${where}`, `Sends the user to \`${where}\`. Code after a redirect does not run.`, 'Next.js redirect() from next/navigation (framework rule)', `redirects ${where}`);
        else if (binding.pkg === 'next/navigation' && binding.name === 'notFound') effect(walk, ctx, node, 'redirect', 'conventional', 'Shows the not-found page', 'Stops and shows the not-found page.', 'Next.js notFound() (framework rule)', 'shows not found');
        else if (binding.pkg === 'next/cache' && ['revalidatePath', 'revalidateTag'].includes(binding.name)) effect(walk, ctx, node, 'revalidate', 'conventional', `Refreshes cached ${where}`, `Marks cached data for \`${where}\` as stale so it is fetched again.`, `Next.js ${binding.name}() (framework rule)`, `revalidates ${where}`, true);
        else if (binding.pkg === 'next/headers' && binding.name === 'cookies') effect(walk, ctx, node, 'cookie', 'conventional', 'Reads cookies', 'Reads the request cookies.', 'Next.js cookies() from next/headers (framework rule)', 'reads cookies');
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'local') {
        const fn = localFunction(binding.decl);
        const setter = hookBinding(binding.decl, name, ['useState', 'useReducer'], 1);
        if (fn) {
          const id = addStep(walk, ctx, { node, idKind: 'call', kind: 'call', title: `Calls ${name}`, code: code(info, node), file: info.path, line: lineOf(info, fn), tier: 'resolved', plainText: `Calls \`${name}\`, a function defined inside \`${ctx.owner}\`.`, why: `Resolved call: ${ctx.owner} → ${name} (declared in scope)`, pathLabel: name, callSite: { file: info.path, line: lineOf(info, node) } });
          if (id) enter(walk, ctx, fn, info, name, id);
        } else if (setter) {
          const state = setter.first ?? name.replace(/^set(?=[A-Z])/, '');
          effect(walk, ctx, node, 'local-state', 'conventional', `Updates ${state} state`, `Updates the \`${state}\` state in this component, which re-renders it.`, `React state setter from ${setter.init.expression.getText(info.source)}() (framework rule)`, `updates ${state}`);
        } else gap(walk, ctx, node, 'Calls a runtime value', `\`${name}\` holds a function chosen at runtime, so CodeDNA can’t tell which code runs.`);
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'param') {
        gap(walk, ctx, node, 'Calls a function passed in', `\`${name}\` is a function passed in by the caller, so CodeDNA can’t tell which code runs.`);
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'missing') {
        gap(walk, ctx, node, 'Source not in the repository', `\`${name}\` comes from \`${binding.module}\`, which CodeDNA couldn’t find in this snapshot.`);
        return visitArgs(walk, ctx, node);
      }
      if (binding.kind === 'unknown-export' || binding.kind === 'value') {
        const file = binding.kind === 'value' ? binding.info.path : binding.file;
        gap(walk, ctx, node, 'Can’t follow this call', `\`${name}\` (${file}) is not a function declaration CodeDNA can follow.`);
        return visitArgs(walk, ctx, node);
      }
      return visitArgs(walk, ctx, node);
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      const receiver = unwrap(callee.expression);
      if (ts.isIdentifier(receiver)) {
        const binding = resolveName(info, receiver.text, receiver);
        if (binding.kind === 'namespace') {
          const target = resolveExport(binding.target, method);
          if (target?.kind === 'fn') callFn(walk, ctx, node, target.fn, `namespace import of ${binding.target}`);
          return visitArgs(walk, ctx, node);
        }
        if (VALIDATE.has(method)) {
          const isZod = binding.kind === 'value' && /^z\./.test(binding.value.getText(binding.info.source));
          if (isZod || /schema$/i.test(receiver.text)) {
            effect(walk, ctx, node, 'validation', isZod ? 'conventional' : 'heuristic', `Validates with ${receiver.text}`, `Checks the data against \`${receiver.text}\`${method.startsWith('safe') ? ' and returns a success flag instead of throwing' : '; invalid data throws an error'}.`, isZod ? `zod schema ${receiver.text}.${method}() (library rule)` : `Best guess: \`${receiver.text}.${method}()\` looks like schema validation by name`, `validates ${receiver.text}`);
            return visitArgs(walk, ctx, node);
          }
        }
        if (['push', 'replace', 'back', 'forward'].includes(method)) {
          const router = binding.kind === 'local' ? hookBinding(binding.decl, receiver.text, ['useRouter', 'useNavigate'], -1) : undefined;
          if (router || receiver.text === 'router') {
            const destination = literalText(node.arguments[0])?.text ?? (method === 'back' ? 'the previous page' : 'a computed address');
            effect(walk, ctx, node, 'navigation', router ? 'conventional' : 'heuristic', `Navigates to ${destination}`, `Navigates the browser to \`${destination}\`.`, router ? `Router ${method}() from ${router.init.expression.getText(info.source)}() (framework rule)` : `Best guess: \`router.${method}()\` matched by name`, `navigates ${destination}`);
            return visitArgs(walk, ctx, node);
          }
        }
        if (binding.kind === 'external' && binding.pkg === 'axios' && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          http(walk, ctx, node, '`axios`', 'conventional', method.toUpperCase());
          return visitArgs(walk, ctx, node);
        }
      }
      if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.expression) && (PRISMA_WRITE.has(method) || PRISMA_READ.has(method))) {
        const root = receiver.expression.text;
        const binding = resolveName(info, root, receiver.expression);
        const known = (binding.kind === 'value' && /PrismaClient/.test(binding.value.getText(binding.info.source))) || (binding.kind === 'external' && binding.pkg === '@prisma/client');
        if (known || /prisma|^db$/i.test(root)) {
          const model = receiver.name.text.charAt(0).toUpperCase() + receiver.name.text.slice(1);
          const writes = PRISMA_WRITE.has(method);
          effect(walk, ctx, node, writes ? 'db-write' : 'db-read', known ? 'conventional' : 'heuristic', `${writes ? 'Writes' : 'Reads'} ${model}`, `${writes ? `Writes ${model} records` : `Reads ${model} records`} in the database with Prisma \`${method}\`.`, known ? `Prisma client call ${root}.${receiver.name.text}.${method}() (library rule)` : `Best guess: \`${root}.${receiver.name.text}.${method}()\` looks like a Prisma call by name`, `${writes ? 'writes' : 'reads'} ${model}`, writes);
          return visitArgs(walk, ctx, node);
        }
      }
      if (ts.isCallExpression(receiver) && ts.isIdentifier(unwrap(receiver.expression))) {
        const inner = (unwrap(receiver.expression) as ts.Identifier).text;
        const binding = resolveName(info, inner, receiver);
        if (binding.kind === 'external' && binding.pkg === 'next/headers' && inner === 'cookies' && ['get', 'set', 'delete', 'has', 'getAll'].includes(method)) {
          const name = literalText(node.arguments[0])?.text ?? '';
          const verb = method === 'set' ? 'Sets' : method === 'delete' ? 'Deletes' : 'Reads';
          effect(walk, ctx, node, 'cookie', 'conventional', `${verb} cookie${name ? ` ${name}` : 's'}`, `${verb} the ${name ? `\`${name}\` ` : ''}cookie${name ? '' : 's'}.`, 'Next.js cookies() from next/headers (framework rule)', `${verb.toLowerCase()} cookie${name ? ` ${name}` : 's'}`, method === 'set' || method === 'delete');
          return visitArgs(walk, ctx, node);
        }
      }
      visit(walk, ctx, receiver);
      return visitArgs(walk, ctx, node);
    }
    ts.forEachChild(node, (child) => visit(walk, ctx, child));
  };
  const walkBody = (walk: Walk, ctx: Ctx, fn: ts.FunctionLikeDeclaration) => {
    if (!fn.body) return;
    if (ts.isBlock(fn.body)) walkStatements(walk, ctx, fn.body.statements);
    else visit(walk, ctx, fn.body);
  };

  // ---- Action detection --------------------------------------------------------------------
  const textOf = (info: FileInfo, element: ts.JsxElement | ts.JsxSelfClosingElement, depth = 0): string => {
    const attrs = ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
    for (const property of attrs.properties)
      if (ts.isJsxAttribute(property) && ['aria-label', 'title'].includes(property.name.getText(info.source)) && property.initializer && ts.isStringLiteral(property.initializer)) return property.initializer.text;
    if (!ts.isJsxElement(element) || depth > 2) return '';
    const parts: string[] = [];
    for (const child of element.children) {
      if (ts.isJsxText(child)) parts.push(child.text.trim());
      else if (ts.isJsxExpression(child) && child.expression && literalText(child.expression)) parts.push(literalText(child.expression)!.text);
      else if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) parts.push(textOf(info, child, depth + 1));
    }
    return short(parts.filter(Boolean).join(' '), 50);
  };
  const submitText = (info: FileInfo, form: ts.JsxElement): string => {
    let found = '';
    const scan = (node: ts.Node) => {
      if (found) return;
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(info.source);
        const type = opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(info.source) === 'type');
        const typeText = type && ts.isJsxAttribute(type) && type.initializer && ts.isStringLiteral(type.initializer) ? type.initializer.text : tag === 'button' ? 'submit' : '';
        if ((tag === 'button' || tag === 'input') && typeText === 'submit') { found = textOf(info, node); return; }
      }
      ts.forEachChild(node, scan);
    };
    form.children.forEach(scan);
    return found;
  };
  const forwardsProp = (fn: Fn, prop: string): boolean => {
    let found = false;
    const scan = (node: ts.Node) => {
      if (found) return;
      if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText()) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const value = unwrap(node.initializer.expression);
        if ((ts.isIdentifier(value) && value.text === prop) || (ts.isPropertyAccessExpression(value) && value.name.text === prop)) found = true;
      }
      ts.forEachChild(node, scan);
    };
    scan(fn.node);
    return found;
  };

  interface Detected { id: string; traceId: string; component: string; kind: TriggerKind; label: string; triggerCode: string; file: string; line: number; build: () => StoredTrace; refine?: ((steps: TraceStepData[]) => string) | undefined }
  const traceCache = new Map<string, StoredTrace>();
  const newWalk = (): Walk => ({ steps: [], visited: new Set(), truncated: false, ids: new Set(), chips: new Map() });
  const chipsByTrace = new Map<string, Map<string, { label: string; writes: boolean }>>();
  const finish = (traceId: string, actionId: string, walk: Walk): StoredTrace => {
    chipsByTrace.set(traceId, walk.chips);
    return { id: traceId, actionId, steps: walk.steps, truncated: walk.truncated };
  };

  const detectInComponent = (fn: Fn, info: FileInfo, pageId: string, queue: Fn[], seen: Set<string>, out: Detected[]) => {
    const scan = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(info.source);
        const intrinsic = /^[a-z]/.test(tag);
        let component: Fn | undefined;
        let linkPackage: string | undefined;
        if (!intrinsic && ts.isIdentifier(opening.tagName)) {
          const binding = resolveName(info, tag, opening.tagName);
          if (binding.kind === 'fn') component = binding.fn;
          if (binding.kind === 'external' && LINK_PACKAGES.has(binding.pkg) && ['Link', 'NavLink', 'default'].includes(binding.name)) linkPackage = binding.pkg;
          if (component && !seen.has(component.id) && seen.size < maxComponents) { seen.add(component.id); queue.push(component); }
        }
        for (const property of opening.attributes.properties) {
          if (!ts.isJsxAttribute(property)) continue;
          const attr = property.name.getText(info.source);
          const isLink = (linkPackage && attr === 'href') || (tag === 'a' && attr === 'href');
          const isForm = intrinsic && ((tag === 'form' && attr === 'action') || attr === 'formAction');
          const isEvent = /^on[A-Z]/.test(attr);
          if (!isLink && !isForm && !isEvent) continue;
          const location = sourceLocation(info.source, property.getStart(info.source), property.getEnd());
          const key = `${info.path}:${location.start.line}:${location.start.column}:${attr}`;
          const traceId = `trace:${key}`;
          const id = `action:${pageId}:${key}`;
          const expression = property.initializer && ts.isJsxExpression(property.initializer) ? property.initializer.expression : property.initializer;
          const value = expression ? unwrap(expression as ts.Expression) : undefined;
          const triggerCode = short(`<${tag} ${property.getText(info.source)}>`, 90);
          const base = { id, traceId, component: fn.name, file: info.path, line: location.start.line, triggerCode };
          const rootCtx: Ctx = { info, owner: fn.name, depth: 0, parentId: undefined, when: [] };

          if (isLink) {
            const href = literalText(value);
            if (tag === 'a' && !href?.text.startsWith('/')) continue;
            const text = textOf(info, node);
            const hrefPath = href ? routeSegments(href.text.split(/[?#]/)[0]!) : [];
            const matchedRoute = href ? [...pageFiles.keys()].find((route) => matchRoute(routeSegments(route), hrefPath) >= 0) : undefined;
            out.push({ ...base, kind: 'link', label: text || `Go to ${matchedRoute ?? href?.text ?? 'link'}`, build: () => {
              const walk = newWalk();
              const destination = href?.text;
              const trigger = addStep(walk, rootCtx, { node: property, kind: 'trigger', effect: 'navigation', title: `User follows the link${text ? ` “${text}”` : ''}`, code: triggerCode, file: info.path, line: location.start.line, tier: 'conventional',
                plainText: destination ? `Following the link opens \`${destination}\`.` : 'Following the link opens an address computed at runtime.', why: linkPackage ? `${linkPackage} Link navigation (framework rule)` : 'HTML link (platform rule)', pathLabel: '<Link>' }, destination ? { label: `navigates ${destination}`, writes: false } : undefined);
              const child = { ...rootCtx, depth: 1, parentId: trigger };
              if (!destination) gap(walk, child, property, 'Link destination is computed', `The link address comes from \`${value ? short(value.getText(info.source), 40) : 'nothing'}\`, which is only known at runtime.`);
              else {
                const path = routeSegments(destination.split(/[?#]/)[0]!);
                const pages = [...pageFiles].map(([route, file]) => ({ route, file, score: matchRoute(routeSegments(route), path) })).filter((item) => item.score >= 0);
                const best = Math.max(-1, ...pages.map((item) => item.score));
                const target = pages.filter((item) => item.score === best);
                if (target.length === 1) addStep(walk, child, { node: property, idKind: 'page', kind: 'call', title: `Opens page ${target[0]!.route}`, code: triggerCode, file: target[0]!.file, line: 1, tier: href?.templated || target[0]!.route.includes('[') ? 'heuristic' : 'conventional',
                  plainText: `\`${destination}\` is served by the page file ${target[0]!.file}.`, why: href?.templated || target[0]!.route.includes('[') ? 'Best guess: link text matched to a dynamic route segment' : 'File-based route (framework rule)', pathLabel: target[0]!.route });
                else if (!/^https?:/.test(destination)) gap(walk, child, property, 'No page found for this link', `No page in the snapshot is registered for \`${destination}\`.`);
              }
              return finish(traceId, id, walk);
            } });
            continue;
          }
          // Event handlers and form actions.
          let handler: { kind: 'fn'; fn: Fn; via?: string } | { kind: 'inline'; node: ts.FunctionLikeDeclaration; name?: string } | { kind: 'setter'; state: string; call: string } | { kind: 'external'; pkg: string; name: string } | { kind: 'url'; url: string } | { kind: 'unknown'; reason: string } | undefined;
          if (!value) handler = { kind: 'unknown', reason: 'The binding has no expression.' };
          else if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) handler = { kind: 'inline', node: value };
          else if (ts.isStringLiteral(value)) handler = { kind: 'url', url: value.text };
          else if (ts.isIdentifier(value)) {
            const binding = resolveName(info, value.text, value);
            if (binding.kind === 'fn') handler = { kind: 'fn', fn: binding.fn };
            else if (binding.kind === 'local') {
              const local = localFunction(binding.decl);
              const actionState = hookBinding(binding.decl, value.text, ['useActionState', 'useFormState'], 1);
              const setter = hookBinding(binding.decl, value.text, ['useState'], 1);
              if (local) handler = { kind: 'inline', node: local, name: value.text };
              else if (actionState && actionState.init.arguments[0] && ts.isIdentifier(unwrap(actionState.init.arguments[0]))) {
                const target = resolveName(info, (unwrap(actionState.init.arguments[0]) as ts.Identifier).text, actionState.init);
                handler = target.kind === 'fn' ? { kind: 'fn', fn: target.fn, via: `${actionState.init.expression.getText(info.source)}(${target.fn.name})` } : { kind: 'unknown', reason: `\`${value.text}\` comes from ${actionState.init.expression.getText(info.source)}(), but its action could not be resolved.` };
              } else if (setter) handler = { kind: 'setter', state: setter.first ?? value.text, call: value.text };
              else handler = { kind: 'unknown', reason: `\`${value.text}\` holds a function chosen at runtime.` };
            } else if (binding.kind === 'param') continue; // forwarded prop: listed where it is defined
            else if (binding.kind === 'external') handler = { kind: 'external', pkg: binding.pkg, name: binding.name };
            else if (binding.kind === 'missing') handler = { kind: 'unknown', reason: `\`${value.text}\` comes from \`${binding.module}\`, which is not in this snapshot.` };
            else handler = { kind: 'unknown', reason: `\`${value.text}\` is not a function CodeDNA can follow.` };
          } else if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(unwrap(value.expression)) && resolveName(info, (unwrap(value.expression) as ts.Identifier).text, value).kind === 'param') continue;
          else handler = { kind: 'unknown', reason: `The handler is \`${short(value.getText(info.source), 40)}\`, which is only known at runtime.` };

          const handlerName = handler.kind === 'fn' ? handler.fn.name : handler.kind === 'inline' ? handler.name : handler.kind === 'external' ? handler.name : undefined;
          const text = textOf(info, node);
          const kind: TriggerKind = isForm ? 'form-action' : 'event-handler';
          const formText = isForm || (tag === 'form' && attr === 'onSubmit') ? (ts.isJsxElement(node) ? submitText(info, node) : '') : '';
          const nameAttr = opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && ['name', 'placeholder', 'aria-label'].includes(p.name.getText(info.source)) && p.initializer && ts.isStringLiteral(p.initializer));
          const fieldName = nameAttr && ts.isJsxAttribute(nameAttr) && nameAttr.initializer && ts.isStringLiteral(nameAttr.initializer) ? nameAttr.initializer.text : '';
          const field = ['input', 'select', 'textarea'].includes(tag);
          const label = isForm ? (handlerName ? humanize(handlerName) : formText || 'Submit form')
            : attr === 'onSubmit' ? formText || (handlerName ? humanize(handlerName) : 'Submit form')
            : field ? (fieldName ? `Change ${fieldName}` : handlerName ? humanize(handlerName) : `Change ${tag}`)
            : text || (handlerName ? humanize(handlerName) : `${humanize(attr)} ${tag}`);
          const verb = isForm ? 'Submitting the form' : `${EVENT_VERB[attr] ?? `Triggering ${attr} on`} ${text ? `“${text}”` : `the <${tag}>`}`;
          const forwarded = component ? forwardsProp(component, attr) : false;
          const triggerTier: StructuralTier = isForm ? 'conventional' : intrinsic || forwarded ? 'resolved' : 'heuristic';
          const finalHandler = handler;
          out.push({ ...base, kind, label, refine: field && !fieldName && !handlerName ? (steps) => { const state = steps.find((s) => s.effect === 'local-state'); return state ? `Edit ${state.title.replace(/^Updates (.+) state$/, '$1')}` : label; } : undefined, build: () => {
            const walk = newWalk();
            const target = finalHandler.kind === 'fn' ? finalHandler.fn : undefined;
            const why = isForm ? `React form action${target?.serverAction ? ' → server action' : ''}${finalHandler.kind === 'fn' && finalHandler.via ? ` via ${finalHandler.via}` : ''} (framework rule)`
              : intrinsic ? `React event binding: ${attr} is bound to ${handlerName ?? 'an inline function'}`
              : forwarded ? `<${tag}> passes ${attr} to a DOM event handler` : `Best guess: \`${attr}\` looks like an event prop; CodeDNA did not find where <${tag}> calls it`;
            const runs = finalHandler.kind === 'fn' ? `${target?.serverAction ? 'the server action ' : ''}\`${finalHandler.fn.name}\`${finalHandler.fn.file !== info.path ? ` (${finalHandler.fn.file})` : ''}`
              : finalHandler.kind === 'inline' ? (finalHandler.name ? `\`${finalHandler.name}\`` : `the inline handler \`${short(finalHandler.node.getText(info.source), 48)}\``)
              : finalHandler.kind === 'external' ? `\`${finalHandler.name}\` from the \`${finalHandler.pkg}\` package` : finalHandler.kind === 'setter' ? `\`${finalHandler.call}\`` : finalHandler.kind === 'url' ? `a request to \`${finalHandler.url}\`` : 'a handler CodeDNA can’t identify';
            const trigger = addStep(walk, rootCtx, { node: property, kind: 'trigger', title: isForm ? 'User submits the form' : `User ${USER_VERB[attr] ?? `triggers ${attr} on`} ${text ? `“${text}”` : `<${tag}>`}`,
              code: triggerCode, file: info.path, line: location.start.line, tier: triggerTier, plainText: `${verb} runs ${runs}${isForm ? ' with the form data' : ''}.`, why,
              pathLabel: isForm ? `<${tag} ${attr}>` : attr, ...(target ? { symbol: { id: target.id, name: target.name, file: target.file, line: target.line } } : {}) });
            const child: Ctx = { ...rootCtx, depth: 1, parentId: trigger };
            if (finalHandler.kind === 'fn') { const targetInfo = files.get(finalHandler.fn.file); if (targetInfo) { walk.visited.add(finalHandler.fn.node); walkBody(walk, { ...child, info: targetInfo, owner: finalHandler.fn.name }, finalHandler.fn.node); } }
            else if (finalHandler.kind === 'inline') { walk.visited.add(finalHandler.node); walkBody(walk, { ...child, owner: finalHandler.name ?? fn.name }, finalHandler.node); }
            else if (finalHandler.kind === 'setter') effect(walk, child, property, 'local-state', 'conventional', `Updates ${finalHandler.state} state`, `Updates the \`${finalHandler.state}\` state in this component, which re-renders it.`, 'React state setter (framework rule)', `updates ${finalHandler.state}`);
            else if (finalHandler.kind === 'external') addStep(walk, child, { node: property, idKind: 'library', kind: 'call', title: `Calls ${finalHandler.name}`, code: triggerCode, file: info.path, line: location.start.line, tier: 'resolved', plainText: `Calls \`${finalHandler.name}\` from the \`${finalHandler.pkg}\` package. Library code is not analyzed.`, why: `Resolved import from ${finalHandler.pkg}`, pathLabel: finalHandler.name });
            else if (finalHandler.kind === 'url') {
              const path = routeSegments(finalHandler.url);
              const match = routes.filter((route) => route.method === 'POST' && matchRoute(route.segments, path) >= 0);
              if (match.length === 1) { const handled = addStep(walk, child, { node: property, idKind: 'route', kind: 'call', title: `Handled by POST ${match[0]!.route}`, code: triggerCode, file: match[0]!.fn.file, line: match[0]!.fn.line, tier: 'heuristic', plainText: `The form posts to \`${finalHandler.url}\`, which matches ${match[0]!.fn.file}.`, why: 'Best guess: form URL matched to a route handler by path', pathLabel: `POST ${match[0]!.fn.file}`, symbol: { id: match[0]!.fn.id, name: match[0]!.fn.name, file: match[0]!.fn.file, line: match[0]!.fn.line } }); if (handled) enter(walk, { ...child }, match[0]!.fn.node, files.get(match[0]!.fn.file)!, `POST ${match[0]!.route}`, handled); }
              else gap(walk, child, property, 'Form target not found', `No single POST route handler matches \`${finalHandler.url}\`.`);
            } else if (finalHandler.kind === 'unknown') gap(walk, child, property, 'Can’t identify the handler', finalHandler.reason);
            return finish(traceId, id, walk);
          } });
        }
      }
      ts.forEachChild(node, scan);
    };
    scan(fn.node);
  };

  // ---- Assemble the index -----------------------------------------------------------------
  const detected: (Detected & { pageId: string; pageRoute: string })[] = [];
  const pages: PageEntry[] = [];
  const seenFiles = new Set<string>();
  for (const [route, file] of [...pageFiles].sort((a, b) => compare(a[0], b[0]))) {
    const info = files.get(file);
    if (!info || seenFiles.has(file)) continue;
    seenFiles.add(file);
    const pageId = `page:${route}`;
    const root = info.fns.get(info.exportsByName.get('default') ?? '') ;
    const queue = root ? [root] : [...info.fns.values()].filter((fn) => /^[A-Z]/.test(fn.name));
    const seen = new Set(queue.map((fn) => fn.id));
    const out: Detected[] = [];
    while (queue.length) {
      const fn = queue.shift()!;
      const fnInfo = files.get(fn.file);
      if (fnInfo) detectInComponent(fn, fnInfo, pageId, queue, seen, out);
    }
    if (seen.size >= maxComponents) { partial = true; limitations.push(`Component limit (${maxComponents}) reached on ${route}.`); }
    const title = info.values.get('metadata');
    const titleText = title && ts.isObjectLiteralExpression(title) ? title.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(info.source) === 'title') : undefined;
    const literal = titleText && ts.isPropertyAssignment(titleText) ? literalText(titleText.initializer) : undefined;
    pages.push({ id: pageId, kind: 'page', route, file, ...(literal && !literal.templated ? { title: literal.text } : {}), actionCount: 0, tierSummary: emptyTierCounts() });
    for (const item of out) detected.push({ ...item, pageId, pageRoute: route });
  }
  if (routes.length) {
    const pageId = 'page:api';
    pages.push({ id: pageId, kind: 'api', route: 'API routes', file: routes[0]!.fn.file, actionCount: 0, tierSummary: emptyTierCounts() });
    for (const route of routes) {
      const info = files.get(route.fn.file)!;
      const key = `${route.fn.file}:${route.fn.line}:${route.method}`;
      const traceId = `trace:${key}`;
      const id = `action:${pageId}:${key}`;
      detected.push({ id, traceId, pageId, pageRoute: 'API routes', component: route.route, kind: 'route-handler', label: `${route.method} ${route.route}`, triggerCode: `export function ${route.method}`, file: route.fn.file, line: route.fn.line, build: () => {
        const walk = newWalk();
        const ctx: Ctx = { info, owner: `${route.method} ${route.route}`, depth: 0, parentId: undefined, when: [] };
        const trigger = addStep(walk, ctx, { node: route.fn.node, kind: 'trigger', title: `Request arrives at ${route.method} ${route.route}`, code: short(route.fn.node.getText(info.source).split('{')[0]!, 90), file: route.fn.file, line: route.fn.line, tier: 'conventional', plainText: `A ${route.method} request to \`${route.route}\` runs \`${route.fn.name}\` in ${route.fn.file}.`, why: 'Next.js route handler file convention (framework rule)', pathLabel: `${route.method} ${route.route}`, symbol: { id: route.fn.id, name: route.fn.name, file: route.fn.file, line: route.fn.line } });
        walk.visited.add(route.fn.node);
        walkBody(walk, { ...ctx, depth: 1, parentId: trigger }, route.fn.node);
        return finish(traceId, id, walk);
      } });
    }
  }

  const actions: UserAction[] = [];
  const gaps: ActionGap[] = [];
  for (const item of detected) {
    if (actions.length >= maxActions || now() > deadline) {
      partial = true;
      limitations.push(actions.length >= maxActions ? `Action limit (${maxActions}) reached; some actions are not listed.` : 'Time budget reached; some actions were not analyzed.');
      break;
    }
    let trace = traceCache.get(item.traceId);
    if (!trace) { trace = item.build(); traceCache.set(item.traceId, trace); }
    const chips = chipsByTrace.get(item.traceId) ?? new Map();
    const effects: Effect[] = [];
    const labels = new Set<string>();
    let writes = false;
    for (const step of trace.steps) {
      const chip = chips.get(step.id);
      if (!chip || !step.effect) continue;
      writes ||= chip.writes && step.effect !== 'revalidate';
      if (labels.has(chip.label) || effects.length >= 8) continue;
      labels.add(chip.label);
      effects.push({ kind: step.effect, label: chip.label, tier: step.tier, evidenceId: step.id });
    }
    const worstTier = weakestTier(trace.steps.map((step) => step.tier));
    const gapSteps = trace.steps.filter((step) => step.tier === 'gap');
    const label = item.refine ? item.refine(trace.steps) : item.label;
    actions.push({ id: item.id, pageId: item.pageId, pageRoute: item.pageRoute, component: item.component, file: item.file, line: item.line, triggerKind: item.kind, triggerCode: item.triggerCode, label, effects, worstTier, gapCount: gapSteps.length, changesData: writes, traceId: item.traceId });
    for (const step of gapSteps) if (gaps.length < 200) gaps.push({ actionId: item.id, actionLabel: label, pageRoute: item.pageRoute, reason: step.gapReason ?? step.plainText, file: step.file, line: step.line });
  }
  actions.sort((a, b) => compare(a.pageId, b.pageId) || compare(a.file, b.file) || a.line - b.line || compare(a.id, b.id));
  for (const page of pages) {
    const own = actions.filter((action) => action.pageId === page.id);
    page.actionCount = own.length;
    for (const action of own) page.tierSummary[action.worstTier]++;
  }
  const used = new Set(actions.map((action) => action.traceId));
  const traces = [...traceCache.values()].filter((trace) => used.has(trace.id)).sort((a, b) => compare(a.id, b.id));
  if (!pages.some((page) => page.kind === 'page')) limitations.push('No pages were detected. Supported: Next.js App Router, React Router, Expo Router and React Navigation routes.');
  return {
    schemaVersion: '1.0',
    snapshotId: checked.id,
    ...(checked.revision ? { commit: checked.revision } : {}),
    pages,
    actions,
    traces,
    apiRoutes: routes.length,
    gaps,
    coverage: {
      followed: actions.filter((action) => action.worstTier === 'resolved' || action.worstTier === 'conventional').length,
      heuristic: actions.filter((action) => action.worstTier === 'heuristic').length,
      gap: actions.filter((action) => action.worstTier === 'gap').length,
    },
    partial: partial || traces.some((trace) => trace.truncated),
    limitations: [...new Set(limitations)],
  };
}

function directive(statements: readonly ts.Statement[], text: string): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === text) return true;
  }
  return false;
}
