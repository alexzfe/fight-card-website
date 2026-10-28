import { expect, type Locator, test } from '@playwright/test';
import sharp from 'sharp';

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
  await expect(tiles.nth(0)).toHaveText(/^\s*Oct 18\s*Golf vs. Hotel\s*$/);
  await expect(tiles.nth(0)).toContainText('Golf vs. Hotel');
  await expect(tiles.nth(1)).toContainText('Oct 31 · UFC 323');
  await expect(tiles.nth(1)).toContainText('Alpha vs. Bravo');
  await expect(tiles.nth(2)).toContainText('India vs. Juliet');
  await expect(tiles.nth(3)).toContainText('Kilo vs. Lima');
  await expect(page.getByRole('navigation', { name: 'Events' })).not.toContainText('Fight Night');

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

test('past tiles are quieter and smaller than upcoming ones', async ({ page }) => {
  await page.goto('/rankings/');
  const tiles = page.getByTestId('event-tile');
  const style = (i: number) =>
    tiles.nth(i).evaluate((el) => {
      const s = getComputedStyle(el);
      const h = getComputedStyle(el.querySelector('.tile-headline')!);
      return { border: s.borderTopColor, bg: s.backgroundColor, size: parseFloat(h.fontSize), color: h.color };
    });
  const past = await style(0);
  const next = await style(1);
  expect(past.border).toBe('rgba(0, 0, 0, 0)');
  expect(next.border).not.toBe('rgba(0, 0, 0, 0)');
  expect(past.size).toBeLessThan(next.size);
  expect(past.color).not.toBe(next.color);
});

// Where the rail's edge fades end: a tile under a fade only half shows.
const clearOfFades = async (rail: Locator, tile: Locator) =>
  tile.evaluate(
    (t, r) => {
      const a = r.getBoundingClientRect();
      const b = t.getBoundingClientRect();
      return b.left >= a.left + 16 - 1 && b.right <= a.right - 40 + 1;
    },
    await rail.elementHandle(),
  );

test('with no event selected, the rail opens on what is next, the latest past event beside it', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/rankings/');
  const rail = page.locator('nav .rail');
  const tiles = page.getByTestId('event-tile');
  await expect.poll(() => clearOfFades(rail, tiles.nth(1))).toBe(true);
  // Wide enough for more: the past tile shows too, so the way back is in view.
  await page.setViewportSize({ width: 900, height: 740 });
  await page.goto('/rankings/');
  await expect.poll(() => clearOfFades(rail, tiles.nth(0))).toBe(true);
  await expect.poll(() => clearOfFades(rail, tiles.nth(1))).toBe(true);
});

test('the selected tile is never left under an edge fade', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const url of ['/', '/events/ufc-fight-night-golf-vs-hotel/', '/events/ufc-fight-night-kilo-vs-lima/']) {
    await page.goto(url);
    const rail = page.locator('nav .rail');
    await expect.poll(() => clearOfFades(rail, page.locator('nav .rail [aria-current="page"]')), url).toBe(true);
  }
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

test('tabbing through the rail brings each tile fully into view', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const rail = page.locator('nav .rail');
  const tiles = page.getByTestId('event-tile');
  // The rail is the first thing on the page, so the first Tab lands on its first tile.
  for (let i = 0; i < (await tiles.count()); i++) {
    await page.keyboard.press('Tab');
    await expect(tiles.nth(i)).toBeFocused();
    await expect
      .poll(() =>
        rail.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const t = document.activeElement!.getBoundingClientRect();
          return t.left >= r.left && t.right <= r.right;
        }),
      )
      .toBe(true);
  }
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

test('the event rail is the topmost thing on every page, and only an event or Rankings is ever current', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [url, current] of [
    ['/', 'UFC 323'],
    ['/events/ufc-fight-night-kilo-vs-lima/', 'Kilo vs. Lima'],
    ['/rankings/', 'Rankings'],
    ['/how-it-works/', null],
    ['/no-such-page/', null],
  ] as const) {
    await page.goto(url);
    const nav = page.locator('.rail-nav');
    expect((await nav.boundingBox())!.y, url).toBe(0);
    const above = await nav.evaluate((el) => [...document.body.children].indexOf(el));
    expect(above, url).toBe(0);
    const marked = page.locator('[aria-current]');
    if (current) {
      await expect(marked, url).toHaveCount(1);
      await expect(marked, url).toContainText(current);
    } else {
      await expect(marked, url).toHaveCount(0);
    }
  }
});

