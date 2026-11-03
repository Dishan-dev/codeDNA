import type {
  Behavior,
  BehaviorCategory,
  BehaviorDiscovery,
  DiscoveredFeature,
  DiscoveredSymbol,
  Evidence,
  ExplanationCertainty,
  FeatureDiscovery,
  RepositorySnapshot,
  RepositoryUnderstanding,
} from '@codedna/shared';
import { buildStaticFlow } from './static-flow.js';
import { tokenize } from './evidence.js';

const MAX_BEHAVIORS = 40;
const MAX_LIBRARY = 12;
const MAX_INTERACTIONS = 8;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const WEIGHT: Record<BehaviorCategory, number> = { page: 6, api: 6, cli: 5, interaction: 3, library: 2, entry: 0 };

export function apiPath(path: string): string | undefined {
  const match = /^(?:src\/)?app\/(.+)\/route\.(?:ts|tsx|js|jsx)$/.exec(path);
  if (!match) return undefined;
  const parts = match[1]!.split('/').filter((part) => !/^\([^/]+\)$/.test(part));
  return parts.length ? `/${parts.join('/')}` : undefined;
}
/** Splits identifiers into plain words: `handleSubmitOrder` becomes `handle submit order`. */
export function humanize(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase();
}
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Candidate {
  key: string;
  category: BehaviorCategory;
  title: string;
  route?: string;
  methods?: string[];
  features: DiscoveredFeature[];
  path: string;
  symbol?: DiscoveredSymbol;
}
const manifestDir = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');
function parseManifests(snapshot: RepositorySnapshot): { dir: string; data: Record<string, unknown> }[] {
  const out: { dir: string; data: Record<string, unknown> }[] = [];
  for (const manifest of snapshot.manifests ?? []) {
    if (!/(?:^|\/)package\.json$/.test(manifest.path)) continue;
    try {
      const data: unknown = JSON.parse(manifest.content);
      if (data && typeof data === 'object' && !Array.isArray(data)) out.push({ dir: manifestDir(manifest.path), data: data as Record<string, unknown> });
    } catch { /* Manifests are untrusted optional text. */ }
  }
  return out;
}
const stem = (path: string) => path.replace(/\.[^./]+$/, '');

/**
 * Deterministic behavior candidates from existing analysis only. Nothing here executes code or
 * decides business meaning: titles come from routes and symbol names, or from a documentation
 * heading that shares a distinctive word with the entry point.
 */
