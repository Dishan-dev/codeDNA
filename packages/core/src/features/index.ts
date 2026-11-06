import ts from 'typescript';
import type { AnalysisDiagnostic, ConceptId, EntryKind, Feature, ImportEdge, PageRoute, Step } from '@codedna/shared';
import type { AnalysisProgram } from '../graph/program.js';
import { isFunctionNode, unwrap, type FunctionNode, type Resolver } from '../graph/resolve.js';
import { codeRef, lineOf, type ParsedFile } from '../snapshot/parse.js';
import { diagnostic } from '../snapshot/validate.js';
import { code, EVENT_ATTRIBUTES, hash, humanize, short, triggerCaption } from './captions.js';
import { nameFeatures } from './naming.js';
import { pagesByFile } from './pages.js';
import { isServerAction, TraceBuilder, type RouteHandler, type TraceContext, type TraceEnvironment } from './trace.js';

export interface FeatureOptions {
  maxFeatures?: number;
  maxSteps?: number;
  maxDepth?: number;
  deadline?: number;
  now?: () => number;
}
export interface FeatureDetection {
  features: Feature[];
  diagnostics: AnalysisDiagnostic[];
  partial: boolean;
}
interface Entry {
  kind: EntryKind;
  file: ParsedFile;
  /** The JSX element, or the function for server entries. */
  node: ts.Node;
  event: string;
  tag: string;
  handler?: ts.Expression;
  href?: string;
  component: string;
  label?: string;
  route?: RouteHandler;
  serverFn?: { fn: FunctionNode; name: string };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SKIPPED_FILE = /(?:^|\/)(?:__tests__|__mocks__)\/|\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;

/** The React component (a capitalised function) that contains a node. */
function componentOf(node: ts.Node): { name: string; fn: FunctionNode } | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name && /^[A-Z]/.test(current.name.text)) return { name: current.name.text, fn: current };
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name) && /^[A-Z]/.test(current.parent.name.text))
      return { name: current.parent.name.text, fn: current };
  }
  return undefined;
}
const componentName = (node: ts.Node) => componentOf(node)?.name ?? 'module';

const isJsx = (node: ts.Expression) => {
  const value = unwrap(node);
  return ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value) || ts.isJsxFragment(value);
};
/** Names used to decide what a component shows: `{error && <p/>}` and `{open ? <A/> : <B/>}`. */
function conditionalNames(component: FunctionNode | undefined): Set<string> {
  const names = new Set<string>();
  if (!component?.body) return names;
  const collect = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && isJsx(node.right)) collect(node.left);
    else if (ts.isConditionalExpression(node) && (isJsx(node.whenTrue) || isJsx(node.whenFalse))) collect(node.condition);
    ts.forEachChild(node, visit);
  };
  visit(component.body);
  return names;
}
/** Prop names a component receives: `({ productId })` or `props` itself. */
function propNames(component: FunctionNode | undefined): string[] {
  const parameter = component?.parameters[0];
  if (!parameter) return [];
  if (ts.isIdentifier(parameter.name)) return [parameter.name.text];
  if (ts.isObjectBindingPattern(parameter.name)) return parameter.name.elements.flatMap((element) => (ts.isIdentifier(element.name) ? [element.name.text] : []));
  return [];
}

/** JSX text keeps HTML entities as written: "Show all -&gt;" is shown as "Show all ->". */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', times: '×', hellip: '…', middot: '·' };
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
const jsxText = (node: ts.Node): string => {
  const parts: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isJsxText(child)) parts.push(decodeEntities(child.text));
    else if (ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression)) parts.push(child.expression.text);
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const attributeText = (element: ts.JsxOpeningLikeElement, name: string): string | undefined => {
  for (const property of element.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name || !property.initializer) continue;
    if (ts.isStringLiteral(property.initializer)) return property.initializer.text;
    if (ts.isJsxExpression(property.initializer) && property.initializer.expression && ts.isStringLiteral(property.initializer.expression)) return property.initializer.expression.text;
  }
  return undefined;
};