test('the 404 page leads back to the fight cards', async ({ page }) => {
  await page.goto('/no-such-page/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await page.getByRole('main').getByRole('link', { name: 'the next fight card' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('fight').first()).toBeVisible();
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

test('a corner shows the Elo on its own line under the record, in full-strength text', async ({ page }) => {
  await page.goto('/');
  const main = page.getByTestId('fight').first();
  const red = main.locator('.corner-red');
  await expect(main.getByTestId('elo')).toHaveCount(1);
  await expect(red.getByTestId('elo')).toHaveText('Elo 1612');
  await expect(red.locator('.record')).toHaveText('21-4-0');
  const record = (await red.locator('.record').boundingBox())!;
  const elo = (await red.getByTestId('elo').boundingBox())!;
  expect(elo.y).toBeGreaterThanOrEqual(record.y + record.height - 1);
  const text = await page.locator('body').evaluate((el) => getComputedStyle(el).color);
  expect(await red.getByTestId('elo').evaluate((el) => getComputedStyle(el).color)).toBe(text);
  await expect(main.locator('.corner-blue').getByTestId('elo')).toHaveCount(0);
});

test('a ranked fighter shows the P4P rank after the Elo', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  await expect(fights.nth(1).locator('.corner-red').getByTestId('elo')).toHaveText('Elo 1690 · #3 P4P');
  await expect(fights.nth(0).locator('.corner-red').getByTestId('elo')).toHaveText('Elo 1612');
});

test('a P4P rank on a card links to the fighter\'s row in the rankings, men\'s or women\'s, and keeps the Elo tip', async ({ page }) => {
  await page.goto('/');
  const fight = page.getByTestId('fight').nth(1);
  const red = fight.locator('.corner-red').getByTestId('elo');
  await expect(red.getByRole('link', { name: '#3 P4P' })).toHaveAttribute('href', '/rankings/#c3c3c3c3c3c3c3c3');
  await expect(fight.locator('.corner-blue').getByTestId('elo').getByRole('link', { name: '#1 P4P' })).toHaveAttribute(
    'href',
    '/rankings/#d4d4d4d4d4d4d4d4',
  );
  await red.hover();
  await expect.poll(() => red.evaluate((e) => getComputedStyle(e, '::after').visibility)).toBe('visible');
  await expect(red).toHaveAttribute('data-tip', 'Peak 1793');

  await red.getByRole('link').click();
  await expect(page).toHaveURL(/\/rankings\/#c3c3c3c3c3c3c3c3$/);
  const row = page.locator('#c3c3c3c3c3c3c3c3');
  await expect(row.getByTestId('p4p-name')).toHaveText('Carla Charlie');
  // It lands in view below the sticky rail, picked out from the rows around it.
  const rail = (await page.getByRole('navigation', { name: 'Events' }).boundingBox())!;
  const box = (await row.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(rail.y + rail.height);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const bg = (el: Element) => getComputedStyle(el).backgroundColor;
  expect(await row.evaluate(bg)).not.toBe(await page.getByTestId('p4p-row').first().evaluate(bg));
});

test('provisional and inactive are quiet unboxed words, and an unknown Elo shows no tag', async ({ page }) => {
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
  expect(await tags(1, 'blue').evaluate((el) => getComputedStyle(el).borderStyle)).toBe('none');
});

test('Stats lists each corner\'s peak and best win under the tale of the tape; the corner already shows the Elo', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const row = (fight: number, label: string) =>
    fights.nth(fight).locator('.stats tr', { has: page.locator('th', { hasText: new RegExp(`^${label}$`) }) }).locator('td');
  await fights.first().locator('summary').click();
  await expect(fights.first().locator('.stats th')).toHaveText(['Height', 'Reach', 'Stance', 'Age', 'Peak', 'Best win']);
  await expect(row(0, 'Peak')).toHaveText(['1655', '—']);
  await expect(row(0, 'Best win')).toHaveText(['Finn FoxtrotElo 1702 · Sep 2025', '—']);
  await fights.nth(1).locator('summary').click();
  await expect(fights.nth(1).locator('.stats th')).toHaveText(['Height', 'Reach', 'Stance', 'Age', 'Peak']);
});

test('hovering or tapping a form tile names the opponent', async ({ page }) => {
  await page.goto('/');
  const form = page.getByTestId('fight').first().getByTestId('form').first();
  const tile = form.locator('span').first();
  await expect(tile).toHaveAttribute('data-tip', 'Dan Delta · KO/TKO R1 · Jun 2026');
  const tip = () => tile.evaluate((el) => getComputedStyle(el, '::after').visibility);
  expect(await tip()).toBe('hidden');
  await tile.hover();
  await expect.poll(tip).toBe('visible');
  expect(await tile.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('Dan Delta');
  await page.mouse.move(0, 0);
  await expect.poll(tip).toBe('hidden');
  await tile.focus(); // a tap focuses the tile
  await expect.poll(tip).toBe('visible');
  // Not a Tab stop: Stats lists the same fights.
  await expect(tile).toHaveAttribute('tabindex', '-1');
});

test('fighters without history show no form and no last-fights list', async ({ page }) => {
  await page.goto('/');
  const second = page.getByTestId('fight').nth(1);
  await expect(second.getByTestId('form')).toHaveCount(0);
  await expect(second.getByTestId('last-fights')).toHaveCount(0);
});

test('a completed fight leads with the result: the method, then the round and time', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const fights = page.getByTestId('fight');
  await expect(fights.first().getByTestId('outcome')).toHaveText('KO/TKO R1 · 4:12');
  await expect(fights.nth(2).getByTestId('outcome')).toHaveText('Draw R3 · 5:00');
  const size = (l: Locator) => l.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const mid = fights.first().locator('.mid');
  expect(await size(mid.locator('.method'))).toBeGreaterThan(await size(mid.locator('.when')));
  expect(await size(mid.locator('.method'))).toBeGreaterThan(await size(mid.getByText('Heavyweight')));
  await expect(page.getByRole('main')).not.toContainText('→');
  // The frozen pre-fight badge stays under the result when there was one; without one, no dash and no label.
  await expect(fights.first().getByTestId('badge')).toHaveText('High');
  await expect(fights.nth(3).getByTestId('badge')).toHaveCount(0);
  await expect(fights.nth(3).getByTestId('finish-label')).toHaveCount(0);
});

test('the winner gets a WIN chip and the loser\'s corner steps back; a draw marks neither', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const fights = page.getByTestId('fight');
  await expect(fights.first().getByTestId('winner')).toContainText('Gus Golf');
  await expect(fights.nth(1).getByTestId('winner')).toContainText('Nia November');
  await expect(fights.first().getByTestId('winner').getByTestId('win-chip')).toHaveText('Win');
  await expect(fights.first().getByTestId('win-chip')).toHaveCount(1);
  // No letter glued to the name any more.
  const after = (l: Locator) => l.evaluate((e) => getComputedStyle(e, '::after').content);
  expect(await after(fights.first().locator('.corner-red .name'))).toBe('none');
  // The loser's photo greys out and their name goes quiet.
  const loser = fights.first().locator('.corner-blue');
  expect(await loser.locator('.avatar').evaluate((e) => getComputedStyle(e).filter)).toContain('grayscale');
  const muted = await page.locator('.event-meta').evaluate((el) => getComputedStyle(el).color);
  expect(await loser.locator('.name').evaluate((e) => getComputedStyle(e).color)).toBe(muted);
  await expect(fights.nth(2).getByTestId('winner')).toHaveCount(0);
  await expect(fights.nth(2).getByTestId('win-chip')).toHaveCount(0);
  expect(await fights.nth(2).locator('.avatar').first().evaluate((e) => getComputedStyle(e).filter)).toBe('none');
});

test('a completed fight shows no form tiles: today\'s form would count fights after it', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  await expect(page.getByTestId('fight').first().getByTestId('form')).toHaveCount(0);
});

// What a corner shows, without the screen-reader-only words.
const shown = (l: Locator) =>
  l.evaluate((e) => {
    const c = e.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.sr-only').forEach((s) => s.remove());
    return c.textContent;
  });

test('a completed fight shows each corner\'s Elo at the time: going in, the change, and the P4P rank then, unlinked', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const fights = page.getByTestId('fight');
  const elo = (fight: number, side: 'red' | 'blue') => fights.nth(fight).locator(`.corner-${side}`).getByTestId('elo');
  await expect(elo(0, 'red')).toBeVisible();
  expect(await shown(elo(0, 'red'))).toBe('Elo 1548 +26 · #4 P4P');
  expect(await shown(elo(0, 'blue'))).toBe('Elo 1580 \u221226 · #12 P4P');
  // Ivan India is 1640 today; the card shows the 1612 he took into the fight.
  expect(await shown(elo(1, 'red'))).toBe('Elo 1612 \u221214 · #7 P4P');
  expect(await shown(elo(1, 'blue'))).toBe('Elo 1497 +14');
  // A no contest changes nothing, so nothing shows.
  expect(await shown(elo(3, 'red'))).toBe('Elo 1502');
  // Past ranks, red or blue, so no link to today's rankings.
  for (const [fight, side] of [[0, 'red'], [0, 'blue'], [1, 'red']] as const) {
    await expect(elo(fight, side).getByRole('link')).toHaveCount(0);
  }
  // No tip: the line already says it all.
  await expect(elo(0, 'red')).not.toHaveAttribute('data-tip');
  // Tags still describe today.
  await expect(fights.nth(0).locator('.corner-blue').getByTestId('elo-tag')).toHaveText(['provisional']);
});

