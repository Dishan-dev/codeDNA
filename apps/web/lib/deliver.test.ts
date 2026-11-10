import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoBundle } from '@codedna/shared';
import { DocumentError, linesFromItems, readDocument, readerFor } from './documents';
import { nextSteps } from './next-steps';
import type { ProjectStatus } from './projects';

const bundle = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'starters', 'snackshop.json'), 'utf8')) as RepoBundle;

describe('document readers', () => {
  it('picks a reader by extension, then by type', () => {
    expect(readerFor({ name: 'Brief.PDF', type: '' })?.label).toBe('PDF');
    expect(readerFor({ name: 'srs.docx', type: '' })?.label).toBe('Word');
    expect(readerFor({ name: 'notes', type: 'text/markdown' })?.label).toBe('Text or Markdown');
    expect(readerFor({ name: 'sheet.xlsx', type: '' })).toBeUndefined();
  });

  it('turns positioned PDF text into lines', () => {
    const at = (str: string, y: number, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 72, y], hasEOL });
    expect(linesFromItems([at('FR-1 The customer ', 700), at('shall order.', 700), at('FR-2 Admins can export.', 684), at('Next', 668, true), at('Last', 652)])).toEqual(['FR-1 The customer shall order.', 'FR-2 Admins can export.', 'Next', 'Last']);
  });

  it('reads text files and explains what it can’t read', async () => {
    expect(await readDocument(new File(['FR-1 The customer shall order.'], 'brief.md', { type: 'text/markdown' }))).toContain('FR-1');
    await expect(readDocument(new File(['x'], 'old.doc'))).rejects.toThrow('Old Word files (.doc)');
    await expect(readDocument(new File(['x'], 'data.xlsx'))).rejects.toBeInstanceOf(DocumentError);
    await expect(readDocument(new File(['x'.repeat(1024 * 1024 + 1)], 'big.txt'))).rejects.toThrow('over 1 MB');
  });
});

describe('next steps', () => {
  const base: ProjectStatus = { lessons: { done: 0, total: 4 }, risks: 0 };
  const next = bundle.plan.path[0];

  it('starts a fresh project with requirements, QA and the first lesson', () => {
    expect(nextSteps(bundle, base, next).map((step) => step.id)).toEqual(['no-srs', 'no-qa', 'lesson']);
  });

  it('puts what broke first', () => {
    const steps = nextSteps(bundle, { ...base, coverage: 40, risks: 2, qa: { passed: 3, failed: 1, warning: 0, skipped: 0, at: '2026-11-07T00:00:00Z' } }, next);
    expect(steps.map((step) => step.id)).toEqual(['qa-failed', 'coverage', 'risks', 'lesson']);
    expect(steps[0]).toMatchObject({ title: 'Fix 1 failed check', path: '/quality', tone: 'danger' });
    expect(steps[1]).toMatchObject({ title: 'Requirements are 40% covered', tone: 'warning' });
  });

  it('has nothing to say when everything is done', () => {
    expect(nextSteps(bundle, { lessons: { done: 4, total: 4 }, risks: 0, coverage: 100, qa: { passed: 5, failed: 0, warning: 0, skipped: 0, at: '2026-11-07T00:00:00Z' } })).toEqual([]);
  });
});
