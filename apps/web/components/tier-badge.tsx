import type { EvidenceTier } from '@codedna/shared';
import { TIER_LABEL, TIER_MEANING, tierCount } from '@/lib/tiers';

/** The one evidence-tier badge. With a count it reads e.g. "4 proven"; without, "PROVEN". */
export function TierBadge({ tier, count, label }: { tier: EvidenceTier; count?: number; label?: string }) {
  const text = label ?? (count === undefined ? TIER_LABEL[tier] : tierCount(tier, count));
  return (
    <span className={`tier-badge tier-badge--${tier}`} title={TIER_MEANING[tier]}>
      {text}
    </span>
  );
}
