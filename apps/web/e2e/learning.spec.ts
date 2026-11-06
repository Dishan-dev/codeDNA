import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Challenge, Lesson, RepoBundle } from '@codedna/shared';

const bundle = (): RepoBundle => JSON.parse(readFileSync(join(__dirname, '..', 'public', 'starters', 'snackshop.json'), 'utf8')) as RepoBundle;
const lessonTitled = (title: string): Lesson => Object.values(bundle().plan.lessons).find((lesson) => lesson.title === title)!;
const answerLabel = (challenge: Extract<Challenge, { answerId: string }>) => challenge.options.find((option) => option.id === challenge.answerId)!.label;

test('the GitHub form checks the link and explains when importing is switched off', async ({ page }) => {
  // The test server runs in production mode without CODEDNA_GITHUB_IMPORT, so importing is off.
  await page.goto('/#start');
  const input = page.getByRole('textbox', { name: 'Public GitHub repo' });
  await input.fill('https://gitlab.com/acme/shop');
  await page.getByRole('button', { name: 'Learn this repo' }).click();
  // Next.js has its own hidden role="alert" route announcer, so look inside the form.
  const message = page.locator('form').getByRole('alert');
  await expect(message).toHaveText('Paste a public repo link like https://github.com/owner/repo.');
  await input.fill('https://github.com/acme/shop');
  await page.getByRole('button', { name: 'Learn this repo' }).click();
  await expect(message).toContainText('switched off on this server');
  await expect(page.getByRole('button', { name: 'Learn this repo' })).toBeEnabled();
});

/** Click "Next" until the story ends. */
async function playToEnd(page: Page) {
  const story = page.getByRole('region', { name: /^Story:/ });
  for (let guard = 0; guard < 40; guard++) {
    const next = story.getByRole('button', { name: /^Next/ });
    if (await next.isDisabled()) return;
    await next.click();
  }
  throw new Error('The story never ended');
}

/**
 * Finish the Understand stage. Each idea has up to three parts (the idea, in your app, a quick
 * check); the check is answered correctly, then "Next idea" (or "Next: Try"). With `keyboard`,
 * every button is pressed with Enter and the answer picked with Space.
 */
async function finishIdeas(page: Page, lesson: Lesson, { keyboard = false } = {}) {
  const press = async (name: string) => {
    const button = page.getByRole('button', { name, exact: true });
    if (keyboard) {
      await button.focus();
      await page.keyboard.press('Enter');
    } else await button.click();
  };
  const ids = lesson.concepts.filter((id) => bundle().plan.concepts[id]);
  for (const [index, id] of ids.entries()) {
    await expect(page.getByText(`Idea ${index + 1} of ${ids.length}`)).toBeVisible();
    const done = index === ids.length - 1 ? 'Next: Try' : 'Next idea';
    const any = page.getByRole('button', { name: new RegExp(`^(${done}|Show me in my app|Check myself|Check)$`) }).first();
    for (let guard = 0; guard < 4; guard++) {
      await expect(any).toBeVisible();
      const name = (await any.textContent())!.trim();
      if (name === done) break;
      if (name === 'Check') {
        const check = bundle().plan.conceptChecks[id]!;
        const radio = page.getByRole('radio', { name: check.options.find((option) => option.id === check.answerId)!.label, exact: true });
        if (keyboard) {
          await radio.focus();
          await page.keyboard.press('Space');
        } else await radio.click();
        await press('Check');
        await expect(page.getByText('Right!')).toBeVisible();
      } else await press(name);
    }
    await press(done);
  }
}

async function solve(page: Page, challenge: Challenge, story: Lesson['story']) {
  if (challenge.kind === 'order') {
    const title = (id: string) => story.find((step) => step.id === id)!.title;
    const current = challenge.stepsShuffled.map(title);
    for (const [target, id] of challenge.correct.entries()) {
      const wanted = title(id);
      for (let at = current.indexOf(wanted); at > target; at--) {
        await page.getByRole('button', { name: `Move “${wanted}” up`, exact: true }).click();
        [current[at - 1], current[at]] = [current[at]!, current[at - 1]!];
      }
    }
  } else {
    await page.getByRole('radio', { name: answerLabel(challenge), exact: true }).click();
  }
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('That’s right!')).toBeVisible();
}

