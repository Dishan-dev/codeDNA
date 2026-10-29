import type { SourceLocation } from '@codedna/shared';
import { normalizeRelative } from './snapshot.js';
export type ExplorerMode =
  | 'Architecture'
  | 'UI Flow'
  | 'Impact Analysis'
  | 'Learning Mode';
export type WebviewRequest =
  | { version: 1; type: 'ready' }
  | { version: 1; type: 'refresh' }
  | { version: 1; type: 'mode'; mode: ExplorerMode }
  | {
      version: 1;
      type: 'progress';
      step: number;
      completed: string[];
      answers: Record<string, string>;
    }
  | { version: 1; type: 'open'; path: string; line?: number; column?: number }
  | { version: 1; type: 'impact'; path: string }
  | { version: 1; type: 'select'; path: string };
export function validMessage(value: unknown): value is WebviewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.type !== 'string') return false;
  const allowed = (keys: string[]) =>
    Object.keys(v).every((k) => keys.includes(k));
  if (v.type === 'ready' || v.type === 'refresh')
    return allowed(['version', 'type']);
  if (v.type === 'mode')
    return (
      allowed(['version', 'type', 'mode']) &&
      ['Architecture', 'UI Flow', 'Impact Analysis', 'Learning Mode'].includes(
        String(v.mode),
      )
    );
  if (v.type === 'progress') {
    if (
      !allowed(['version', 'type', 'step', 'completed', 'answers']) ||
      !Number.isSafeInteger(v.step) ||
      Number(v.step) < 0 ||
      Number(v.step) > 20 ||
      !Array.isArray(v.completed) ||
      v.completed.length > 20 ||
      !v.completed.every((x) => typeof x === 'string' && x.length <= 4096) ||
      !v.answers ||
      typeof v.answers !== 'object' ||
      Array.isArray(v.answers)
    )
      return false;
    const entries = Object.entries(v.answers);
    return (
      entries.length <= 10 &&
      entries.every(
        ([key, val]) =>
          key.length <= 4096 && typeof val === 'string' && val.length <= 4096,
      )
    );
  }
  if (v.type === 'impact' || v.type === 'select' || v.type === 'open') {
    if (
      !allowed(
        v.type === 'open'
          ? ['version', 'type', 'path', 'line', 'column']
          : ['version', 'type', 'path'],
      ) ||
      typeof v.path !== 'string' ||
      v.path.length > 4096 ||
      normalizeRelative(v.path) !== v.path
    )
      return false;
    if (
      v.line !== undefined &&
      (!Number.isSafeInteger(v.line) ||
        Number(v.line) < 1 ||
        Number(v.line) > 10000000)
    )
      return false;
    if (
      v.column !== undefined &&
      (!Number.isSafeInteger(v.column) ||
        Number(v.column) < 1 ||
        Number(v.column) > 10000000)
    )
      return false;
    return true;
  }
  return false;
}
export function position(location: SourceLocation | undefined): {
  line: number;
  column: number;
} {
  return {
    line: Math.max(0, (location?.start.line ?? 1) - 1),
    column: Math.max(0, (location?.start.column ?? 1) - 1),
  };
}