export function discoverBehaviors(snapshot: RepositorySnapshot, understanding: RepositoryUnderstanding | undefined, discovery: FeatureDiscovery, complete = true): BehaviorDiscovery {
  const symbols = new Map(discovery.symbols.map((item) => [item.id, item]));
  const candidates = new Map<string, Candidate>();
  const limitations: string[] = [];
  const add = (c: Omit<Candidate, 'features'>, feature: DiscoveredFeature) => {
    const existing = candidates.get(c.key);
    if (existing) {
      if (!existing.features.some((f) => f.id === feature.id)) existing.features.push(feature);
      if (c.methods) existing.methods = [...new Set([...(existing.methods ?? []), ...c.methods])].sort(compare);
    } else candidates.set(c.key, { ...c, features: [feature] });
  };
  const features = [...discovery.features].sort((a, b) => compare(a.id, b.id));
  for (const feature of features.filter((f) => f.kind === 'route')) {
    const route = feature.routes[0] ?? feature.name;
    add({ key: `page:${route}`, category: 'page', title: route === '/' ? 'Open the home page' : `Open the ${route} page`, route, path: feature.files[0] ?? '' }, feature);
  }
  const pageByFile = new Map<string, Candidate>();
  for (const [key, c] of candidates) if (key.startsWith('page:')) pageByFile.set(c.path, c);
  const manifests = parseManifests(snapshot);
  const bins: { name: string; path: string }[] = [];
  const roots = new Set<string>();
  for (const { dir, data } of manifests) {
    const bin = data.bin;
    const entries: [string, unknown][] = typeof bin === 'string' ? [[String(data.name ?? 'cli'), bin]] : bin && typeof bin === 'object' ? Object.entries(bin) : [];
    for (const [name, target] of entries) if (typeof target === 'string') bins.push({ name, path: `${dir}${target.replace(/^\.\//, '')}` });
    for (const key of ['main', 'module', 'types']) if (typeof data[key] === 'string') roots.add(`${dir}${(data[key] as string).replace(/^\.\//, '')}`);
  }
  const rel = new Map<string, number>();
  for (const r of discovery.relationships) rel.set(r.sourceId, (rel.get(r.sourceId) ?? 0) + 1);
  const eventSources = new Set(discovery.relationships.filter((r) => r.kind === 'event-handler').map((r) => r.sourceId));
  const library: { feature: DiscoveredFeature; symbol: DiscoveredSymbol; score: number }[] = [];
  const interactions: { feature: DiscoveredFeature; symbol: DiscoveredSymbol }[] = [];
  const binFor = (path: string) => bins.find((b) => stem(b.path) === stem(path) || stem(b.path.replace(/^(?:dist|build|lib)\//, 'src/')) === stem(path));
  for (const feature of features) {
    if (feature.kind === 'exported-symbol') {
      const symbol = symbols.get(feature.symbols[0] ?? '');
      if (!symbol) continue;
      const api = apiPath(symbol.file);
      if (api && HTTP_METHODS.includes(symbol.name)) {
        add({ key: `api:${api}`, category: 'api', title: `Handle requests to ${api}`, route: api, methods: [symbol.name], path: symbol.file, symbol }, feature);
        continue;
      }
      const page = pageByFile.get(symbol.file);
      if (page) { add(page, feature); continue; }
      const bin = binFor(symbol.file);
      if (bin) { add({ key: `cli:${bin.name}`, category: 'cli', title: `Run the ${bin.name} command`, path: symbol.file }, feature); continue; }
      if (symbol.kind === 'component' && eventSources.has(symbol.id)) { interactions.push({ feature, symbol }); continue; }
      const isRoot = roots.has(symbol.file) || /(?:^|\/)index\.(?:ts|tsx|js|jsx)$/.test(symbol.file);
      library.push({ feature, symbol, score: (isRoot ? 100 : 0) + (rel.get(symbol.id) ?? 0) });
    } else if (feature.kind === 'entry-point') {
      const path = feature.files[0] ?? '';
      const bin = binFor(path);
      if (bin) add({ key: `cli:${bin.name}`, category: 'cli', title: `Run the ${bin.name} command`, path }, feature);
      else add({ key: `entry:${path}`, category: 'entry', title: `Start from ${path}`, path }, feature);
    }
  }
  for (const { feature, symbol } of interactions.slice(0, MAX_INTERACTIONS)) {
    add({ key: `interaction:${symbol.file}:${symbol.name}`, category: 'interaction', title: `Use the ${humanize(symbol.name)} controls`, path: symbol.file, symbol }, feature);
  }
  if (interactions.length > MAX_INTERACTIONS) limitations.push('Only the first interactive components are listed as behaviors.');
  const hasApplication = [...candidates.values()].some((c) => c.category === 'page' || c.category === 'api' || c.category === 'cli');
  if (!hasApplication) {
    library.sort((a, b) => b.score - a.score || compare(a.symbol.id, b.symbol.id));
    for (const { feature, symbol } of library.slice(0, MAX_LIBRARY)) add({ key: `library:${symbol.file}:${symbol.name}`, category: 'library', title: `Use ${symbol.name}`, path: symbol.file, symbol }, feature);
  } else if (library.length) limitations.push('Exported helper functions were not listed as behaviors because the repository exposes pages, APIs or commands.');

  // An entry file that already anchors another behavior adds nothing.
  for (const [key, c] of [...candidates]) if (c.category === 'entry' && [...candidates.values()].some((o) => o !== c && o.category !== 'entry' && o.features.some((f) => f.files.includes(c.path)))) candidates.delete(key);

  const headings = (understanding?.capabilities ?? []).filter((claim) => claim.certainty === 'documented');
  const usedHeadings = new Set<string>();
  const behaviors: Behavior[] = [];
  for (const candidate of [...candidates.values()].sort((a, b) => compare(a.key, b.key))) {
    // Anchor on the member whose static flow reaches the most steps; ties break on stable id.
    const flows = candidate.features
      .map((feature) => ({ feature, flow: buildStaticFlow(discovery, feature.id, { snapshotComplete: complete }) }))
      .sort((a, b) => b.flow.steps.length - a.flow.steps.length || compare(a.feature.id, b.feature.id));
    const { feature: anchor, flow } = flows[0]!;
    const verified = flow.relationships.length, unresolved = flow.unresolved.length;
    const anchorSymbol = candidate.symbol && anchor.symbols.includes(candidate.symbol.id) ? candidate.symbol : symbols.get(anchor.symbols[0] ?? '');
    const certainty: ExplanationCertainty = anchor.kind === 'entry-point' && !verified ? 'inferred' : unresolved && !verified ? 'unresolved' : 'verified';
    const location = anchor.evidence.find((e) => e.location)?.location ?? anchorSymbol?.location;
    const evidence: Evidence[] = anchor.evidence.slice(0, 3);
    let title = candidate.title, titleBasis: Behavior['titleBasis'] = 'derived';
    const words = tokenize(`${candidate.route ?? ''} ${anchorSymbol?.name ?? ''} ${candidate.path.split('/').slice(-2).join(' ').replace(/\.[^.]+$/, '')}`).filter((w) => w.length >= 4);
    const heading = headings.find((claim) => !usedHeadings.has(claim.text) && tokenize(claim.text).some((w) => words.includes(w)));
    if (heading) { title = heading.text; titleBasis = 'documented'; usedHeadings.add(heading.text); evidence.push(...heading.evidence.slice(0, 1)); }
    const where = candidate.route ? (candidate.methods?.length ? `${candidate.methods.join(', ')} ${candidate.route}` : candidate.route) : candidate.path;
    const trail = verified || unresolved
      ? ` Static analysis found ${verified} direct reference${verified === 1 ? '' : 's'} to follow${unresolved ? ` and ${unresolved} it could not resolve` : ''}.`
      : ' Static analysis found no further direct references to follow.';
    const summaries: Record<BehaviorCategory, string> = {
      page: `Shows what ${where} is wired to in the code.${trail}`,
      api: `Shows how requests to ${where} are handled in the code.${trail}`,
      cli: `Shows what the ${candidate.key.slice(4)} command starts.${trail}`,
      interaction: `Shows how ${anchorSymbol?.name ?? candidate.path} connects interface events to code.${trail}`,
      library: `Shows the exported ${anchorSymbol?.name ?? 'function'} and what it references.${trail}`,
      entry: `A conventionally named entry file; its runtime role is not verified.${trail}`,
    };
    const name = anchorSymbol?.name ?? where;
    behaviors.push({
      schemaVersion: '1.0', id: `behavior:${candidate.key}`, title: sentence(title), titleBasis, summary: summaries[candidate.category],
      category: candidate.category,
      entryPoint: {
        path: location?.path ?? candidate.path, line: location?.start.line ?? 1,
        ...(anchorSymbol ? { symbolId: anchorSymbol.id } : {}),
        ...(candidate.route ? { route: candidate.route } : {}),
        ...(candidate.methods?.length ? { methods: candidate.methods } : {}),
      },
      flowFeatureId: anchor.id, featureIds: candidate.features.map((f) => f.id).sort(compare),
      evidence, certainty, verifiedRelationships: verified, unresolvedRelationships: unresolved,
      coverage: unresolved || flow.truncated || !complete ? 'partial' : 'source-evidenced',
      limitations: flow.limitations.filter((l) => !l.startsWith('Static references do not prove')),
      suggestedQuestions: [
        `How does "${sentence(title)}" work?`,
        ...(verified ? [`What does ${name} do next?`] : []),
        ...(unresolved ? [`What could not be resolved for ${name}?`] : []),
        `Which code is responsible for ${name}?`,
      ],
    });
  }
  const score = (b: Behavior) => WEIGHT[b.category] * 10 + Math.min(b.verifiedRelationships, 20) * 3 + (b.titleBasis === 'documented' ? 5 : 0);
  behaviors.sort((a, b) => score(b) - score(a) || compare(a.id, b.id));
  const kept = behaviors.filter((b) => b.category !== 'entry' || b.verifiedRelationships > 0 || behaviors.length === 1).slice(0, MAX_BEHAVIORS);
  if (behaviors.length > MAX_BEHAVIORS) limitations.push(`Only the ${MAX_BEHAVIORS} highest-ranked behaviors are listed.`);
  if (!kept.length) limitations.push('No behavior was supported by the available analysis. Use the Advanced tools to explore the code directly.');
  if (!complete) limitations.push('The snapshot is partial; behaviors may be missing or incomplete.');
  limitations.push('Behaviors come from static analysis of routes, exports and references, not from running the application.');
  const recommended = kept.find((b) => b.verifiedRelationships > 0) ?? kept[0];
  return {
    schemaVersion: '1.0', snapshotId: snapshot.id, ...(snapshot.revision ? { revision: snapshot.revision } : {}),
    behaviors: kept, ...(recommended ? { recommendedId: recommended.id } : {}), limitations,
  };
}
