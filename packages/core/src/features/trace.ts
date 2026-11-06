import ts from 'typescript';
import type { Branch, ConceptId, Confidence, Effect, EffectKind, Step, StepStage } from '@codedna/shared';
import { classifyCall, type EffectMatch } from '../adapters/effects/index.js';
import type { AnalysisProgram } from '../graph/program.js';
import { isFunctionNode, unwrap, type Callee, type FunctionNode, type Resolver } from '../graph/resolve.js';
import { codeRef, lineOf, type ParsedFile } from '../snapshot/parse.js';
import { code, short } from './captions.js';

export type Side = 'client' | 'server';
type When = { branchId: string; outcomeId: string };
export interface TraceContext {
  file: ParsedFile;
  side: Side;
  depth: number;
  parentId?: string;
  when: When[];
  /** True inside a server action or route handler body, where `return` sends the answer. */
  entry: boolean;
  /** True inside an `if`/`try` branch of the current function, where a `return` stops early. */
  inBranch?: boolean;
  /** Name of the function being walked, for captions. */
  fnName?: string;
}
export interface RouteHandler {
  route: string;
  method: string;
  file: ParsedFile;
  fn: FunctionNode;
}
export interface TraceEnvironment {
  program: AnalysisProgram;
  resolver: Resolver;
  findRoute: (url: string, method: string) => RouteHandler | undefined;
  /** Functions reached by any feature, so unreached server code can become its own feature. */
  reached: Set<ts.Node>;
}
export interface TraceLimits {
  maxSteps: number;
  maxDepth: number;
}
interface StepInput {
  title: string;
  stage: StepStage;
  plain: string;
  confidence: Confidence;
  unknownReason?: string;
  effect?: { kind: EffectKind; label: string };
  concepts?: ConceptId[];
  /** Lines of context and maximum excerpt length for the code panel. */
  context?: number;
  maxLines?: number;
}

const EFFECT_CONCEPTS: Partial<Record<EffectKind, ConceptId>> = {
  'db-read': 'database',
  'db-write': 'database',
  'api-call': 'api-call',
  redirect: 'navigation',
  navigation: 'navigation',
  validation: 'validation',
  'local-state': 'state',
};
const AUTH_WORDS = /session|auth|user|signed|logged|token|login/i;
const VALIDATION_WORDS = /\.success\b|valid|\berrors?\b/i;
/** True when a call's result is awaited, e.g. `await prisma.order.create()`. */
const awaited = (node: ts.Node) => {
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return !!parent && ts.isAwaitExpression(parent);
};


export function isServerAction(fn: FunctionNode, file: ParsedFile | undefined): boolean {
  const body = fn.body;
  const first = body && ts.isBlock(body) ? body.statements[0] : undefined;
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use server') return true;
  if (!file) return false;
  const directive = file.source.statements[0];
  return !!directive && ts.isExpressionStatement(directive) && ts.isStringLiteral(directive.expression) && directive.expression.text === 'use server';
}

/** Builds the ordered steps of one feature. Bounded by step count and call depth. */
export class TraceBuilder {
  readonly steps: Step[] = [];
  readonly branches: Branch[] = [];
  readonly effects: Effect[] = [];
  truncated = false;
  /** Names the entry component shows conditionally, e.g. `error` in `{error && <p/>}`. */
  renderNames = new Set<string>();
  private readonly ids = new Set<string>();
  private readonly active = new Set<FunctionNode>();

  constructor(
    private readonly env: TraceEnvironment,
    private readonly featureId: string,
    private readonly limits: TraceLimits,
  ) {}

