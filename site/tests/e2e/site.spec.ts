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

  test('marks the current event tile', async ({ page }) => {
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

test('event tiles run in date order, name the headliners, and navigate', async ({ page }) => {
  await page.goto('/');
  const tiles = page.getByTestId('event-tile');
  await expect(tiles).toHaveCount(4);
  await expect(tiles.nth(0)).toContainText('Oct 18 · Results');
  await expect(tiles.nth(0)).toContainText('Golf vs. Hotel');
  await expect(tiles.nth(1)).toContainText('Oct 31 · UFC 323');
  await expect(tiles.nth(1)).toContainText('Alpha vs. Bravo');
  await expect(tiles.nth(2)).toContainText('India vs. Juliet');
  await expect(tiles.nth(3)).toContainText('Kilo vs. Lima');
  await expect(page.locator('nav')).not.toContainText('Fight Night');

  // The today marker sits between the past and the upcoming events.
  const past = (await tiles.nth(0).boundingBox())!;
  const today = (await page.getByTestId('rail-today').boundingBox())!;
  const next = (await tiles.nth(1).boundingBox())!;
  expect(past.x + past.width).toBeLessThanOrEqual(today.x);
  expect(today.x + today.width).toBeLessThanOrEqual(next.x);

  await tiles.nth(2).click();
  await expect(page).toHaveURL(/\/events\/ufc-fight-night-india-vs-juliet\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('UFC Fight Night: India vs. Juliet');
  await expect(page.locator('nav [aria-current="page"]')).toContainText('India vs. Juliet');
});

test('event tiles are comfortable touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  await expect(page.getByTestId('event-tile')).toHaveCount(4);
  for (const tile of await page.getByTestId('event-tile').all()) {
    expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('the selected tile is in view on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/events/ufc-fight-night-kilo-vs-lima/');
  const box = (await page.locator('nav [aria-current="page"]').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('the rail keeps its scroll position when switching events', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const rail = page.locator('nav .rail');
  const target = page.getByTestId('event-tile').nth(2);
  // Swipe the rail so the target sits centred (a snap position), away from where the page opened it.
  const opened = await rail.evaluate((el) => el.scrollLeft);
  await target.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }));
  const before = await rail.evaluate((el) => el.scrollLeft);
  expect(before).not.toBe(opened);
  await target.click();
  await expect(page).toHaveURL(/india-vs-juliet/);
  expect(await page.locator('nav .rail').evaluate((el) => el.scrollLeft)).toBe(before);
});

test('a swipe on the rail comes to rest with a whole tile centred', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const rail = page.locator('nav .rail');
  const box = (await rail.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(70, 0);
  // Wait for the rail to settle.
  let last = -1;
  await expect
    .poll(async () => {
      const now = await rail.evaluate((el) => el.scrollLeft);
      const settled = now === last;
      last = now;
      return settled && now > 0;
    }, { intervals: [150] })
    .toBe(true);
  const offset = await rail.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    const tiles = [...el.querySelectorAll('[data-testid="event-tile"]')].map((t) => t.getBoundingClientRect());
    return Math.min(...tiles.map((t) => Math.abs(t.left + t.width / 2 - mid)));
  });
  expect(offset).toBeLessThanOrEqual(1);
});

test('the event rail stays at the top while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 400 });
  await page.goto('/');
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const box = (await page.locator('nav .rail').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeLessThanOrEqual(1);
});

test('switching events prerenders eagerly and animates the selection', async ({ page }) => {
  await page.goto('/');
  const rules = JSON.parse((await page.locator('script[type="speculationrules"]').textContent())!);
  expect(rules.prerender[0].eagerness).toBe('eager');
  const hasViewTransition = await page.evaluate(() => {
    const active = (rules: CSSRuleList): CSSRule[] =>
      [...rules].flatMap((r) =>
        r instanceof CSSMediaRule ? (matchMedia(r.conditionText).matches ? active(r.cssRules) : []) : [r],
      );
    return [...document.styleSheets].some((sheet) =>
      active(sheet.cssRules).some((r) => r.cssText.startsWith('@view-transition')),
    );
  });
  expect(hasViewTransition).toBe(true);
  const name = await page.locator('nav [aria-current="page"]').evaluate((el) => getComputedStyle(el).viewTransitionName);
  expect(name).toBe('current-event');
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

test('a corner shows the Elo next to the record, and nothing when it is unknown', async ({ page }) => {
  await page.goto('/');
  const main = page.getByTestId('fight').first();
  await expect(main.getByTestId('elo')).toHaveCount(1);
  await expect(main.locator('.corner-red').getByTestId('elo')).toHaveText('Elo 1612');
  await expect(main.locator('.corner-red .record')).toContainText('21-4-0');
  await expect(main.locator('.corner-blue').getByTestId('elo')).toHaveCount(0);
});

test('a ranked fighter shows the P4P rank after the Elo', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  await expect(fights.nth(1).locator('.corner-red').getByTestId('elo')).toHaveText('Elo 1690 · #4 P4P');
  await expect(fights.nth(0).locator('.corner-red').getByTestId('elo')).toHaveText('Elo 1612');
});

test('provisional and inactive are quiet tags, and an unknown Elo shows no tag', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const tags = (fight: number, side: 'red' | 'blue') =>
    fights.nth(fight).locator(`.corner-${side}`).getByTestId('elo-tag');
  await expect(tags(1, 'blue')).toHaveText(['provisional']);
  await expect(tags(2, 'red')).toHaveText(['inactive']);
  await expect(tags(1, 'red')).toHaveCount(0);
  await expect(tags(0, 'blue')).toHaveCount(0); // inactive, but no Elo
  const muted = await page.locator('.event-meta').evaluate((el) => getComputedStyle(el).color);
  expect(await tags(1, 'blue').evaluate((el) => getComputedStyle(el).color)).toBe(muted);
});

