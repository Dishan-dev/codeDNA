import type { EvidenceTier, TierCounts } from '@codedna/shared';

/** Badge text. Tiers are always distinguishable by this text, not only by colour. */
export const TIER_LABEL: Record<EvidenceTier, string> = {
  resolved: 'PROVEN',
  conventional: 'FRAMEWORK',
  heuristic: 'BEST GUESS',
  inferred: 'AI READING',
  gap: 'GAP',
};
const SINGULAR: Record<EvidenceTier, [string, string]> = {
  resolved: ['proven', 'proven'],
  conventional: ['framework', 'framework'],
  heuristic: ['best guess', 'best guesses'],
  inferred: ['AI reading', 'AI readings'],
  gap: ['gap', 'gaps'],
};
/** What each tier means. "Proven" is deliberately not described as type-checked. */
export const TIER_MEANING: Record<EvidenceTier, string> = {
  resolved: 'Call bound through a compiler-resolved import or a declaration in scope (not type-checked)',
  conventional: 'Follows a Next.js, React or web platform rule',
  heuristic: 'Matched by name or URL text',
  inferred: 'Plain-English interpretation by AI, not proof',
  gap: 'CodeDNA can’t follow this step',
};
export const LEGEND_ORDER: EvidenceTier[] = ['resolved', 'conventional', 'heuristic', 'inferred', 'gap'];
export const COUNT_ORDER: Exclude<EvidenceTier, 'inferred'>[] = ['resolved', 'conventional', 'heuristic', 'gap'];

export function tierCount(tier: EvidenceTier, count: number): string {
  return `${count} ${SINGULAR[tier][count === 1 ? 0 : 1]}`;
}

/** One-line status for a page row, derived from its actions' worst tiers. */
export function pageStatus(summary: TierCounts, actionCount: number): { text: string; tier: EvidenceTier | null } {
  if (!actionCount) return { text: 'No actions found', tier: null };
  if (summary.gap) return { text: `${summary.gap} with gaps`, tier: 'gap' };
  if (summary.heuristic) return { text: tierCount('heuristic', summary.heuristic), tier: 'heuristic' };
  return { text: 'All followed', tier: 'resolved' };
}