  addStep(ctx: TraceContext, node: ts.Node, input: StepInput): Step | undefined {
    if (this.steps.length >= this.limits.maxSteps) {
      this.truncated = true;
      return undefined;
    }
    const start = node.getStart(ctx.file.source);
    const base = `${this.featureId}#${ctx.file.path}:${lineOf(ctx.file.source, start)}:${ctx.file.source.getLineAndCharacterOfPosition(start).character + 1}:${input.stage}`;
    let id = base;
    for (let index = 2; this.ids.has(id); index++) id = `${base}:${index}`;
    this.ids.add(id);
    const step: Step = {
      id,
      title: input.title,
      stage: input.stage,
      plain: input.plain,
      code: codeRef(ctx.file.source, node, { context: input.context ?? 1, maxLines: input.maxLines ?? 10 }),
      concepts: input.confidence === 'gap' ? [] : [...new Set([...(input.concepts ?? []), ...(awaited(node) ? (['async-await'] as const) : [])])],
      confidence: input.confidence,
      ...(input.unknownReason ? { unknownReason: input.unknownReason } : {}),
      ...(ctx.parentId ? { parentId: ctx.parentId } : {}),
      depth: ctx.depth,
      ...(ctx.when.length ? { when: [...ctx.when] } : {}),
    };
    this.steps.push(step);
    if (input.effect) this.effects.push({ kind: input.effect.kind, label: input.effect.label, stepId: id, confidence: input.confidence });
    return step;
  }

  gap(ctx: TraceContext, node: ts.Node, title: string, reason: string): Step | undefined {
    return this.addStep(ctx, node, { title, stage: ctx.side === 'server' ? 'server' : 'client', plain: reason, confidence: 'gap', unknownReason: reason });
  }

  private child(ctx: TraceContext, step: Step | undefined, patch: Partial<TraceContext> = {}): TraceContext {
    return { ...ctx, depth: ctx.depth + 1, ...(step ? { parentId: step.id } : {}), ...patch };
  }

  /** Walk a function's body as part of the current flow. */
  walkFunction(fn: FunctionNode, ctx: TraceContext, name?: string): void {
    if (!fn.body) return;
    if (ctx.depth > this.limits.maxDepth) {
      this.truncated = true;
      return;
    }
    if (this.active.has(fn)) return;
    this.active.add(fn);
    this.env.reached.add(fn);
    const inner: TraceContext = { ...ctx, inBranch: false, ...(name ? { fnName: name } : {}) };
    if (ts.isBlock(fn.body)) this.walkStatements(fn.body.statements, inner);
    else this.walkNode(fn.body, inner);
    this.active.delete(fn);
  }

  /** A call into repository code: crossing to the server when a client calls a server action. */
  callFunction(fn: FunctionNode, name: string, ctx: TraceContext, at: ts.Node, confidence: Confidence = 'resolved'): void {
    const server = isServerAction(fn, this.env.program.fileOf(fn));
    const target = this.env.program.fileOf(fn) ?? ctx.file;
    if (server && ctx.side === 'client') {
      const request = this.addStep(ctx, at, {
        title: 'Sends the data to the server',
        stage: 'request',
        plain: `Calls ${name === 'inline' ? 'the server action written inside the form' : `the server function ${code(name)}`}. Next.js sends the data over the network for you.`,
        confidence: 'conventional',
        concepts: ['server-action'],
      });
      const serverCtx = this.child(ctx, request, { file: target, side: 'server', entry: true });
      const start = this.addStep(serverCtx, fn, {
        title: name === 'inline' ? 'The server runs the form’s action' : `The server runs ${name}`,
        stage: 'server',
        plain: `On the server, ${name === 'inline' ? 'the form’s action' : code(name)} starts. Code here can safely use the database and secret keys.`,
        confidence: 'resolved',
        concepts: ['server-action'],
        context: 0,
        maxLines: 3,
      });
      this.walkFunction(fn, this.child(serverCtx, start, { depth: serverCtx.depth }), name);
      return;
    }
    const step = this.addStep(ctx, at, {
      title: `Runs ${name}`,
      stage: ctx.side === 'server' ? 'logic' : 'client',
      plain: `Runs ${code(name)}${target.path !== ctx.file.path ? ` from ${code(target.path)}` : ''} to do part of the work.${confidence === 'heuristic' ? ' CodeDNA is fairly sure this is the right function, but the value it is called on is worked out while the app runs.' : ''}`,
      confidence,
      ...(AUTH_WORDS.test(name) ? { concepts: ['authentication' as const] } : {}),
    });
    this.walkFunction(fn, this.child(ctx, step, { file: target, entry: false }), name);
  }

