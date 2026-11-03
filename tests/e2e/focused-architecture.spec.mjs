import { test, expect } from '@playwright/test';
import { openAdvanced } from './helpers.mjs';
test('folder evidence leads to source and focused dependency questions', async ({
  page,
}) => {
  await page.goto('/explorer');
  await openAdvanced(page);
  await openAdvanced(page);
  await page.getByRole('tab', { name: 'Architecture' }).click();
  await page
    .getByLabel('Repository overview')
    .locator('.guide-entry')
    .filter({ hasText: 'src' })
    .first()
    .click();
  const guide = page.getByLabel('Codebase guide');
  await guide
    .locator('.guide-entry')
    .filter({ hasText: 'lib' })
    .first()
    .click();
  const connection = guide
    .locator('details')
    .filter({ hasText: 'Used by src' });
  await connection.locator('summary').click();
  await expect(connection).toContainText('src/app.ts');
  await expect(connection).toContainText('src/lib/greet.ts');
  await connection.getByRole('button', { name: /View src\/app\.ts:1/ }).click();
  await expect(page.locator('#source-evidence-line')).toContainText('import');
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const question = page.getByLabel('What would you like to see?');
  await expect(question).toHaveValue('direct');
  await expect(page.locator('.react-flow__node')).toHaveCount(2, {
    timeout: 15000,
  });
  await question.selectOption('dependents');
  await expect(page.locator('.react-flow__node')).toHaveCount(1, {
    timeout: 15000,
  });
  await question.selectOption('uses');
  await expect(page.locator('.react-flow__node')).toHaveCount(2, {
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await page
    .getByRole('button', { name: 'Explore impact of selected file' })
    .click();
  await expect(
    page.getByRole('tab', { name: 'Impact Analysis' }),
  ).toHaveAttribute('aria-selected', 'true');
});
