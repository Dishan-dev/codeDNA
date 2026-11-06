import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/**
 * `next dev` and `next build` write to different folders, so building never breaks a running
 * dev server. CODEDNA_DIST_DIR overrides both (used for verification builds).
 */
export default function config(phase) {
  return {
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
