'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  JOURNEYS_VERSION,
  applyJourneyEdits,
  buildJourneys,
  editsBetween,
  journeyIsDestructive,
  journeyStations,
  readJourneyEdits,
  worstStatus,
  type Feature,
  type Journey,
  type JourneyEdits,
  type JourneyStation,
  type QaCheck,
  type QaLiveRun,
  type QaReport,
  type QaStatus,
  type QaStepKind,
  type QaStepResult,
  type RepoBundle,
} from '@codedna/shared';
import type { LiveQa } from './qa-live';
import type { FlowState } from './qa-flows';

/** One point on the journey map, with what happened there (if it has run). */
export interface NodeView {
  id: string;
  step: number;
  kind: QaStepKind;
  label: string;
  featureId?: string;
  featureStepId?: string;
  result?: QaStepResult;
  state: FlowState;
  /** Added while running (signing in on the way), not part of the plan. */
  extra?: boolean;
}

export interface StationView {
  station: JourneyStation;
  nodes: NodeView[];
  state: FlowState;
}

export interface JourneyView {
  journey: Journey;
  stations: StationView[];
  check?: QaCheck;
  state: FlowState;
  destructive: boolean;
}

const stepOf = (nodeId?: string) => Number(nodeId?.split('.')[0] ?? -1);

function stateOf(states: FlowState[]): FlowState {
  if (states.includes('running')) return 'running';
  const ran = states.filter(
    (state): state is QaStatus =>
      state === 'passed' ||
      state === 'failed' ||
      state === 'warning' ||
      state === 'skipped',
  );
  if (!ran.length) return 'untested';
  return ran.some((state) => state !== 'skipped')
    ? worstStatus(ran)
    : 'skipped';
}

/**
 * Joins each journey's map (from the code) with what happened (the last report, or a run going on
 * now), point by point. Pure, so the page and its tests agree.
 */
export function journeyViews(
  journeys: readonly Journey[],
  features: readonly Feature[],
  report?: QaReport,
  live?: QaLiveRun,
): JourneyView[] {
  const checks = new Map<string, QaCheck>();
  for (const suite of report?.suites ?? [])
    if (suite.runner === 'journeys')
      for (const check of suite.checks)
        if (check.journeyId) checks.set(check.journeyId, check);
  const ongoing = live?.state === 'running' && live.kind === 'journeys';
  if (ongoing)
    for (const check of live.checks)
      if (check.journeyId) checks.set(check.journeyId, check);
  return journeys.map((journey) => {
    const now = ongoing && live.current?.journeyId === journey.id;
    const queued =
      ongoing &&
      !now &&
      (!live.journeyIds || live.journeyIds.includes(journey.id)) &&
      !live.checks.some((check) => check.journeyId === journey.id);
    const check = now || queued ? undefined : checks.get(journey.id);
    const results = now ? (live.current?.steps ?? []) : (check?.steps ?? []);
    let runningSet = false;
    const stations = journeyStations(journey, features).map(
      (station): StationView => {
        const planned = station.nodes;
        const mine = results.filter(
          (result) => stepOf(result.nodeId) === station.step,
        );
        const seen = new Set(mine.map((result) => result.nodeId));
        const nodes: NodeView[] = [
          ...mine.map((result): NodeView => {
            const plan = planned.find((node) => node.id === result.nodeId);
            const traced = result.featureStepId ?? plan?.featureStepId;
            return {
              id: result.nodeId!,
              step: station.step,
              kind: result.kind,
              label: result.label,
              ...(plan?.featureId ? { featureId: plan.featureId } : {}),
              ...(traced ? { featureStepId: traced } : {}),
              result,
              state: result.status,
              ...(plan ? {} : { extra: true }),
            };
          }),
          ...planned
            .filter((node) => !seen.has(node.id))
            .map((node): NodeView => {
              const running = now && !runningSet;
              if (running) runningSet = true;
              return { ...node, state: running ? 'running' : 'untested' };
            }),
        ];
        return {
          station,
          nodes,
          state: stateOf(nodes.map((node) => node.state)),
        };
      },
    );
    const state: FlowState = now
      ? 'running'
      : check
        ? check.status
        : 'untested';
    return {
      journey,
      stations,
      ...(check ? { check } : {}),
      state,
      destructive: journeyIsDestructive(journey, features),
    };
  });
}

