import ts from 'typescript';
import type { SourceFile, SourceLocation } from '@codedna/shared';
export function parseSource(file: SourceFile): ts.SourceFile {
  const kind = file.path.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.path.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : file.path.endsWith('.js')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(
    `/${file.path}`,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
}
export function sourceLocation(
  file: ts.SourceFile,
  start: number,
  end: number,
): SourceLocation {
  const a = file.getLineAndCharacterOfPosition(start);
  const b = file.getLineAndCharacterOfPosition(end);
  return {
    path: file.fileName.slice(1),
    start: { line: a.line + 1, column: a.character + 1 },
    end: { line: b.line + 1, column: b.character + 1 },
  };
}
