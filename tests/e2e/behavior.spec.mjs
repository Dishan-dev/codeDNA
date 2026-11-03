import { test, expect } from '@playwright/test';
import { openAdvanced } from './helpers.mjs';

async function openMenuItem(page, name) {
  await page.getByRole('button', { name: 'Advanced tools', exact: true }).click();
  await page.getByRole('menuitem', { name }).click();
}

test('behavior stories remain available under Advanced tools', async ({ page }) => {
  await page.goto('/explorer?example=next');
  await openMenuItem(page, /Behavior stories/);
  await expect(page.getByTestId('behavior-chooser')).toBeVisible();
  await page.getByTestId('behavior-chooser').getByRole('button').first().click();
  const player = page.getByTestId('story-player');
  await expect(player).toBeVisible();
  await page.getByRole('button', { name: 'Why does this happen?' }).click();
  await expect(player.locator('.story-why')).toBeVisible();
  await expect(player.getByText('What this story cannot tell you')).toBeVisible();
});

test('Ask CodeDNA answers deterministically without an AI provider', async ({ page }) => {
  await page.goto('/explorer?example=next');
  await openMenuItem(page, /Ask CodeDNA/);
  await expect(page.getByTestId('ask')).toBeVisible();
  await page.getByLabel('Your question').fill('What does this application do?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByLabel('Answer from detected behaviors')).toBeVisible();
  await expect(page.getByText(/AI is not configured|not available/i).first()).toBeVisible();
  await expect(page.getByLabel('AI explanations').getByRole('checkbox')).toHaveCount(0);
});

test('technical tools remain available under Advanced on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explorer?example=next');
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await expect(page.getByLabel('Repository overview')).toBeVisible();
  await expect(page).toHaveURL(/view=advanced/);
  await expect(page).toHaveURL(/mode=Architecture/);
});
