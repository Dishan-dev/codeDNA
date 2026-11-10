import type { IconName } from '@codedna/learn-ui';
import type { QaStepKind } from '@codedna/shared';
import type { FlowState } from '@/lib/qa-flows';

/** How each QA state looks, shared by the flows and journeys views. */
export const STATE: Record<FlowState, { label: string; icon: IconName; chip: string; dot: string; node: string }> = {
  failed: { label: 'Broke', icon: 'unknown', chip: 'bg-danger-soft text-danger', dot: 'bg-danger', node: 'border-danger bg-danger-soft text-danger' },
  warning: { label: 'Look at', icon: 'logic', chip: 'bg-warning-soft text-warning', dot: 'bg-warning', node: 'border-warning bg-warning-soft text-warning' },
  passed: { label: 'Passed', icon: 'done', chip: 'bg-success-soft text-success', dot: 'bg-success', node: 'border-success bg-success-soft text-success' },
  skipped: { label: 'Skipped', icon: 'next', chip: 'bg-surface-2 text-muted', dot: 'bg-muted/60', node: 'border-dashed border-line bg-surface text-muted' },
  untested: { label: 'Not tested', icon: 'play', chip: 'bg-surface-2 text-muted', dot: 'bg-line', node: 'border-dashed border-line bg-surface text-muted' },
  unavailable: { label: 'Can’t test', icon: 'lock', chip: 'bg-surface-2 text-muted', dot: 'bg-line', node: 'border-dashed border-line bg-surface text-muted' },
  running: { label: 'Testing…', icon: 'play', chip: 'bg-accent-soft text-accent', dot: 'bg-accent motion-safe:animate-pulse', node: 'border-accent bg-accent-soft text-accent' },
};
export const STEP_ICON: Record<QaStepKind, IconName> = { open: 'screen', find: 'click', fill: 'form', press: 'click', request: 'request', server: 'server', result: 'response' };
