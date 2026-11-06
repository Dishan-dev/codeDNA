import { LEARNING_SCHEMA_VERSION, type RepoAnalysis, type RepoBundle } from '@codedna/shared';
import { hash } from '../features/captions.js';
import { buildLearningPlan } from './index.js';

/** URL-safe key for a repository name, e.g. "My Shop!" → "my-shop". */
export const repoKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'app';

/** Same hash as lesson ids, so a feature's story and its lesson share a slug. */
export const featureSlug = (key: string) => `f-${hash(key)}`;

/** One JSON document with everything the learning UI needs for a repository. */
export function buildRepoBundle(id: string, analysis: RepoAnalysis, source: RepoBundle['source'], name = analysis.name ?? id): RepoBundle {
  return {
    schemaVersion: LEARNING_SCHEMA_VERSION,
    id,
    name,
    source,
    ...(analysis.revision ? { revision: analysis.revision } : {}),
    framework: analysis.framework,
    stats: analysis.stats,
    partial: analysis.partial,
    limitations: analysis.limitations,
    features: analysis.features,
    slugs: Object.fromEntries(analysis.features.map((feature) => [feature.id, featureSlug(feature.key)])),
    plan: buildLearningPlan(analysis),
  };
}
