import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, UIFlowGraph } from '@codedna/shared';
import {
  analyzeSnapshot,
  analyzeUIFlows,
  generateLearningPlan,
  expoRouterAdapter,
  reactNavigationAdapter,
  reactRouterAdapter,
  nextAppRouterAdapter,
} from './index.js';
function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'learning-fixture',
    revision: 'abc',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const base = snapshot({
  'src/index.ts': `import {value} from './util'; console.log(value)`,
  'src/util.ts': 'export const value=1',
  'src/extra.ts': 'export const extra=1',
  'src/other.ts': 'export const other=1',
});
const cases = [
  {
    name: 'Next.js',
    adapter: nextAppRouterAdapter,
    files: {
      'app/page.tsx': `import Link from 'next/link';export default function Page(){return <Link href="/about"/>}`,
      'app/about/page.tsx': `export default function About(){return null}`,
    },
  },
  {
    name: 'React Router',
    adapter: reactRouterAdapter,
    files: {
      'routes.tsx': `import {Routes,Route,Link} from 'react-router';function Home(){return <Link to="/about"/>} function About(){return null} export function App(){return <Routes><Route path="/" element={<Home/>}/><Route path="/about" element={<About/>}/></Routes>}`,
    },
  },
  {
    name: 'Expo Router',
    adapter: expoRouterAdapter,
    files: {
      'app/_layout.tsx': `import {Stack} from 'expo-router';export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `import {Link} from 'expo-router';export default function Home(){return <Link href="/about"/>}`,
      'app/about.tsx': `export default function About(){return null}`,
    },
  },
  {
    name: 'React Navigation',
    adapter: reactNavigationAdapter,
    files: {
      'App.tsx': `import {createNativeStackNavigator} from '@react-navigation/native-stack';function Home({navigation}){navigation.navigate('About');return null} function About(){return null} const Stack=createNativeStackNavigator();export function App(){return <Stack.Navigator><Stack.Screen name="Home" component={Home}/><Stack.Screen name="About" component={About}/></Stack.Navigator>}`,
    },
  },
];
describe('learning plan', () => {
  it('provides bounded steps with entry heuristics and source-evidenced dependency lessons', () => {
    const result = analyzeSnapshot(base),
      plan = generateLearningPlan(result);
    expect(plan.steps.map((s) => s.kind)).toEqual([
      'overview',
      'entry',
      'dependency',
      'module',
      'impact',
      'recap',
    ]);
    expect(plan.steps.find((s) => s.kind === 'entry')?.files).toContain(
      'src/index.ts',
    );
    expect(plan.steps.find((s) => s.kind === 'entry')?.explanation).toContain(
      'do not prove',
    );
    const dependency = plan.steps.find((s) => s.kind === 'dependency')!;
    expect(
      dependency.evidence.some((e) => e.location?.path === 'src/index.ts'),
    ).toBe(true);
    expect(dependency.files.indexOf('src/util.ts')).toBeLessThan(
      dependency.files.indexOf('src/index.ts'),
    );
  });
  it.each(cases)(
    'uses actual $name UI flow without inventing screens',
    ({ files, adapter }) => {
      const repository = snapshot(files),
        analysis = analyzeSnapshot(repository),
        flow = analyzeUIFlows(repository, {}, adapter),
        plan = generateLearningPlan(analysis, flow.graph);
      const step = plan.steps.find((s) => s.kind === 'navigation');
      expect(step).toBeDefined();
      expect(
        step?.screenIds?.every((id) =>
          flow.graph.nodes.some((n) => n.id === id),
        ),
      ).toBe(true);
      expect(
        step?.navigationEdgeIds?.every((id) =>
          flow.graph.edges.some((e) => e.id === id),
        ),
      ).toBe(true);
    },
  );
  it('does not invent routes, entry points or questions in empty or disconnected data', () => {
    const repository = snapshot({
        'alpha.ts': 'export const a=1',
        'beta.ts': 'export const b=1',
      }),
      plan = generateLearningPlan(analyzeSnapshot(repository));
    expect(plan.steps.map((s) => s.kind)).toEqual(['overview', 'recap']);
    expect(plan.steps.at(-1)?.questions).toBeUndefined();
    expect(generateLearningPlan(analyzeSnapshot(snapshot({}))).steps).toEqual(
      [],
    );
    expect(generateLearningPlan(null).warnings).toContain(
      'Dependency analysis is unavailable or incomplete.',
    );
  });
  it('reports partial and incomplete analysis and never fabricates invalid dependency evidence', () => {
    const analysis = analyzeSnapshot(base);
    analysis.dependencyGraph.edges.push({
      id: 'invalid',
      sourceId: 'file:missing.ts',
      targetId: 'file:src/util.ts',
      metadata: { confidence: 1, evidence: [] },
    });
    const plan = generateLearningPlan(analysis, undefined, {
      snapshotComplete: false,
      uiFlowDiagnostics: [
        { id: 'd', severity: 'warning', message: 'ambiguous' },
      ],
    });
    expect(plan.warnings.length).toBeGreaterThanOrEqual(3);
    expect(plan.steps.flatMap((s) => s.dependencyEdgeIds ?? [])).not.toContain(
      'invalid',
    );
  });
  it('produces answerable importer questions with evidence and no ambiguous choices', () => {
    const analysis = analyzeSnapshot(base),
      plan = generateLearningPlan(analysis),
      question = plan.steps
        .at(-1)
        ?.questions?.find((q) => q.id.startsWith('question:importer:'));
    expect(question).toBeDefined();
    expect(
      question?.choices.find((c) => c.id === question.answerId)?.label,
    ).toBe('src/index.ts');
    expect(question?.evidence[0]?.location?.path).toBe('src/index.ts');
    expect(new Set(question?.choices.map((c) => c.id)).size).toBe(3);
    const ambiguous = snapshot({
      ...Object.fromEntries(base.files.map((f) => [f.path, f.content])),
      'src/extra.ts': `import './util'`,
    });
    expect(
      generateLearningPlan(analyzeSnapshot(ambiguous)).steps.at(-1)?.questions,
    ).toBeUndefined();
  });
  it('skips ambiguous navigation questions, even when screen labels repeat', () => {
    const analysis = analyzeSnapshot(base),
      meta = { confidence: 1, evidence: [{ description: 'navigation' }] },
      flow: UIFlowGraph = {
        schemaVersion: '1.0',
        nodes: [
          {
            id: 'a',
            label: 'Same',
            sourceFile: 'src/index.ts',
            metadata: meta,
          },
          { id: 'b', label: 'Same', sourceFile: 'src/util.ts', metadata: meta },
          {
            id: 'c',
            label: 'Other',
            sourceFile: 'src/other.ts',
            metadata: meta,
          },
          {
            id: 'd',
            label: 'Extra',
            sourceFile: 'src/extra.ts',
            metadata: meta,
          },
        ],
        edges: [{ id: 'e', sourceId: 'a', targetId: 'c', metadata: meta }],
      };
    expect(
      generateLearningPlan(analysis, flow)
        .steps.at(-1)
        ?.questions?.some((q) => q.id.startsWith('question:navigation:')),
    ).toBe(false);
  });
  it('creates a navigation question only for one unique evidenced source', () => {
    const analysis = analyzeSnapshot(base),
      meta = {
        confidence: 1,
        evidence: [
          {
            description: 'Link evidence',
            location: {
              path: 'src/index.ts',
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            },
          },
        ],
      };
    const flow: UIFlowGraph = {
      schemaVersion: '1.0',
      nodes: analysis.dependencyGraph.nodes.map((n, i) => ({
        id: `s${i}`,
        label: `Screen ${i}`,
        sourceFile: n.label,
        metadata: meta,
      })),
      edges: [{ id: 'e', sourceId: 's0', targetId: 's1', metadata: meta }],
    };
    const question = generateLearningPlan(analysis, flow)
      .steps.at(-1)
      ?.questions?.find((q) => q.id.startsWith('question:navigation:'));
    expect(question?.answerId).toBe('s0');
    expect(question?.evidence[0]?.location?.path).toBe('src/index.ts');
    flow.edges.push({
      id: 'other',
      sourceId: 's2',
      targetId: 's1',
      metadata: { confidence: 1, evidence: [] },
    });
    expect(
      generateLearningPlan(analysis, flow)
        .steps.at(-1)
        ?.questions?.some((q) => q.id.startsWith('question:navigation:')),
    ).toBe(false);
  });
  it('handles missing graph arrays as incomplete data', () => {
    const result = analyzeSnapshot(base);
    const malformed = {
      ...result,
      dependencyGraph: { ...result.dependencyGraph, nodes: undefined },
    } as unknown as typeof result;
    const plan = generateLearningPlan(malformed);
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings).toContain(
      'Dependency analysis is unavailable or incomplete.',
    );
  });
  it('handles cycles and produces deterministic order across reordered graphs', () => {
    const analysis = analyzeSnapshot(
      snapshot({
        'a.ts': `import './b'`,
        'b.ts': `import './a'`,
        'c.ts': 'export const c=1',
      }),
    );
    const plan = generateLearningPlan(analysis);
    expect(plan.steps.some((s) => s.kind === 'dependency')).toBe(true);
    expect(
      generateLearningPlan({
        ...analysis,
        dependencyGraph: {
          ...analysis.dependencyGraph,
          nodes: [...analysis.dependencyGraph.nodes].reverse(),
          edges: [...analysis.dependencyGraph.edges].reverse(),
        },
      }),
    ).toEqual(plan);
  });
  it('bounds lessons and handles a 500-file fixture', () => {
    const files: Record<string, string> = { 'f0.ts': 'export const x=1' };
    for (let i = 1; i < 500; i++) files[`f${i}.ts`] = `import './f${i - 1}'`;
    const analysis = analyzeSnapshot(snapshot(files)),
      start = Date.now(),
      plan = generateLearningPlan(analysis, undefined, {
        maxFilesPerStep: 4,
        maxQuestions: 1,
      });
    expect(plan.steps.length).toBeLessThanOrEqual(7);
    expect(plan.steps.every((s) => s.files.length <= 4)).toBe(true);
    expect(
      plan.steps.flatMap((s) => s.questions ?? []).length,
    ).toBeLessThanOrEqual(1);
    expect(Date.now() - start).toBeLessThan(15000);
  });
});