test('screen readers hear the at-time change in words, not a minus sign they may drop', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const elo = (fight: number, side: 'red' | 'blue') =>
    page.getByTestId('fight').nth(fight).locator(`.corner-${side}`).getByTestId('elo');
  await expect(elo(0, 'red')).toMatchAriaSnapshot('- text: "Elo 1548 (up 26) · #4 P4P"');
  await expect(elo(0, 'blue')).toMatchAriaSnapshot('- text: "Elo 1580 (down 26) · #12 P4P"');
  await expect(elo(3, 'blue')).toMatchAriaSnapshot('- text: "Elo 1471 (no change)"');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the at-time change is a small chip: a gain filled, a loss outlined (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
    const fight = page.getByTestId('fight').first();
    const gain = fight.locator('.corner-red').getByTestId('elo-delta');
    const loss = fight.locator('.corner-blue').getByTestId('elo-delta');
    await expect(gain).toHaveText('+26');
    await expect(loss).toHaveText('\u221226');
    const look = (l: Locator) =>
      l.evaluate((e) => {
        const s = getComputedStyle(e);
        return { bg: s.backgroundColor, border: s.borderTopStyle, radius: parseFloat(s.borderTopLeftRadius) };
      });
    const g = await look(gain);
    const l = await look(loss);
    expect(g.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(l.bg).toBe('rgba(0, 0, 0, 0)');
    expect(l.border).toBe('solid');
    expect(g.radius).toBeGreaterThan(0);
  });
}

