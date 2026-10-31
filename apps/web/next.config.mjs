import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// Keep production builds from replacing chunks used by a running dev server.
export default (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
