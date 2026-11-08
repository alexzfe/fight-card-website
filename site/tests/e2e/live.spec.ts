// Runs against dist-live: tests/fixtures/live built at 2026-11-08T00:44Z (npm run build:fixtures:live), mid fight night.
// The card dated 2026-11-07 already has status `completed` (the engine flips it on the first result) with 2 of its 4
// bouts decided, and the next card is a week out: the home page must stay on tonight's card.
import { expect, test } from '@playwright/test';

test('the home page keeps the live card, not the next one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('UFC Fight Night: Live vs. Wire');
  await expect(page.getByTestId('fight')).toHaveCount(4);
  await expect(page).toHaveTitle(/Live vs\. Wire/);
  await expect(page).not.toHaveTitle(/Next vs\. Upcoming/);
});

test('the rail marks the live card as current', async ({ page }) => {
  await page.goto('/');
  const current = page.locator('nav [aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Live vs. Wire');
});

test('the home page structured data describes the live card', async ({ page }) => {
  await page.goto('/');
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const names = blocks.flatMap((b) => [JSON.parse(b)].flat()).filter((d) => d['@type'] === 'SportsEvent').map((d) => d.name);
  expect(names).toEqual(['UFC Fight Night: Live vs. Wire']);
});
