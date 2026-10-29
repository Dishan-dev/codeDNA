import { describe, expect, it } from 'vitest';
import type { RepositorySnapshot } from '@codedna/shared';
import { analyzeUIFlows, reactRouterAdapter } from '../index.js';

function snapshot(files: Record<string, string>): RepositorySnapshot {
  return {
    schemaVersion: '1.0',
    id: 'react-router-fixture',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
}
const fixture = snapshot({
  'src/routes.tsx': `import { Routes, Route } from 'react-router-dom';
    import Home from './Home'; import { About } from './About'; import Item from './Item';
    export function App(){ return <Routes><Route element={<Layout/>}><Route index element={<Home/>}/><Route path="about" element={<About/>}/><Route path="products"><Route index element={<Item/>}/><Route path=":id" element={<Item/>}/><Route path="*" element={<Missing/>}/></Route></Route></Routes> }
    function Layout(){return null} function Missing(){return null}`,
  'src/Home.tsx': `import {Link, NavLink, useNavigate} from 'react-router-dom'; import Shared from './Shared';
    export default function Home(){ const go=useNavigate(); return <><Link to="/about"/><NavLink to="products/42"/><Link to={unknown}/><Link to="https://example.com"/><button onClick={()=>go('/about',{replace:true})}/><button onClick={()=>go(-1)}/><Shared/></> }`,
  'src/About.tsx': `import {useNavigate, Link} from 'react-router-dom'; import Shared from './Shared'; export function About(){const nav=useNavigate(); return <><Link to="../products"/><button onClick={()=>nav('/products/3')}/><Shared/></>}`,
  'src/Shared.tsx': `import {Link} from 'react-router-dom'; export default function Shared(){return <Link to="/about"/>}`,
  'src/Item.tsx': `export default function Item(){return null}`,
});

describe('React Router static UI flow', () => {
  it('discovers nested, index, pathless, dynamic and wildcard routes with source attribution', () => {
    const result = analyzeUIFlows(fixture);
    expect(result.framework).toBe('react-router');
    expect(result.graph.nodes.map((n) => n.routePath).sort()).toEqual([
      '/',
      '/about',
      '/products',
      '/products/*',
      '/products/:id',
    ]);
    expect(
      result.graph.nodes.find((n) => n.routePath === '/about')?.sourceFile,
    ).toBe('src/About.tsx');
    const home = result.graph.nodes.find((n) => n.routePath === '/')!;
    const about = result.graph.nodes.find((n) => n.routePath === '/about')!;
    expect(
      result.graph.edges.some(
        (e) =>
          e.sourceId === home.id &&
          e.targetId === about.id &&
          e.kind === 'link',
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (e) =>
          e.sourceId === home.id &&
          e.targetId === about.id &&
          e.kind === 'replace',
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        (e) => e.sourceId === about.id && e.destination === '../products',
      ),
    ).toBe(true);
    expect(
      result.graph.navigationEvents?.some(
        (e) => e.kind === 'history' && e.resolution === 'unresolved',
      ),
    ).toBe(true);
    expect(
      result.graph.navigationEvents?.some((e) => e.resolution === 'external'),
    ).toBe(true);
    expect(
      result.graph.navigationEvents?.some((e) => e.resolution === 'dynamic'),
    ).toBe(true);
    const shared = result.graph.navigationEvents?.find(
      (e) => e.location.path === 'src/Shared.tsx',
    );
    expect(shared?.sourceId).toBeUndefined();
    expect(
      result.diagnostics.some((d) => d.code === 'rr-ambiguous-source'),
    ).toBe(true);
    expect(
      result.graph.edges.some((e) => e.location?.path === 'src/Shared.tsx'),
    ).toBe(false);
    expect(analyzeUIFlows(fixture)).toEqual(result);
  });
  it('handles route objects, JSX conversion, redirect helpers and Navigate', () => {
    const data = snapshot({
      'routes.tsx': `import {createBrowserRouter, createRoutesFromElements, Route, Navigate, redirect} from 'react-router';
      function Home(){return null} function User(){return null}
      const routes=[{path:'/',Component:Home,loader:()=>redirect('/user/123')},{path:'user',children:[{path:':id',Component:User},{path:'old',element:<Navigate to="/"/>}]}];
      const router=createBrowserRouter(routes);
      const extra=createRoutesFromElements(<><Route path="/extra" element={<Home/>}/></>); const router2=createBrowserRouter(extra);`,
    });
    const result = analyzeUIFlows(data);
    expect(result.diagnostics.some((d) => d.code === 'rr-dynamic-route')).toBe(
      false,
    );
    expect(result.graph.nodes.map((n) => n.routePath).sort()).toEqual([
      '/',
      '/extra',
      '/user/:id',
      '/user/old',
    ]);
    expect(
      result.graph.navigationEvents?.some(
        (e) =>
          e.kind === 'redirect' &&
          e.destination === '/user/123' &&
          e.resolution === 'internal',
      ),
    ).toBe(true);
    expect(
      result.graph.navigationEvents?.some(
        (e) =>
          e.kind === 'redirect' &&
          e.destination === '/' &&
          e.resolution === 'internal',
      ),
    ).toBe(true);
  });
  it('reports collisions and dynamic configuration without inventing destinations', () => {
    const data = snapshot({
      'r.tsx': `import { Routes, Route, Link } from 'react-router'; function A(){return <Link to="/item/1"/>} function B(){return null} export function App(){return <Routes><Route path="/" element={<A/>}/><Route path="/item/:id" element={<B/>}/><Route path="/item/:name" element={<B/>}/><Route path={dynamic} element={<B/>}/></Routes>}`,
    });
    const result = analyzeUIFlows(data);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'rr-collision',
        'rr-dynamic-route',
        'rr-unresolved-navigation',
      ]),
    );
    expect(result.graph.edges).toHaveLength(0);
  });
  it('prefers Next.js for mixed projects and supports explicit React Router selection', () => {
    const data = snapshot({
      ...Object.fromEntries(fixture.files.map((f) => [f.path, f.content])),
      'app/page.tsx': 'export default function Page(){return null}',
    });
    const auto = analyzeUIFlows(data);
    expect(
      auto.graph.nodes.every((n) => n.framework === 'next-app-router'),
    ).toBe(true);
    expect(auto.diagnostics.some((d) => d.code === 'ui-mixed-frameworks')).toBe(
      true,
    );
    expect(
      analyzeUIFlows(data, {}, reactRouterAdapter).graph.nodes.some(
        (n) => n.framework === 'react-router',
      ),
    ).toBe(true);
  });
  it('keeps malformed and unsupported source localized', () => {
    const data = snapshot({
      'r.tsx': `import {createBrowserRouter} from 'react-router'; const router=createBrowserRouter(makeRoutes()); const broken = ;`,
    });
    const result = analyzeUIFlows(data);
    expect(result.graph.nodes).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['rr-dynamic-route', 'rr-syntax']),
    );
  });
});
