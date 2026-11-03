import { test, expect } from '@playwright/test';
import { openAdvanced } from './helpers.mjs';
test('overview leads to a module, a screen and its source evidence', async ({
  page,
}) => {
  await page.goto('/explorer?example=next');
  await openAdvanced(page);
  await expect(page.getByRole('tab', { name: 'Discover' })).toHaveAttribute('aria-selected', 'true');
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  const overview = page.getByLabel('Repository overview');
  await expect(overview).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(overview).toContainText('next-app-router');
  await expect(overview).toContainText('app/page.tsx');
  await overview
    .locator('.module-card')
    .first()
    .click();
  await expect(page.getByRole('tab', { name: 'Architecture' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('navigation', { name: 'Architecture folder path' }),
  ).toContainText('app');
  await page
    .getByRole('navigation', { name: 'Architecture folder path' })
    .getByRole('button', { name: 'Repository' })
    .click();
  await overview.getByText('Routes, technology and analysis status').click();
  await page
    .getByLabel('Repository overview')
    .getByRole('button', { name: /app\/page.tsx/ })
    .first()
    .click();
  await expect(
    page.getByRole('tab', { name: 'Routes & Features' }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.route-detail')).toContainText('app/page.tsx');
  await expect(page.locator('.route-detail')).toContainText('/projects/42');
  await page.getByRole('button', { name: 'Inspect screen source' }).click();
  await expect(page.locator('#source-evidence-line')).toBeVisible();
});
test('learning walkthrough can finish and keeps session progress', async ({
  page,
}) => {
  await page.goto('/explorer');
  await openAdvanced(page);
  await page.getByRole('button', { name: 'Start guided learning' }).click();
  await expect(page.getByLabel('Learning roadmap')).toBeVisible();
  for (let i = 0; i < 20; i++) {
    const finish = page.getByRole('button', { name: 'Finish', exact: true });
    if (await finish.isVisible()) {
      await finish.click();
      break;
    }
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
  }
  await expect(
    page.getByText('Walkthrough finished. You can revisit any skipped steps.'),
  ).toBeVisible();
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Learning', exact: true }).click();
  await expect(
    page.getByText('Walkthrough finished. You can revisit any skipped steps.'),
  ).toBeVisible();
});
import {
  analyzeSnapshot,
  analyzeUIFlows,
} from '../../packages/core/dist/index.js';
import { understandRepository } from '../../packages/core/dist/understanding.js';
import { discoverFeatures } from '../../packages/core/dist/features.js';
test('500-file repository starts with bounded module cards instead of a file graph', async ({
  page,
}) => {
  const snapshot = {
    schemaVersion: '1.0',
    id: 'large-example',
    revision: 'r1',
    files: Array.from({ length: 500 }, (_, i) => ({
      id: `packages/mod${i % 12}/file${i}.ts`,
      path: `packages/mod${i % 12}/file${i}.ts`,
      content: 'export const value = 1;',
    })),
  };
  const payload = {
    repository: {
      owner: 'test',
      repo: 'large',
      url: 'https://github.com/test/large',
    },
    commitSha: 'r1',
    snapshot,
    analysis: analyzeSnapshot(snapshot),
    uiFlow: analyzeUIFlows(snapshot),
    understanding: understandRepository(snapshot, analyzeSnapshot(snapshot), analyzeUIFlows(snapshot).graph),
    features: discoverFeatures(snapshot, analyzeSnapshot(snapshot), analyzeUIFlows(snapshot).graph),
    completeness: { complete: true, skippedFiles: 0 },
    diagnostics: [],
  };
  await page.route('**/api/repositories/acquire', (route) =>
    route.fulfill({ status: 200, json: payload }),
  );
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/large');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  const overview = page.getByLabel('Repository overview');
  await expect(overview).toContainText('500');
  await expect(overview.locator('.module-card')).toHaveCount(8);
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await overview.locator('.module-card').first().click();
  await expect(page.getByLabel('Codebase guide')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Architecture folder path' }),
  ).toContainText('packages');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const before = await page
    .getByRole('navigation', { name: 'Architecture folder path' })
    .innerText();
  // The 3D view is no longer linked from navigation.
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveCount(0);
  expect(
    await page.getByRole('navigation', { name: 'Architecture folder path' }).innerText(),
  ).toBe(before);
  await page.getByText('Map options').click();
  await page.getByRole('button', { name: 'Advanced / Raw graph' }).click();
  await expect(page.getByText('Advanced raw dependency graph')).toBeVisible();
});
test('Discover leads to scoped Architecture, Features and source evidence', async ({ page }) => {
  await page.goto('/explorer?example=next');
  await openAdvanced(page);
  await expect(page.locator('.discover-workspace')).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.locator('.discover-workspace .guide-entry').first().click();
  await expect(page.getByRole('tab', { name: 'Features', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.feature-workspace')).toBeVisible();
  await page.locator('.feature-workspace .guide-action').click();
  await expect(page.getByRole('tab', { name: 'Static Walkthrough' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Return to selected feature' }).click();
  await expect(page.getByRole('tab', { name: 'Features', exact: true })).toHaveAttribute('aria-selected', 'true');
});
test('feature selection survives a static walkthrough and return navigation', async ({ page }) => {
  await page.goto('/explorer?example=next');
  await openAdvanced(page);
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Features', exact: true }).click();
  const feature = page.locator('.feature-list button').first();
  const name = await feature.locator('strong').innerText();
  await feature.click();
  await page.getByRole('button', { name: 'Walk through this feature' }).click();
  await expect(page.getByRole('tab', { name: 'Static Walkthrough' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Static Walkthrough')).toContainText(name);
  await expect(page.getByLabel('Static Walkthrough')).toContainText('Repository code is not executed');
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
  await page.getByText('Source and evidence for this step').click();
  await expect(page.locator('.simulation-source')).toBeVisible();
  await page.getByRole('button', { name: 'Return to selected feature' }).click();
  await expect(page.getByRole('tab', { name: 'Features', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.feature-workspace h2')).toHaveText(name);
});
test('analysis status exposes capability limits without implying execution', async ({
  page,
}) => {
  await page.goto('/explorer');
  await openAdvanced(page);
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await page.getByText('Routes, technology and analysis status').click();
  const status = page.locator('.capability-summary');
  await status.locator('summary').first().click();
  await expect(status).toContainText('Repository snapshot');
  await expect(status).toContainText('Documentation understanding');
  await expect(status).toContainText('Runtime QA');
  await expect(status).toContainText(
    'No repository code or tests are executed',
  );
});

test('guided default keeps secondary panels contextual and supports compact navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explorer?example=next');
  await openAdvanced(page);
  await expect(page.getByRole('tab', { name: 'Discover' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Context inspector')).toHaveCount(0);
  await expect(page.getByLabel('Repository files')).toHaveCount(0);
  await page.getByRole('button', { name: 'Explore the architecture' }).click();
  await expect(page.getByRole('tab', { name: 'Architecture' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Repository overview')).toBeVisible();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(page.getByLabel('Repository files')).toBeVisible();
  await page.getByRole('button', { name: 'Hide files' }).click();
  // The Explorer defaults to the light theme from the design tokens; dark remains available.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
