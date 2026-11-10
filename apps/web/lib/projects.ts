'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { pathStates } from '@codedna/learn-ui';
import { qaTotals, type Progress, type RepoBundle } from '@codedna/shared';
import { useQaReport, type QaReportState } from './qa-results';
import { scanQuality } from './quality';
import { matchRequirements, parseRequirements } from './requirements';

/**
 * Projects: every repo you've opened, with where it stands. One status shape feeds the sidebar
 * badges, the Overview page and the Projects list, so they always agree.
 *
 * The store is an interface. Today it is this browser (localStorage); a team server or a file
 * in the CLI can implement the same four calls later without touching any screen.
 */
export interface ProjectStatus {
  lessons: { done: number; total: number };
  /** Requirements coverage in %, when a document was checked. */
  coverage?: number;
  /** High and medium findings from the code scan. */
  risks: number;
  /** The last QA run, when there is one. */
  qa?: { passed: number; failed: number; warning: number; skipped: number; at: string };
}

export interface ProjectRecord extends ProjectStatus {
  id: string;
  name: string;
  source: RepoBundle['source'];
  framework: string;
  lastOpened: string;
}

export interface ProjectStore {
  list: () => readonly ProjectRecord[];
  save: (record: ProjectRecord) => void;
  remove: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
}

const KEY = 'codedna:projects';
const MAX_PROJECTS = 50;
const EMPTY: readonly ProjectRecord[] = [];

function createLocalStore(): ProjectStore {
  let cache: readonly ProjectRecord[] | undefined;
  const listeners = new Set<() => void>();
  const read = (): readonly ProjectRecord[] => {
    if (cache) return cache;
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      cache = Array.isArray(parsed) ? (parsed as ProjectRecord[]).filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string') : [];
    } catch {
      cache = [];
    }
    return cache;
  };
  const write = (records: readonly ProjectRecord[]) => {
    cache = records;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(records));
    } catch {
      // Storage blocked or full: the list lasts for this visit.
    }
    listeners.forEach((listener) => listener());
  };
  if (typeof window !== 'undefined')
    window.addEventListener('storage', (event) => {
      if (event.key !== KEY) return;
      cache = undefined;
      listeners.forEach((listener) => listener());
    });
  return {
    list: () => (typeof window === 'undefined' ? EMPTY : read()),
    save: (record) => {
      const others = read().filter((item) => item.id !== record.id);
      write([record, ...others].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened)).slice(0, MAX_PROJECTS));
    },
    remove: (id) => write(read().filter((item) => item.id !== id)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const projectStore: ProjectStore = createLocalStore();

export function useProjects(store: ProjectStore = projectStore): readonly ProjectRecord[] {
  return useSyncExternalStore(store.subscribe, store.list, () => EMPTY);
}

/** Coverage of the requirements document saved for this repo, if there is one. */
export function savedCoverage(bundle: RepoBundle): number | undefined {
  try {
    const saved = window.localStorage.getItem(`codedna:srs:${bundle.id}`);
    return saved ? matchRequirements(parseRequirements((JSON.parse(saved) as { text: string }).text), bundle.features).percent : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where this project stands now. `refreshKey` (the current page) re-reads what other pages
 * save, like a newly checked requirements document.
 */
export function useProjectStatus(bundle: RepoBundle, progress: Progress, refreshKey?: string): ProjectStatus & { qaState: QaReportState } {
  const items = pathStates(bundle.plan, progress);
  const done = items.filter((item) => item.state === 'done').length;
  const quality = useMemo(() => scanQuality(bundle), [bundle]);
  const [coverage, setCoverage] = useState<number | undefined>();
  useEffect(() => setCoverage(savedCoverage(bundle)), [bundle, refreshKey]);
  const qaState = useQaReport(bundle, refreshKey);
  const report = qaState.report;
  return {
    lessons: { done, total: bundle.plan.path.length },
    ...(coverage === undefined ? {} : { coverage }),
    risks: quality.counts.high + quality.counts.medium,
    ...(report ? { qa: { ...qaTotals(report), at: report.createdAt } } : {}),
    qaState,
  };
}
