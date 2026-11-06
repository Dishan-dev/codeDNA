import { CONFIDENCE_LABELS, type ConceptId, type Confidence, type StepStage } from '@codedna/shared';

export type IconName =
  | 'click'
  | 'form'
  | 'client'
  | 'request'
  | 'server'
  | 'check'
  | 'logic'
  | 'database'
  | 'external'
  | 'response'
  | 'screen'
  | 'unknown'
  | 'play'
  | 'pause'
  | 'back'
  | 'next'
  | 'replay'
  | 'code'
  | 'branch'
  | 'lock'
  | 'done'
  | 'star'
  | 'flame'
  | 'lightbulb'
  | 'terminal'
  | 'github'
  | 'book';

/** What each journey stage is called on screen, and its icon. */
export const STAGES: Record<StepStage, { label: string; icon: IconName }> = {
  click: { label: 'You act', icon: 'click' },
  form: { label: 'Form', icon: 'form' },
  client: { label: 'Browser', icon: 'client' },
  request: { label: 'Request', icon: 'request' },
  server: { label: 'Server', icon: 'server' },
  check: { label: 'Check', icon: 'check' },
  logic: { label: 'Logic', icon: 'logic' },
  database: { label: 'Database', icon: 'database' },
  external: { label: 'Other service', icon: 'external' },
  response: { label: 'Answer', icon: 'response' },
  screen: { label: 'Screen', icon: 'screen' },
};

/** Confidence in friendly words, with what it means. */
export const CONFIDENCE: Record<Confidence, { label: string; hint: string }> = {
  resolved: { label: CONFIDENCE_LABELS.resolved, hint: 'CodeDNA followed this in your code.' },
  conventional: { label: CONFIDENCE_LABELS.conventional, hint: 'This follows a rule of the framework, like Next.js routes.' },
  heuristic: { label: CONFIDENCE_LABELS.heuristic, hint: 'CodeDNA matched this by name or shape, so it is probably right.' },
  gap: { label: CONFIDENCE_LABELS.gap, hint: 'This is decided while the app runs, so CodeDNA can’t see it from the code.' },
};

/**
 * One tint per concept, used everywhere the concept appears. Always shown next to the concept's
 * name, never as the only signal.
 */
export const CONCEPT_TINT: Record<ConceptId, string> = {
  component: '#6366f1',
  props: '#8b5cf6',
  state: '#ec4899',
  'event-handler': '#f97316',
  'conditional-rendering': '#d946ef',
  'async-await': '#0ea5e9',
  'api-call': '#06b6d4',
  'server-action': '#14b8a6',
  validation: '#eab308',
  authentication: '#ef4444',
  database: '#22c55e',
  navigation: '#3b82f6',
};
