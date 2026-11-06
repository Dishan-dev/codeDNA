import { describe, expect, it } from 'vitest';
import { parseFile } from '../../snapshot/parse.js';
import { languageOf } from '../../snapshot/validate.js';
import { exportedMethods, findNextRoutes } from './next-app-router.js';

const routesOf = (files: Record<string, string>) =>
  findNextRoutes(Object.entries(files).map(([path, content]) => parseFile({ path, content, language: languageOf(path)! })));
const PAGE = 'export default function Page() { return null; }';

describe('findNextRoutes', () => {
  it('maps pages, layouts and route handlers to URL paths', () => {
    const result = routesOf({
      'app/layout.tsx': PAGE,
      'app/page.tsx': PAGE,
      'app/checkout/page.tsx': PAGE,
      'app/rooms/[id]/page.tsx': PAGE,
      'app/api/orders/route.ts': 'export async function POST() {}\nexport async function GET() {}',
      'components/page.tsx': PAGE,
    });
    expect(result.appRoots).toEqual(['app']);
    expect(result.routes.map((route) => [route.kind, route.route, route.dynamic])).toEqual([
      ['layout', '/', false],
      ['page', '/', false],
      ['route-handler', '/api/orders', false],
      ['page', '/checkout', false],
      ['page', '/rooms/[id]', true],
    ]);
    expect(result.routes.find((route) => route.kind === 'route-handler')?.methods).toEqual(['GET', 'POST']);
  });

  it('follows route groups, parallel slots, private folders and src/app', () => {
    const result = routesOf({
      'src/app/(shop)/cart/page.tsx': PAGE,
      'src/app/@modal/login/page.tsx': PAGE,
      'src/app/_components/page.tsx': PAGE,
      'src/app/[...slug]/page.tsx': PAGE,
      'src/app/(.)photo/page.tsx': PAGE,
    });
    expect(result.appRoots).toEqual(['src/app']);
    expect(result.routes.map((route) => route.route)).toEqual(['/[...slug]', '/cart', '/login']);
    expect(result.diagnostics.map((item) => item.id)).toEqual(['diag:intercepting-route:src/app/(.)photo/page.tsx:1']);
  });

  it('lists the layouts that wrap each page, outermost first', () => {
    const result = routesOf({
      'app/layout.tsx': PAGE,
      'app/(shop)/layout.tsx': PAGE,
      'app/(shop)/cart/page.tsx': PAGE,
      'app/about/page.tsx': PAGE,
    });
    const page = (route: string) => result.routes.find((item) => item.kind === 'page' && item.route === route);
    expect(page('/cart')?.layouts).toEqual(['app/layout.tsx', 'app/(shop)/layout.tsx']);
    expect(page('/about')?.layouts).toEqual(['app/layout.tsx']);
  });

  it('finds app folders inside monorepo packages', () => {
    const result = routesOf({ 'apps/web/app/page.tsx': PAGE, 'apps/admin/src/app/users/page.tsx': PAGE });
    expect(result.appRoots).toEqual(['apps/admin/src/app', 'apps/web/app']);
    expect(result.routes.map((route) => route.route)).toEqual(['/', '/users']);
  });

  it('flags a route file without recognised handlers', () => {
    const result = routesOf({ 'app/api/x/route.ts': 'export const dynamic = "force-dynamic";' });
    expect(result.routes[0]?.methods).toEqual([]);
    expect(result.diagnostics.map((item) => item.id)).toEqual(['diag:route-no-methods:app/api/x/route.ts:1']);
  });
});

describe('exportedMethods', () => {
  it('reads function, const and renamed exports', () => {
    const source = parseFile({
      path: 'route.ts',
      content: 'export function GET() {}\nexport const POST = async () => {};\nconst handler = () => {};\nexport { handler as DELETE, handler as helper };\nfunction PUT() {}',
      language: 'ts',
    }).source;
    expect(exportedMethods(source)).toEqual(['DELETE', 'GET', 'POST']);
  });
});