test('the peak shows in a tooltip on the Elo, on hover or on tap', async ({ page }) => {
  await page.goto('/');
  const elo = page.getByTestId('fight').nth(1).locator('.corner-red').getByTestId('elo');
  await expect(elo).toHaveAttribute('data-tip', 'Peak 1793');
  const tip = () => elo.evaluate((el) => getComputedStyle(el, '::after').visibility);
  expect(await tip()).toBe('hidden');
  await elo.hover();
  await expect.poll(tip).toBe('visible');
  await page.mouse.move(0, 0);
  await expect.poll(tip).toBe('hidden');
  await elo.focus();
  await expect.poll(tip).toBe('visible');
  const noPeak = page.getByTestId('fight').nth(1).locator('.corner-blue').getByTestId('elo');
  await expect(noPeak).not.toHaveAttribute('data-tip');
  await expect(noPeak).not.toHaveAttribute('tabindex');
});

test('screen readers hear the peak without hovering', async ({ page }) => {
  await page.goto('/');
  const corner = page.getByTestId('fight').nth(1).locator('.corner-red');
  await expect(corner.getByTestId('elo-peak')).toHaveText('Peak 1793');
  await expect(page.getByTestId('fight').nth(1).locator('.corner-blue').getByTestId('elo-peak')).toHaveCount(0);
});

test('an Elo with a peak is a 44px tap target that leaves the Stats toggle alone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const fight = page.getByTestId('fight').nth(1);
  const box = (await fight.locator('.corner-red').getByTestId('elo').boundingBox())!;
  const x = box.x + box.width / 2;
  const bottom = box.y + box.height;
  const hit = (y: number) =>
    page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="elo"], summary')?.tagName, [x, y]);
  // The hit area runs 44px up from the label's bottom edge.
  expect(await hit(bottom - 1)).toBe('SPAN');
  expect(await hit(bottom - 43)).toBe('SPAN');
  const summary = (await fight.locator('summary').boundingBox())!;
  expect(await hit(summary.y + 2)).toBe('SUMMARY');
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

test('the card is split into main card, prelims and early prelims', async ({ page }) => {
  await page.goto('/');
  const heads = page.getByRole('heading', { level: 2 });
  await expect(heads).toHaveText([/Main card/, /Prelims/, /Early prelims/]);
  const segments = page.getByTestId('segment');
  await expect(segments.nth(0).getByTestId('fight')).toHaveCount(2);
  await expect(segments.nth(1).getByTestId('fight')).toHaveCount(1);
  await expect(segments.nth(2).getByTestId('fight')).toHaveCount(1);
});

test('an event without segment data shows no segment headings', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-india-vs-juliet/');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  await expect(page.getByTestId('fight')).toHaveCount(2);
});

test('the main event is marked', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  await expect(fights.first().getByTestId('main-event')).toBeVisible();
  await expect(fights.nth(1).getByTestId('main-event')).toHaveCount(0);
});

test('the finish meter fills one bar per tier and none for unscored fights', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const filled = (i: number) => fights.nth(i).locator('[data-testid="badge"] .bar.on');
  await expect(filled(0)).toHaveCount(3);
  await expect(filled(1)).toHaveCount(2);
  await expect(filled(2)).toHaveCount(1);
  await expect(fights.nth(3).locator('[data-testid="badge"] .bar')).toHaveCount(0);
});

test('the stats toggle is a comfortable touch target', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const box = (await page.getByTestId('fight').first().locator('summary').boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(200);
});

test('each finish tier has its own colour', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const colour = (i: number) => fights.nth(i).getByTestId('badge').evaluate((el) => getComputedStyle(el).color);
  const [high, medium, low, none] = await Promise.all([0, 1, 2, 3].map(colour));
  const text = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
  const muted = await page.locator('.event-meta').evaluate((el) => getComputedStyle(el).color);
  expect(new Set([high, medium, low, text, muted]).size).toBe(5);
  expect(none).toBe(muted);
});

test('hovering a form tile names the opponent', async ({ page }) => {
  await page.goto('/');
  const tile = page.getByTestId('fight').first().getByTestId('form').first().locator('span').first();
  await expect(tile).toHaveAttribute('data-tip', 'Dan Delta · KO/TKO R1 · Jun 2026');
  const tip = () => tile.evaluate((el) => getComputedStyle(el, '::after').visibility);
  expect(await tip()).toBe('hidden');
  await tile.hover();
  await expect.poll(tip).toBe('visible');
  expect(await tile.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('Dan Delta');
});
