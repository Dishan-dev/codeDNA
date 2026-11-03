import ts from 'typescript';
import type { AnalysisResult, DiscoveredFeature, DiscoveredSymbol, Evidence, FeatureDiscovery, RepositorySnapshot, StaticFlowRelationship, UIFlowGraph, UnderstandingClaim } from '@codedna/shared';
import { validateSnapshot } from './validation.js';
import { parseSource, sourceLocation } from './source.js';

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const moduleFor = (path: string) => { const p = path.split('/'); return (p[0] === 'apps' || p[0] === 'packages') && p.length > 2 ? p.slice(0, 2).join('/') : p.length > 1 ? p[0]! : ''; };
const evidence = (location: DiscoveredSymbol['location'], description: string): Evidence[] => [{ description, location }];
const documented = (text: string, ev: Evidence[]): UnderstandingClaim => ({ text, certainty: 'verified', evidence: ev });
function apiPath(path: string): string | undefined {
  const match = /^(?:src\/)?app\/(.+)\/route\.(?:ts|tsx|js|jsx)$/.exec(path);
  if (!match) return undefined;
  const parts = match[1]!.split('/').filter((part) => !/^\([^/]+\)$/.test(part));
  if (!parts.length || parts.some((part) => ['[', ']', '@', '(', ')'].some((character) => part.includes(character)))) return undefined;
  return `/${parts.join('/')}`;
}
/** Bounded syntactic discovery. Calls are direct references; imports are never interpreted as calls. */
export function discoverFeatures(snapshot: RepositorySnapshot, result: AnalysisResult | undefined, flow: UIFlowGraph, complete = true): FeatureDiscovery {
  const checked = validateSnapshot(snapshot, {});
  const files = checked.files.filter((f) => /\.(?:ts|tsx|js|jsx)$/.test(f.path));
  const symbols: DiscoveredSymbol[] = [], relationships: StaticFlowRelationship[] = [];
  const parsed = new Map<string, ts.SourceFile>();
  const byFile = new Map<string, Map<string, DiscoveredSymbol>>();
  const exports = new Map<string, Map<string, DiscoveredSymbol>>();
  const limitations: string[] = ['Relationships are syntactic references, not runtime execution paths.'];
  if (!complete) limitations.push('The snapshot is partial; missing files may hide features and relationships.');
  for (const file of files) {
    const source = parseSource(file);
    parsed.set(file.path, source);
    const local = new Map<string, DiscoveredSymbol>();
    const exported = new Map<string, DiscoveredSymbol>();
    if ((source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
      limitations.push(`Symbol discovery skipped malformed source: ${file.path}.`);
      byFile.set(file.path, local);
      exports.set(file.path, exported);
      continue;
    }
    const add = (name: string, kind: DiscoveredSymbol['kind'], node: ts.Node, isExported: boolean) => {
      if (symbols.length >= 10000 || local.has(name)) return;
      const location = sourceLocation(source, node.getStart(source), node.getEnd());
      const symbol: DiscoveredSymbol = { id: `symbol:${file.path}:${location.start.line}:${location.start.column}:${encodeURIComponent(name)}`, name, kind, file: file.path, location, exported: isExported };
      symbols.push(symbol); local.set(name, symbol);
      if (isExported) exported.set(name, symbol);
    };
    for (const statement of source.statements) {
      const isExported = ts.canHaveModifiers(statement) && !!ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, /^[A-Z]/.test(statement.name.text) ? 'component' : 'function', statement.name, isExported);
      if (ts.isClassDeclaration(statement) && statement.name) add(statement.name.text, 'class', statement.name, isExported);
      if (ts.isVariableStatement(statement)) for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer || !(ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) continue;
        add(decl.name.text, /^[A-Z]/.test(decl.name.text) ? 'component' : 'function', decl.name, isExported);
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) {
        const localName = item.propertyName?.text ?? item.name.text;
        const localSymbol = local.get(localName);
        if (localSymbol) {
          localSymbol.exported = true;
          exported.set(item.name.text, localSymbol);
        }
      }
    }
    for (const statement of source.statements) if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) {
      const localSymbol = local.get(item.propertyName?.text ?? item.name.text);
      if (localSymbol) { localSymbol.exported = true; exported.set(item.name.text, localSymbol); }
    }
    byFile.set(file.path, local); exports.set(file.path, exported);
  }
  const handlers = new Map<string, DiscoveredSymbol[]>();
  for (const file of files) {
    const path = apiPath(file.path);
    if (!path) continue;
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const symbol = exports.get(file.path)?.get(method);
      if (!symbol) continue;
      const key = `${method} ${path}`, list = handlers.get(key) ?? [];
      list.push(symbol); handlers.set(key, list);
    }
  }
  const edges = new Map<string, Map<string, string>>();
  for (const edge of result?.dependencyGraph.edges ?? []) if (edge.sourceId.startsWith('file:') && edge.targetId.startsWith('file:') && edge.specifier) {
    const source = edge.sourceId.slice(5), target = edge.targetId.slice(5), map = edges.get(source) ?? new Map();
    map.set(edge.specifier, target); edges.set(source, map);
  }
  for (const file of files) {
    const source = parsed.get(file.path)!;
    const locals = byFile.get(file.path)!;
    const imported = new Map<string, DiscoveredSymbol>();
    const importedNames = new Set<string>();
    const sourceBindings = new Set<string>();
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) sourceBindings.add(declaration.name.text);
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) sourceBindings.add(statement.name.text);
    }
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.name) importedNames.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) importedNames.add(clause.namedBindings.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const spec of clause.namedBindings.elements) importedNames.add(spec.name.text);
      const target = edges.get(file.path)?.get(statement.moduleSpecifier.text);
      if (!target) continue;
      const candidates = exports.get(target);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const spec of clause.namedBindings.elements) {
        const item = candidates?.get(spec.propertyName?.text ?? spec.name.text);
        if (item) imported.set(spec.name.text, item);
      }
    }
    const emit = (owner: DiscoveredSymbol | undefined, target: DiscoveredSymbol | undefined, kind: StaticFlowRelationship['kind'], node: ts.Node, destination?: string) => {
      if (!owner || relationships.length >= 30000) return;
      const location = sourceLocation(source, node.getStart(source), node.getEnd());
      let condition: StaticFlowRelationship['condition'];
      for (let parent = node.parent; parent && parent !== source; parent = parent.parent) {
        const expression = ts.isIfStatement(parent) ? parent.expression : ts.isConditionalExpression(parent) ? parent.condition : undefined;
        if (expression && expression.getWidth(source) <= 120) {
          const inElse = ts.isIfStatement(parent) && parent.elseStatement && node.getStart(source) >= parent.elseStatement.getStart(source);
          condition = { description: inElse ? `not (${expression.getText(source)})` : expression.getText(source), location: sourceLocation(source, expression.getStart(source), expression.getEnd()) };
          break;
        }
      }
      relationships.push({ id: `relation:${owner.id}:${location.start.line}:${location.start.column}:${kind}`, sourceId: owner.id, ...(target ? { targetId: target.id } : {}), kind, location, status: target ? 'verified' : 'unresolved', evidence: [{ description: target ? `Direct ${kind} reference to ${target.name}` : `Target of ${kind} could not be resolved`, location }], ...(destination ? { destination } : {}), ...(condition ? { condition } : {}) });
    };
    const shadowed = (node: ts.Node, name: string): boolean => {
      for (let parent = node.parent; parent && parent !== source; parent = parent.parent) {
        if (ts.isFunctionLike(parent) && parent.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name)) return true;
        if (ts.isBlock(parent) || ts.isSourceFile(parent)) for (const statement of parent.statements) {
          if (statement.pos > node.pos) break;
          if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)) return true;
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.parent !== source) return true;
        }
      }
      return false;
    };
    const walk = (node: ts.Node, owner?: DiscoveredSymbol) => {
      if (ts.isFunctionDeclaration(node) && node.name) owner = node.parent === source ? locals.get(node.name.text) ?? owner : undefined;
      if (ts.isClassDeclaration(node) && node.name) owner = node.parent === source ? locals.get(node.name.text) ?? owner : undefined;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ts.isVariableStatement(node.parent.parent) && node.parent.parent.parent === source) owner = locals.get(node.name.text) ?? owner;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const target = shadowed(node, name) ? undefined : locals.get(name) ?? imported.get(name);
        if (target || imported.has(name) || locals.has(name) || /^use[A-Z]/.test(name)) emit(owner, target, /^use[A-Z]/.test(name) ? 'hook-reference' : 'call', node.expression);
        if (name === 'fetch' && !shadowed(node, name) && !sourceBindings.has(name) && !importedNames.has(name)) {
          const first = node.arguments[0];
          const destination = first && ts.isStringLiteralLike(first) ? first.text : undefined;
          let method = 'GET', supported = node.arguments.length <= 1;
          const options = node.arguments[1];
          if (options && ts.isObjectLiteralExpression(options)) {
            supported = true;
            if (options.properties.some((property) => !ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name))) supported = false;
            const methodProperties = options.properties.filter((property) => ts.isPropertyAssignment(property) && (property.name.getText(source) === 'method' || property.name.getText(source) === "'method'" || property.name.getText(source) === '"method"'));
            if (methodProperties.length > 1) supported = false;
            const methodProperty = methodProperties[0];
            if (methodProperty && ts.isPropertyAssignment(methodProperty)) {
              if (ts.isStringLiteralLike(methodProperty.initializer)) method = methodProperty.initializer.text.toUpperCase();
              else supported = false;
            }
          }
          const matches = destination && supported ? handlers.get(`${method} ${destination}`) ?? [] : [];
          if (destination?.startsWith('/api/') || !destination) emit(owner, matches.length === 1 ? matches[0] : undefined, 'http-request', node.expression, destination);
        }
      }
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) emit(owner, shadowed(node, node.tagName.text) ? undefined : locals.get(node.tagName.text) ?? imported.get(node.tagName.text), 'jsx-reference', node.tagName);
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /^on[A-Z]/.test(node.name.text) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) emit(owner, shadowed(node, node.initializer.expression.text) ? undefined : locals.get(node.initializer.expression.text) ?? imported.get(node.initializer.expression.text), 'event-handler', node.initializer.expression);
      ts.forEachChild(node, (child) => walk(child, owner));
    };
    walk(source);
  }
  symbols.sort((a, b) => compare(a.id, b.id)); relationships.sort((a, b) => compare(a.id, b.id));
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const relationshipsBySource = new Map<string, StaticFlowRelationship[]>();
  for (const relation of relationships) {
    const list = relationshipsBySource.get(relation.sourceId) ?? [];
    list.push(relation);
    relationshipsBySource.set(relation.sourceId, list);
  }
  const features: DiscoveredFeature[] = [];
  const make = (id: string, name: string, kind: DiscoveredFeature['kind'], path: string, route: string | undefined, ev: Evidence[], relatedSymbol?: DiscoveredSymbol) => {
    if (features.length >= 500) return;
    const own = relatedSymbol ? relationshipsBySource.get(relatedSymbol.id) ?? [] : (byFile.get(path) ? [...byFile.get(path)!.values()].flatMap((s) => relationshipsBySource.get(s.id) ?? []).slice(0, 200) : []);
    features.push({ id, name, kind, description: { ...documented(kind === 'route' ? `Detected route ${name} is registered from ${path}.` : kind === 'entry-point' ? `${path} has a conventional entry-point filename; its runtime role is unverified.` : `${name} is exported from ${path}.`, ev), certainty: kind === 'entry-point' ? 'inferred' : 'verified' }, routes: route ? [route] : [], modules: [moduleFor(path)], files: [path, ...new Set(own.flatMap((r) => { const target = symbolById.get(r.targetId ?? ''); return target && target.file !== path ? [target.file] : []; }))], symbols: relatedSymbol ? [relatedSymbol.id] : [...(byFile.get(path)?.values() ?? [])].slice(0, 20).map((s) => s.id), relationships: own.filter((r) => r.status === 'verified'), unresolved: own.filter((r) => r.status === 'unresolved'), coverage: !complete || own.some((r) => r.status === 'unresolved') ? 'partial' : 'source-evidenced', evidence: ev });
  };
  for (const node of flow.nodes) if (node.sourceFile && parsed.has(node.sourceFile)) make(`feature:route:${node.id}`, node.routePath ?? node.label, 'route', node.sourceFile, node.routePath, node.metadata.evidence.length ? node.metadata.evidence : node.location ? [{ description: 'Detected route source', location: node.location }] : [{ description: 'Detected route source' }]);
  for (const file of files) if (/(?:^|\/)(?:main|index|app|server)\.(?:tsx?|jsx?)$/.test(file.path)) make(`feature:entry:${file.path}`, file.path, 'entry-point', file.path, undefined, [{ description: 'Conventional entry-point filename', location: sourceLocation(parsed.get(file.path)!, 0, 0) }]);
  for (const symbol of symbols) if (symbol.exported) make(`feature:symbol:${symbol.id}`, symbol.name, 'exported-symbol', symbol.file, undefined, evidence(symbol.location, 'Exported declaration'), symbol);
  features.sort((a, b) => compare(a.id, b.id));
  if (symbols.length >= 10000 || relationships.length >= 30000 || features.length >= 500) limitations.push('Feature or relationship limit reached; results are partial.');
  if (!features.length) limitations.push('No supported route, conventional entry point, or exported function/class was identified.');
  return { schemaVersion: '1.0', snapshotId: checked.id, ...(checked.revision ? { revision: checked.revision } : {}), features, symbols, relationships, limitations };
}
