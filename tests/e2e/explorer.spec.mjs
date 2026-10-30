import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  analyzeSnapshot,
  analyzeUIFlows,
} from '../../packages/core/dist/index.js';
const fixture = JSON.parse(
  await readFile(
    new URL(
      '../../packages/core/fixtures/next-app-router.snapshot.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const response = (revision = 'one', complete = true) => {
  const snapshot = { ...fixture, id: `mock@${revision}`, revision };
  return {
    repository: {
      owner: 'test',
      repo: 'repo',
      url: 'https://github.com/test/repo',
    },
    commitSha: revision,
    snapshot,
    analysis: analyzeSnapshot(snapshot),
    uiFlow: analyzeUIFlows(snapshot),
    completeness: { complete, skippedFiles: complete ? 0 : 1 },
    diagnostics: [],
  };
};
test('demo architecture, source inspection and impact paths', async ({
  page,
}) => {
  await page.goto('/explorer');
  await expect(page.getByLabel('Architecture dependency map')).toBeVisible();
  await page.getByRole('button', { name: 'src/lib/greet.ts' }).click();
  await expect(
    page.getByLabel('Context inspector').locator('pre'),
  ).toContainText('export const greet');
  await page.getByRole('tab', { name: 'Impact Analysis' }).click();
  await expect(page.getByLabel('Impact summary')).toContainText('1 direct');
  await expect(page.getByLabel('Impact results')).toContainText('src/app.ts');
  await page
    .getByRole('button', { name: /Path 1:/ })
    .first()
    .click();
  await expect(
    page.getByText('Dependency evidence', { exact: true }),
  ).toBeVisible();
});
test('Next fixture renders UI flow and source navigation by keyboard', async ({
  page,
}) => {
  await page.goto('/explorer?example=next');
  const tab = page.getByRole('tab', { name: 'Architecture' });
  await tab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'UI Flow' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('UI Flow screen map')).toBeVisible();
  await page.getByRole('button', { name: 'app/page.tsx' }).click();
  await expect(page.getByLabel('Context inspector')).toContainText(
    '/projects/42',
  );
  await page.getByRole('button', { name: 'View source file' }).click();
  await expect(
    page.getByLabel('Context inspector').locator('pre'),
  ).toContainText('next/link');
});
test('learning progress and cross-mode navigation', async ({ page }) => {
  await page.goto('/explorer');
  await page.getByRole('tab', { name: 'Learning Mode' }).click();
  await expect(page.getByLabel('Learning roadmap')).toContainText(
    'Understand the codebase',
  );
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByLabel('Learning roadmap')).toContainText('1 of');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Open Architecture' }).click();
  await expect(page.getByRole('tab', { name: 'Architecture' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Learning Mode' }).click();
  await expect(page.getByLabel('Learning roadmap')).toContainText('1 of');
});
test('mocked acquisition, partial snapshot and revision isolation', async ({
  page,
}) => {
  let revision = 'one';
  await page.route('**/api/repositories/acquire', async (route) =>
    route.fulfill({ status: 200, json: response(revision, false) }),
  );
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/repo');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/source=github/);
  await expect(page.getByText(/partial/i).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Learning Mode' }).click();
  await page.getByRole('button', { name: 'Mark complete' }).click();
  revision = 'two';
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/repo');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/source=github/);
  await page.getByRole('tab', { name: 'Learning Mode' }).click();
  await expect(page.getByLabel('Learning roadmap')).toContainText('0 of');
});
test('invalid URL and mocked acquisition error', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://example.com/a/b');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.getByLabel('GitHub repository URL')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await page.route('**/api/repositories/acquire', async (route) =>
    route.fulfill({
      status: 504,
      json: { error: { code: 'timeout', message: 'Acquisition timed out.' } },
    }),
  );
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/repo');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.getByText('Acquisition timed out.')).toBeVisible();
});
test('knowledge check records an answer from real dependency evidence', async ({
  page,
}) => {
  const snapshot = {
    schemaVersion: '1.0',
    id: 'questions',
    revision: '1',
    files: [
      { id: 'a.ts', path: 'a.ts', content: "import './b';" },
      { id: 'b.ts', path: 'b.ts', content: 'export const b=1;' },
      { id: 'c.ts', path: 'c.ts', content: 'export const c=1;' },
      { id: 'd.ts', path: 'd.ts', content: 'export const d=1;' },
    ],
  };
  const payload = {
    ...response(),
    snapshot,
    analysis: analyzeSnapshot(snapshot),
    uiFlow: analyzeUIFlows(snapshot),
  };
  await page.route('**/api/repositories/acquire', (route) =>
    route.fulfill({ status: 200, json: payload }),
  );
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/repo');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/source=github/);
  await page.getByRole('tab', { name: 'Learning Mode' }).click();
  await page
    .getByRole('button', { name: /Recap and check your understanding/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Knowledge check' }),
  ).toBeVisible();
  await page.locator('.learning-choice').first().click();
  await expect(page.locator('.learning-answer')).toBeVisible();
});
test('React Router analyzed fixture renders screen navigation', async ({
  page,
}) => {
  const files = {
    'src/routes.tsx':
      "import {Routes,Route} from 'react-router-dom'; import Home from './Home'; import About from './About'; export function App(){return <Routes><Route path='/' element={<Home/>}/><Route path='/about' element={<About/>}/></Routes>}",
    'src/Home.tsx':
      "import {Link} from 'react-router-dom'; export default function Home(){return <Link to='/about'>About</Link>}",
    'src/About.tsx': 'export default function About(){return null}',
  };
  const snapshot = {
    schemaVersion: '1.0',
    id: 'react-router-browser',
    revision: '1',
    files: Object.entries(files).map(([path, content]) => ({
      id: path,
      path,
      content,
    })),
  };
  await page.route('**/api/repositories/acquire', (route) =>
    route.fulfill({
      status: 200,
      json: {
        ...response(),
        snapshot,
        analysis: analyzeSnapshot(snapshot),
        uiFlow: analyzeUIFlows(snapshot),
      },
    }),
  );
  await page.goto('/');
  await page
    .getByLabel('GitHub repository URL')
    .fill('https://github.com/test/repo');
  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page).toHaveURL(/source=github/);
  await page.getByRole('tab', { name: 'UI Flow' }).click();
  await expect(page.getByLabel('UI Flow screen map')).toBeVisible();
  await page.getByRole('button', { name: 'src/Home.tsx' }).click();
  await expect(page.getByLabel('Context inspector')).toContainText('/about');
  await expect(page.getByLabel('Context inspector')).toContainText(
    'react-router',
  );
});
