import ts from 'typescript';
import type { CodeRef, FileSummary, SourceLanguage } from '@codedna/shared';
import { toRepoPath } from '../graph/host.js';
import type { ReadyFile } from './validate.js';

export interface ParsedFile extends ReadyFile {
  source: ts.SourceFile;
}

const SCRIPT_KIND: Record<SourceLanguage, ts.ScriptKind> = {
  ts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
  json: ts.ScriptKind.JSON,
};

/** Syntax only: never type-checks, resolves or executes anything. */
export function parseFile(file: ReadyFile): ParsedFile {
  return { ...file, source: ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, SCRIPT_KIND[file.language]) };
}

/** 1-based line of a position. */
export const lineOf = (source: ts.SourceFile, position: number) => source.getLineAndCharacterOfPosition(position).line + 1;

export function fileDirective(source: ts.SourceFile): FileSummary['directive'] {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return undefined;
    const text = statement.expression.text;
    if (text === 'use client' || text === 'use server') return text;
  }
  return undefined;
}

export function summarize(file: ParsedFile): FileSummary {
  const directive = file.language === 'json' ? undefined : fileDirective(file.source);
  return { path: file.path, language: file.language, lines: file.source.getLineStarts().length, ...(directive ? { directive } : {}) };
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];
const SECRET_ASSIGNMENT = /((?:secret|password|passwd|token|api[_-]?key|private[_-]?key)\w*\s*[:=]\s*)(['"`])([^'"`\n]{8,})\2/gi;

/** Hide likely credentials in excerpts shown to learners or sent to an AI helper. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, '[hidden secret]');
  return result.replace(SECRET_ASSIGNMENT, (_match, prefix: string, quote: string) => `${prefix}${quote}[hidden secret]${quote}`);
}

export interface ExcerptOptions {
  /** Lines of context above and below the node. */
  context?: number;
  maxLines?: number;
  maxLineLength?: number;
}

/** A bounded, redacted excerpt around a node; `highlightLine` is the node's first line. */
export function codeRef(source: ts.SourceFile, node: ts.Node, options: ExcerptOptions = {}): CodeRef {
  const { context = 1, maxLines = 14, maxLineLength = 200 } = options;
  const total = source.getLineStarts().length;
  const first = lineOf(source, node.getStart(source));
  const last = lineOf(source, node.getEnd());
  const startLine = Math.max(1, first - context);
  const endLine = Math.min(total, last + context, startLine + maxLines - 1);
  const lines = source.text.split(/\r?\n/).slice(startLine - 1, endLine).map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength - 1)}…` : line));
  return {
    path: toRepoPath(source.fileName),
    startLine,
    endLine,
    highlightLine: first,
    ...(last > first ? { highlightEndLine: last } : {}),
    excerpt: redactSecrets(lines.join('\n')),
  };
}
