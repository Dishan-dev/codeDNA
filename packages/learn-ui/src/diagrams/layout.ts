import type { Branch, Feature, Step } from '@codedna/shared';
import { defaultChoices, type Choices, type Place, type Zone } from '../story.js';

/* ------------------------------------------------------------------ */
/* Sequence diagram                                                    */
/* ------------------------------------------------------------------ */

/** The columns of a sequence diagram: who starts it, then the places the story visits. */
export type Lane = 'person' | Zone;
export const LANE_ORDER: readonly Lane[] = ['person', 'browser', 'server', 'database', 'service'];

/** One row: an arrow between two columns, or something that happens inside one column. */
export type SequenceRow = { kind: 'arrow'; from: Lane; to: Lane; back: boolean; step: Step } | { kind: 'self'; lane: Lane; step: Step };

/**
 * Turn the steps of one playthrough into sequence rows. A step that moves the story to another
 * place is an arrow; a step that stays in place is a note on that column. Database and other
 * services answer whoever called them, so the story returns to the caller afterwards.
 */
export function sequenceRows(steps: readonly Step[], places: readonly Place[], startsWithPerson: boolean): { lanes: Lane[]; rows: SequenceRow[] } {
  const rows: SequenceRow[] = [];
  let at: Lane = startsWithPerson ? 'person' : 'server';
  steps.forEach((step, index) => {
    const place = places[index];
    if (!place) return;
    if ('from' in place) {
      rows.push({ kind: 'arrow', from: place.from, to: place.to, back: place.to === 'browser', step });
      at = place.to;
      return;
    }
    const target: Lane = place.zone;
    // The first step on a route with no person: something calls the server.
    if (index === 0 && !startsWithPerson) {
      rows.push({ kind: 'arrow', from: 'person', to: target, back: false, step });
      at = target;
      return;
    }
    if (target === at) rows.push({ kind: 'self', lane: target, step });
    else {
      rows.push({ kind: 'arrow', from: at, to: target, back: false, step });
      // Data and services answer the caller; the story carries on where it was.
      if (target !== 'database' && target !== 'service') at = target;
    }
    if ((step.stage === 'click' || step.stage === 'form') && at === 'person') at = 'browser';
  });
  const used = new Set<Lane>();
  for (const row of rows) for (const lane of row.kind === 'arrow' ? [row.from, row.to] : [row.lane]) used.add(lane);
  return { lanes: LANE_ORDER.filter((lane) => used.has(lane)), rows };
}

/* ------------------------------------------------------------------ */
/* Flowchart                                                           */
/* ------------------------------------------------------------------ */

export interface FlowNode {
  step: Step;
  /** Which path column: 0 is the usual path, 1 a path off it, and so on. */
  col: number;
  row: number;
  branch?: Branch;
}
export interface FlowEdge {
  from: string;
  to: string;
  /** The answer this edge stands for, at a fork ("Yes", "No"). */
  label?: string;
}

const signature = (step: Step) => JSON.stringify((step.when ?? []).map((item) => `${item.branchId}=${item.outcomeId}`));

/**
 * Lay out every step of a feature as a flowchart: one row per step in code order, one column
 * per path (the usual path on the left). Edges join steps on the same path, and each fork
 * joins its step to the first step of each answer. Paths that rejoin later are not drawn as
 * joined, because the trace doesn't say so; nothing is invented.
 */
export function flowLayout(feature: Feature): { nodes: FlowNode[]; edges: FlowEdge[]; columns: number } {
  const usual = defaultChoices(feature);
  const branchAt = new Map(feature.branches.map((branch) => [branch.stepId, branch]));
  const nodes: FlowNode[] = feature.steps.map((step, row) => {
    const col = (step.when ?? []).filter((item) => usual[item.branchId] !== undefined && usual[item.branchId] !== item.outcomeId).length;
    const branch = branchAt.get(step.id);
    return { step, col, row, ...(branch ? { branch } : {}) };
  });
  const edges: FlowEdge[] = [];
  const lastOnPath = new Map<string, Step>();
  for (const step of feature.steps) {
    const key = signature(step);
    const previous = lastOnPath.get(key);
    // After a fork, the next steps hang off its answers instead.
    if (previous && !branchAt.has(previous.id)) edges.push({ from: previous.id, to: step.id });
    lastOnPath.set(key, step);
  }
  for (const branch of feature.branches)
    for (const outcome of branch.outcomes) if (outcome.nextStepId) edges.push({ from: branch.stepId, to: outcome.nextStepId, label: outcome.label });
  return { nodes, edges, columns: Math.max(1, ...nodes.map((node) => node.col + 1)) };
}

/** Choices that make a step visible: the answers on its path, the rest left as they are. */
export function choicesFor(step: Step, current: Choices): Choices {
  const next = { ...current };
  for (const item of step.when ?? []) next[item.branchId] = item.outcomeId;
  return next;
}
