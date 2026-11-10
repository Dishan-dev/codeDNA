import { NextResponse, type NextRequest } from 'next/server';
import { DEVELOPER_MODE_MESSAGE, DEVELOPER_MODE_PATH, developerModeOn, isOpenPath } from './lib/developer-mode';

/**
 * In developer mode only the landing page is open: any other page shows the "being built" screen
 * (at the same address), and the API answers 503 with a short message the landing page shows.
 */
export function middleware(request: NextRequest) {
  if (!developerModeOn()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: { code: 'developer_mode', message: DEVELOPER_MODE_MESSAGE } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '86400' } });
  const url = request.nextUrl.clone();
  url.pathname = DEVELOPER_MODE_PATH;
  url.search = '';
  return NextResponse.rewrite(url, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export const config = {
  // Next's own files never need checking.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
