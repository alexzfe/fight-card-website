import { expect, test } from '@playwright/test';

test.describe('home page', () => {
  test('shows the next event and its fights', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('UFC 323: Alpha vs. Bravo');
    const fights = page.getByTestId('fight');
    await expect(fights).toHaveCount(4);
    const main = fights.first();
    await expect(main).toContainText('Alex Alpha');
    await expect(main).toContainText('Bruno Bravo');
    await expect(main).toContainText('21-4-0');
    await expect(main).toContainText('18-2-1 (1 NC)');
    await expect(main).toContainText('Lightweight');
    await expect(main.getByTestId('title')).toBeVisible();
    await expect(main.getByTestId('badge')).toHaveText('High');
    await expect(fights.nth(3).getByTestId('badge')).toHaveText('—');
  });

  test('renders initials for fighters without a photo', async ({ page }) => {
    await page.goto('/');
    const third = page.getByTestId('fight').nth(2);
    await expect(third.getByTestId('avatar-initials').first()).toHaveText('EE');
  });

  test('marks the current event chip', async ({ page }) => {
    await page.goto('/');
    const current = page.locator('nav [aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('UFC 323');
  });

  test('shows the footer attribution', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer).toContainText('Finish model as of Oct 1, 2026');
    await expect(footer).toContainText('ufcstats.com');
    await expect(footer).toContainText('ESPN');
  });
});

test('chips are ordered upcoming then past, and navigate', async ({ page }) => {
  await page.goto('/');
  const chips = page.locator('nav a');
  await expect(chips).toHaveCount(4);
  await expect(chips.nth(0)).toContainText('Oct 31');
  await expect(chips.nth(1)).toContainText('Nov 7');
  await expect(chips.nth(2)).toContainText('Nov 14');
  await expect(chips.nth(3)).toContainText('Oct 18');

  await chips.nth(1).click();
  await expect(page).toHaveURL(/\/events\/ufc-fight-night-india-vs-juliet\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('UFC Fight Night: India vs. Juliet');
  await expect(page.locator('nav [aria-current="page"]')).toContainText('Nov 7');
});

test('details expand to show height, reach, stance and age', async ({ page }) => {
  await page.goto('/');
  const main = page.getByTestId('fight').first();
  const details = main.locator('details');
  await expect(details.getByText(`5'11"`)).toBeHidden();
  await main.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details).toContainText(`5'11"`);
  await expect(details).toContainText('72"');
  await expect(details).toContainText('75.5"');
  await expect(details).toContainText('Southpaw');
  await expect(details).toContainText('33');
});

test('each corner shows recent form, and details list the last 3 fights', async ({ page }) => {
  await page.goto('/');
  const main = page.getByTestId('fight').first();
  await expect(main.getByTestId('form').first()).toHaveText('W L W');
  await expect(main.getByTestId('form').first()).toHaveAttribute('aria-label', 'Last 3: win, loss, win');
  await expect(main.getByTestId('form').nth(1)).toHaveText('NC');

  const details = main.locator('details');
  await expect(details.getByText('Dan Delta')).toBeHidden();
  await main.locator('summary').click();
  const red = details.getByTestId('last-fights').first();
  await expect(red.locator('li')).toHaveCount(3);
  await expect(red.locator('li').first()).toContainText('Dan Delta');
  await expect(red.locator('li').first()).toContainText('KO/TKO R1 · Jun 2026');
  await expect(details.getByTestId('last-fights').nth(1).locator('li')).toHaveCount(1);
});

test('fighters without history show no form and no last-fights list', async ({ page }) => {
  await page.goto('/');
  const second = page.getByTestId('fight').nth(1);
  await expect(second.getByTestId('form')).toHaveCount(0);
  await expect(second.getByTestId('last-fights')).toHaveCount(0);
});

test('completed event shows results next to the frozen badge', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const fights = page.getByTestId('fight');
  await expect(fights.first().getByTestId('outcome')).toHaveText('High → KO/TKO R1 4:12');
  await expect(fights.first().getByTestId('winner')).toContainText('Gus Golf');
  await expect(fights.nth(1).getByTestId('winner')).toContainText('Nia November');
  await expect(fights.nth(2).getByTestId('outcome')).toHaveText('Medium → Draw R3 5:00');
  await expect(fights.nth(2).getByTestId('winner')).toHaveCount(0);
});

test('no horizontal overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const url of ['/', '/events/ufc-fight-night-golf-vs-hotel/']) {
    await page.goto(url);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, url).toBeLessThanOrEqual(clientWidth);
  }
});

test('healthz returns ok', async ({ request }) => {
  const res = await request.get('/healthz');
  expect(res.status()).toBe(200);
  expect((await res.text()).trim()).toBe('ok');
});

test('fight row is mirrored: red left, badge centre, blue right, names readable at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const main = page.getByTestId('fight').first();
  const red = (await main.getByText('Alex Alpha').boundingBox())!;
  const badge = (await main.getByTestId('badge').boundingBox())!;
  const blue = (await main.getByText('Bruno Bravo').boundingBox())!;
  expect(red.x + red.width).toBeLessThanOrEqual(badge.x);
  expect(badge.x + badge.width).toBeLessThanOrEqual(blue.x);
  // No word broken mid-letter: a name wraps onto at most two lines.
  const lineHeight = await main.getByText('Alex Alpha').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(red.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
});
