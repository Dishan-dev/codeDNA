import { test, expect } from '@playwright/test';
import { openAdvanced } from './helpers.mjs';
test('expanded architecture preserves breadcrumbs and exits with Escape', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto('/explorer');
  await openAdvanced(page);
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  const folder = page
    .locator('.guide-entry')
    .filter({ hasText: 'src' })
    .first();
  await folder.click();
  const path = page.getByRole('navigation', {
    name: 'Architecture folder path',
  });
  await expect(path).toContainText('src');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open fullscreen architecture workspace' })
    .click();
  await expect(page.locator('.architecture-workspace--expanded')).toBeVisible();
  await expect(path).toContainText('src');
  await page.keyboard.press('Escape');
  await expect(page.locator('.architecture-workspace--expanded')).toHaveCount(
    0,
  );
  await expect(path).toContainText('src');
});
test('fullscreen control enters and exits browser fullscreen when available', async ({
  page,
}) => {
  await page.goto('/explorer');
  await openAdvanced(page);
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await page
    .getByRole('button', { name: 'Open fullscreen architecture workspace' })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Exit fullscreen architecture workspace',
    }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await expect(
    page.getByRole('navigation', { name: 'Architecture folder path' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Exit fullscreen architecture workspace' })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);
});