  /** Returns true when the statements always stop the function (return, throw, redirect). */
  walkStatements(statements: readonly ts.Statement[], ctx: TraceContext): boolean {
    let current = ctx;
    for (const statement of statements) {
      const result = this.walkStatement(statement, current);
      if (result === true) return true;
      if (result) current = { ...current, when: [...current.when, result] };
    }
    return false;
  }

  /** `true` when the statement always exits; a `When` when only one branch continues. */
  private walkStatement(statement: ts.Statement, ctx: TraceContext): boolean | When | undefined {
    if (ts.isBlock(statement)) return this.walkStatements(statement.statements, ctx);
    if (ts.isIfStatement(statement)) return this.walkIf(statement, ctx);
    if (ts.isTryStatement(statement)) return this.walkTry(statement, ctx);
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) {
      const expression = statement.expression;
      if (expression && this.walkNode(expression, ctx)) return true;
      if (ts.isThrowStatement(statement))
        this.addStep(ctx, statement, { title: 'Stops with an error', stage: 'response', plain: `Stops and throws an error: ${code(expression?.getText(ctx.file.source) ?? 'error')}.`, confidence: 'resolved' });
      else if (expression && ctx.entry && ctx.side === 'server')
        this.addStep(ctx, statement, { title: 'Sends back an answer', stage: 'response', plain: `Sends ${code(expression.getText(ctx.file.source))} back as the answer.`, confidence: 'resolved' });
      else if (ctx.inBranch) {
        const value = expression?.getText(ctx.file.source);
        const where = ctx.fnName && ctx.fnName !== 'inline' ? code(ctx.fnName) : 'this function';
        this.addStep(ctx, statement, {
          title: value ? `Stops early and gives back ${short(value, 30)}` : 'Stops early',
          stage: ctx.entry ? 'response' : ctx.side === 'server' ? 'logic' : 'client',
          plain: value ? `Stops ${where} here and gives back ${code(value)} to the code that called it.` : `Stops ${where} here. Nothing below this line runs.`,
          confidence: 'resolved',
        });
      }
      return true;
    }
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return undefined;
    return this.walkNode(statement, ctx) || undefined;
  }

  private branch(ctx: TraceContext, node: ts.Node, condition: string, title: string, plain: string, labels: [string, string]) {
    const concepts: ConceptId[] = [...(AUTH_WORDS.test(condition) ? (['authentication'] as const) : []), ...(VALIDATION_WORDS.test(condition) ? (['validation'] as const) : [])];
    // Two lines of context above, so a spot-the-bug challenge shows what the check protects.
    const step = this.addStep(ctx, node, { title, stage: 'check', plain, confidence: 'resolved', concepts, context: 2, maxLines: 10 });
    if (!step) return undefined;
    const id = `${step.id}/branch`;
    const branch: Branch = { id, stepId: step.id, condition, outcomes: [{ id: `${id}:yes`, label: labels[0] }, { id: `${id}:no`, label: labels[1] }] };
    this.branches.push(branch);
    return { step, branch, yes: { branchId: id, outcomeId: `${id}:yes` }, no: { branchId: id, outcomeId: `${id}:no` } };
  }

  private walkIf(statement: ts.IfStatement, ctx: TraceContext): boolean | When | undefined {
    const condition = statement.expression.getText(ctx.file.source);
    this.walkNode(statement.expression, ctx);
    const made = this.branch(ctx, statement, `if (${short(condition, 80)})`, `Checks ${short(condition, 40)}`, `Asks a yes/no question: ${code(condition)}. What happens next depends on the answer.`, ['Yes', 'No']);
    if (!made) return undefined;
    const whenYes = { ...ctx, inBranch: true, when: [...ctx.when, made.yes] };
    const whenNo = { ...ctx, inBranch: true, when: [...ctx.when, made.no] };
    const thenExits = this.walkStatements(ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement], whenYes);
    const elseExits = statement.elseStatement ? this.walkStatements(ts.isBlock(statement.elseStatement) ? statement.elseStatement.statements : [statement.elseStatement], whenNo) : false;
    if (thenExits && elseExits) return true;
    if (thenExits) return made.no;
    if (elseExits) return made.yes;
    return undefined;
  }

  private walkTry(statement: ts.TryStatement, ctx: TraceContext): boolean | undefined {
    const made = this.branch(ctx, statement.tryBlock, 'try { … } catch', 'Tries the next steps, ready for errors', 'Runs the next steps. If anything fails, it jumps to the `catch` part instead of crashing.', ['It works', 'Something fails']);
    if (!made) return undefined;
    const tryExits = this.walkStatements(statement.tryBlock.statements, { ...ctx, inBranch: true, when: [...ctx.when, made.yes] });
    const catchExits = statement.catchClause ? this.walkStatements(statement.catchClause.block.statements, { ...ctx, inBranch: true, when: [...ctx.when, made.no] }) : false;
    const finallyExits = statement.finallyBlock ? this.walkStatements(statement.finallyBlock.statements, ctx) : false;
    return finallyExits || (tryExits && catchExits) || undefined;
  }

  /** Visit an expression in evaluation order. Returns true when it always exits (e.g. redirect). */
  walkNode(node: ts.Node, ctx: TraceContext): boolean {
    if (isFunctionNode(node)) return false;
    if (ts.isCallExpression(node)) {
      const callee = this.env.resolver.resolveCall(node);
      const match = classifyCall(callee, node);
      // In `db.insert(t).values()` the whole chain is one effect, so inner calls are not steps.
      this.walkCallee(node.expression, ctx, !match);
      const callbacks: FunctionNode[] = [];
      for (const argument of node.arguments) {
        const value = unwrap(argument);
        if (isFunctionNode(value)) callbacks.push(value);
        else this.walkNode(argument, ctx);
      }
      const exits = this.handleCall(node, callee, match, ctx);
      // Callbacks such as `startTransition(() => …)` run as part of the call.
      for (const callback of callbacks) this.walkFunction(callback, ctx);
      return exits;
    }
    let exits = false;
    ts.forEachChild(node, (child) => {
      if (this.walkNode(child, ctx)) exits = true;
    });
    return exits;
  }

  private effectStep(ctx: TraceContext, call: ts.CallExpression, match: EffectMatch): Step | undefined {
    return this.addStep(ctx, call, {
      title: match.title,
      stage: match.stage,
      plain: match.plain,
      confidence: match.confidence,
      ...(match.unknownReason ? { unknownReason: match.unknownReason } : {}),
      ...(match.effect ? { effect: { kind: match.effect, label: match.label } } : {}),
      concepts: [
        ...(match.effect && EFFECT_CONCEPTS[match.effect] ? [EFFECT_CONCEPTS[match.effect]!] : []),
        ...(match.auth ? (['authentication'] as const) : []),
        ...(match.state && this.renderNames.has(match.state) ? (['conditional-rendering'] as const) : []),
      ],
    });
  }

  private walkCallee(expression: ts.Expression, ctx: TraceContext, handleInner: boolean): void {
    const value = unwrap(expression);
    if (ts.isPropertyAccessExpression(value)) this.walkCallee(value.expression, ctx, handleInner);
    else if (ts.isCallExpression(value) && !handleInner) {
      this.walkCallee(value.expression, ctx, false);
      for (const argument of value.arguments) this.walkNode(argument, ctx);
    } else this.walkNode(value, ctx);
  }

  private handleCall(call: ts.CallExpression, callee: Callee, match: EffectMatch | undefined, ctx: TraceContext): boolean {
    if (match) {
      const step = this.effectStep(ctx, call, match);
      if (step && match.request?.url && !/^https?:/.test(match.request.url)) this.followRequest(match.request.url, match.request.method, ctx, step, call);
      return !!match.exits;
    }
    switch (callee.kind) {
      case 'function':
        this.callFunction(callee.fn, callee.name, ctx, call, callee.confidence);
        break;
      case 'multiple': {
        const list = callee.targets.map((target) => code(`${target.name} (${this.env.program.fileOf(target.fn)?.path ?? '?'})`)).join(', ');
        this.gap(ctx, call, `Runs one of ${callee.targets.length} versions`, `There are ${callee.targets.length} possible versions here: ${list}. Which one runs is decided while the app runs.`);
        break;
      }
      case 'missing':
        this.gap(ctx, call, `Runs ${callee.name} from a missing file`, `${code(callee.name)} comes from ${code(callee.module)}, which isn’t in this project, so CodeDNA can’t show what it does.`);
        break;
      case 'dynamic-import':
        this.gap(ctx, call, 'Loads more code while the app runs', `This code is loaded only when it is needed, using \`import()\`${callee.specifier ? ` (it loads ${code(callee.specifier)})` : ''}. CodeDNA doesn’t follow code loaded this way.`);
        break;
      case 'element-access': {
        const env = /process\.env\.(\w+)/.exec(this.envText(callee.index))?.[1];
        const options = this.objectKeys(callee.object);
        const could = options.length ? ` It could be ${options.map((option) => code(option)).join(' or ')}.` : '';
        this.gap(
          ctx,
          call,
          'Picks a function while the app runs',
          env
            ? `Which function runs here is picked by the setting ${code(env)}, so it can differ between your computer and the live app.${could}`
            : `Which function runs here is picked from ${code(callee.object.getText(ctx.file.source))} while the app runs.${could}`,
        );
        break;
      }
      case 'parameter':
        this.gap(ctx, call, `Runs ${callee.name}, passed in from outside`, `${code(callee.name)} is passed in from outside (for example as a prop), so which code runs depends on who uses this.`);
        break;
      default:
        break;
    }
    return false;
  }

  /** Text of an index expression, including the initializer of a variable it names. */
  private envText(index: ts.Expression): string {
    const value = unwrap(index);
    if (ts.isIdentifier(value)) {
      const origin = this.env.resolver.originOf(value);
      if (origin.kind === 'declaration' && ts.isVariableDeclaration(origin.declaration) && origin.declaration.initializer) return origin.declaration.initializer.getText();
    }
    return value.getText();
  }

  private objectKeys(object: ts.Expression): string[] {
    const value = unwrap(object);
    if (!ts.isIdentifier(value)) return [];
    const origin = this.env.resolver.originOf(value);
    if (origin.kind !== 'declaration' || !ts.isVariableDeclaration(origin.declaration) || !origin.declaration.initializer) return [];
    const literal = unwrap(origin.declaration.initializer);
    if (!ts.isObjectLiteralExpression(literal)) return [];
    return literal.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
      if (ts.isPropertyAssignment(property)) return [ts.isIdentifier(property.initializer) ? property.initializer.text : property.name.getText()];
      return [];
    });
  }

  private followRequest(url: string, method: string, ctx: TraceContext, step: Step, call: ts.CallExpression): void {
    const handler = this.env.findRoute(url, method);
    if (!handler) {
      this.gap(this.child(ctx, step), call, `Can’t find the code for ${url}`, `CodeDNA can’t find the code that answers ${method} ${code(url)} in this project.`);
      return;
    }
    const serverCtx = this.child(ctx, step, { file: handler.file, side: 'server', entry: true });
    const start = this.addStep(serverCtx, handler.fn, {
      title: `The server answers ${method} ${handler.route}`,
      stage: 'server',
      plain: `The request arrives at ${code(handler.file.path)}, where the ${method} function answers it.`,
      confidence: 'conventional',
      concepts: ['server-action'],
      context: 0,
      maxLines: 3,
    });
    this.walkFunction(handler.fn, this.child(serverCtx, start, { depth: serverCtx.depth }), `${method} ${handler.route}`);
  }
}

