import { test, expect } from '@playwright/test';

test('Overview → page → trace → keyboard → branch → who reaches this → back', async ({ page }) => {
  await page.goto('/explorer?example=roomly');
  await expect(page.getByTestId('flow-overview')).toBeVisible();
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Where CodeDNA gets stuck' })).toBeVisible();

  await page.getByRole('button', { name: /^\/book\/\[roomId\]:/ }).click();
  await expect(page.getByTestId('flow-inventory')).toBeVisible();
  await expect(page).toHaveURL(/view=page/);
  await expect(main.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /^Has gaps/ }).click();
  await expect(page.getByTestId('flow-action')).toHaveCount(1);
  await page.getByRole('button', { name: /^All \d/ }).click();
  await expect(page.getByTestId('flow-action')).toHaveCount(4);

  await page.getByRole('button', { name: 'Trace Create booking' }).click();
  const trace = page.getByTestId('action-trace');
  await expect(trace).toBeVisible();
  await expect(page.getByTestId('static-label')).toContainText('nothing was executed');
  await expect(trace.getByText(/^Step 1 of \d+$/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(trace.getByText(/^Step 2 of \d+$/)).toBeVisible();
  await expect(page.getByTestId('trace-code')).toContainText('lib/bookings/actions.ts');
  await page.keyboard.press('ArrowLeft');
  await expect(trace.getByText(/^Step 1 of \d+$/)).toBeVisible();

  const steps = page.getByTestId('trace-step');
  const total = await steps.count();
  const branch = page.getByRole('group', { name: 'Branch if (!session)' });
  await expect(branch.locator('code')).toHaveText('if (!session)');
  await branch.getByRole('button', { name: /^Yes:/ }).click();
  await expect(branch.getByRole('button', { name: /^Yes:/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await steps.count()).toBeLessThan(total);
  await page.getByRole('button', { name: 'Show all paths' }).click();
  await expect(steps).toHaveCount(total);

  await page.getByRole('button', { name: /Calls quotePrice/ }).click();
  await expect(page.getByTestId('trace-code')).toContainText('lib/pricing.ts · line 3');
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.getByTestId('trace-permalink').inputValue();
  expect(link).toContain('view=trace');
  expect(link).toContain('example=roomly');
  expect(link).toContain('step=');

  await page.getByRole('button', { name: 'Who else reaches quotePrice? →' }).click();
  await expect(page.getByTestId('reach-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who reaches quotePrice()?' })).toBeVisible();
  await expect(page.getByTestId('reach-row')).toHaveCount(3);
  await expect(page.getByTestId('reach-gap')).toHaveCount(1);

  await page.goBack();
  await expect(page.getByTestId('action-trace')).toBeVisible();
  await expect(page.getByTestId('trace-code')).toContainText('lib/pricing.ts · line 3');

  await page.goto(link);
  await expect(page.getByTestId('trace-code')).toContainText('lib/pricing.ts · line 3');
});

test('partial analysis is labelled on every primary screen', async ({ page }) => {
  await page.goto('/explorer?example=roomly-partial');
  await expect(page.getByTestId('partial-notice')).toContainText('missing 1 file');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Pages' }).click();
  await expect(page.getByTestId('partial-notice')).toBeVisible();
});

test('a repository without pages explains what is supported and offers the advanced tools', async ({ page }) => {
  await page.goto('/explorer');
  await expect(page.getByRole('heading', { name: 'CodeDNA couldn’t find any pages here' })).toBeVisible();
  await page.getByRole('button', { name: 'Open advanced tools' }).click();
  await expect(page.getByRole('tab', { name: 'Discover' })).toBeVisible();
});

test('search jumps to traces and functions, and the advanced menu works from the keyboard', async ({ page }) => {
  await page.goto('/explorer?example=roomly');
  await page.getByLabel('Search actions').fill('quote');
  await page.getByRole('list', { name: 'Search results' }).getByRole('button', { name: /quotePrice\(\)/ }).click();
  await expect(page.getByTestId('reach-view')).toBeVisible();
  await page.getByLabel('Search actions').fill('promo');
  await page.getByLabel('Search actions').press('Enter');
  await expect(page.getByTestId('action-trace')).toBeVisible();

  const menuButton = page.getByRole('button', { name: 'Advanced tools', exact: true });
  await menuButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Advanced tools' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Architecture graph/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await page.getByRole('menuitem', { name: /Diagnostics/ }).click();
  await expect(page.getByTestId('diagnostics')).toBeVisible();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveCount(0);
});

test('a stale or unknown trace link explains itself instead of failing', async ({ page }) => {
  await page.goto('/explorer?example=roomly&view=trace&action=missing&commit=abc1234');
  await expect(page.getByRole('heading', { name: 'This trace isn’t available' })).toBeVisible();
  await expect(page.getByText('This link was made for commit abc1234')).toBeVisible();
});

test('primary screens fit a 390px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const url of ['/explorer?example=roomly', '/explorer?example=roomly&view=page&page=page%3A%2Fbook%2F%5BroomId%5D']) {
    await page.goto(url);
    await expect(page.locator('.flow-page')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
