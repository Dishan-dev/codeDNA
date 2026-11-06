import { defineConfig, devices } from '@playwright/test';

// Windows can reserve whole port ranges (3101–3200 here), so the port can be moved with CODEDNA_E2E_PORT.
const PORT = Number(process.env.CODEDNA_E2E_PORT ?? 3200);

/**
 * End-to-end tests against a production build in its own folder (.next-e2e) and port, so they
 * never disturb `next dev`. Every test runs twice: normal, and with reduced motion.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'reduced-motion', use: { ...devices['Desktop Chrome'], contextOptions: { reducedMotion: 'reduce' } } },
  ],
  webServer: {
    command: `node scripts/build-starters.mjs && next build && next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    env: { CODEDNA_DIST_DIR: '.next-e2e' },
    timeout: 240_000,
    reuseExistingServer: false,
  },
});