test('a completed fight without Elo at the time shows today\'s, as before', async ({ page }) => {
  await page.goto('/events/ufc-fight-night-golf-vs-hotel/');
  const red = page.getByTestId('fight').nth(2).locator('.corner-red');
  await expect(red.getByTestId('elo')).toHaveText('Elo 1531');
  await expect(red.getByTestId('elo')).toHaveAttribute('data-tip', 'Peak 1604');
  await expect(red.getByTestId('elo-delta')).toHaveCount(0);
  await expect(red.getByTestId('elo-tag')).toHaveText(['inactive']);
});

test('upcoming fights still show today\'s Elo and linked rank, with no change', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('elo-delta')).toHaveCount(0);
  const red = page.getByTestId('fight').nth(1).locator('.corner-red').getByTestId('elo');
  await expect(red).toHaveText('Elo 1690 · #3 P4P');
  await expect(red.getByRole('link', { name: '#3 P4P' })).toHaveAttribute('href', '/rankings/#c3c3c3c3c3c3c3c3');
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
  // The longest at-time line sits in a main event's large corner, and still fits its row without overflowing.
  const row = page.locator('.main-event');
  const who = row.locator('.corner-blue .who');
  const elo = who.getByTestId('elo');
  const lengths = await page.getByTestId('elo').evaluateAll((els) =>
    els.filter((e) => e.querySelector('.elo-delta')).map((e) => e.textContent!.length),
  );
  expect((await elo.textContent())!.length).toBe(Math.max(...lengths));
  const fits = (await row.boundingBox())!;
  for (const box of (await elo.evaluate((e) => [...e.getClientRects()].map((r) => r.toJSON())))) {
    expect(box.left).toBeGreaterThanOrEqual(fits.x);
    expect(box.right).toBeLessThanOrEqual(fits.x + fits.width);
  }
  expect(await who.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
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

test('the finish meter is labelled once per card segment, and every badge is still named for screen readers', async ({ page }) => {
  // Home: main card (2 fights), prelims, early prelims. Golf vs. Hotel: no segment data, so one group; its no contest
  // had no badge frozen, so it has neither badge nor label (null).
  for (const [url, shown] of [
    ['/', [true, false, true, true]],
    ['/events/ufc-fight-night-golf-vs-hotel/', [true, false, false, null]],
  ] as const) {
    await page.goto(url);
    const fights = page.getByTestId('fight');
    await expect(fights, url).toHaveCount(shown.length);
    for (const [i, visible] of shown.entries()) {
      const label = fights.nth(i).getByTestId('finish-label');
      if (visible === null) {
        await expect(label, `${url} fight ${i}`).toHaveCount(0);
        continue;
      }
      await expect(label, `${url} fight ${i}`).toHaveText('Finish chance');
      const width = await label.evaluate((el) => el.getBoundingClientRect().width);
      expect(width > 1, `${url} fight ${i}`).toBe(visible);
    }
  }
});

test('the Elo underline shows on hover or focus, and its tip opens below the line in both corners', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const underline = (el: import('@playwright/test').Locator) => el.evaluate((e) => getComputedStyle(e).textDecorationLine);
  const elo = fights.first().locator('.corner-red').getByTestId('elo');
  expect(await underline(elo)).toBe('none');
  await elo.hover();
  await expect.poll(() => underline(elo)).toBe('underline');

  // The tip hangs below its anchor, so it never covers the fighter's name above it.
  const below = async (el: import('@playwright/test').Locator) => {
    await el.focus();
    await expect.poll(() => el.evaluate((e) => getComputedStyle(e, '::after').visibility)).toBe('visible');
    return el.evaluate((e) => {
      const tip = getComputedStyle(e, '::after');
      return parseFloat(tip.top) >= e.getBoundingClientRect().height;
    });
  };
  expect(await below(elo)).toBe(true);
  expect(await below(fights.nth(1).locator('.corner-blue').getByTestId('elo-tag'))).toBe(true);
});

test('headshots are 64px on phones and 72px wider, the main event 88px and 96px', async ({ page }) => {
  const size = (fight: number) =>
    page.getByTestId('fight').nth(fight).locator('.corner-red .avatar').evaluate((el) => el.getBoundingClientRect().width);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  expect([await size(0), await size(1)]).toEqual([88, 64]);
  await page.setViewportSize({ width: 1024, height: 800 });
  expect([await size(0), await size(1)]).toEqual([96, 72]);
});

