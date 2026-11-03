import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// Keep production builds from replacing chunks used by a running dev server.
export default (phase) => ({
  distDir:
    phase === PHASE_DEVELOPMENT_SERVER
      ? process.env.CODEDNA_E2E === '1'
        ? '.next-e2e'
        : '.next-dev'
      : '.next',
  ...(phase === PHASE_DEVELOPMENT_SERVER && process.env.CODEDNA_E2E === '1'
    ? { typescript: { tsconfigPath: 'tsconfig.e2e.json' } }
    : {}),
});
