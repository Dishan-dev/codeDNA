import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeSnapshot, analyzeUIFlows } from './index.js';
import { discoverFeatures } from './features.js';
import { understandRepository } from './understanding.js';
import { discoverBehaviors } from './behaviors.js';
import { buildBehaviorStory } from './stories.js';
import { answerQuestion } from './ask.js';

/**
 * Comprehension evaluation: for each representative repository shape, can a first-time reader
 * (1) learn what it does or be told honestly that it is unknown, (2) see its behaviors,
 * (3) follow one, (4) check the evidence against real source lines, (5) see what is uncertain?
 */
interface Fixture { name: string; files: Record<string, string>; documents?: { path: string; content: string }[]; manifests?: { path: string; content: string }[]; expectBehaviors: boolean; documented: boolean }
const README = '# Shop\n\nA small shop application used to place customer orders online.\n\n## Orders\n\nPlace orders.\n';
const fixtures: Fixture[] = [
  { name: 'frontend application', expectBehaviors: true, documented: true, documents: [{ path: 'README.md', content: README }],
    files: { 'app/page.tsx': "import { Cart } from './cart';\nexport default function Home() { return <Cart />; }", 'app/cart.tsx': 'export function Cart() { return <button onClick={clear} />; }\nfunction clear() {}' } },
  { name: 'full-stack application', expectBehaviors: true, documented: true, documents: [{ path: 'README.md', content: README }],
    files: { 'app/page.tsx': 'export default function Home() { return null; }', 'app/api/orders/route.ts': 'export async function POST() { return save(); }\nfunction save() { return null; }' } },
  { name: 'backend API', expectBehaviors: true, documented: false,
    files: { 'app/api/items/route.ts': 'export function GET() { return list(); }\nexport function POST() { return null; }\nfunction list() { return []; }' } },
  { name: 'library', expectBehaviors: true, documented: false, manifests: [{ path: 'package.json', content: '{"main":"src/index.ts"}' }],
    files: { 'src/index.ts': 'export function parse(input: string) { return tokenize(input); }\nfunction tokenize(s: string) { return [s]; }' } },
  { name: 'CLI', expectBehaviors: true, documented: false, manifests: [{ path: 'package.json', content: '{"name":"mytool","bin":"./cli.ts"}' }],
    files: { 'cli.ts': 'export function main() { run(); }\nfunction run() {}' } },
  { name: 'monorepo', expectBehaviors: true, documented: false,
    files: { 'apps/web/app/page.tsx': 'export default function Home() { return null; }', 'packages/api/app/api/ping/route.ts': 'export function GET() { return null; }' } },
  { name: 'minimal documentation, unsupported shape', expectBehaviors: false, documented: false, files: { 'src/constants.ts': 'const answer = 42;' } },
];

describe.each(fixtures)('comprehension: $name', (fixture) => {
  const snapshot: RepositorySnapshot = {
    schemaVersion: '1.0', id: 'eval',
    files: Object.entries(fixture.files).map(([path, content]) => ({ id: path, path, content })),
    ...(fixture.documents ? { documents: fixture.documents } : {}),
    ...(fixture.manifests ? { manifests: fixture.manifests } : {}),
  };
  const result = analyzeSnapshot(snapshot);
  const flow = analyzeUIFlows(snapshot);
  const understanding = understandRepository(snapshot, result, flow.graph, true);
  const discovery = discoverFeatures(snapshot, result, flow.graph, true);
  const behaviors = discoverBehaviors(snapshot, understanding, discovery, true);
  const lines = (path: string) => (snapshot.files.find((f) => f.path === path) ?? snapshot.documents?.find((d) => d.path === path))?.content.split('\n') ?? [];

  it('1. says what the repository does, or honestly that documentation does not', () => {
    if (fixture.documented) expect(understanding.introduction).toMatchObject({ certainty: 'documented' });
    else expect(understanding.introduction.certainty).not.toBe('documented');
  });
  it('2. lists supported behaviors only when evidence supports them', () => {
    expect(behaviors.behaviors.length > 0).toBe(fixture.expectBehaviors);
    if (!fixture.expectBehaviors) expect(behaviors.limitations.join(' ')).toMatch(/No behavior/);
  });
  it('3. gives a followable story, and 4. every cited excerpt is real source text', () => {
    for (const behavior of behaviors.behaviors) {
      const story = buildBehaviorStory(behavior, discovery, snapshot);
      expect(story.steps.length).toBeGreaterThan(0);
      for (const item of story.evidence) {
        const start = item.location!.start.line;
        const real = lines(item.path);
        expect(real.length).toBeGreaterThanOrEqual(start);
        const first = item.excerpt.split('\n').find((l) => l.trim())!;
        expect(real.some((line) => line.slice(0, 200).includes(first.trim().slice(0, 40)))).toBe(true);
      }
    }
  });
  it('5. discloses uncertainty: static-only caveat on every story and answer', () => {
    for (const behavior of behaviors.behaviors) {
      const story = buildBehaviorStory(behavior, discovery, snapshot);
      expect(story.limitations.join(' ')).toContain('not proof');
      const answer = answerQuestion(`How does ${behavior.title} work?`, { snapshot, discovery, understanding, behaviors, story: (b) => buildBehaviorStory(b, discovery, snapshot) });
      expect(answer.notes.join(' ')).toContain('static analysis');
      expect(answer.certainty).not.toBe('runtime-observed');
    }
    expect(behaviors.limitations.join(' ')).toContain('static analysis');
  });
});