test('the footer explains what the page shows, in one line', async ({ page }) => {
  const explainer = page.getByTestId('footer-explainer');
  for (const url of ['/', '/events/ufc-fight-night-golf-vs-hotel/']) {
    await page.goto(url);
    await expect(explainer, url).toHaveText(
      "High / Medium / Low is the model's chance the fight ends inside the distance; — means too little data.",
    );
  }
  await page.goto('/rankings/');
  await expect(explainer).toHaveText(
    'Elo rates fighters from their results, weighted by opponent strength; 1500 is the average active fighter.',
  );
  // Every page keeps the model date, the attribution and the way to the method.
  for (const url of ['/', '/rankings/', '/no-such-page/']) {
    await page.goto(url);
    const footer = page.locator('footer');
    await expect(footer, url).toContainText('Finish model as of Oct 1, 2026');
    await expect(footer, url).toContainText('ufcstats.com');
    await expect(footer.getByRole('link', { name: 'How finish chance and Elo work' }), url).toHaveAttribute(
      'href',
      '/how-it-works/',
    );
  }
  await page.goto('/how-it-works/');
  await expect(page.locator('footer')).toContainText('Finish model as of Oct 1, 2026');
  await expect(page.locator('footer')).toContainText('ufcstats.com');
});

test.describe('how it works page', () => {
  test('the footer links to it', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer').getByRole('link', { name: 'How finish chance and Elo work' }).click();
    await expect(page).toHaveURL(/\/how-it-works\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Methodology: How finish chance and Elo work');
  });

  test('explains both numbers with formulas and charts', async ({ page }) => {
    await page.goto('/how-it-works/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([/Finish chance/, /Elo/]);
    expect(await page.locator('math').count()).toBeGreaterThanOrEqual(6);
    const charts = page.getByRole('img');
    expect(await charts.count()).toBeGreaterThanOrEqual(5);
    for (const chart of await charts.all()) await expect(chart).toHaveAttribute('aria-label', /\w/);
  });

  test('quotes the tier cut points and how often each tier finished', async ({ page }) => {
    await page.goto('/how-it-works/');
    const tiers = page.getByTestId('tier-table');
    await expect(tiers).toContainText('43%');
    await expect(tiers).toContainText('56%');
    await expect(tiers).toContainText('62%'); // High tier's actual finish rate
  });

  test('works through an Elo update with real numbers', async ({ page }) => {
    await page.goto('/how-it-works/');
    await expect(page.getByTestId('elo-example')).toContainText('+32');
  });

  test('fits a 360px phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/how-it-works/');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});

test('the Elo and its tags explain themselves on hover or tap', async ({ page }) => {
  await page.goto('/');
  const fights = page.getByTestId('fight');
  const visible = (el: import('@playwright/test').Locator) => () =>
    el.evaluate((e) => getComputedStyle(e, '::after').visibility);

  const elo = fights.first().locator('.corner-red').getByTestId('elo');
  await expect(elo).toHaveAttribute('data-tip', 'Peak 1655 · Best win: Finn Foxtrot (1702)');
  expect(await visible(elo)()).toBe('hidden');
  await elo.hover();
  await expect.poll(visible(elo)).toBe('visible');
  // Nothing to say: no peak, no best win.
  await expect(fights.nth(1).locator('.corner-blue').getByTestId('elo')).not.toHaveAttribute('data-tip');

  const tag = fights.nth(1).locator('.corner-blue').getByTestId('elo-tag');
  await expect(tag).toHaveAttribute('data-tip', 'Fewer than 3 UFC fights');
  await tag.focus(); // a tap focuses it
  await expect.poll(visible(tag)).toBe('visible');
  await expect(fights.nth(2).locator('.corner-red').getByTestId('elo-tag')).toHaveAttribute(
    'data-tip',
    'No fight in the last 12 months',
  );
});

test('an event tile shows the full event name on hover', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('event-tile').nth(1)).toHaveAttribute('title', 'UFC 323: Alpha vs. Bravo');
});

