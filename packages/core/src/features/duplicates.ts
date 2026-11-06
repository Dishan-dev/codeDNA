import ts from 'typescript';
import type { DuplicateCode } from '@codedna/shared';
import { isFunctionNode, unwrap } from '../graph/resolve.js';
import { codeRef, type ParsedFile } from '../snapshot/parse.js';
import { hash } from './captions.js';

const MIN_BODY = 30;
const MAX_GROUPS = 20;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Body text without comments or whitespace, so formatting differences don't hide a copy. */
const normalize = (node: ts.Node, source: ts.SourceFile) =>
  node
    .getText(source)
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .replace(/\s+/g, '');

/** Top-level functions with the same parameters and body in more than one file. */
export function findDuplicates(files: readonly ParsedFile[]): DuplicateCode[] {
  const groups = new Map<string, { name: string; file: ParsedFile; node: ts.Node }[]>();
  for (const file of files) {
    for (const statement of file.source.statements) {
      const found: { name: string; fn: ts.FunctionLikeDeclaration; node: ts.Node }[] = [];
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) found.push({ name: statement.name.text, fn: statement, node: statement });
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          const value = declaration.initializer && unwrap(declaration.initializer);
          if (ts.isIdentifier(declaration.name) && value && isFunctionNode(value)) found.push({ name: declaration.name.text, fn: value, node: statement });
        }
      for (const { name, fn, node } of found) {
        if (!fn.body) continue;
        const body = normalize(fn.body, file.source);
        if (body.length < MIN_BODY) continue;
        const key = hash(`${fn.parameters.map((parameter) => normalize(parameter, file.source)).join(',')}=>${body}`);
        const list = groups.get(key) ?? [];
        list.push({ name, file, node });
        groups.set(key, list);
      }
    }
  }
  const duplicates: DuplicateCode[] = [];
  for (const list of groups.values()) {
    if (new Set(list.map((item) => item.file.path)).size < 2) continue;
    duplicates.push({
      name: list[0]!.name,
      places: list.map((item) => codeRef(item.file.source, item.node, { context: 0, maxLines: 6 })).sort((a, b) => compare(a.path, b.path)),
    });
  }
  return duplicates.sort((a, b) => compare(a.places[0]!.path, b.places[0]!.path) || compare(a.name, b.name)).slice(0, MAX_GROUPS);
}
