'use client';
import { useCallback, useEffect, useState } from 'react';
import { validateQaReport, type QaReport, type RepoBundle } from '@codedna/shared';

/**
 * Where the Quality page finds the latest `codedna qa` report. Sources are tried in order; to add
 * one (a CI artifact, a shared team store) add an entry. Reports never leave the learner's machine
 * unless they move the file themselves.
 */
export type QaOrigin = 'local' | 'file';

interface QaSource {
  origin: QaOrigin;
  load: (bundle: RepoBundle) => Promise<QaReport | undefined>;
}

const FILE_KEY = (id: string) => `codedna:qa-report:${id}`;
/** Big enough for a large walk, small enough for browser storage. */
const MAX_REPORT_CHARS = 2_000_000;

function parse(text: string): QaReport | undefined {
  try {
    const result = validateQaReport(JSON.parse(text));
    return 'report' in result ? result.report : undefined;
  } catch {
    return undefined;
  }
}

const SOURCES: readonly QaSource[] = [
  {
    // The CLI serves the project's latest report while `codedna` runs.
    origin: 'local',
    load: async (bundle) => {
      if (bundle.source !== 'local') return undefined;
      const response = await fetch(`/api/local/qa/${encodeURIComponent(bundle.id)}`, { cache: 'no-store' }).catch(() => undefined);
      return response?.ok ? parse(await response.text()) : undefined;
    },
  },
  {
    // A report file the learner loaded on this page, kept in this browser.
    origin: 'file',
    load: async (bundle) => {
      try {
        const saved = window.localStorage.getItem(FILE_KEY(bundle.id));
        return saved ? parse(saved) : undefined;
      } catch {
        return undefined;
      }
    },
  },
];

export interface QaReportState {
  report?: QaReport;
  origin?: QaOrigin;
  loading: boolean;
  /** Screenshots that came with a report from a GitHub run (this visit only), by report path. */
  shots?: Record<string, string>;
  /** Load a qa-report.json picked by the learner. Returns a reason when it can't be used. */
  loadFile: (file: File) => Promise<string | undefined>;
  /** Load a report fetched for this page (a GitHub run). Returns a reason when it can't be used. */
  loadReport: (value: unknown, shots?: Record<string, string>) => string | undefined;
  forget: () => void;
  refresh: () => void;
}

/** `refreshKey` (e.g. the current page) looks again when it changes, so a new run shows up. */
export function useQaReport(bundle: RepoBundle, refreshKey?: string): QaReportState {
  const [state, setState] = useState<{ report?: QaReport; origin?: QaOrigin; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const [shots, setShots] = useState<Record<string, string>>();
  useEffect(() => {
    let active = true;
    void (async () => {
      for (const source of SOURCES) {
        const report = await source.load(bundle);
        if (report && report.repoId === bundle.id) {
          if (active) setState({ report, origin: source.origin, loading: false });
          return;
        }
      }
      if (active) setState({ loading: false });
    })();
    return () => {
      active = false;
    };
  }, [bundle, tick, refreshKey]);

  const loadReport = useCallback(
    (value: unknown, pictures?: Record<string, string>) => {
      const result = validateQaReport(value);
      if ('problem' in result) return result.problem;
      if (result.report.repoId !== bundle.id) return `This report is for “${result.report.repoName}”, not ${bundle.name}.`;
      try {
        window.localStorage.setItem(FILE_KEY(bundle.id), JSON.stringify(result.report));
      } catch {
        // Shown for this visit only when storage is blocked or full.
      }
      setState({ report: result.report, origin: 'file', loading: false });
      setShots(pictures);
      return undefined;
    },
    [bundle.id, bundle.name],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_REPORT_CHARS) return 'That file is too big to be a CodeDNA QA report.';
      const text = await file.text().catch(() => '');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return 'That file isn’t JSON. Load the qa-report.json from your project’s .codedna folder.';
      }
      return loadReport(value);
    },
    [loadReport],
  );

  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(FILE_KEY(bundle.id));
    } catch {
      // Nothing stored.
    }
    setShots(undefined);
    setTick((value) => value + 1);
  }, [bundle.id]);

  return { ...state, ...(shots ? { shots } : {}), loadFile, loadReport, forget, refresh: () => setTick((value) => value + 1) };
}