test.describe('rankings page', () => {
  test('a Rankings tile pinned to the rail leads to it, is the current tile there, and event tiles lead back', async ({
    page,
  }) => {
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Events' });
    const pin = rail.getByRole('link', { name: 'Rankings' });
    await expect(pin).toHaveText('Rankings');
    await expect(pin).not.toHaveAttribute('aria-current', /.+/);
    await pin.click();
    await expect(page).toHaveURL(/\/rankings\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Elo: Pound-for-pound rankings');
    await expect(rail.locator('[aria-current]')).toHaveCount(1);
    await expect(pin).toHaveAttribute('aria-current', 'page');
    // It is styled as the selected tile, and the selection slides to it from the event tile.
    const style = (el: Element) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).viewTransitionName];
    const selected = await page.goto('/').then(() => page.locator('nav [aria-current="page"]').evaluate(style));
    await page.goto('/rankings/');
    expect(await pin.evaluate(style)).toEqual(selected);
    await page.getByTestId('event-tile').nth(1).click();
    await expect(page).toHaveURL(/\/events\/ufc-323-alpha-vs-bravo\/$/);
  });

  test('the rail is named for both the events and the rankings it leads to', async ({ page }) => {
    for (const path of ['/', '/rankings/']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Events and rankings', exact: true })).toBeVisible();
    }
  });

  test('the Rankings tile holds still at the right end of the rail while the events scroll beside it', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    const pin = page.getByRole('navigation', { name: 'Events' }).getByRole('link', { name: 'Rankings' });
    const tile = (await page.getByTestId('event-tile').first().boundingBox())!;
    const before = (await pin.boundingBox())!;
    expect(before.x + before.width).toBeLessThanOrEqual(360);
    expect(before.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(before.y - tile.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(before.height - tile.height)).toBeLessThanOrEqual(1);
    await page.locator('nav .rail').evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await expect.poll(async () => (await page.getByTestId('event-tile').last().boundingBox())!.x).toBeLessThan(before.x);
    expect(await pin.boundingBox()).toEqual(before);
    // The last event tile scrolls clear of it rather than under it.
    const last = (await page.getByTestId('event-tile').last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(before.x);
  });

  test('on a wide screen every event is in view beside the Rankings tile, which sits at the window\'s right end', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const pin = (await page.getByRole('navigation', { name: 'Events' }).getByRole('link', { name: 'Rankings' }).boundingBox())!;
    expect(1280 - (pin.x + pin.width)).toBeLessThanOrEqual(32);
    const tiles = page.getByTestId('event-tile');
    const first = (await tiles.first().boundingBox())!;
    const last = (await tiles.last().boundingBox())!;
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.width).toBeLessThanOrEqual(pin.x);
    // Nothing is left to scroll to: the rail fits the window.
    expect(await page.locator('nav .rail').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('ranks men and women apart, best first, with division and Elo', async ({ page }) => {
    await page.goto('/rankings/');
    const men = page.getByTestId('p4p-men').getByTestId('p4p-row');
    await expect(men).toHaveCount(3);
    await expect(men.nth(0).getByTestId('p4p-rank')).toHaveText('1');
    await expect(men.nth(0).getByTestId('p4p-name')).toHaveText('Alex Alpha');
    await expect(men.nth(0).getByTestId('p4p-division')).toHaveText('Lightweight');
    await expect(men.nth(0).getByTestId('p4p-elo')).toContainText('1612');
    await expect(men.nth(2).getByTestId('p4p-name')).toHaveText('Carla Charlie');
    const women = page.getByTestId('p4p-women').getByTestId('p4p-row');
    await expect(women.getByTestId('p4p-name')).toHaveText(['Dana Delta', 'Nia November']);
    await expect(women.nth(0).getByTestId('p4p-division')).toHaveText("Women's Flyweight");
  });

  test('shows headshots where there is one and initials where there is not', async ({ page }) => {
    await page.goto('/rankings/');
    const men = page.getByTestId('p4p-men').getByTestId('p4p-row');
    await expect(men.nth(0).locator('img')).toHaveCount(1);
    await expect(men.nth(1).locator('img')).toHaveCount(1);
    await expect(men.nth(2).getByTestId('avatar-initials')).toHaveText('CC');
    await expect(page.getByTestId('p4p-women').getByTestId('p4p-row').nth(1).getByTestId('avatar-initials')).toHaveText('NN');
  });

  test('marks provisional ratings as quiet words', async ({ page }) => {
    await page.goto('/rankings/');
    const women = page.getByTestId('p4p-women').getByTestId('p4p-row');
    await expect(women.nth(1).getByTestId('elo-tag')).toHaveText('provisional');
    await expect(women.nth(0).getByTestId('elo-tag')).toHaveCount(0);
  });

  test('says these are our Elo ratings, not the UFC\'s, and links how they work', async ({ page }) => {
    await page.goto('/rankings/');
    const note = page.getByTestId('rankings-note');
    await expect(note).toContainText('not official UFC rankings');
    await expect(note).toContainText('Oct 20, 2026');
    await note.getByRole('link', { name: 'How Elo works' }).click();
    await expect(page).toHaveURL(/\/how-it-works\/#elo$/);
  });

  test('searches the active fighters ignoring case and accents', async ({ page }) => {
    await page.goto('/rankings/');
    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    const results = page.getByTestId('result');
    await expect(page.getByTestId('p4p-men')).toBeVisible();
    await search.fill('JUILET');
    await expect(results).toHaveCount(0); // a typo is no match
    await search.fill('juliet');
    await expect(results).toHaveCount(1);
    await expect(results.first().getByTestId('result-name')).toHaveText('Joaquín Juliét');
    await expect(results.first()).toContainText('Featherweight');
    await expect(results.first()).toContainText('1520');
    await expect(results.first().getByTestId('elo-tag')).toHaveText('provisional');
    await search.fill('ALPHA');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('#1 P4P');
    await search.fill('dana');
    await expect(results.first()).toContainText('#1 women’s P4P');
  });

  test('finds names over apostrophes, dots, hyphens and word order', async ({ page }) => {
    await page.goto('/rankings/');
    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    const names = page.getByTestId('result-name');
    for (const q of ["o'hara", 'o’hara', 'ohara', 'jean luc', 'jean-luc', 'hara jean', 'O.Hara', '  Luc   OHARA ']) {
      await search.fill(q);
      await expect(names, q).toHaveText(["Jean-Luc O'Hara"]);
    }
    await search.fill('echo eli');
    await expect(names).toHaveText(['Eli Echo']);
    await search.fill('eli zzzz');
    await expect(page.getByTestId('result')).toHaveCount(0); // every word has to match
  });

  test('swaps the P4P lists for the results while a query is typed, and back', async ({ page }) => {
    await page.goto('/rankings/');
    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    await search.fill('a');
    await expect(page.getByTestId('p4p-men')).toBeHidden();
    await search.fill('');
    await expect(page.getByTestId('p4p-men')).toBeVisible();
    await expect(page.getByTestId('result')).toHaveCount(0);
  });

  test('lists results best Elo first and says when nothing matches', async ({ page }) => {
    await page.goto('/rankings/');
    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    await search.fill('e');
    const elos = await page.getByTestId('result-elo').allTextContents();
    expect(elos.length).toBeGreaterThan(2);
    const nums = elos.map((t) => Number(t.match(/\d+/)![0]));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
    await search.fill('zzzz');
    await expect(page.getByTestId('result')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveText('No active fighter matches “zzzz”.');
  });

  test('lists at most 30 matches and says how many there are', async ({ page }) => {
    await page.goto('/rankings/');
    await page.evaluate(() => {
      const rows = Array.from({ length: 40 }, (_, i) => [`Fighter ${i}`, 1500 - i, 'Lightweight', '', 0]);
      document.getElementById('rank-data')!.textContent = JSON.stringify(rows); // read on the first keystroke
    });
    await page.getByRole('searchbox', { name: 'Search active fighters' }).fill('fighter');
    await expect(page.getByTestId('result')).toHaveCount(30);
    await expect(page.getByRole('status')).toHaveText('Showing the first 30 of 40 matches.');
  });

  test('reads the fighter data on the first keystroke, not at load', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { parses: number };
      w.parses = 0;
      const parse = JSON.parse;
      JSON.parse = (...args: Parameters<typeof JSON.parse>) => (w.parses++, parse(...args));
    });
    await page.goto('/rankings/');
    const parses = () => page.evaluate(() => (window as unknown as { parses: number }).parses);
    await expect(page.getByRole('searchbox')).toBeVisible();
    expect(await parses()).toBe(0);
    await page.getByRole('searchbox').fill('eli');
    await page.getByRole('searchbox').fill('eli e');
    expect(await parses()).toBe(1);
  });

  test('answers a query typed before the page has finished arriving', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // a script that blocks the parser just before #rank-data holds the page at "loading", with the box already usable
    await page.route('**/rankings/', async (route) => {
      const html = (await (await route.fetch()).text()).replace('<script type="application/json" id="rank-data"', '<script src="/held.js"></script>$&');
      await route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.route('**/held.js', async (route) => {
      await held;
      await route.fulfill({ contentType: 'text/javascript', body: '' });
    });
    const arrived = page.waitForRequest('**/held.js');
    await page.goto('/rankings/', { waitUntil: 'commit' });
    await arrived;
    await page.getByRole('searchbox', { name: 'Search active fighters' }).fill('alpha');
    await expect(page.getByTestId('result')).toHaveCount(0);
    release();
    await expect(page.getByTestId('result')).toHaveCount(1);
    await expect(page.getByTestId('p4p-men')).toBeHidden();
    await expect(page.getByRole('status')).toHaveText('1 of 9 active fighters');
  });

  test('puts the search box in the first paint, above the lists', async ({ page }) => {
    await page.goto('/rankings/');
    const form = page.locator('#rank-search');
    await expect(form).not.toHaveAttribute('hidden', /.*/);
    const [box, lists] = await Promise.all([form.boundingBox(), page.locator('#p4p').boundingBox()]);
    expect(box!.y + box!.height).toBeLessThanOrEqual(lists!.y);
  });

  test('says each Elo as "Elo" to a screen reader', async ({ page }) => {
    await page.goto('/rankings/');
    await expect(page.getByTestId('p4p-men').getByTestId('p4p-elo').first()).toContainText('Elo 1612');
    await page.getByRole('searchbox', { name: 'Search active fighters' }).fill('alpha');
    await expect(page.getByTestId('result-elo').first()).toContainText('Elo 1612');
  });

  test('announces how many fighters match', async ({ page }) => {
    await page.goto('/rankings/');
    await page.getByRole('searchbox', { name: 'Search active fighters' }).fill('juliet');
    await expect(page.getByRole('status')).toHaveText('1 of 9 active fighters');
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('the lists show and the search stays hidden', async ({ page }) => {
      await page.goto('/rankings/');
      await expect(page.getByTestId('p4p-men').getByTestId('p4p-row')).toHaveCount(3);
      await expect(page.getByRole('searchbox')).toBeHidden();
    });
  });

  test('a fighter booked on an upcoming card links to it, in the P4P lists and in the search results', async ({ page }) => {
    await page.goto('/rankings/');
    const carla = page.locator('#c3c3c3c3c3c3c3c3');
    const next = carla.getByRole('link', { name: /^Oct 31 vs Delta/ });
    await expect(next).toHaveAttribute('href', '/events/ufc-323-alpha-vs-bravo/');
    await expect(next).toHaveAccessibleName('Oct 31 vs Delta'); // the arrow is decoration, not read aloud
    expect(await next.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('→');
    const muted = await page.getByTestId('p4p-division').first().evaluate((el) => getComputedStyle(el).color);
    expect(await next.evaluate((el) => getComputedStyle(el).color)).toBe(muted);

    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    await search.fill('echo');
    const result = page.getByTestId('result').first();
    await expect(result.getByRole('link', { name: /^Oct 31 vs Foxtrot/ })).toHaveAttribute('href', '/events/ufc-323-alpha-vs-bravo/');
    await expect(result.getByRole('link')).toHaveAccessibleName('Oct 31 vs Foxtrot');
    await result.getByRole('link').click();
    await expect(page).toHaveURL(/\/events\/ufc-323-alpha-vs-bravo\/$/);
  });

  test('the search box\'s clear button takes the page\'s muted colour, not the browser\'s blue', async ({ page }) => {
    await page.goto('/rankings/');
    const search = page.getByRole('searchbox', { name: 'Search active fighters' });
    await search.fill('alpha');
    const muted = await page.getByTestId('p4p-division').first().evaluate((el) => getComputedStyle(el).color);
    // Chrome won't report the button's computed style, so read its pixels: the strongest mark at the box's right end.
    const box = (await search.boundingBox())!;
    const shot = await page.screenshot({ clip: { x: box.x + box.width - 40, y: box.y + 4, width: 36, height: box.height - 8 } });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const px = (i: number) => [data[i]!, data[i + 1]!, data[i + 2]!];
    const bg = px(0);
    const dist = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0);
    let mark = bg;
    for (let i = 0; i < data.length; i += info.channels) if (dist(px(i), bg) > dist(mark, bg)) mark = px(i);
    expect(dist(mark, bg)).toBeGreaterThan(60); // a cross is drawn
    expect(dist(mark, muted.match(/\d+/g)!.map(Number))).toBeLessThanOrEqual(24); // in the muted grey
  });

  test('fits a 360px phone, with comfortable touch targets', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/rankings/');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect((await page.getByRole('searchbox').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const pin = page.getByRole('navigation', { name: 'Events' }).getByRole('link', { name: 'Rankings' });
    expect((await pin.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByTestId('p4p-next').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('searchbox').fill('echo');
    expect((await page.getByTestId('result-next').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('polish', () => {
  test('text is antialiased, headings wrap in balanced lines and short prose avoids lone words', async ({ page }) => {
    const style = (sel: string) =>
      page.locator(sel).first().evaluate((el) => {
        const s = getComputedStyle(el);
        return { smoothing: s.getPropertyValue('-webkit-font-smoothing'), wrap: s.textWrapStyle };
      });
    await page.goto('/');
    expect((await style('html')).smoothing).toBe('antialiased');
    for (const sel of ['h1', '.headline', 'h2']) expect((await style(sel)).wrap, sel).toBe('balance');
    for (const sel of ['.event-meta', '.site-footer p']) expect((await style(sel)).wrap, sel).toBe('pretty');
    await page.goto('/how-it-works/');
    expect((await style('.page-section h2')).wrap).toBe('balance');
    expect((await style('.lede')).wrap).toBe('pretty');
    await page.goto('/rankings/');
    expect((await style('.page-head .event-meta')).wrap).toBe('pretty');
  });

  test('headshots carry a faint inset edge, dark on the light theme and light on the dark', async ({ page }) => {
    const edge = () =>
      page.locator('img.avatar').first().evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.outlineStyle, s.outlineWidth, s.outlineOffset, s.outlineColor];
      });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    expect(await edge()).toEqual(['solid', '1px', '-1px', 'rgba(0, 0, 0, 0.1)']);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await edge()).toEqual(['solid', '1px', '-1px', 'rgba(255, 255, 255, 0.1)']);
  });

  test('a form tile answers a tap just outside its edge, up to where its neighbour\'s begins', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const tiles = page.getByTestId('fight').first().locator('.corner-red [data-testid=form] > span');
    const [a, b] = [(await tiles.nth(0).boundingBox())!, (await tiles.nth(1).boundingBox())!];
    const tapped = async (x: number, y: number) => {
      await page.mouse.click(x, y);
      return page.evaluate(() => document.activeElement?.getAttribute('data-tip'));
    };
    const [tipA, tipB] = [await tiles.nth(0).getAttribute('data-tip'), await tiles.nth(1).getAttribute('data-tip')];
    expect(await tapped(a.x + a.width / 2, a.y - 1.5)).toBe(tipA); // above the tile, toward the Elo line
    expect(await tapped(a.x + a.width + 0.5, a.y + a.height / 2)).toBe(tipA); // in the gap, on its side
    expect(await tapped(b.x - 0.5, b.y + b.height / 2)).toBe(tipB); // in the gap, on the neighbour's side
  });

  test('a form tile leaves the Stats toggle beneath it whole', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const fight = page.getByTestId('fight').first();
    const tile = (await fight.locator('.corner-red [data-testid=form] > span').first().boundingBox())!;
    const summary = (await fight.locator('summary').first().boundingBox())!;
    // Just under the tile, and wherever the summary starts if the two sit flush, a tap belongs to the toggle.
    const y = Math.max(tile.y + tile.height + 1, summary.y + 1);
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('summary'), [tile.x + tile.width / 2, y]);
    expect(hit).toBe(true);
  });
});
