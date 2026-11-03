import type {
  Behavior,
  BehaviorStory,
  EvidenceBundle,
  EvidenceItem,
  FeatureDiscovery,
  RepositorySnapshot,
  RepositoryUnderstanding,
  SourceLocation,
} from '@codedna/shared';

export interface EvidenceLimits {
  maxItems: number;
  maxExcerptLines: number;
  maxLineLength: number;
  maxTotalChars: number;
}
export const DEFAULT_EVIDENCE_LIMITS: EvidenceLimits = { maxItems: 12, maxExcerptLines: 14, maxLineLength: 200, maxTotalChars: 8000 };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const STOPWORDS = new Set('a an and are as at be by can do does for from how i in is it of on or that the this to was what when where which who why with work works happen happens after before my me use used uses'.split(' '));
const SECRET = /((?:api[_-]?key|secret|token|passwd|password|authorization|private[_-]?key)["']?\s*[:=]\s*)(["'`])[^"'`\r\n]{6,}\2/gi;

/** Lower-cased identifier-aware tokens; camelCase and path separators split. */
export function tokenize(text: string): string[] {
  const parts = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  return [...new Set(parts.filter((part) => part.length > 1 && !STOPWORDS.has(part)))];
}
export function redactSecrets(text: string): string {
  return text.replace(SECRET, '$1$2[redacted]$2');
}
const clip = (line: string, max: number) => (line.length > max ? `${line.slice(0, max)}…` : line);

/** Bounded, redacted source lines around a location. Returns undefined when the file is absent. */
export function excerptAt(snapshot: RepositorySnapshot, location: SourceLocation, limits: EvidenceLimits = DEFAULT_EVIDENCE_LIMITS, context = 1): string | undefined {
  const file = snapshot.files.find((item) => item.path === location.path) ?? snapshot.documents?.find((item) => item.path === location.path);
  if (!file) return undefined;
  const lines = file.content.split(/\r?\n/);
  const first = Math.max(1, location.start.line - context);
  const last = Math.min(lines.length, Math.max(location.start.line, location.end.column === 1 ? location.end.line - 1 : location.end.line) + context, first + limits.maxExcerptLines - 1);
  return redactSecrets(lines.slice(first - 1, last).map((line) => clip(line, limits.maxLineLength)).join('\n'));
}
export function evidenceId(kind: EvidenceItem['kind'], location: SourceLocation): string {
  return `ev:${kind}:${location.path}:${location.start.line}-${Math.max(location.start.line, location.end.line)}`;
}
export function makeEvidence(snapshot: RepositorySnapshot, kind: EvidenceItem['kind'], title: string, location: SourceLocation, limits = DEFAULT_EVIDENCE_LIMITS): EvidenceItem | undefined {
  const excerpt = excerptAt(snapshot, location, limits);
  if (excerpt === undefined) return undefined;
  const origin = snapshot.documents?.some((doc) => doc.path === location.path) ? 'documentation' : 'source';
  return { id: evidenceId(kind, location), kind, title, path: location.path, location, excerpt, origin };
}

export interface RetrievalInput {
  snapshot: RepositorySnapshot;
  discovery: FeatureDiscovery;
  understanding?: RepositoryUnderstanding;
  behavior?: Behavior;
  story?: BehaviorStory;
  stepId?: string;
  question?: string;
}
/**
 * Deterministic, bounded retrieval. Behavior and step evidence ranks first, then question matches.
 * Nothing here calls a model; the result is the only repository content an explainer may see.
 */
export function retrieveEvidence(input: RetrievalInput, limits: EvidenceLimits = DEFAULT_EVIDENCE_LIMITS): EvidenceBundle {
  const ranked: { score: number; item: EvidenceItem }[] = [];
  const seen = new Set<string>();
  const add = (score: number, item: EvidenceItem | undefined) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    ranked.push({ score, item });
  };
  const { snapshot, discovery, behavior, story, question } = input;
  if (story) {
    const step = input.stepId ? story.steps.find((item) => item.id === input.stepId) : undefined;
    const byId = new Map(story.evidence.map((item) => [item.id, item]));
    if (step) for (const id of step.evidenceIds) add(1000, byId.get(id));
    for (const item of story.evidence) add(500, item);
  } else if (behavior) {
    behavior.evidence.forEach((entry) => entry.location && add(500, makeEvidence(snapshot, 'source', entry.description, entry.location, limits)));
  }
  const tokens = tokenize([question ?? '', behavior?.title ?? ''].join(' '));
  if (tokens.length) {
    const hit = (text: string) => { const words = new Set(tokenize(text)); return tokens.reduce((n, token) => n + (words.has(token) ? 1 : 0), 0); };
    for (const symbol of discovery.symbols) {
      const score = hit(`${symbol.name} ${symbol.file}`);
      if (score) add(score * 10 + (symbol.exported ? 1 : 0), makeEvidence(snapshot, 'symbol', `${symbol.kind} ${symbol.name}`, symbol.location, limits));
    }
    for (const feature of discovery.features) {
      const score = hit(`${feature.name} ${feature.routes.join(' ')}`);
      const where = feature.evidence.find((entry) => entry.location)?.location;
      if (score && where) add(score * 10 + 2, makeEvidence(snapshot, feature.kind === 'route' ? 'route' : 'entry-point', feature.name, where, limits));
    }
    for (const doc of snapshot.documents ?? []) {
      const lines = doc.content.split(/\r?\n/);
      for (let i = 0; i < lines.length && i < 600; i++) {
        const score = lines[i] ? hit(lines[i]!) : 0;
        if (score >= Math.min(2, tokens.length)) {
          const location = { path: doc.path, start: { line: i + 1, column: 1 }, end: { line: i + 1, column: 1 } };
          add(score * 8, makeEvidence(snapshot, 'documentation', `${doc.path}:${i + 1}`, location, limits));
        }
      }
    }
  }
  ranked.sort((a, b) => b.score - a.score || compare(a.item.id, b.item.id));
  const items: EvidenceItem[] = [];
  let chars = 0, truncated = ranked.length > limits.maxItems;
  for (const { item } of ranked) {
    if (items.length >= limits.maxItems || chars + item.excerpt.length > limits.maxTotalChars) { truncated = true; break; }
    items.push(item);
    chars += item.excerpt.length;
  }
  return { schemaVersion: '1.0', query: { ...(behavior ? { behaviorId: behavior.id } : {}), ...(input.stepId ? { stepId: input.stepId } : {}), ...(question ? { question } : {}) }, items, truncated };
}
