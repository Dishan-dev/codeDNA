import type { UserAction } from '@codedna/shared';

/** Explorer screens. Overview, page and trace are the primary flow; the rest are advanced tools. */
export type Screen = 'overview' | 'pages' | 'page' | 'trace' | 'reach' | 'advanced' | 'stories' | 'ask' | 'diagnostics';
const SCREENS: readonly Screen[] = ['overview', 'pages', 'page', 'trace', 'reach', 'advanced', 'stories', 'ask', 'diagnostics'];
export interface FlowLocation {
  screen: Screen;
  page?: string;
  action?: string;
  step?: string;
  symbol?: string;
  mode?: string;
  commit?: string;
}
const KEYS = ['view', 'page', 'action', 'step', 'symbol', 'mode', 'commit'] as const;
const MAX_PARAM = 500;

/** Parse the Explorer location from a query string. Unknown or oversized values are ignored. */
export function readFlowLocation(search: string): FlowLocation {
  const params = new URLSearchParams(search);
  const value = (key: string) => {
    const raw = params.get(key);
    return raw && raw.length <= MAX_PARAM ? raw : undefined;
  };
  const view = value('view');
  const screen = SCREENS.includes(view as Screen) ? (view as Screen) : 'overview';
  const location: FlowLocation = { screen };
  for (const key of ['page', 'action', 'step', 'symbol', 'mode', 'commit'] as const) {
    const item = value(key);
    if (item) location[key] = item;
  }
  return location;
}

/** Serialise a location, keeping unrelated parameters such as `example` and `source`. */
export function writeFlowLocation(search: string, location: FlowLocation): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) params.delete(key);
  if (location.screen !== 'overview') params.set('view', location.screen);
  for (const key of ['page', 'action', 'step', 'symbol', 'mode', 'commit'] as const) {
    const item = location[key];
    if (item) params.set(key, item);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A shareable trace link: repository source, commit, trace and step. */
export function tracePermalink(base: string, search: string, actionId: string, stepId: string | undefined, commit: string | undefined): string {
  return `${base}${writeFlowLocation(search, { screen: 'trace', action: actionId, ...(stepId ? { step: stepId } : {}), ...(commit ? { commit } : {}) })}`;
}

export function moveStep(ids: readonly string[], current: string | undefined, delta: 1 | -1): string | undefined {
  if (!ids.length) return undefined;
  const index = current ? ids.indexOf(current) : -1;
  if (index < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
}

export type ActionFilter = 'all' | 'data' | 'gap';
export function filterActions(actions: readonly UserAction[], filter: ActionFilter): UserAction[] {
  return actions.filter((action) => filter === 'all' || (filter === 'data' ? action.changesData : action.gapCount > 0));
}
export function groupByComponent(actions: readonly UserAction[]): { component: string; file: string; actions: UserAction[] }[] {
  const groups = new Map<string, { component: string; file: string; actions: UserAction[] }>();
  for (const action of actions) {
    const key = `${action.file}\u0000${action.component}`;
    const group = groups.get(key) ?? { component: action.component, file: action.file, actions: [] };
    group.actions.push(action);
    groups.set(key, group);
  }
  return [...groups.values()];
}
/** The header tab a screen belongs to. */
export function screenTab(screen: Screen): 'Overview' | 'Pages' | null {
  if (screen === 'overview' || screen === 'reach') return 'Overview';
  if (screen === 'pages' || screen === 'page' || screen === 'trace') return 'Pages';
  return null;
}
