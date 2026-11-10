import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * `next dev` and `next build` write to different folders, so building never breaks a running
 * dev server. CODEDNA_DIST_DIR overrides both (used for verification builds).
 */
/**
 * Developer mode: visitors see only the landing page while the app is being built. On by default
 * for Vercel builds of the main branch; CODEDNA_DEVELOPER_MODE=on or off decides it anywhere.
 * Never on for `next dev`, so the app stays usable while you work on it.
 */
function developerMode(phase) {
  const setting = process.env.CODEDNA_DEVELOPER_MODE?.trim().toLowerCase();
  if (setting === 'on' || setting === 'off') return setting === 'on';
  return phase !== PHASE_DEVELOPMENT_SERVER && process.env.VERCEL === '1' && process.env.VERCEL_GIT_COMMIT_REF === 'main';
}

export default function config(phase) {
  return {
    // Fixed at build time, so the edge middleware and the pages agree.
    env: { CODEDNA_DEVELOPER_MODE_ACTIVE: developerMode(phase) ? '1' : '0' },
    distDir: process.env.CODEDNA_DIST_DIR || (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
    reactStrictMode: true,
    poweredByHeader: false,
    // Server-only engine packages run as plain Node modules: the analysis worker is a separate
    // file that bundling would break, and the TypeScript compiler is too big to bundle.
    serverExternalPackages: ['@codedna/core', '@codedna/github', '@codedna/node', 'typescript'],
    // pnpm links workspace packages from outside node_modules, which Next would otherwise bundle
    // anyway; load them from disk at runtime on the server. (Node 20.19+ can require ESM.)
    webpack(webpackConfig, { isServer }) {
      if (isServer) {
        const externals = Array.isArray(webpackConfig.externals) ? webpackConfig.externals : [webpackConfig.externals].filter(Boolean);
        webpackConfig.externals = [
          ...externals,
          ({ request }, callback) => (request && /^@codedna\/(?:core|github|node)$/.test(request) ? callback(null, `commonjs ${request}`) : callback()),
        ];
      }
      return webpackConfig;
    },
  };
}
