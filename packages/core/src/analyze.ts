import { ANALYSIS_SCHEMA_VERSION, type RepoAnalysis, type RepositoryText } from '@codedna/shared';
import { findNextRoutes } from './adapters/ui/next-app-router.js';
import { findDuplicates } from './features/duplicates.js';
import { detectFeatures } from './features/index.js';
import { detectFramework } from './framework.js';
import { createResolution, matchesAlias } from './graph/host.js';
import { buildImportGraph } from './graph/imports.js';
import { createAnalysisProgram } from './graph/program.js';
import { createResolver } from './graph/resolve.js';
import { parseFile, summarize } from './snapshot/parse.js';
import { DEFAULT_SNAPSHOT_LIMITS, diagnostic, validateSnapshot, type SnapshotLimits } from './snapshot/validate.js';

export interface AnalyzeOptions {
  limits?: Partial<SnapshotLimits>;
  /** Wall-clock budget for the whole analysis. */
  timeBudgetMs?: number;
  now?: () => number;
}
export const DEFAULT_TIME_BUDGET_MS = 20_000;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The root README's first heading, else the root package.json name. Data only; nothing is run. */
function appName(manifests: readonly RepositoryText[], documents: readonly RepositoryText[]): string | undefined {
  const readme = documents.find((document) => /^readme(?:\.[\w-]+)?\.md$/i.test(document.path));
  const heading = readme && /^#\s+(.{1,60}?)\s*$/m.exec(readme.content)?.[1];
  if (heading) return heading;
  const manifest = manifests.find((item) => item.path === 'package.json');
  try {
    const name = manifest && (JSON.parse(manifest.content) as { name?: unknown }).name;
    if (typeof name === 'string' && /^[@\w./-]{1,60}$/.test(name)) {
      const base = name.replace(/^@[^/]+\//, '').replace(/[-_.]+/g, ' ');
      return base.charAt(0).toUpperCase() + base.slice(1);
    }
  } catch {
    // An unreadable manifest has no name.
  }
  return undefined;
}

/**
 * Snapshot in, analysis out. Pure: no filesystem, network, or execution of repository code.
 * Every stage is bounded; hitting a limit returns a partial result instead of failing.
 */
export function analyzeRepository(snapshot: unknown, options: AnalyzeOptions = {}): RepoAnalysis {
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const checked = validateSnapshot(snapshot, { ...DEFAULT_SNAPSHOT_LIMITS, ...options.limits });
  const diagnostics = [...checked.diagnostics];
  const limitations: string[] = [];
  let partial = checked.partial;

  const resolution = createResolution(checked.files, checked.manifests);
  diagnostics.push(...resolution.diagnostics);
  const program = createAnalysisProgram(checked.files, resolution);
  const parsed = [...program.files, ...checked.files.filter((file) => file.language === 'json').map(parseFile)].sort((a, b) => compare(a.path, b.path));

  const imports = buildImportGraph(parsed, checked.manifests, { deadline, now, resolution });
  partial ||= imports.partial;
  diagnostics.push(...imports.diagnostics);
  const next = findNextRoutes(program.files);
  diagnostics.push(...next.diagnostics);
  const framework = detectFramework(checked.manifests, imports.edges, next.routes);
  const supported = program.files.length > 0;

  let features: RepoAnalysis['features'] = [];
  if (supported && now() <= deadline) {
    const isLocalModule = (specifier: string, from: string) => specifier.startsWith('.') || specifier.startsWith('/') || matchesAlias(specifier, resolution.optionsFor(from));
    const resolver = createResolver(program, { isLocalModule });
    const detected = detectFeatures({ program, resolver, routes: next.routes, imports: imports.edges }, { deadline, now });
    features = detected.features;
    partial ||= detected.partial;
    diagnostics.push(...detected.diagnostics);
  } else if (supported) {
    partial = true;
    diagnostics.push(diagnostic('feature-time-limit', 'warning', 'There was no time left to follow features.'));
  }

  if (!supported) limitations.push('CodeDNA reads TypeScript and JavaScript. This repository has none it can read.');
  else if (framework.support === 'limited') limitations.push('Lessons are built for Next.js App Router apps. Other code is shown, but features may be missing.');
  if (partial) limitations.push('Some parts were too big to read — lessons cover the rest.');

  const files = parsed.map(summarize);
  const name = appName(checked.manifests, checked.documents);
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    snapshotId: checked.id,
    ...(checked.revision ? { revision: checked.revision } : {}),
    ...(name ? { name } : {}),
    supported,
    framework,
    files,
    imports: imports.edges,
    routes: next.routes,
    features,
    duplicates: supported ? findDuplicates(program.files) : [],
    diagnostics,
    partial,
    limitations,
    stats: {
      files: files.length,
      skippedFiles: checked.skippedFiles,
      imports: imports.edges.length,
      routes: next.routes.length,
      features: features.length,
      durationMs: Math.max(0, now() - started),
    },
  };
}
