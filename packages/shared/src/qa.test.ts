import { describe, expect, it } from 'vitest';
import { qaTotals, validateQaReport, worstStatus, type QaReport } from './qa.js';

const report: QaReport = {
  version: 1,
  repoId: 'local-shop',
  repoName: 'shop',
  createdAt: '2026-11-07T00:00:00Z',
  tool: { name: 'codedna', version: '0.0.0' },
  suites: [
    {
      runner: 'tests',
      title: 'Your tests',
      status: 'failed',
      startedAt: '2026-11-07T00:00:00Z',
      durationMs: 10,
      checks: [
        { id: 'a', title: 'A', status: 'passed' },
        { id: 'b', title: 'B', status: 'failed' },
      ],
    },
    { runner: 'walk', title: 'Walk', status: 'warning', startedAt: '2026-11-07T00:00:00Z', durationMs: 10, checks: [{ id: 'c', title: 'C', status: 'warning' }] },
  ],
};

describe('QA reports', () => {
  it('counts checks across suites', () => {
    expect(qaTotals(report)).toEqual({ passed: 1, failed: 1, warning: 1, skipped: 0, total: 3 });
  });

  it('takes the worst status', () => {
    expect(worstStatus(['passed', 'warning', 'failed'])).toBe('failed');
    expect(worstStatus(['passed', 'skipped'])).toBe('passed');
    expect(worstStatus(['skipped'])).toBe('skipped');
    expect(worstStatus([])).toBe('skipped');
  });

  it('accepts a good report and explains a bad one', () => {
    expect(validateQaReport(JSON.parse(JSON.stringify(report)))).toEqual({ report });
    expect(validateQaReport(null)).toEqual({ problem: 'This isn’t a CodeDNA QA report.' });
    expect(validateQaReport({ ...report, version: 2 })).toEqual({ problem: 'This report is from a different CodeDNA version (2).' });
    expect(validateQaReport({ ...report, suites: [{ ...report.suites[0], status: 'great' }] })).toEqual({ problem: 'This QA report has a damaged section.' });
    expect(validateQaReport({ ...report, suites: [{ ...report.suites[0], checks: [{ id: 1 }] }] })).toEqual({ problem: 'This QA report has a damaged check.' });
  });
});

describe('QA targets', () => {
  it('tells the learner’s own machine from a deployed site, and refuses unsafe addresses', async () => {
    const { qaTargetOf, ownerFileAllows, qaWorkflowYaml } = await import('./index.js');
    expect(qaTargetOf('http://localhost:3000/')).toEqual({ kind: 'local', url: 'http://localhost:3000', origin: 'http://localhost:3000' });
    expect(qaTargetOf('https://my-app.vercel.app/shop/')).toEqual({ kind: 'deployed', url: 'https://my-app.vercel.app/shop', origin: 'https://my-app.vercel.app' });
    expect(qaTargetOf('http://192.168.1.20:8080')).toMatchObject({ kind: 'deployed' });
    expect(qaTargetOf('http://example.com')).toEqual({ problem: 'A site on the internet must use https.' });
    expect(qaTargetOf('http://localhost.evil.com')).toHaveProperty('problem');
    expect(qaTargetOf('https://user:pw@example.com')).toHaveProperty('problem');
    expect(qaTargetOf('file:///etc/passwd')).toHaveProperty('problem');
    expect(qaTargetOf('not a url')).toHaveProperty('problem');
    expect(ownerFileAllows('# hello\n  CodeDNA: allow-testing  \n')).toBe(true);
    expect(ownerFileAllows('codedna: allow-testing-please')).toBe(false);
    expect(qaWorkflowYaml()).toContain('repository: Dishan-dev/codeDNA');
  });
});
