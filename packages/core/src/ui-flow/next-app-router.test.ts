import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeUIFlows } from '../index.js';
function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'next-fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const fixture = snapshot({
  'app/layout.tsx':
    'export default function Layout({children}) { return children }',
  'app/page.tsx': `import Link from 'next/link'; import Nav from '../components/Nav'; export default function Home(){ return <><Link href="/about">About</Link><Link href={unknown}>Dynamic</Link><Nav /></> }`,
  'app/(site)/about/page.tsx': `import { useRouter as useNav, redirect as go } from 'next/navigation'; export default function About(){ const router = useNav(); router.push('/blog/42'); router.replace('/docs'); router.back(); go('/'); return null; }`,
  'app/(site)/about/loading.tsx':
    'export default function Loading(){ return null }',
  'app/blog/[id]/page.tsx': 'export default function Blog(){return null}',
  'app/docs/[[...slug]]/page.jsx':
    'export default function Docs(){ return null }',
  'app/files/[...path]/page.ts':
    'export default function Files(){ return null }',
  'app/api/route.ts': 'export function GET() {}',
  'app/@modal/(.)photo/page.tsx':
    'export default function Photo(){return null}',
  'components/Nav.tsx': `import Link from 'next/link'; export default function Nav(){return <Link href="https://example.org">External</Link>}`,
});
describe('Next.js App Router UI flow', () => {
  it('detects a single nested monorepo app root and preserves source paths', () => {
    const result = analyzeUIFlows(
      snapshot({
        'apps/web/app/page.tsx': `import Link from 'next/link'; export default function Home(){return <Link href="/about">About</Link>}`,
        'apps/web/app/about/page.tsx':
          'export default function About(){return null}',
      }),
    );
    expect(result.graph.nodes.map((node) => node.routePath).sort()).toEqual([
      '/',
      '/about',
    ]);
    expect(result.graph.edges).toHaveLength(1);
    expect(
      result.graph.nodes.some(
        (node) => node.sourceFile === 'apps/web/app/page.tsx',
      ),
    ).toBe(true);
  });
  it('reports ambiguous nested app roots instead of merging applications', () => {
    const result = analyzeUIFlows(
      snapshot({
        'apps/one/app/page.tsx': 'export default function Page(){return null}',
        'apps/two/app/page.tsx': 'export default function Page(){return null}',
      }),
    );
    expect(result.graph.nodes).toHaveLength(0);
    expect(
      result.diagnostics.some((d) => d.code === 'ui-app-root-ambiguous'),
    ).toBe(true);
  });
  it('discovers arbitrary project nesting and analyzes an explicitly selected app', () => {
    const data = snapshot({
      'products/team/portal/src/app/page.tsx':
        'export default function Page(){return null}',
      'services/console/app/page.tsx':
        'export default function Page(){return null}',
    });
    const ambiguous = analyzeUIFlows(data);
    expect(ambiguous.graph.nodes).toHaveLength(0);
    expect(
      ambiguous.diagnostics.some((d) => d.code === 'ui-app-root-ambiguous'),
    ).toBe(true);
    const selected = analyzeUIFlows(data, {
      appRoot: 'products/team/portal/src/app',
    });
    expect(selected.graph.nodes.map((n) => n.sourceFile)).toEqual([
      'products/team/portal/src/app/page.tsx',
    ]);
    const invalid = analyzeUIFlows(data, { appRoot: '../outside' });
    expect(
      invalid.diagnostics.some((d) => d.code === 'ui-app-root-invalid'),
    ).toBe(true);
    expect(
      analyzeUIFlows(data, { appRoot: 'products/team/portal/src/app' }),
    ).toEqual(selected);
  });
  it('does not silently ignore a nested app when a root app also exists', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': 'export default function Page(){return null}',
        'other/site/app/page.tsx':
          'export default function Page(){return null}',
      }),
    );
    expect(result.graph.nodes).toHaveLength(0);
    expect(
      result.diagnostics.some((d) => d.code === 'ui-app-root-ambiguous'),
    ).toBe(true);
  });
  it('discovers routes, groups, dynamic segments, boundaries and direct navigation', () => {
    const { graph, diagnostics } = analyzeUIFlows(fixture);
    expect(graph.nodes.map((n) => n.routePath).sort()).toEqual([
      '/',
      '/about',
      '/blog/[id]',
      '/docs/[[...slug]]',
      '/files/[...path]',
    ]);
    expect(
      graph.nodes.find((n) => n.routePath === '/about')?.boundaries,
    ).toEqual(
      expect.arrayContaining([
        { kind: 'layout', path: 'app/layout.tsx' },
        { kind: 'loading', path: 'app/(site)/about/loading.tsx' },
      ]),
    );
    expect(graph.edges.map((e) => [e.kind, e.sourceId, e.targetId])).toEqual(
      expect.arrayContaining([
        ['link', 'screen:app/page.tsx', 'screen:app/(site)/about/page.tsx'],
        [
          'push',
          'screen:app/(site)/about/page.tsx',
          'screen:app/blog/[id]/page.tsx',
        ],
        [
          'replace',
          'screen:app/(site)/about/page.tsx',
          'screen:app/docs/[[...slug]]/page.jsx',
        ],
        ['redirect', 'screen:app/(site)/about/page.tsx', 'screen:app/page.tsx'],
      ]),
    );
    expect(graph.navigationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'back', resolution: 'dynamic' }),
        expect.objectContaining({ kind: 'link', resolution: 'dynamic' }),
        expect.objectContaining({
          kind: 'link',
          resolution: 'external',
          destination: 'https://example.org',
          sourceId: 'screen:app/page.tsx',
          location: expect.objectContaining({ path: 'components/Nav.tsx' }),
        }),
      ]),
    );
    expect(graph.edges.some((e) => e.kind === 'back')).toBe(false);
    expect(diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['ui-navigation-dynamic', 'ui-route-unsupported']),
    );
    expect(graph.nodes.some((n) => n.sourceFile?.includes('route.ts'))).toBe(
      false,
    );
  });
  it('identifies collisions and refuses ambiguous edges', () => {
    const result = analyzeUIFlows(
      snapshot({
        'src/app/page.tsx': `import Link from 'next/link'; export default function Home(){return <Link href="/about">Go</Link>}`,
        'src/app/(one)/about/page.tsx':
          'export default function A(){return null}',
        'src/app/(two)/about/page.tsx':
          'export default function B(){return null}',
      }),
    );
    expect(
      result.diagnostics.filter((d) => d.code === 'ui-route-collision'),
    ).toHaveLength(2);
    expect(
      result.diagnostics.some((d) => d.code === 'ui-navigation-ambiguous'),
    ).toBe(true);
    expect(result.graph.edges).toHaveLength(0);
  });
  it('does not attribute a shared component to several screens', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': `import Nav from '../Nav'; export default function Home(){return <Nav/>}`,
        'app/about/page.tsx': `import Nav from '../../Nav'; export default function About(){return <Nav/>}`,
        'Nav.tsx': `import Link from 'next/link'; export default function Nav(){return <Link href="/about">About</Link>}`,
      }),
    );
    expect(
      result.diagnostics.some((d) => d.code === 'ui-shared-ambiguous'),
    ).toBe(true);
    expect(result.graph.edges).toHaveLength(0);
  });
  it('reports unresolved destinations, syntax errors and unsupported slots without blocking other pages', () => {
    const result = analyzeUIFlows(
      snapshot({
        'src/app/page.tsx': `import Link from 'next/link'; export default function Home(){return <Link href="/missing">No</Link>}`,
        'src/app/broken/page.tsx':
          'export default function Broken(){ const = ; return null }',
        'src/app/@slot/page.tsx': 'export default function Slot(){return null}',
        'src/app/feed/(..)photo/page.tsx':
          'export default function Intercept(){return null}',
        'src/app/ok/page.tsx': 'export default function OK(){return null}',
      }),
    );
    expect(result.graph.nodes.map((n) => n.routePath)).toContain('/ok');
    expect(result.diagnostics.some((d) => d.code?.startsWith('TS'))).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'ui-navigation-unresolved'),
    ).toBe(true);
    expect(
      result.diagnostics.filter((d) => d.code === 'ui-route-unsupported'),
    ).toHaveLength(2);
  });
  it('rejects shadowed bindings and treats spread or computed navigation as dynamic', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': `import Link from 'next/link'; import {useRouter} from 'next/navigation'; export default function Home(){ const router=useRouter(); return <><Link {...props} href="/target"/><button onClick={()=>router.push(dest)} /></> }`,
        'app/target/page.tsx': 'export default function Target(){return null}',
      }),
    );
    expect(result.graph.edges).toHaveLength(0);
    expect(result.graph.navigationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'link', resolution: 'dynamic' }),
        expect.objectContaining({ kind: 'push', resolution: 'dynamic' }),
      ]),
    );
  });
  it('does not infer navigation from shadowed framework bindings', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': `import Link from 'next/link'; import {redirect} from 'next/navigation'; export default function Page(){function nested(Link, redirect){redirect('/target'); return <Link href="/target"/>} return null}`,
        'app/target/page.tsx': 'export default function Target(){}',
      }),
    );
    expect(result.graph.edges).toHaveLength(0);
    expect(result.graph.navigationEvents).toHaveLength(0);
  });
  it('handles a medium app without repeated project scans', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 500; i++)
      files[`app/section${i}/page.tsx`] =
        `import Link from 'next/link'; export default function Page(){return <Link href="/section${(i + 1) % 500}"/>}`;
    const start = Date.now();
    const result = analyzeUIFlows(snapshot(files));
    expect(result.graph.nodes).toHaveLength(500);
    expect(result.graph.edges).toHaveLength(500);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);
  it('reports dynamic route collisions and optional catch-all conflicts', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': `import Link from 'next/link'; export default function Home(){return <><Link href="/blog/7"/><Link href="/docs"/></>}`,
        'app/blog/[id]/page.ts': 'export default function A(){}',
        'app/blog/[slug]/page.ts': 'export default function B(){}',
        'app/docs/page.ts': 'export default function Docs(){}',
        'app/docs/[[...slug]]/page.ts': 'export default function All(){}',
      }),
    );
    expect(result.graph.edges).toHaveLength(0);
    expect(
      result.diagnostics.filter((d) => d.code === 'ui-route-collision'),
    ).toHaveLength(4);
  });
  it('retains an unattributed event for shared navigation', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/page.tsx': `import Nav from '../Nav'; export default function Page(){return <Nav/>}`,
        'app/other/page.tsx': `import Nav from '../../Nav'; export default function Other(){return <Nav/>}`,
        'Nav.tsx': `import Link from 'next/link'; export default function Nav(){return <Link href="/other"/>}`,
      }),
    );
    expect(result.graph.navigationEvents).toEqual([
      expect.objectContaining({
        kind: 'link',
        resolution: 'unresolved',
        destination: '/other',
        location: expect.objectContaining({ path: 'Nav.tsx' }),
      }),
    ]);
    expect(result.graph.navigationEvents?.[0]?.sourceId).toBeUndefined();
  });
  it('is deterministic and ignores projects with no app router', () => {
    expect(analyzeUIFlows(fixture)).toEqual(
      analyzeUIFlows({ ...fixture, files: [...fixture.files].reverse() }),
    );
    expect(
      analyzeUIFlows(snapshot({ 'src/index.ts': 'export const x=1' })).graph
        .nodes,
    ).toEqual([]);
  });
});
