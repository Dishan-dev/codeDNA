import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot, UIFlowGraph } from '@codedna/shared';
import { analyzeSnapshot } from './index.js';
import { validateSnapshot, SnapshotValidationError } from './validation.js';
import { understandRepository } from './understanding.js';
import { discoverFeatures } from './features.js';

const flow: UIFlowGraph = { schemaVersion: '1.0', nodes: [], edges: [] };
const basic = (extra: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({ schemaVersion: '1.0', id: 'test', files: [{ id: 'src/index.ts', path: 'src/index.ts', content: 'export function start() { return helper(); }\nfunction helper() { return 1; }' }], ...extra });

describe('documentation-aware snapshots and understanding', () => {
  it('keeps old snapshots valid and admits missing documentation', () => {
    const snapshot = basic();
    expect(validateSnapshot(snapshot, {}).documents).toBeUndefined();
    const model = understandRepository(snapshot, analyzeSnapshot(snapshot), flow);
    expect(model.introduction.certainty).toBe('unverified');
    expect(model.exploration[0]?.path).toBe('src/index.ts');
  });
  it('keeps documented claims separate from source evidence and deterministic', () => {
    const snapshot = basic({ documents: [{ path: 'README.md', content: '# Helpful Tool\n\nThis tool definitely uploads all your files to the moon.\n\n## Supercharged Search\n' }, { path: 'docs/guide.md', content: '# Guide' }], manifests: [{ path: 'package.json', content: '{"dependencies":{"react":"19.0.0"}}' }] });
    const analysis = analyzeSnapshot(snapshot);
    const model = understandRepository(snapshot, analysis, flow, false);
    expect(model.introduction).toMatchObject({ certainty: 'documented' });
    expect(model.introduction.text).toContain('moon');
    expect(model.capabilities[0]?.text).toBe('Supercharged Search');
    expect(model.technologies.some((t) => t.text.includes('react'))).toBe(true);
    expect(model.limitations.join(' ')).toContain('partial');
    expect(understandRepository(snapshot, analysis, flow, false)).toEqual(model);
  });
  it('labels package README responsibility as documented, not verified', () => {
    const snapshot = basic({ files: [{ id: 'packages/api/index.ts', path: 'packages/api/index.ts', content: 'export const api = 1;' }], documents: [{ path: 'packages/api/README.md', content: '# API\n\nThis package is documented as a network gateway for the application.' }] });
    const model = understandRepository(snapshot, analyzeSnapshot(snapshot), flow);
    expect(model.modules[0]?.description).toMatchObject({ certainty: 'documented' });
    expect(model.modules[0]?.description.text).toContain('network gateway');
  });
  it('rejects unsafe or unbounded optional text while preserving source rules', () => {
    expect(() => validateSnapshot(basic({ documents: [{ path: '../README.md', content: 'bad' }] }), {})).toThrow(SnapshotValidationError);
    expect(() => validateSnapshot(basic({ documents: [{ path: 'notes.txt', content: 'bad' }] }), {})).toThrow(SnapshotValidationError);
    expect(() => validateSnapshot(basic({ documents: [{ path: 'README.md', content: 'x' }], manifests: [{ path: 'README.md', content: '{}' }] }), {})).toThrow(SnapshotValidationError);
    expect(() => validateSnapshot(basic({ documents: Array.from({ length: 101 }, (_, i) => ({ path: `docs/doc${i}.md`, content: '' })) }), {})).toThrow(SnapshotValidationError);
  });
});

describe('feature discovery', () => {
  it('detects exported functions, direct calls and unresolved hooks without inventing runtime paths', () => {
    const snapshot = basic();
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.features.some((f) => f.kind === 'entry-point')).toBe(true);
    expect(data.features.some((f) => f.name === 'start')).toBe(true);
    expect(data.relationships.some((r) => r.kind === 'call' && r.status === 'verified')).toBe(true);
    expect(discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow)).toEqual(data);
  });
  it('works for backend-only and library exports without routes', () => {
    const snapshot = basic({ files: [{ id: 'lib/service.ts', path: 'lib/service.ts', content: 'export class Service {}\nexport const run = () => 42;' }] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.features.map((f) => f.name)).toEqual(['Service', 'run']);
    expect(data.features.every((f) => f.routes.length === 0)).toBe(true);
  });
  it('isolates malformed source and keeps medium repositories deterministic', () => {
    const snapshot = basic({ files: [
      { id: 'broken.ts', path: 'broken.ts', content: 'export function broken( {' },
      ...Array.from({ length: 500 }, (_, i) => ({ id: `packages/service${i % 10}/file${i}.ts`, path: `packages/service${i % 10}/file${i}.ts`, content: `export function task${i}() { return ${i}; }` })),
    ] });
    const analysis = analyzeSnapshot(snapshot);
    const data = discoverFeatures(snapshot, analysis, flow);
    expect(data.limitations.join(' ')).toContain('broken.ts');
    expect(data.features.length).toBe(500);
    expect(discoverFeatures(snapshot, analysis, flow)).toEqual(data);
  });
  it('resolves named imported component references and leaves dynamic targets unproven', () => {
    const snapshot = basic({ files: [
      { id: 'src/Panel.tsx', path: 'src/Panel.tsx', content: 'export function Panel(){ return <div/> }' },
      { id: 'src/App.tsx', path: 'src/App.tsx', content: "import { Panel } from './Panel'; export function App(){ const x = useUnknown(); return <Panel onClick={x}/> }" },
    ] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.relationships.some((r) => r.kind === 'jsx-reference' && r.status === 'verified')).toBe(true);
    expect(data.relationships.some((r) => r.kind === 'hook-reference' && r.status === 'unresolved')).toBe(true);
    expect(data.relationships.every((r) => r.kind !== 'import')).toBe(true);
  });
  it('does not resolve parameter-shadowed calls to top-level symbols', () => {
    const snapshot = basic({ files: [{ id: 'src/index.ts', path: 'src/index.ts', content: 'export function action() {}\nexport function run(action: () => void) { action(); }' }] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.relationships.some((r) => r.targetId === data.symbols.find((s) => s.name === 'action')?.id)).toBe(false);
  });
  it('resolves only exact literal requests to a unique exported App Router handler', () => {
    const snapshot = basic({ files: [
      { id: 'app/api/items/route.ts', path: 'app/api/items/route.ts', content: 'export function GET() { return null }\nexport function POST() { return null }' },
      { id: 'src/client.ts', path: 'src/client.ts', content: "export function load(flag: boolean, path: string) { if (flag) fetch('/api/items'); fetch('/api/items', {method: 'POST'}); fetch(path); fetch('/api/missing'); }" },
    ] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    const requests = data.relationships.filter((item) => item.kind === 'http-request');
    expect(requests).toHaveLength(4);
    expect(requests.filter((item) => item.status === 'verified').map((item) => data.symbols.find((symbol) => symbol.id === item.targetId)?.name)).toEqual(['GET', 'POST']);
    expect(requests.filter((item) => item.status === 'unresolved')).toHaveLength(2);
    expect(requests.find((item) => item.condition)?.condition?.description).toBe('flag');
    expect(requests.every((item) => item.location.path === 'src/client.ts')).toBe(true);
  });
  it('supports an explicit same-file export alias without resolving unrelated names', () => {
    const snapshot = basic({ files: [
      { id: 'src/helper.ts', path: 'src/helper.ts', content: 'function work() {}\nexport { work as run };' },
      { id: 'src/main.ts', path: 'src/main.ts', content: "import { run } from './helper'; export function start(){ run(); }" },
    ] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.relationships.find((item) => item.kind === 'call')).toMatchObject({ status: 'verified' });
    expect(data.features.some((feature) => feature.name === 'work')).toBe(true);
  });
  it('keeps duplicate API handlers and shadowed fetch calls unresolved', () => {
    const snapshot = basic({ files: [
      { id: 'app/api/data/route.ts', path: 'app/api/data/route.ts', content: 'export function GET() {}' },
      { id: 'src/app/api/data/route.ts', path: 'src/app/api/data/route.ts', content: 'export function GET() {}' },
      { id: 'src/client.ts', path: 'src/client.ts', content: "export function load(){ fetch('/api/data'); }\nexport function local(fetch: (x:string)=>void){ fetch('/api/data'); }" },
    ] });
    const data = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow);
    expect(data.relationships.filter((item) => item.kind === 'http-request')).toHaveLength(1);
    expect(data.relationships.find((item) => item.kind === 'http-request')).toMatchObject({ status: 'unresolved' });
  });
  it('does not verify a request when options can override its method', () => {
    const snapshot = basic({ files: [
      { id: 'app/api/data/route.ts', path: 'app/api/data/route.ts', content: 'export function GET() {}' },
      { id: 'src/client.ts', path: 'src/client.ts', content: "export function load(options: object){ fetch('/api/data', { ...options }); }" },
    ] });
    const requests = discoverFeatures(snapshot, analyzeSnapshot(snapshot), flow).relationships.filter((item) => item.kind === 'http-request');
    expect(requests).toMatchObject([{ status: 'unresolved' }]);
  });
});
