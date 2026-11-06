import ts from 'typescript';
import type { AnalysisProgram } from './program.js';

/** Where a value comes from, as far as static analysis can tell. */
export type Origin =
  /** Imported from a package that is not in the snapshot, e.g. `redirect` from `next/navigation`. */
  | { kind: 'external'; module: string; name: string }
  /** Declared in the repository. */
  | { kind: 'declaration'; declaration: ts.Declaration }
  /** No declaration anywhere: a platform global such as `fetch`, `console` or `Response`. */
  | { kind: 'global'; name: string }
  /** A function parameter or a prop, so its value is decided by the caller. */
  | { kind: 'parameter'; declaration: ts.Declaration }
  | { kind: 'unknown' };

export type FunctionNode = ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction;

export type Callee =
  /**
   * `heuristic` when the receiver is computed (`pick().charge()`): TypeScript merges object types
   * of the same shape, so one declaration may stand for several possible implementations.
   */
  | { kind: 'function'; fn: FunctionNode; name: string; confidence: 'resolved' | 'heuristic' }
  | { kind: 'multiple'; targets: { fn: FunctionNode; name: string }[] }
  /** A call on something from a package or a global, with the property chain after the root. */
  | { kind: 'external'; module: string; name: string; chain: string[]; calls: ts.CallExpression[] }
  | { kind: 'global'; name: string; chain: string[]; calls: ts.CallExpression[] }
  /** A call on a repository value whose own origin is known (e.g. `prisma.order.create`). */
  | { kind: 'value'; root: string; declaration: ts.Declaration; init: Origin | undefined; chain: string[]; calls: ts.CallExpression[] }
  /** A `useState`/`useReducer` setter. */
  | { kind: 'state-setter'; state: string; hook: string }
  /** Imported from a repository file that is not in the snapshot (a relative path or an alias). */
  | { kind: 'missing'; module: string; name: string }
  | { kind: 'dynamic-import'; specifier?: string }
  | { kind: 'element-access'; object: ts.Expression; index: ts.Expression }
  | { kind: 'parameter'; name: string }
  | { kind: 'unresolved' };

export const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression;
  return current;
};

export const isFunctionNode = (node: ts.Node | undefined): node is FunctionNode =>
  !!node && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));

const moduleOf = (declaration: ts.Declaration): string | undefined => {
  let node: ts.Node | undefined = declaration;
  while (node && !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node) && !ts.isImportEqualsDeclaration(node)) node = node.parent;
  if (!node) return undefined;
  const specifier = ts.isImportEqualsDeclaration(node)
    ? ts.isExternalModuleReference(node.moduleReference)
      ? node.moduleReference.expression
      : undefined
    : node.moduleSpecifier;
  return specifier && ts.isStringLiteral(specifier) ? specifier.text : undefined;
};
const importedName = (declaration: ts.Declaration): string => {
  if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
  if (ts.isImportClause(declaration)) return 'default';
  return '*';
};
const isAlias = (declaration: ts.Declaration) =>
  ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportEqualsDeclaration(declaration) || ts.isExportSpecifier(declaration);

export interface Resolver {
  originOf: (identifier: ts.Identifier) => Origin;
  resolveCall: (call: ts.CallExpression) => Callee;
  /** The function a handler expression refers to, following variables and aliases. */
  functionOf: (expression: ts.Expression) => { fn: FunctionNode; name: string } | undefined;
  /** The state a `useState`/`useReducer` setter identifier changes. */
  stateSetterOf: (identifier: ts.Identifier) => { state: string; hook: string } | undefined;
}

export interface ResolverOptions {
  /** True when a specifier names repository code (relative or a tsconfig alias), not a package. */
  isLocalModule?: (specifier: string, fromPath: string) => boolean;
}

