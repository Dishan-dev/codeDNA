import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { buildJourneys, type Challenge, type Lesson, type RepoBundle } from '@codedna/shared';

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
  ['Overview', '/r/snackshop/overview'],
  ['QA flows', '/r/snackshop/qa'],
  ['Projects', '/projects'],
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
  // A broken file is turned away with a reason, not silently ignored.
  await page.getByLabel('Requirements file').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByRole('alert').filter({ hasText: 'couldn’t be read' })).toBeVisible();
  // A real PDF and a Word file are read in the browser.
  for (const file of ['brief.pdf', 'brief.docx']) {
    await page.getByLabel('Requirements file').setInputFiles(join(__dirname, 'fixtures', file));
    await expect(page.getByRole('img', { name: /Requirements covered: \d+%/ })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'place an order' }).getByText('Built', { exact: true })).toBeVisible();
    await expect(page.getByText(file)).toBeVisible();
    await page.getByRole('button', { name: 'Use another document' }).click();
  }
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

test('Overview says where a project stands and what to do next; Projects lists it', async ({ page }) => {
  await page.goto('/r/snackshop/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'Snackshop' })).toBeVisible();
  const next = page.getByRole('region', { name: 'What to do next' });
  await expect(next.getByRole('link', { name: /Run the QA agent/ })).toBeVisible();
  await next.getByRole('link', { name: /Check it against the requirements/ }).click();
  await page.getByRole('button', { name: 'Try the sample brief' }).click();
  await expect(page.getByRole('img', { name: /Requirements covered: \d+%/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Repository' }).getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByRole('region', { name: 'What to do next' }).getByRole('link', { name: /Requirements are \d+% covered/ })).toBeVisible();

  await page.goto('/projects');
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Snackshop' }) });
  await expect(card.getByText(/\d+%/).first()).toBeVisible();
  await card.getByRole('button', { name: 'Remove Snackshop from this list' }).click();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
});

test('Quality shows a QA report loaded from a file, tied to each flow', async ({ page }) => {
  const placeOrder = bundle().features.find((feature) => feature.title === 'Place order')!;
  const report = {
    version: 1,
    repoId: 'snackshop',
    repoName: 'Snackshop',
    appUrl: 'http://localhost:3000',
    createdAt: '2026-11-07T10:00:00Z',
    tool: { name: 'codedna', version: '0.0.0' },
    suites: [
      { runner: 'tests', title: 'Your tests', status: 'passed', startedAt: '2026-11-07T10:00:00Z', durationMs: 900, checks: [{ id: 'tests:run', title: 'All 12 tests passed', status: 'passed', detail: '12 passed, 0 failed.' }] },
      {
        runner: 'walk',
        title: 'Walk the app',
        status: 'failed',
        startedAt: '2026-11-07T10:00:01Z',
        durationMs: 4000,
        checks: [{ id: 'walk:x:try', title: 'Send “Place order” with empty fields', status: 'failed', featureId: placeOrder.id, page: '/checkout', detail: 'The server answered with an error.', evidence: ['500 POST http://localhost:3000/checkout'] }],
      },
    ],
  };
  await page.goto('/r/snackshop/quality');
  await page.getByRole('tab', { name: /Test runs/ }).click();
  await expect(page.getByRole('heading', { name: 'No test runs yet' })).toBeVisible();
  // A report for another project is turned away.
  await page.getByLabel('QA report file').setInputFiles({ name: 'qa-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...report, repoId: 'other', repoName: 'Other' })) });
  await expect(page.getByRole('alert').filter({ hasText: 'This report is for “Other”' })).toBeVisible();
  await page.getByLabel('QA report file').setInputFiles({ name: 'qa-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
  const failed = page.getByRole('listitem').filter({ hasText: 'Send “Place order” with empty fields' });
  await expect(failed.getByText('Failed', { exact: true })).toBeVisible();
  await expect(failed.getByRole('link', { name: 'See “Place order” →' })).toBeVisible();
  await failed.getByText('What CodeDNA saw').click();
  await expect(failed.getByText('500 POST http://localhost:3000/checkout')).toBeVisible();
  // It is kept in this browser, and the Overview asks to fix what failed.
  await page.reload();
  await page.getByRole('tab', { name: /Test runs · 2/ }).click();
  await expect(page.getByRole('region', { name: 'Walk the app' })).toBeVisible();
  await page.goto('/r/snackshop/overview');
  await expect(page.getByRole('link', { name: /Fix 1 failed check/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)).toEqual([]);
});

test('QA flows lists every feature by part and shows which step of a case broke', async ({ page }) => {
  const placeOrder = bundle().features.find((feature) => feature.title === 'Place order')!;
  const request = placeOrder.steps.find((step) => step.stage === 'request')!;
  const result = [...placeOrder.steps].reverse().find((step) => step.stage === 'screen' || step.stage === 'response')!;
  const report = {
    version: 1,
    repoId: 'snackshop',
    repoName: 'Snackshop',
    appUrl: 'http://localhost:3000',
    runId: 'run-20261107-100000',
    createdAt: '2026-11-07T10:00:00Z',
    tool: { name: 'codedna', version: '0.0.0' },
    suites: [
      {
        runner: 'flows',
        title: 'Flows',
        status: 'failed',
        startedAt: '2026-11-07T10:00:00Z',
        durationMs: 9000,
        checks: [
          {
            id: `flow:${placeOrder.id}:empty`,
            title: 'Place order — Sent empty',
            status: 'failed',
            caseKind: 'empty',
            featureId: placeOrder.id,
            page: '/checkout',
            detail: 'It accepted empty data: the server said OK and no message was shown.',
            inputs: { 'Coupon code': '' },
            screenshot: 'run-20261107-100000/place-order-empty.jpg',
            steps: [
              { kind: 'open', label: 'Open /checkout', status: 'passed' },
              { kind: 'find', label: 'Find “Place order”', status: 'passed' },
              { kind: 'fill', label: 'Fill in 1 of 1 field', status: 'passed' },
              { kind: 'press', label: 'Press “Place order”', status: 'passed' },
              { kind: 'request', label: 'Send to the server', status: 'warning', detail: 'POST /checkout', featureStepId: request.id },
              { kind: 'server', label: 'Server answers', status: 'passed', detail: 'Answered 200.' },
              { kind: 'result', label: 'What happens next', status: 'failed', detail: 'It accepted empty data.', featureStepId: result.id },
            ],
          },
        ],
      },
    ],
  };
  await page.goto('/r/snackshop/quality');
  await page.getByRole('tab', { name: /Test runs/ }).click();
  await page.getByLabel('QA report file').setInputFiles({ name: 'qa-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
  await page.getByRole('navigation', { name: 'Repository' }).getByRole('link', { name: /QA flows/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'QA flows' })).toBeVisible();
  await page.getByRole('group', { name: 'What to test' }).getByRole('button', { name: /Single features/ }).click();

  // Every feature, grouped by part; the broken one opens first.
  const list = page.getByRole('navigation', { name: 'Features to test' });
  await expect(list.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(list.getByRole('button', { name: /Place order.*Broke/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('tab', { name: /^Sent empty\s*:\s*Broke$/ })).toHaveAttribute('aria-selected', 'true');

  // The strip and the step list say exactly which step broke, and where that is in the code.
  const strip = page.getByRole('region', { name: 'Steps of this case' });
  await expect(strip.getByRole('listitem').filter({ hasText: 'What happens next' })).toContainText('Broke');
  await expect(strip.getByRole('listitem').filter({ hasText: 'Open /checkout' })).toContainText('Passed');
  const broken = page.getByRole('list', { name: 'Step by step' }).getByRole('listitem').filter({ hasText: 'What happens next' });
  await expect(broken.getByText(`${result.code.path}:${result.code.highlightLine}`)).toBeVisible();
  await expect(broken.getByRole('link', { name: 'See this step →' })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Coupon code' })).toBeVisible();
  // Screenshots live in the project folder; from a loaded file the page says where.
  await expect(page.getByText(/saved as .codedna\/qa\/run-20261107-100000\/place-order-empty.jpg/)).toBeVisible();

  // A case that hasn't run shows the steps it will take.
  await page.getByRole('tab', { name: /Very long text/ }).click();
  await expect(strip.getByRole('listitem').filter({ hasText: 'Server answers' })).toContainText('Not tested');

  // On the hosted site the page says how to test a deployed site, with its address filled in.
  await expect(page.getByRole('group', { name: 'Where to test' }).getByRole('button', { name: 'A deployed site' })).toHaveAttribute('aria-pressed', 'true');
  const address = page.getByLabel('Your app’s address');
  await address.fill('https://snackshop.example');
  await expect(page.getByText('codedna qa path/to/app --url https://snackshop.example --only journeys,flows', { exact: true })).toBeVisible();
  // A full test needs the site's agreement first.
  await page.getByText('Full test', { exact: true }).click();
  await expect(page.getByText('codedna qa path/to/app --url https://snackshop.example --only journeys,flows --interact', { exact: true })).toBeVisible();
  await expect(page.getByText('codedna: allow-testing', { exact: true })).toBeVisible();
  await address.fill('http://snackshop.example');
  await expect(page.getByText('A site on the internet must use https.')).toBeVisible();
  await address.fill('https://snackshop.example');
  // Or every deploy, through GitHub Actions.
  await page.getByRole('button', { name: 'Every deploy' }).click();
  await expect(page.getByText('codedna ci', { exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('on the hosted site, Test all flows runs the repo’s workflow on GitHub and shows the results', async ({ page }) => {
  // An imported GitHub repo, with GitHub's API played by the test.
  const repo = { ...bundle(), id: 'gh-acme-shop', name: 'acme/shop', source: 'github' } as RepoBundle;
  const placeOrder = repo.features.find((feature) => feature.title === 'Place order')!;
  await page.route('**/api/github/bundle/gh-acme-shop', (route) => route.fulfill({ json: repo }));
  let workflowAdded = false;
  let dispatched: { ref: string; inputs: Record<string, string> } | undefined;
  let polls = 0;
  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe('Bearer github_pat_testtokenabcdefghijklmnop');
    if (url.pathname === '/repos/acme/shop') return route.fulfill({ json: { default_branch: 'main' } });
    if (url.pathname.endsWith('/workflows/codedna-qa.yml')) return workflowAdded ? route.fulfill({ json: { state: 'active' } }) : route.fulfill({ status: 404, json: { message: 'Not Found' } });
    if (url.pathname.endsWith('/dispatches')) {
      dispatched = route.request().postDataJSON() as typeof dispatched;
      return route.fulfill({ status: 204, body: '' });
    }
    const run = { id: 5, display_title: `CodeDNA QA ${dispatched?.inputs.request ?? ''}`, created_at: new Date().toISOString(), html_url: 'https://github.com/acme/shop/actions/runs/5' };
    if (url.pathname.endsWith('/workflows/codedna-qa.yml/runs')) return route.fulfill({ json: { workflow_runs: [{ ...run, status: 'queued' }] } });
    if (url.pathname === '/repos/acme/shop/actions/runs/5') {
      polls += 1;
      return route.fulfill({ json: polls < 2 ? { ...run, status: 'in_progress' } : { ...run, status: 'completed', conclusion: 'failure' } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await page.route('**/api/github/qa-results', (route) => {
    expect(route.request().headers()['x-github-token']).toBe('github_pat_testtokenabcdefghijklmnop');
    expect(route.request().postDataJSON()).toEqual({ repo: 'acme/shop', runId: 5 });
    return route.fulfill({
      json: {
        report: {
          version: 1,
          repoId: 'gh-acme-shop',
          repoName: 'acme/shop',
          appUrl: 'https://shop.example.com',
          mode: 'look',
          runId: 'run-1',
          createdAt: '2026-11-08T10:00:00Z',
          tool: { name: 'codedna', version: '0.0.0' },
          suites: [
            {
              runner: 'flows',
              title: 'Flows',
              status: 'failed',
              startedAt: '2026-11-08T10:00:00Z',
              durationMs: 4000,
              checks: [
                {
                  id: `flow:${placeOrder.id}:reach`,
                  title: 'Place order — It can be reached',
                  status: 'failed',
                  caseKind: 'reach',
                  featureId: placeOrder.id,
                  page: '/checkout',
                  detail: 'The page answered 500.',
                  screenshot: 'run-1/place-order-reach.png',
                  steps: [{ kind: 'open', label: 'Open /checkout', status: 'failed', detail: 'Answered 500.' }],
                },
              ],
            },
          ],
        },
        shots: { 'run-1/place-order-reach.png': pixel },
      },
    });
  });

  await page.goto('/r/gh-acme-shop/qa');
  await page.getByRole('group', { name: 'What to test' }).getByRole('button', { name: /Single features/ }).click();
  await page.getByLabel('Your app’s address').fill('https://shop.example.com');
  const run = page.getByRole('button', { name: 'Test all flows' });
  await expect(run).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Make a fine-grained token ↗' })).toHaveAttribute('href', /personal-access-tokens\/new\?.*target_name=acme/);

  // Connect: the repo has no workflow yet, so the page says how to add it.
  await page.getByLabel('GitHub token').fill('github_pat_testtokenabcdefghijklmnop');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('acme/shop doesn’t have the CodeDNA QA workflow yet')).toBeVisible();
  workflowAdded = true;
  await page.getByRole('button', { name: 'Check again' }).click();

  // Then one press runs it on GitHub and the results land on the page.
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('link', { name: 'Open the run on GitHub ↗' })).toHaveAttribute('href', 'https://github.com/acme/shop/actions/runs/5');
  await expect(page.getByText(/^Finished: 1 broke, 0 to look at, 0 passed/)).toBeVisible({ timeout: 30_000 });
  expect(dispatched).toMatchObject({ ref: 'main', inputs: { url: 'https://shop.example.com', interact: 'false' } });
  expect(dispatched!.inputs.request).toMatch(/^#\w+$/);
  const list = page.getByRole('navigation', { name: 'Features to test' });
  await list.getByRole('button', { name: /Place order.*Broke/ }).click();
  await expect(page.getByRole('img', { name: /The page after “It can be reached” on Place order/ })).toHaveAttribute('src', pixel);

  // Disconnecting forgets the token.
  await page.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await expect(page.getByLabel('GitHub token')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('Connect GitHub signs in through the CodeDNA GitHub App with one click', async ({ page }) => {
  const repo = { ...bundle(), id: 'gh-acme-shop', name: 'acme/shop', source: 'github' } as RepoBundle;
  await page.route('**/api/github/bundle/gh-acme-shop', (route) => route.fulfill({ json: repo }));
  await page.route('**/api/github/auth/config', (route) => route.fulfill({ json: { enabled: true, installUrl: 'https://github.com/apps/codedna-qa/installations/new' } }));
  // GitHub's approve page is skipped: the sign-in comes straight back with a token.
  await page.route('**/api/github/auth/start?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('return')).toBe('/r/gh-acme-shop/qa');
    return route.fulfill({ status: 302, headers: { Location: '/r/gh-acme-shop/qa#codedna-github=ghu_apptokenabcdefghijklmnop&expires=28800' } });
  });
  let installed = false;
  await page.route('https://api.github.com/**', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer ghu_apptokenabcdefghijklmnop');
    const path = new URL(route.request().url()).pathname;
    if (!installed) return route.fulfill({ status: 404, json: { message: 'Not Found' } });
    if (path === '/repos/acme/shop') return route.fulfill({ json: { default_branch: 'main' } });
    return route.fulfill({ json: { state: 'active' } });
  });

  await page.goto('/r/gh-acme-shop/qa');
  await page.getByRole('group', { name: 'What to test' }).getByRole('button', { name: /Single features/ }).click();
  await page.getByLabel('Your app’s address').fill('https://shop.example.com');
  await expect(page.getByLabel('GitHub token')).toBeHidden();
  await page.getByRole('button', { name: 'Connect GitHub' }).click();

  // Back on the page, the token is out of the address; the app isn't on the repo yet.
  await expect(page.getByText(/CodeDNA can’t see acme\/shop yet/)).toBeVisible();
  expect(page.url()).not.toContain('codedna-github');
  await expect(page.getByRole('link', { name: 'Install the CodeDNA app on acme/shop ↗' })).toHaveAttribute('href', 'https://github.com/apps/codedna-qa/installations/new');
  installed = true;
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('button', { name: 'Test all flows' })).toBeEnabled();

  // Still connected after a reload; Disconnect forgets it.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Test all flows' })).toBeEnabled();
  await page.getByRole('button', { name: 'Disconnect GitHub' }).click();
  await expect(page.getByRole('button', { name: 'Connect GitHub' })).toBeVisible();
});

test('user journeys are drawn as a map, with the point that broke and its HTTP answer, and can be edited', async ({ page }) => {
  const journey = buildJourneys(bundle().features).find((item) => item.title === 'Place order')!;
  const report = {
    version: 1,
    repoId: 'snackshop',
    repoName: 'Snackshop',
    appUrl: 'http://localhost:3000',
    mode: 'full',
    runId: 'run-20261110-100000',
    createdAt: '2026-11-10T10:00:00Z',
    tool: { name: 'codedna', version: '0.0.0' },
    suites: [
      {
        runner: 'journeys',
        title: 'User journeys',
        status: 'failed',
        startedAt: '2026-11-10T10:00:00Z',
        durationMs: 5000,
        checks: [
          {
            id: `journey:${journey.id}`,
            journeyId: journey.id,
            title: 'Place order',
            status: 'failed',
            detail: 'Server answers: The server failed: it answered 500.',
            steps: [
              { nodeId: '0.open', kind: 'open', label: 'Open /', status: 'passed', http: { method: 'GET', url: 'http://localhost:3000/', status: 200, durationMs: 40 } },
              { nodeId: '1.find', kind: 'find', label: 'Find “Go to checkout”', status: 'passed' },
              { nodeId: '1.press', kind: 'press', label: 'Click “Go to checkout”', status: 'passed' },
              { nodeId: '1.result', kind: 'result', label: 'Opens /checkout', status: 'passed' },
              { nodeId: '2.find', kind: 'find', label: 'Find “Place order”', status: 'passed' },
              { nodeId: '2.fill', kind: 'fill', label: 'Fill in the form', status: 'passed' },
              { nodeId: '2.press', kind: 'press', label: 'Press “Place order”', status: 'passed' },
              { nodeId: '2.request', kind: 'request', label: 'Send to the server', status: 'passed', http: { method: 'POST', url: 'http://localhost:3000/checkout', status: 500, durationMs: 120 } },
              { nodeId: '2.server', kind: 'server', label: 'Server answers', status: 'failed', detail: 'The server failed: it answered 500.', http: { method: 'POST', url: 'http://localhost:3000/checkout', status: 500, durationMs: 120 } },
              { nodeId: '2.result', kind: 'result', label: 'What happens next', status: 'skipped', detail: 'Not reached.' },
            ],
          },
        ],
      },
    ],
  };
  await page.goto('/r/snackshop/qa');
  await expect(page.getByRole('group', { name: 'What to test' }).getByRole('button', { name: /User journeys/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('QA report file').setInputFiles({ name: 'qa-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });

  // The broken journey opens first, on the point that broke, with its request and answer.
  const list = page.getByRole('navigation', { name: 'Journeys' });
  await expect(list.getByRole('button', { name: /Place order.*Broke/ })).toHaveAttribute('aria-current', 'true');
  const map = page.getByRole('region', { name: 'Journey map' });
  await expect(map.getByRole('button', { name: /^Server answers: Broke, POST answered 500/ })).toHaveAttribute('aria-pressed', 'true');
  const point = page.getByRole('region', { name: 'This point' });
  await expect(point.getByText('POST http://localhost:3000/checkout')).toBeVisible();
  await expect(point.getByText('The server failed: it answered 500.')).toBeVisible();
  await expect(map.getByRole('button', { name: /^What happens next: Skipped/ })).toBeVisible();
  // Picking another point shows it.
  await map.getByRole('button', { name: /^Open \/: Passed/ }).click();
  await expect(point.getByText('GET http://localhost:3000/')).toBeVisible();
  // Signing in uses the repo's secrets on the hosted site.
  await expect(page.getByText('CODEDNA_QA_EMAIL', { exact: true })).toBeVisible();

  // Rename it; on the hosted site edits stay in this browser, with the file to add to the repo.
  await page.getByRole('button', { name: 'Edit journey' }).click();
  await page.getByLabel('Journey name').fill('Buy snacks');
  await page.getByRole('button', { name: 'Move step 2 up' }).click();
  await page.getByRole('button', { name: 'Move step 1 down' }).click();
  await page.getByRole('button', { name: 'Save journey' }).click();
  await expect(list.getByRole('button', { name: /Buy snacks\s*edited/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy codedna.journeys.json' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Journeys' }).getByRole('button', { name: /Buy snacks/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
});
