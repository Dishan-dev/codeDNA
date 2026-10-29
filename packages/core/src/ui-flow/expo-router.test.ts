import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import {
  analyzeUIFlows,
  expoRouterAdapter,
  nextAppRouterAdapter,
} from '../index.js';
function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'expo-fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const fixture = snapshot({
  'src/app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
  'src/app/index.tsx': `import { Link, router } from 'expo-router'; import Nav from '../components/Nav'; export default function Home(){return <><Link href="/profile"/><Link href="./settings"/><Link href={target}/><Link href="https://example.com"/><Link {...props} href="/profile"/><Nav/><Button onPress={()=>router.push('/user/42')}/><Button onPress={()=>router.back()}/></>}`,
  'src/app/(tabs)/profile.tsx': `import {useRouter, Redirect} from 'expo-router'; import Nav from '../../components/Nav'; export default function Profile(){const nav=useRouter(); nav.replace('/settings'); nav.navigate('/docs/a/b'); return <><Redirect href="/"/><Nav/></>}`,
  'src/app/settings.tsx': `export default function Settings(){return null}`,
  'src/app/user/[id].tsx': `export default function User(){return null}`,
  'src/app/docs/[...slug].tsx': `export default function Docs(){return null}`,
  'src/app/nested/_layout.jsx': `export default function Layout(){return null}`,
  'src/app/nested/index.jsx': `export default function Nested(){return null}`,
  'src/app/nested/other.ts': `export default function Other(){return null}`,
  'src/app/helpers.ts': `export const helper = 1`,
  'src/app/+not-found.tsx': `export default function NotFound(){return null}`,
  'src/components/Nav.tsx': `import {Link} from 'expo-router'; export default function Nav(){return <Link href="/settings"/>}`,
});
describe('Expo Router static UI flow', () => {
  it('discovers screens, layouts, route groups, dynamic and catch-all patterns', () => {
    const result = analyzeUIFlows(fixture);
    expect(result.framework).toBe('expo-router');
    expect(result.graph.nodes.map((n) => n.routePath).sort()).toEqual([
      '/',
      '/docs/[...slug]',
      '/nested',
      '/nested/other',
      '/profile',
      '/settings',
      '/user/[id]',
    ]);
    expect(
      result.graph.nodes.find((n) => n.routePath === '/nested')?.boundaries,
    ).toEqual(
      expect.arrayContaining([
        { kind: 'layout', path: 'src/app/_layout.tsx' },
        { kind: 'layout', path: 'src/app/nested/_layout.jsx' },
      ]),
    );
    expect(result.graph.nodes.every((n) => n.framework === 'expo-router')).toBe(
      true,
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'expo-screen-unsupported',
        'expo-route-unsupported',
      ]),
    );
  });
  it('detects Link, router, useRouter, Redirect, relative, external, dynamic and history navigation', () => {
    const result = analyzeUIFlows(fixture);
    const events = result.graph.navigationEvents!;
    for (const [kind, dest] of [
      ['link', '/profile'],
      ['link', './settings'],
      ['push', '/user/42'],
      ['replace', '/settings'],
      ['navigate', '/docs/a/b'],
      ['redirect', '/'],
    ] as const)
      expect(events).toContainEqual(
        expect.objectContaining({
          kind,
          destination: dest,
          resolution: 'internal',
          sourceId: expect.any(String),
          targetId: expect.any(String),
          location: expect.objectContaining({ path: expect.any(String) }),
        }),
      );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'back',
        resolution: 'unresolved',
        sourceId: expect.any(String),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'link', resolution: 'dynamic' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'link',
        resolution: 'external',
        destination: 'https://example.com',
      }),
    );
    expect(
      result.graph.edges.every(
        (e) => e.sourceId && e.targetId && e.kind !== 'back',
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.code === 'expo-history-navigation'),
    ).toBe(true);
  });
  it('retains shared navigation without assigning it to either screen', () => {
    const result = analyzeUIFlows(fixture);
    const event = result.graph.navigationEvents?.find(
      (e) => e.location.path === 'src/components/Nav.tsx',
    );
    expect(event).toMatchObject({
      destination: '/settings',
      resolution: 'unresolved',
    });
    expect(event?.sourceId).toBeUndefined();
    expect(
      result.graph.edges.some(
        (e) => e.location?.path === 'src/components/Nav.tsx',
      ),
    ).toBe(false);
    expect(
      result.diagnostics.some((d) => d.code === 'expo-shared-ambiguous'),
    ).toBe(true);
  });
  it('reports colliding route groups and parameter patterns without resolving edges', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
        'app/index.tsx': `import {Link} from 'expo-router'; export default function Home(){return <><Link href="/about"/><Link href="/users/1"/></>}`,
        'app/(a)/about.tsx': `export default function A(){}`,
        'app/(b)/about.tsx': `export default function B(){}`,
        'app/users/[id].tsx': `export default function A(){}`,
        'app/users/[name].tsx': `export default function B(){}`,
      }),
    );
    expect(
      result.diagnostics.filter((d) => d.code === 'expo-route-collision'),
    ).toHaveLength(4);
    expect(result.graph.edges).toHaveLength(0);
  });
  it('treats platform variants as ambiguous and never invents screens or actions for them', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
        'app/index.tsx': `export default function Home(){return null}`,
        'app/profile.tsx': `import {Link} from 'expo-router'; export default function Profile(){return <Link href="/"/>}`,
        'app/profile.web.tsx': `import {Link} from 'expo-router'; export default function Profile(){return <Link href="/"/>}`,
        'app/mobile.ios.tsx': `export default function Mobile(){}`,
      }),
    );
    expect(result.graph.nodes.map((n) => n.routePath).sort()).toEqual([
      '/',
      '/profile',
    ]);
    expect(result.graph.edges).toHaveLength(0);
    expect(
      result.diagnostics.filter((d) => d.code === 'expo-platform-unsupported'),
    ).toHaveLength(2);
    expect(
      result.diagnostics.some((d) => d.code === 'expo-platform-ambiguous'),
    ).toBe(true);
  });
  it('avoids resolving relative navigation from dynamic or ambiguous contexts', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
        'app/user/[id].tsx': `import {Link} from 'expo-router'; export default function User(){return <Link href="../settings"/>}`,
        'app/user/index.tsx': `import {Link} from 'expo-router'; export default function User(){return <Link href="./settings"/>}`,
        'app/settings.tsx': `export default function Settings(){}`,
      }),
    );
    expect(result.graph.edges).toHaveLength(0);
    expect(
      result.graph.navigationEvents?.every(
        (e) => e.resolution === 'unresolved',
      ),
    ).toBe(true);
  });
  it('uses Next source evidence for mixed applications and permits explicit Expo selection', () => {
    const data = snapshot({
      'app/page.tsx': `import Link from 'next/link'; export default function Page(){return <Link href="/"/>}`,
      'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `export default function Home(){}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.nodes[0]?.framework).toBe('next-app-router');
    expect(
      result.diagnostics.some((d) => d.code === 'ui-mixed-frameworks'),
    ).toBe(true);
    expect(analyzeUIFlows(data, {}, expoRouterAdapter).framework).toBe(
      'expo-router',
    );
    expect(
      analyzeUIFlows(data, {}, nextAppRouterAdapter).graph.nodes[0]?.framework,
    ).toBe('next-app-router');
  });
  it('does not mistake an Expo screen named page for Next.js', () => {
    const result = analyzeUIFlows(
      snapshot({
        'app/_layout.tsx': `import {Stack} from 'expo-router';export default function Layout(){return <Stack/>}`,
        'app/page.tsx': `export default function Page(){}`,
      }),
    );
    expect(result.framework).toBe('expo-router');
    expect(result.graph.nodes[0]?.routePath).toBe('/page');
  });
  it('does not select Expo from unused or type-only imports', () => {
    const data = snapshot({
      'app/page.tsx': `import type {Link} from 'expo-router'; import {Stack} from 'expo-router'; export default function Page(){return null}`,
    });
    expect(analyzeUIFlows(data).graph.nodes[0]?.framework).toBe(
      'next-app-router',
    );
  });
  it('reports malformed source, preserves other screens, and is deterministic', () => {
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'src/app/broken.tsx': `export default function Broken(){const = ; return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.nodes.some((n) => n.routePath === '/settings')).toBe(
      true,
    );
    expect(result.diagnostics.some((d) => d.code?.startsWith('expo-TS'))).toBe(
      true,
    );
    expect(
      analyzeUIFlows({ ...data, files: [...data.files].reverse() }),
    ).toEqual(result);
  });
  it('detects mixed React Router and Expo evidence without merging route graphs', () => {
    const data = snapshot({
      'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `export default function Home(){}`,
      'routes.tsx': `import {Routes,Route} from 'react-router'; export function App(){return <Routes><Route path="/other"/></Routes>}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.framework).toBe('expo-router');
    expect(result.graph.nodes.map((n) => n.routePath)).toEqual(['/']);
    expect(
      result.diagnostics.some((d) => d.code === 'ui-mixed-frameworks'),
    ).toBe(true);
  });
  it('tracks aliased imports and rejects shadowed bindings', () => {
    const data = snapshot({
      'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `import { Link as Go, router as navigation } from 'expo-router'; export default function Home(){return <><Go href="/target"/><button onClick={()=>navigation.navigate('/target')}/></>}`,
      'app/target.tsx': `import {Link} from 'expo-router'; export default function Target(){function nested(Link){return <Link href="/"/>} return null}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.edges.map((e) => e.kind).sort()).toEqual([
      'link',
      'navigate',
    ]);
    expect(
      result.graph.navigationEvents?.every(
        (e) => e.location.path === 'app/index.tsx',
      ),
    ).toBe(true);
  });
  it('attributes a uniquely rendered component and preserves its evidence', () => {
    const data = snapshot({
      'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
      'app/index.tsx': `import Nav from '../Nav'; export default function Home(){return <Nav/>}`,
      'app/target.tsx': `export default function Target(){return null}`,
      'Nav.tsx': `import {Link} from 'expo-router'; export default function Nav(){return <Link href="/target"/>}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        sourceId: 'screen:expo:app/index.tsx',
        targetId: 'screen:expo:app/target.tsx',
        location: expect.objectContaining({ path: 'Nav.tsx' }),
        metadata: expect.objectContaining({ confidence: 0.8 }),
      }),
    );
  });
  it('analyzes a medium snapshot without repeated full-project scans', () => {
    const files: Record<string, string> = {
      'app/_layout.tsx': `import {Stack} from 'expo-router'; export default function Layout(){return <Stack/>}`,
    };
    for (let i = 0; i < 500; i++)
      files[`app/screen${i}.tsx`] =
        `import {Link} from 'expo-router'; export default function Page(){return <Link href="/screen${(i + 1) % 500}"/>}`;
    const start = Date.now();
    const result = analyzeUIFlows(snapshot(files));
    expect(result.graph.nodes).toHaveLength(500);
    expect(result.graph.edges).toHaveLength(500);
    expect(Date.now() - start).toBeLessThan(15000);
  }, 20000);
});