export function createResolver({ checker, fileOf }: AnalysisProgram, options: ResolverOptions = {}): Resolver {
  const isLocalModule = options.isLocalModule ?? ((specifier: string) => specifier.startsWith('.') || specifier.startsWith('/'));
  const inRepo = (node: ts.Node) => !!fileOf(node);

  /** Follow import/re-export aliases one hop at a time, so a chain ending in a package is still named. */
  function originOfSymbol(symbol: ts.Symbol | undefined, name: string): Origin {
    let current = symbol;
    for (let hops = 0; current && hops < 12; hops++) {
      const declaration = current.declarations?.[0];
      if (!declaration) return { kind: 'global', name };
      if (!isAlias(declaration)) {
        if (!inRepo(declaration)) return { kind: 'global', name };
        if (ts.isParameter(declaration) || (ts.isBindingElement(declaration) && isParameterBinding(declaration))) return { kind: 'parameter', declaration };
        return { kind: 'declaration', declaration };
      }
      let next: ts.Symbol | undefined;
      try {
        next = checker.getImmediateAliasedSymbol(current);
      } catch {
        next = undefined;
      }
      if (!next || !next.declarations?.length) {
        const module = moduleOf(declaration);
        return module ? { kind: 'external', module, name: importedName(declaration) } : { kind: 'unknown' };
      }
      current = next;
    }
    return { kind: 'unknown' };
  }
  const isParameterBinding = (node: ts.BindingElement) => {
    let current: ts.Node = node;
    while (ts.isBindingElement(current) || ts.isObjectBindingPattern(current) || ts.isArrayBindingPattern(current)) current = current.parent;
    return ts.isParameter(current);
  };

  function originOf(identifier: ts.Identifier): Origin {
    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(identifier);
    } catch {
      return { kind: 'unknown' };
    }
    if (symbol && ts.isShorthandPropertyAssignment(identifier.parent)) symbol = checker.getShorthandAssignmentValueSymbol(identifier.parent) ?? symbol;
    if (!symbol) return { kind: 'global', name: identifier.text };
    return originOfSymbol(symbol, identifier.text);
  }

  /** The function a declaration holds, following `const f = g` and shorthand properties. */
  function functionOfDeclaration(declaration: ts.Declaration, depth = 0): { fn: FunctionNode; name: string } | undefined {
    if (depth > 4) return undefined;
    const name = ts.getNameOfDeclaration(declaration)?.getText() ?? 'function';
    if (isFunctionNode(declaration)) return declaration.body ? { fn: declaration, name } : undefined;
    if ((ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
      const value = unwrap(declaration.initializer);
      if (isFunctionNode(value)) return { fn: value, name };
      if (ts.isIdentifier(value)) {
        const origin = originOf(value);
        return origin.kind === 'declaration' ? functionOfDeclaration(origin.declaration, depth + 1) : undefined;
      }
      // `const save = lib.save`
      if (ts.isPropertyAccessExpression(value)) {
        let symbol: ts.Symbol | undefined;
        try {
          symbol = checker.getSymbolAtLocation(value.name);
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        } catch {
          return undefined;
        }
        const target = symbol?.declarations?.find((item) => inRepo(item));
        return target ? functionOfDeclaration(target, depth + 1) : undefined;
      }
    }
    if (ts.isShorthandPropertyAssignment(declaration)) {
      const origin = originOf(declaration.name);
      return origin.kind === 'declaration' ? functionOfDeclaration(origin.declaration, depth + 1) : undefined;
    }
    return undefined;
  }

  function functionOf(expression: ts.Expression): { fn: FunctionNode; name: string } | undefined {
    const value = unwrap(expression);
    if (isFunctionNode(value)) return { fn: value, name: 'inline' };
    const target = ts.isPropertyAccessExpression(value) ? value.name : ts.isIdentifier(value) ? value : undefined;
    if (!target) return undefined;
    if (ts.isIdentifier(target)) {
      const origin = originOf(target);
      if (origin.kind === 'declaration') return functionOfDeclaration(origin.declaration);
    }
    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(target);
    } catch {
      return undefined;
    }
    const declaration = symbol?.declarations?.find((item) => inRepo(item));
    return declaration ? functionOfDeclaration(declaration) : undefined;
  }

  /** `useState` / `useReducer` setters from `const [x, setX] = useState()`. */
  function stateSetter(declaration: ts.Declaration): { state: string; hook: string } | undefined {
    if (!ts.isBindingElement(declaration) || !ts.isArrayBindingPattern(declaration.parent)) return undefined;
    const pattern = declaration.parent;
    if (pattern.elements.indexOf(declaration) !== 1 || !ts.isVariableDeclaration(pattern.parent) || !pattern.parent.initializer) return undefined;
    const init = unwrap(pattern.parent.initializer);
    if (!ts.isCallExpression(init)) return undefined;
    const callee = unwrap(init.expression);
    const hook = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    if (hook !== 'useState' && hook !== 'useReducer') return undefined;
    const first = pattern.elements[0];
    return { state: first && ts.isBindingElement(first) ? first.name.getText() : 'state', hook };
  }

  /** What a variable's initializer is made from: `new PrismaClient()`, `createClient()`, `z.object()`… */
  function initOrigin(declaration: ts.Declaration, depth = 0): Origin | undefined {
    // `export default apiClient;` stands for the variable it names.
    if (ts.isExportAssignment(declaration) && depth < 3) {
      const named = unwrap(declaration.expression);
      if (!ts.isIdentifier(named)) return undefined;
      const origin = originOf(named);
      return origin.kind === 'declaration' && origin.declaration !== declaration ? initOrigin(origin.declaration, depth + 1) : undefined;
    }
    let holder: ts.Node = declaration;
    while (ts.isBindingElement(holder) || ts.isObjectBindingPattern(holder) || ts.isArrayBindingPattern(holder)) holder = holder.parent;
    if (!ts.isVariableDeclaration(holder) || !holder.initializer) return undefined;
    const candidates: ts.Expression[] = [holder.initializer];
    for (let index = 0; index < candidates.length && index < 8; index++) {
      const value = unwrap(candidates[index]!);
      if (ts.isBinaryExpression(value) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(value.operatorToken.kind)) {
        candidates.push(value.right, value.left);
        continue;
      }
      if (ts.isNewExpression(value) || ts.isCallExpression(value)) {
        let root = unwrap(value.expression);
        while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root)) root = unwrap(root.expression);
        if (ts.isIdentifier(root)) {
          const origin = originOf(root);
          if (origin.kind !== 'unknown') return origin;
        }
      }
    }
    return undefined;
  }

  /** A receiver whose value is fixed by its declaration: an import, a namespace, `this`, or a const object. */
  function stableReceiver(expression: ts.Expression): boolean {
    const value = unwrap(expression);
    if (value.kind === ts.SyntaxKind.ThisKeyword) return true;
    if (ts.isPropertyAccessExpression(value)) return stableReceiver(value.expression);
    if (!ts.isIdentifier(value)) return false;
    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(value);
    } catch {
      return false;
    }
    const declaration = symbol?.declarations?.[0];
    if (!declaration) return false;
    if (isAlias(declaration) || ts.isClassDeclaration(declaration) || ts.isModuleDeclaration(declaration)) return true;
    return ts.isVariableDeclaration(declaration) && !!declaration.initializer && ts.isObjectLiteralExpression(unwrap(declaration.initializer)) && !!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const);
  }

  function resolveCall(call: ts.CallExpression): Callee {
    if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = call.arguments[0];
      return { kind: 'dynamic-import', ...(argument && ts.isStringLiteral(argument) ? { specifier: argument.text } : {}) };
    }
    const callee = unwrap(call.expression);
    if (ts.isElementAccessExpression(callee)) return { kind: 'element-access', object: callee.expression, index: callee.argumentExpression };

    // The checker resolves repository functions, methods and re-exports, including unions.
    const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : undefined;
    if (nameNode) {
      let symbol: ts.Symbol | undefined;
      try {
        symbol = checker.getSymbolAtLocation(nameNode);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      } catch {
        symbol = undefined;
      }
      const targets = (symbol?.declarations ?? [])
        .filter((declaration) => inRepo(declaration))
        .flatMap((declaration) => {
          const found = functionOfDeclaration(declaration);
          return found ? [found] : [];
        });
      if (targets.length === 1) return { kind: 'function', ...targets[0]!, name: nameNode.text, confidence: ts.isPropertyAccessExpression(callee) && !stableReceiver(callee.expression) ? 'heuristic' : 'resolved' };
      if (targets.length > 1) return { kind: 'multiple', targets };
    }

    // Otherwise, find the root of `a.b().c()` and describe the call by where the root comes from.
    const chain: string[] = [];
    const calls: ts.CallExpression[] = [call];
    let root: ts.Expression = callee;
    for (;;) {
      root = unwrap(root);
      if (ts.isPropertyAccessExpression(root)) {
        chain.unshift(root.name.text);
        root = root.expression;
      } else if (ts.isCallExpression(root)) {
        calls.unshift(root);
        root = root.expression;
      } else break;
    }
    if (ts.isElementAccessExpression(root)) return { kind: 'unresolved' };
    if (!ts.isIdentifier(root)) return { kind: 'unresolved' };
    const origin = originOf(root);
    switch (origin.kind) {
      case 'external': {
        const from = fileOf(call)?.path ?? '';
        if (isLocalModule(origin.module, from)) return { kind: 'missing', module: origin.module, name: root.text };
        return { kind: 'external', module: origin.module, name: origin.name, chain, calls };
      }
      case 'global':
        return { kind: 'global', name: origin.name, chain, calls };
      case 'parameter':
        return chain.length || calls.length > 1 ? { kind: 'unresolved' } : { kind: 'parameter', name: root.text };
      case 'declaration': {
        const setter = !chain.length && calls.length === 1 ? stateSetter(origin.declaration) : undefined;
        if (setter) return { kind: 'state-setter', ...setter };
        return { kind: 'value', root: root.text, declaration: origin.declaration, init: initOrigin(origin.declaration), chain, calls };
      }
      default:
        return { kind: 'unresolved' };
    }
  }

  const stateSetterOf = (identifier: ts.Identifier) => {
    const origin = originOf(identifier);
    return origin.kind === 'declaration' ? stateSetter(origin.declaration) : undefined;
  };

  return { originOf, resolveCall, functionOf, stateSetterOf };
}
