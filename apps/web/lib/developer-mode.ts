/**
 * Developer mode: while CodeDNA is being built, visitors see the landing page only. Every other
 * page shows the "being built" screen, and the API refuses politely. Decided at build time in
 * next.config.mjs (on for Vercel builds of main, or CODEDNA_DEVELOPER_MODE=on).
 */
export const developerModeOn = () => process.env.CODEDNA_DEVELOPER_MODE_ACTIVE === '1';

export const DEVELOPER_MODE_PATH = '/developer-mode';
export const DEVELOPER_MODE_MESSAGE = 'CodeDNA is in developer mode while it’s being built. The full app opens soon.';

/** What stays open in developer mode: the landing page, its own files, and the "being built" screen. */
export function isOpenPath(pathname: string): boolean {
  if (pathname === '/' || pathname === DEVELOPER_MODE_PATH) return true;
  if (pathname.startsWith('/_next/')) return true;
  // Static files the landing page uses: icons, fonts, the starter list.
  if (/^\/(?:icon|apple-icon|favicon)/.test(pathname)) return true;
  return /^\/[^?]*\.[a-z0-9]{2,5}$/i.test(pathname) && !pathname.startsWith('/api/');
}