test('learner opens a starter repo, plays a story, opens a concept, answers every challenge type and sees XP and skills grow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Finally understand how your app works.' })).toBeVisible();
  await page.getByRole('link', { name: 'Start learning' }).click();

  // My App
  await expect(page.getByRole('heading', { level: 1, name: 'Snackshop' })).toBeVisible();
  await expect(page.getByText(bundle().plan.summary.sentence)).toBeVisible();
  // Tips show in the inspector, with the lesson they are about.
  await page.getByRole('tablist', { name: 'Parts of the app' }).getByRole('tab', { name: /Home page/ }).click();
  await page.getByRole('button', { name: /^Lesson \d+: Save to favorites/ }).click();
  await expect(page.getByRole('complementary', { name: 'Lesson details' }).getByText('“Save to favorites” changes data without a sign-in check')).toBeVisible();

  // Feature Story
  await page.getByRole('navigation', { name: 'Repository' }).getByRole('link', { name: 'Features' }).click();
  await page.getByRole('link', { name: /Place order/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Place order' })).toBeVisible();
  const story = page.getByRole('region', { name: 'Story: Place order' });
  await expect(story.getByText(/^Step 1 of \d+$/)).toBeVisible();
  // Take the other path at the sign-in check: the story ends at the login page.
  for (let guard = 0; guard < 10 && !(await story.getByText('The code asks:').isVisible()); guard++) await story.getByRole('button', { name: /^Next/ }).click();
  await story.getByRole('button', { name: /^Yes/ }).first().click();
  await playToEnd(page);

  // Concept Card
  await story.getByRole('button', { name: /^Next/ }).isDisabled();
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await story.getByRole('button', { name: 'Component' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Concept: Component' });
  await expect(drawer.getByRole('heading', { name: 'Component' })).toBeVisible();
  const check = bundle().plan.conceptChecks.component!;
  await drawer.getByRole('radio', { name: check.options.find((option) => option.id === check.answerId)!.label, exact: true }).click();
  await drawer.getByRole('button', { name: 'Check' }).click();
  await expect(drawer.getByText('Right!')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Lesson flow: Watch → Understand → Try → Recap
  await page.getByRole('link', { name: 'Open the lesson' }).click();
  const lesson = lessonTitled('Place order');
  await playToEnd(page);
  await page.getByRole('button', { name: 'Next: Understand' }).click();
  await finishIdeas(page, lesson);
  expect(new Set(lesson.challenges.map((challenge) => challenge.kind))).toEqual(new Set(['predict', 'order', 'spot-bug', 'fill-gap']));
  for (const [index, challenge] of lesson.challenges.entries()) {
    await expect(page.getByText(`Challenge ${index + 1} of ${lesson.challenges.length}`)).toBeVisible();
    await solve(page, challenge, lesson.story);
    await page.getByRole('button', { name: index === lesson.challenges.length - 1 ? 'Finish the lesson' : 'Next challenge' }).click();
  }
  await expect(page.getByText('Lesson complete!')).toBeVisible();
  await expect(page.getByText(`${lesson.challenges.length} / ${lesson.challenges.length}`)).toBeVisible();

  // XP, path and skills
  await page.getByRole('button', { name: 'Back to your app' }).click();
  await expect(page.getByRole('img', { name: `Lessons done: 1 of ${bundle().plan.path.length}` })).toBeVisible();
  const xp = 4 * 10 + 50 + lesson.challenges.length * 20;
  await expect(page.getByText(String(xp), { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(String(xp), { exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Repository' }).getByRole('link', { name: 'Skills' }).click();
  const validation = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Validation' }) });
  await expect(validation.getByText('Practised')).toBeVisible();
});

test('a wrong answer explains itself and lets the learner try again', async ({ page }) => {
  const lesson = lessonTitled('Place order');
  const predict = lesson.challenges.find((challenge) => challenge.kind === 'predict')!;
  await page.goto(`/r/snackshop/learn/${lesson.id}`);
  await page.getByRole('button', { name: 'Try' }).isDisabled();
  // Jump to Try through progress: watch and understand first.
  await playToEnd(page);
  await page.getByRole('button', { name: 'Next: Understand' }).click();
  await finishIdeas(page, lesson);
  const wrong = predict.options.find((option) => option.id !== predict.answerId)!;
  await page.getByRole('radio', { name: wrong.label, exact: true }).click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('Not quite.')).toBeVisible();
  // Backticks in explanations are shown as inline code, so compare the visible text.
  await expect(page.getByText(predict.explanation.replace(/`/g, ''))).toBeVisible();
  const tryScreen = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(tryScreen.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('radio', { name: answerLabel(predict), exact: true }).click();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('That’s right!')).toBeVisible();
  // Only the first answer earns XP, so no "+20 XP" after a retry.
  await expect(page.getByText('+20 XP')).toBeHidden();
});

test('keyboard only: move through a story and answer a challenge', async ({ page }) => {
  const order = bundle().features.find((feature) => feature.title === 'Place order')!;
  await page.goto(`/r/snackshop/story/${bundle().slugs[order.id]}`);
  const story = page.getByRole('region', { name: 'Story: Place order' });
  await story.focus();
  await page.keyboard.press('ArrowRight');
  await expect(story.getByText(/^Step 2 of/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(story.getByText(/^Step 1 of/)).toBeVisible();
  await page.keyboard.press(' ');
  await expect(story.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(story.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  const lesson = lessonTitled('Save to favorites');
  await page.goto(`/r/snackshop/learn/${lesson.id}`);
  for (let guard = 0; guard < 10; guard++) {
    const next = page.getByRole('region', { name: /^Story:/ }).getByRole('button', { name: /^Next/ });
    if (await next.isDisabled()) break;
    await next.focus();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: 'Next: Understand' }).focus();
  await page.keyboard.press('Enter');
  await finishIdeas(page, lesson, { keyboard: true });
  const first = lesson.challenges[0] as Extract<Challenge, { answerId: string }>;
  const option = page.getByRole('radio', { name: answerLabel(first), exact: true });
  await option.focus();
  await page.keyboard.press('Space');
  await expect(option).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Check answer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('That’s right!')).toBeVisible();
});

test('reduced motion turns off the travelling token animation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reduced-motion', 'Only meaningful with reduced motion');
  const order = bundle().features.find((feature) => feature.title === 'Place order')!;
  await page.goto(`/r/snackshop/story/${bundle().slugs[order.id]}`);
  const token = page.locator('[data-journey-marker]');
  await expect(token).toBeAttached();
  const duration = await token.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
  expect(duration).toBeLessThan(0.01);
});

for (const [name, path] of [
  ['Start', '/'],
  ['My App', '/r/snackshop'],
  ['Features', '/r/snackshop/features'],
  ['App map', '/r/snackshop/map'],
  ['Skills', '/r/snackshop/skills'],
  ['Requirements', '/r/snackshop/requirements'],
  ['Quality', '/r/snackshop/quality'],
] as const) {
  test(`accessibility: ${name} has no serious or critical axe violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}

test('accessibility: story and lesson screens have no serious or critical axe violations', async ({ page }) => {
  const order = bundle().features.find((feature) => feature.title === 'Place order')!;
  for (const path of [`/r/snackshop/story/${bundle().slugs[order.id]}`, `/r/snackshop/learn/${lessonTitled('Place order').id}`]) {
    await page.goto(path);
    await expect(page.getByRole('region', { name: /^Story:/ })).toBeVisible();
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.isVisible()) await pause.click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
    expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`), path).toEqual([]);
  }
});

test('number keys pick an answer and Enter checks it', async ({ page }) => {
  const lesson = lessonTitled('Save to favorites');
  await page.goto(`/r/snackshop/learn/${lesson.id}`);
  await playToEnd(page);
  await page.getByRole('button', { name: 'Next: Understand' }).click();
  await expect(page.getByRole('navigation', { name: 'Lesson steps' }).getByRole('button', { name: /Test/ })).toHaveCount(0);
  const understand = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(understand.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
  await finishIdeas(page, lesson);
  const first = lesson.challenges[0] as Extract<Challenge, { answerId: string }>;
  const position = first.options.findIndex((option) => option.id === first.answerId);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press(String(position + 1));
  await expect(page.getByRole('radio', { name: answerLabel(first), exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByText('That’s right!')).toBeVisible();
});

test('My App shows one part at a time as a strand, with the picked lesson in the inspector', async ({ page }) => {
  await page.goto('/r/snackshop');
  const tabs = page.getByRole('tablist', { name: 'Parts of the app' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  const inspector = page.getByRole('complementary', { name: 'Lesson details' });
  // Each part's tab opens its own strand of lessons, under its own heading.
  for (const area of bundle().plan.areas!.filter((item) => item.lessonIds.length)) {
    await tabs.getByRole('tab', { name: new RegExp(area.title) }).click();
    await expect(tabs.getByRole('tab', { name: new RegExp(area.title) })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { level: 2, name: area.title, exact: true })).toBeVisible();
    const title = bundle().plan.lessons[area.lessonIds[0]!]!.title;
    const node = page.getByRole('tabpanel').getByRole('button', { name: new RegExp(`^Lesson \\d+: ${title}`) });
    await node.click();
    await expect(node).toHaveAttribute('aria-current', 'true');
    await expect(inspector.getByRole('heading', { level: 2, name: title })).toBeVisible();
  }
  // Arrow keys move between parts, as in any tab list.
  await tabs.getByRole('tab', { name: /Checkout/ }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.getByRole('tab', { selected: true })).not.toHaveText(/Checkout/);
  await tabs.getByRole('tab', { name: /Checkout/ }).click();
  // The part looked at last comes back on the next visit.
  await page.reload();
  await expect(tabs.getByRole('tab', { name: /Checkout/ })).toHaveAttribute('aria-selected', 'true');
  // "Play the part" walks the strand lesson by lesson, playing each path in the inspector.
  await page.getByRole('button', { name: 'Play the part' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  // While a path plays, the stop it has reached is marked as the current step.
  await expect(inspector.locator('[aria-current="step"]').first()).toBeAttached();
  const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('each stop on a path opens a card with the code behind it', async ({ page }) => {
  await page.goto('/r/snackshop');
  await page.getByRole('tablist', { name: 'Parts of the app' }).getByRole('tab', { name: /Checkout/ }).click();
  await page.getByRole('button', { name: /^Lesson \d+: Apply coupon/ }).click();
  const path = page.getByRole('complementary', { name: 'Lesson details' }).getByRole('list', { name: 'What happens in “Apply coupon”' });
  const check = path.getByRole('button', { name: /check/i });
  // Pointing at the stop shows what it means, each traced step with its file and line, and that it was read, not run.
  await check.hover();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  await expect(card.getByText('Checks on the way')).toBeVisible();
  await expect(card.getByText(/\.tsx?$/).first()).toBeVisible();
  await expect(card.getByText(/^line \d+$/).first()).toBeVisible();
  // Every check is listed, none hidden behind "+N more".
  const count = Number(/(\d+) check/.exec((await check.textContent()) ?? '')?.[1] ?? '1');
  await expect(card.getByRole('listitem')).toHaveCount(count);
  await expect(card.getByText(/Read from the code, not run/)).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  // Keyboard: focusing the stop opens it, Escape closes it.
  await page.mouse.move(0, 0);
  await expect(card).toBeHidden();
  await check.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await expect(check).toHaveAttribute('aria-describedby', /.+/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
});

test('the app map draws every part and each flow’s path', async ({ page }) => {
  await page.goto('/r/snackshop/map');
  await expect(page.getByRole('heading', { level: 1, name: 'App map' })).toBeVisible();
  const placeOrder = page.getByRole('list', { name: 'The path of “Place order”' });
  await expect(placeOrder.getByText('Saves order')).toBeVisible();
  await expect(placeOrder.getByText('An unknown part')).toBeVisible();
});

test('the story plays as a journey, a sequence diagram or a flowchart, all in step', async ({ page }) => {
  const order = bundle().features.find((feature) => feature.title === 'Place order')!;
  await page.goto(`/r/snackshop/story/${bundle().slugs[order.id]}`);
  const story = page.getByRole('region', { name: 'Story: Place order' });
  const pause = story.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await story.getByRole('button', { name: /^Step 3:/ }).click();
  for (const view of ['Sequence', 'Flowchart', 'Journey']) {
    await story.getByRole('tab', { name: view }).click();
    await expect(story.getByRole('tab', { name: view })).toHaveAttribute('aria-selected', 'true');
    // Switching views keeps the place in the story.
    await expect(story.getByText(/^Step 3 of \d+$/)).toBeVisible();
    const results = await new AxeBuilder({ page }).include('section[aria-label^="Story:"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${view}: ${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  }
  // The choice is remembered on the next visit.
  await story.getByRole('tab', { name: 'Flowchart' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Story: Place order' }).getByRole('tab', { name: 'Flowchart' })).toHaveAttribute('aria-selected', 'true');
});

test('Requirements: a brief is matched to the code, with coverage and evidence', async ({ page }) => {
  await page.goto('/r/snackshop/requirements');
  await expect(page.getByRole('heading', { level: 1, name: 'Requirements' })).toBeVisible();
  // A PDF is turned away with a way forward, not silently ignored.
  await page.getByLabel('Requirements file').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByRole('alert').filter({ hasText: 'PDF and Word files aren’t read yet' })).toBeVisible();
  await page.getByLabel('Or paste the requirements').fill('FR-1 The customer shall be able to place an order.\nFR-2 Users shall reset their password by email.');
  await page.getByRole('button', { name: 'Check coverage' }).click();
  await expect(page.getByRole('img', { name: /Requirements covered: \d+%/ })).toBeVisible();
  const order = page.getByRole('listitem').filter({ hasText: 'place an order' });
  await expect(order.getByText('Built', { exact: true })).toBeVisible();
  await expect(order.getByRole('link', { name: /Place order/ })).toBeVisible();
  const reset = page.getByRole('listitem').filter({ hasText: 'reset their password' });
  await expect(reset.getByText('Not found', { exact: true })).toBeVisible();
  // Filters narrow the list; the document is kept in this browser for the next visit.
  await page.getByRole('button', { name: /Not found/ }).first().click();
  await expect(order).toBeHidden();
  await page.reload();
  await expect(page.getByRole('img', { name: /Requirements covered/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('Quality: findings read from the code, and edge cases that tick off as you try them', async ({ page }) => {
  await page.goto('/r/snackshop/quality');
  await expect(page.getByRole('heading', { level: 1, name: 'Quality' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /Save to favorites/ }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Edge cases/ }).click();
  const first = page.getByRole('tabpanel').getByRole('checkbox').first();
  await first.check();
  await page.reload();
  await page.getByRole('tab', { name: /Edge cases/ }).click();
  await expect(page.getByRole('tabpanel').getByRole('checkbox').first()).toBeChecked();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('the sidebar folds to icons and remembers it; on phones it is a drawer', async ({ page }) => {
  await page.goto('/r/snackshop');
  const nav = page.getByRole('navigation', { name: 'Repository' });
  await expect(nav.getByRole('link', { name: 'Requirements' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  // Folded, the links keep their names for screen readers and keyboards.
  await nav.getByRole('link', { name: 'Quality' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Quality' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav.getByRole('link', { name: 'Learn' })).toBeHidden();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await nav.getByRole('link', { name: 'Map' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'App map' })).toBeVisible();
  // Moving to another page closes the drawer.
  await expect(nav.getByRole('link', { name: 'Learn' })).toBeHidden();
});
