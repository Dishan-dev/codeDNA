import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, UIFlowGraph } from '@codedna/shared';
import { analyzeSnapshot } from './index.js';
import { discoverFeatures } from './features.js';
import { buildStaticFlow } from './static-flow.js';

const flow: UIFlowGraph = { schemaVersion: '1.0', nodes: [], edges: [] };
function make(content: string): RepositorySnapshot { return { schemaVersion: '1.0', id: 'walk', files: [{ id: 'src/index.ts', path: 'src/index.ts', content }] }; }
const run = (snapshot: RepositorySnapshot, name: string, complete = true) => {
  const discovery = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow, complete);
  const feature = discovery.features.find((item) => item.name === name)!;
  return buildStaticFlow(discovery, feature.id, { snapshotComplete: complete });
};
describe('bounded static walkthroughs', () => {
  it('follows only direct calls with exact source evidence', () => {
    const result = run(make('export function start(){ helper(); }\nfunction helper(){ return 1; }'), 'start');
    expect(result.steps.map((step) => step.symbolId)).toHaveLength(2);
    expect(result.relationships).toMatchObject([{ kind: 'call', location: { path: 'src/index.ts' } }]);
    expect(result.steps[1]?.location.start.line).toBe(2);
    expect(result.steps[0]?.branches[0]?.targetStepId).toBe(result.steps[1]?.id);
    expect(run(make('export function start(){ helper(); }\nfunction helper(){ return 1; }'), 'start')).toEqual(result);
  });
  it('keeps unresolved HTTP requests as boundaries with conditions', () => {
    const result = run(make("export function load(flag: boolean, path: string){ if(flag) fetch(path); }"), 'load');
    expect(result.unresolved).toHaveLength(1);
    expect(result.steps[1]).toMatchObject({ verification: 'unresolved', file: 'src/index.ts' });
    expect(result.steps[0]?.branches[0]?.condition).toBe('flag');
    expect(result.verification).toBe('incomplete');
  });
  it('reuses cycle steps and enforces depth and step limits', () => {
    const snapshot = make('export function a(){ b(); }\nfunction b(){ a(); }');
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    const feature = data.features.find((item) => item.name === 'a')!;
    const result = buildStaticFlow(data, feature.id);
    expect(result.steps).toHaveLength(2);
    expect(result.relationships).toHaveLength(2);
    expect(result.limitations.join(' ')).toContain('Cycle');
    const limited = buildStaticFlow(data, feature.id, { maxDepth: 1 });
    expect(limited.truncated).toBe(true);
  });
  it('marks partial snapshots and unknown entries without inventing steps', () => {
    const snapshot = make('export function start() {}');
    const partial = run(snapshot, 'start', false);
    expect(partial.verification).toBe('incomplete');
    const discovery = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(buildStaticFlow(discovery, 'missing').steps).toEqual([]);
  });
  it('links exact static HTTP requests to handler declarations', () => {
    const snapshot: RepositorySnapshot = { schemaVersion: '1.0', id: 'request', files: [
      { id: 'app/api/data/route.ts', path: 'app/api/data/route.ts', content: 'export function GET(){ return null; }' },
      { id: 'src/client.ts', path: 'src/client.ts', content: "export function load(){ fetch('/api/data'); }" },
    ] };
    const result = run(snapshot, 'load');
    expect(result.relationships[0]).toMatchObject({ kind: 'http-request', destination: '/api/data', status: 'verified' });
    expect(result.steps[1]?.file).toBe('app/api/data/route.ts');
  });
});