/** The point to show first: where it broke, else the last thing that ran, else the start. */
export function firstNodeOf(view: JourneyView): NodeView | undefined {
  const nodes = view.stations.flatMap((station) => station.nodes);
  return (
    nodes.find((node) => node.state === 'running') ??
    nodes.find((node) => node.state === 'failed') ??
    nodes.find((node) => node.state === 'warning') ??
    [...nodes]
      .reverse()
      .find((node) => node.result && node.state !== 'skipped') ??
    nodes[0]
  );
}

const EDITS_KEY = (id: string) => `codedna:journeys:${id}`;

export interface JourneysState {
  /** Every journey, hidden ones included. */
  journeys: Journey[];
  original: Journey[];
  /** Where edits are kept: the project file (opened with `codedna`) or this browser. */
  savedIn: 'project' | 'browser';
  edits: JourneyEdits;
  save: (journeys: Journey[]) => Promise<string | undefined>;
  /** The test account's email when one is saved on this computer (never the password). */
  account?: string;
  saveAccount: (email: string, password: string) => Promise<string | undefined>;
  removeAccount: () => Promise<string | undefined>;
}

function readStored(id: string): JourneyEdits | undefined {
  try {
    const text = window.localStorage.getItem(EDITS_KEY(id));
    if (!text) return undefined;
    const edits = readJourneyEdits(JSON.parse(text));
    return 'problem' in edits ? undefined : edits;
  } catch {
    return undefined;
  }
}

/** The project's journeys with its edits, and its test account, from the local server or this browser. */
export function useJourneys(bundle: RepoBundle, live: LiveQa): JourneysState {
  const original = useMemo(
    () => buildJourneys(bundle.features),
    [bundle.features],
  );
  const [edits, setEdits] = useState<JourneyEdits>({
    version: JOURNEYS_VERSION,
    journeys: [],
  });
  const [account, setAccount] = useState<string>();
  const local = live.available;
  const url = `/api/local/journeys/${encodeURIComponent(bundle.id)}`;
  const accountUrl = `/api/local/qa-account/${encodeURIComponent(bundle.id)}`;

  useEffect(() => {
    let active = true;
    if (!local) {
      const stored = readStored(bundle.id);
      if (stored) setEdits(stored);
      return;
    }
    void fetch(url, { cache: 'no-store' })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              edits?: unknown;
              account?: { email?: string };
            }>)
          : {},
      )
      .then((value: { edits?: unknown; account?: { email?: string } }) => {
        if (!active) return;
        const read = value.edits ? readJourneyEdits(value.edits) : undefined;
        if (read && !('problem' in read)) setEdits(read);
        setAccount(value.account?.email);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bundle.id, local, url]);

  const apply = (value: unknown) => {
    const body = value as { edits?: unknown; account?: { email?: string } };
    const read = body.edits ? readJourneyEdits(body.edits) : undefined;
    setEdits(
      read && !('problem' in read)
        ? read
        : { version: JOURNEYS_VERSION, journeys: [] },
    );
    setAccount(body.account?.email);
  };

  const save = useCallback(
    async (journeys: Journey[]) => {
      const next = editsBetween(original, journeys);
      if (local) {
        const { value, error } = await live.send(url, next);
        if (error) return error;
        apply(value);
        return undefined;
      }
      try {
        window.localStorage.setItem(EDITS_KEY(bundle.id), JSON.stringify(next));
      } catch {
        // Kept for this visit only.
      }
      setEdits(next);
      return undefined;
    },
    [original, local, live, url, bundle.id],
  );

  return {
    journeys: applyJourneyEdits(original, edits),
    original,
    savedIn: local ? 'project' : 'browser',
    edits,
    save,
    ...(account ? { account } : {}),
    saveAccount: async (email, password) => {
      const { value, error } = await live.send(accountUrl, { email, password });
      if (error) return error;
      apply(value);
      return undefined;
    },
    removeAccount: async () => {
      const { value, error } = await live.send(accountUrl, {});
      if (error) return error;
      apply(value);
      return undefined;
    },
  };
}

export function journeyCounts(
  views: readonly JourneyView[],
): Record<FlowState, number> {
  const counts: Record<FlowState, number> = {
    passed: 0,
    failed: 0,
    warning: 0,
    skipped: 0,
    untested: 0,
    unavailable: 0,
    running: 0,
  };
  for (const view of views) counts[view.state]++;
  return counts;
}