/** The words a learner sees on the control: button text, a submit button inside a form, or a label attribute. */
function labelOf(element: ts.JsxOpeningLikeElement, event: string): string | undefined {
  const full = ts.isJsxOpeningElement(element) ? element.parent : undefined;
  const tag = element.tagName.getText();
  if (full && (tag === 'form' || event === 'onSubmit')) {
    let found: string | undefined;
    const visit = (node: ts.Node) => {
      if (found) return;
      if (ts.isJsxElement(node) && /^(?:button|Button)$/.test(node.openingElement.tagName.getText())) {
        const type = attributeText(node.openingElement, 'type');
        if (!type || type === 'submit') found = jsxText(node) || undefined;
      }
      ts.forEachChild(node, visit);
    };
    visit(full);
    if (found) return found;
  }
  // An aria-label is the control's accessible name, so it wins over visible text.
  const aria = attributeText(element, 'aria-label');
  if (aria) return aria;
  if (full && tag !== 'form') {
    const text = jsxText(full);
    if (text) return text;
  }
  return attributeText(element, 'title') ?? attributeText(element, 'placeholder') ?? attributeText(element, 'name');
}

function exportedFunction(file: ParsedFile, name: string): FunctionNode | undefined {
  for (const statement of file.source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) return statement;
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
          const value = unwrap(declaration.initializer);
          if (isFunctionNode(value)) return value;
        }
  }
  return undefined;
}
const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** Route matching with Next.js segment rules; `${…}` in a URL template matches any segment. */
export function matchRoute(route: string, url: string): number {
  const routeParts = route.split('/').filter(Boolean);
  const urlParts = url.split(/[?#]/)[0]!.split('/').filter(Boolean);
  let score = 0;
  for (let index = 0; index < routeParts.length; index++) {
    const segment = routeParts[index]!;
    if (/^\[\[?\.\.\./.test(segment)) return urlParts.length >= index ? score : -1;
    const part = urlParts[index];
    if (part === undefined) return -1;
    if (/^\[.+\]$/.test(segment) || part.includes('${…}')) continue;
    if (part !== segment) return -1;
    score++;
  }
  return urlParts.length === routeParts.length ? score : -1;
}

function difficultyOf(steps: Step[], branches: number): 1 | 2 | 3 {
  const server = steps.some((step) => step.stage === 'server');
  const gaps = steps.filter((step) => step.confidence === 'gap').length;
  const score = steps.length + 2 * branches + (server ? 2 : 0) + gaps;
  return score <= 5 ? 1 : score <= 14 ? 2 : 3;
}

/**
 * Features: every way a user (or a request) starts something, followed through resolved calls.
 * Entry points are JSX event handlers, form actions, links, and server code nothing in the UI reaches.
 */
export function detectFeatures(
  input: { program: AnalysisProgram; resolver: Resolver; routes: readonly PageRoute[]; imports: readonly ImportEdge[] },
  options: FeatureOptions = {},
): FeatureDetection {
  const { program, resolver } = input;
  const { maxFeatures = 200, maxSteps = 60, maxDepth = 6, deadline, now = Date.now } = options;
  const diagnostics: AnalysisDiagnostic[] = [];
  const pages = pagesByFile(input.routes, input.imports);
  const byPath = new Map(program.files.map((file) => [file.path, file]));

  const handlers: RouteHandler[] = [];
  for (const route of input.routes) {
    if (route.kind !== 'route-handler') continue;
    const file = byPath.get(route.file);
    if (!file) continue;
    for (const method of route.methods ?? []) {
      const fn = exportedFunction(file, method);
      if (fn) handlers.push({ route: route.route, method, file, fn });
    }
  }
  const findRoute = (url: string, method: string) => {
    let best: RouteHandler | undefined;
    let bestScore = -1;
    for (const handler of handlers) {
      if (handler.method !== method) continue;
      const score = matchRoute(handler.route, url);
      if (score > bestScore) [best, bestScore] = [handler, score];
    }
    return best;
  };

  // 1. UI entry points from JSX attributes.
  const entries: Entry[] = [];
  for (const file of program.files) {
    if (SKIPPED_FILE.test(file.path) || !/x$/.test(file.language)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const name = node.name.getText();
        const element = node.parent.parent;
        const tag = element.tagName.getText();
        const expression = node.initializer.expression;
        const isAction = (name === 'action' && tag === 'form') || (name === 'formAction' && (tag === 'button' || tag === 'input'));
        if (EVENT_ATTRIBUTES.has(name) || isAction) {
          const value = unwrap(expression);
          // Forwarded props (`onClick={onClick}`) belong to the component that passes the real function.
          const forwarded = ts.isIdentifier(value) && resolver.originOf(value).kind === 'parameter';
          if (!forwarded)
            entries.push({ kind: isAction ? 'form-action' : 'event-handler', file, node: element, event: name, tag, handler: expression, component: componentName(node), ...withLabel(element, name) });
        } else if (name === 'href' && ts.isIdentifier(element.tagName)) {
          const origin = resolver.originOf(element.tagName);
          const href = ts.isStringLiteral(unwrap(expression)) ? (unwrap(expression) as ts.StringLiteral).text : undefined;
          if (origin.kind === 'external' && origin.module === 'next/link' && href)
            entries.push({ kind: 'link', file, node: element, event: 'onClick', tag, href, component: componentName(node), ...withLabel(element, 'onClick') });
        }
      } else if (ts.isJsxAttribute(node) && node.name.getText() === 'href' && node.initializer && ts.isStringLiteral(node.initializer)) {
        const element = node.parent.parent;
        if (ts.isIdentifier(element.tagName)) {
          const origin = resolver.originOf(element.tagName);
          if (origin.kind === 'external' && origin.module === 'next/link')
            entries.push({ kind: 'link', file, node: element, event: 'onClick', tag: element.tagName.text, href: node.initializer.text, component: componentName(node), ...withLabel(element, 'onClick') });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file.source);
  }
  function withLabel(element: ts.JsxOpeningLikeElement, event: string) {
    const label = labelOf(element, event);
    return label ? { label: short(label, 60) } : {};
  }

  const reached = new Set<ts.Node>();
  const env: TraceEnvironment = { program, resolver, findRoute, reached };
  const features: Feature[] = [];
  let partial = false;
  /** The function each feature runs, for naming it afterwards. */
  const handlerNames = new Map<string, string>();

  const build = (entry: Entry): Feature | undefined => {
    const start = entry.node.getStart(entry.file.source);
    const id = `feature:${entry.file.path}:${lineOf(entry.file.source, start)}:${entry.file.source.getLineAndCharacterOfPosition(start).character + 1}`;
    const trace = new TraceBuilder(env, id, { maxSteps, maxDepth });
    const root: TraceContext = { file: entry.file, side: entry.kind === 'route-handler' || entry.kind === 'server-action' ? 'server' : 'client', depth: 0, when: [], entry: false };
    let handlerName: string | undefined;
    let title: string;

    if (entry.kind === 'route-handler' || entry.kind === 'server-action') {
      const fn = entry.route?.fn ?? entry.serverFn!.fn;
      handlerName = entry.route ? `${entry.route.method} ${entry.route.route}` : entry.serverFn!.name;
      title = entry.route ? `${entry.route.method} ${entry.route.route}` : humanize(entry.serverFn!.name);
      const startStep = trace.addStep(root, fn, {
        title: entry.route ? `A ${entry.route.method} request arrives at ${entry.route.route}` : `The server runs ${handlerName}`,
        stage: 'server',
        plain: entry.route
          ? `Something sends a ${entry.route.method} request to ${code(entry.route.route)}, and ${code(entry.file.path)} answers it.`
          : `The server function ${code(handlerName)} runs. Nothing in the app’s screens calls it directly, as far as CodeDNA can see.`,
        confidence: 'conventional',
        concepts: ['server-action'],
        context: 0,
        maxLines: 3,
      });
      trace.walkFunction(fn, { ...root, depth: 1, entry: true, ...(startStep ? { parentId: startStep.id } : {}) }, handlerName);
    } else {
      const element = entry.node as ts.JsxOpeningLikeElement;
      const component = componentOf(element);
      trace.renderNames = conditionalNames(component?.fn);
      const caption = triggerCaption(entry.event, entry.tag, entry.label);
      // The handler uses a prop when its code mentions one, e.g. toggleFavorite(productId).
      const handlerText = entry.handler ? (isFunctionNode(unwrap(entry.handler)) ? entry.handler.getText(entry.file.source) : (resolver.functionOf(entry.handler)?.fn.getText() ?? '')) : '';
      const usesProps = propNames(component?.fn).some((name) => new RegExp(`\\b${name}\\b`).test(handlerText));
      const triggerConcepts: ConceptId[] = entry.kind === 'link' ? ['component'] : ['component', 'event-handler', ...(usesProps ? (['props'] as const) : [])];
      const trigger = trace.addStep(root, element, { title: caption.title, stage: entry.kind === 'form-action' || entry.event === 'onSubmit' ? 'form' : 'click', plain: caption.plain, confidence: 'conventional', concepts: triggerConcepts, context: 0, maxLines: 4 });
      const ctx: TraceContext = { ...root, depth: 1, ...(trigger ? { parentId: trigger.id } : {}) };
      if (entry.kind === 'link') {
        handlerName = entry.href!;
        title = entry.label ? `Open “${entry.label}”` : `Go to ${entry.href}`;
        trace.addStep(ctx, element, { title: `Opens ${entry.href}`, stage: 'screen', plain: `Next.js shows the ${code(entry.href!)} page without a full reload.`, confidence: 'conventional', effect: { kind: 'navigation', label: `opens ${entry.href}` }, concepts: ['navigation'], context: 0, maxLines: 4 });
      } else {
        const handler = unwrap(entry.handler!);
        const binding = ts.isIdentifier(handler) ? actionStateTarget(handler) : undefined;
        if (isFunctionNode(handler)) {
          handlerName = 'inline';
          // An inline 'use server' function in a form still runs on the server.
          if (isServerAction(handler, entry.file)) trace.callFunction(handler, 'inline', ctx, element);
          else trace.walkFunction(handler, ctx);
        } else if (binding) {
          handlerName = binding.name;
          const before = trace.steps.length;
          trace.callFunction(binding.fn, binding.name, ctx, element);
          // What the action returns becomes `state`; if the form shows it conditionally, that is the lesson.
          if (binding.state && trace.renderNames.has(binding.state))
            for (const step of trace.steps.slice(before)) if (step.stage === 'response' && step.when && /^(?:Sends back|Stops early)/.test(step.title)) step.concepts = [...new Set([...step.concepts, 'conditional-rendering' as const])];
        } else {
          const found = resolver.functionOf(handler);
          if (found) {
            handlerName = found.name;
            trace.callFunction(found.fn, found.name, ctx, element);
          } else {
            // A setter passed directly, e.g. onChange={setQuery}, or something CodeDNA can't follow.
            const setter = ts.isIdentifier(handler) ? resolver.stateSetterOf(handler) : undefined;
            if (setter) {
              handlerName = handler.getText(entry.file.source);
              trace.addStep(ctx, element, {
                title: `Updates ${setter.state} on the screen`,
                stage: 'screen',
                plain: `Changes ${code(setter.state)}, so React redraws the parts of the screen that show it.`,
                confidence: 'conventional',
                effect: { kind: 'local-state', label: `updates ${setter.state}` },
                concepts: ['state', ...(trace.renderNames.has(setter.state) ? (['conditional-rendering'] as const) : [])],
              });
            } else {
              handlerName = handler.getText(entry.file.source);
              trace.gap(ctx, element, 'Runs code CodeDNA can’t follow', `The code that runs here comes from ${code(handlerName)}, which is only known while the app runs.`);
            }
          }
        }
        const named = handlerName && handlerName !== 'inline' && !/[^\w$]/.test(handlerName) ? humanize(handlerName) : undefined;
        const typing = entry.event === 'onChange' || entry.event === 'onInput';
        if (entry.label && entry.label.length <= 40) title = typing ? `Type in “${entry.label}”` : entry.label;
        else title = named ?? caption.title.replace(/^You /, '').replace(/^./, (letter) => letter.toUpperCase());
      }
    }

    // Fill each branch outcome with the first step taken on that path.
    for (const branch of trace.branches)
      for (const outcome of branch.outcomes) {
        const next = trace.steps.find((step) => step.when?.some((item) => item.outcomeId === outcome.id));
        if (next) outcome.nextStepId = next.id;
      }
    if (handlerName && handlerName !== 'inline') handlerNames.set(id, handlerName);
    const handlerKey = handlerName === 'inline' ? `inline:${entry.label ?? entry.event}` : handlerName;
    const key = `${entry.kind}:${entry.file.path}:${entry.component}:${handlerKey ?? entry.label ?? entry.event}`;
    const contentHash = hash(trace.steps.map((step) => `${step.stage}|${step.title}|${step.code.excerpt?.split('\n')[step.code.highlightLine - step.code.startLine]?.trim() ?? ''}`).join('\n'));
    const page = pages.get(entry.file.path)?.[0] ?? (entry.route ? entry.route.route : undefined);
    return {
      id,
      key,
      contentHash,
      title,
      ...(page ? { page } : {}),
      entry: codeRef(entry.file.source, entry.node, { context: 0, maxLines: 4 }),
      entryKind: entry.kind,
      steps: trace.steps,
      branches: trace.branches,
      effects: trace.effects,
      difficulty: difficultyOf(trace.steps, trace.branches.length),
      partial: trace.truncated,
    };
  };

  /** `const [state, formAction] = useActionState(placeOrder, …)` → placeOrder. */
  function actionStateTarget(identifier: ts.Identifier): { fn: FunctionNode; name: string; state?: string } | undefined {
    const origin = resolver.originOf(identifier);
    if (origin.kind !== 'declaration' || !ts.isBindingElement(origin.declaration) || !ts.isArrayBindingPattern(origin.declaration.parent)) return undefined;
    const pattern = origin.declaration.parent;
    if (pattern.elements.indexOf(origin.declaration) !== 1 || !ts.isVariableDeclaration(pattern.parent) || !pattern.parent.initializer) return undefined;
    const init = unwrap(pattern.parent.initializer);
    if (!ts.isCallExpression(init) || !/^(?:useActionState|useFormState)$/.test(init.expression.getText()) || !init.arguments[0]) return undefined;
    const found = resolver.functionOf(init.arguments[0]);
    const first = pattern.elements[0];
    const state = first && ts.isBindingElement(first) && ts.isIdentifier(first.name) ? first.name.text : undefined;
    return found && { fn: found.fn, name: found.name === 'inline' ? init.arguments[0].getText() : found.name, ...(state ? { state } : {}) };
  }

  const ordered = entries.sort((a, b) => compare(a.file.path, b.file.path) || a.node.getStart() - b.node.getStart());
  const add = (entry: Entry) => {
    if (features.length >= maxFeatures) {
      if (!partial) diagnostics.push(diagnostic('feature-limit', 'warning', `This app has more than ${maxFeatures} features; only the first ${maxFeatures} were read.`));
      partial = true;
      return false;
    }
    if (deadline !== undefined && now() > deadline) {
      if (!partial) diagnostics.push(diagnostic('feature-time-limit', 'warning', 'Following features took too long; some were left out.'));
      partial = true;
      return false;
    }
    const feature = build(entry);
    if (feature) features.push(feature);
    return true;
  };
  for (const entry of ordered) if (!add(entry)) break;

  // 2. Server code that no screen reaches: API routes and exported server actions.
  if (!partial) {
    for (const handler of handlers)
      if (!reached.has(handler.fn) && !add({ kind: 'route-handler', file: handler.file, node: handler.fn, event: 'request', tag: '', component: 'module', route: handler })) break;
    for (const file of program.files) {
      if (partial) break;
      if (SKIPPED_FILE.test(file.path)) continue;
      const first = file.source.statements[0];
      if (!first || !ts.isExpressionStatement(first) || !ts.isStringLiteral(first.expression) || first.expression.text !== 'use server') continue;
      for (const statement of file.source.statements) {
        const names = ts.isFunctionDeclaration(statement) && statement.name && isExported(statement) ? [statement.name.text] : ts.isVariableStatement(statement) && isExported(statement) ? statement.declarationList.declarations.flatMap((item) => (ts.isIdentifier(item.name) ? [item.name.text] : [])) : [];
        for (const name of names) {
          const fn = exportedFunction(file, name);
          if (fn && !reached.has(fn)) add({ kind: 'server-action', file, node: fn, event: 'call', tag: '', component: 'module', serverFn: { fn, name } });
        }
      }
    }
  }

  nameFeatures(features, handlerNames);
  return { features, diagnostics, partial };
}
