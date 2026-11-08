// Runs against dist-live: tests/fixtures/live built at 2026-11-08T00:44Z (npm run build:fixtures:live), mid fight night.
// The card dated 2026-11-07 already has status `completed` (the engine flips it on the first result) with 2 of its 4
// bouts decided, and the next card is a week out: the home page must stay on tonight's card.
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import finalCard from '../fixtures/live-final/events/bbbb1111bbbb1111.json' with { type: 'json' };
import staticCard from '../fixtures/live/events/bbbb1111bbbb1111.json' with { type: 'json' };

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

// ---- Live results in the browser (phase 4). The engine API is mocked with page.route (its CORS isn't on prod yet);
// every mock answer carries Access-Control-Allow-Origin: *, as the engine's do, or the browser would block it. The
// browser clock is pinned to fight night with page.clock, so polling runs on Playwright's fake timers.

const API = 'https://ufc-data.xlobax.com/v1/events/bbbb1111bbbb1111.json';
const LIVE_PAGE = '/events/ufc-fight-night-live-vs-wire/';
const MAIN = 'f000000000000002';
const CO_MAIN = 'f000000000000003';
const CORS = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' };

/** The static card with the bouts in `ids` decided as on the finished card (with their elo). */
const withResults = (...ids: string[]) => ({
  ...staticCard,
  fights: staticCard.fights.map((f) => (ids.includes(f.id) ? finalCard.fights.find((g) => g.id === f.id)! : f)),
});

type Answer = object | 'error' | 'garbage';

// Headers a CORS-simple request may carry: the safelisted ones plus those the browser itself sets (it may add
// sec-* and the like; a script cannot). Anything else (x-*, a hand-set if-none-match, authorization) costs a
// preflight, and the engine answers OPTIONS with 405.
const SIMPLE_HEADER = /^(accept|accept-language|content-language|user-agent|referer|origin|sec-.*)$/;

/** Serve the event file from `answers[0]` (changeable mid-test); counts the requests, notes any that are not simple. */
async function mockApi(page: Page, first: Answer) {
  const api = { answer: first, requests: 0, notSimple: [] as string[], checks: [] as Promise<void>[] };
  await page.route(API, (route: Route) => {
    api.requests += 1;
    const req = route.request();
    if (req.method() !== 'GET') api.notSimple.push(`method ${req.method()}`);
    // Checked on the side: holding the answer back would shift the poller's timers (the backoff test times them).
    api.checks.push(
      req.allHeaders().then((headers) => {
        for (const name of Object.keys(headers)) if (!SIMPLE_HEADER.test(name)) api.notSimple.push(`header ${name}`);
      }),
    );
    if (api.answer === 'error') return route.fulfill({ status: 503, headers: CORS, body: 'down' });
    if (api.answer === 'garbage')
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"id": 3' });
    return route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify(api.answer),
    });
  });
  return api;
}

const row = (page: Page, id: string) => page.locator(`[data-fight-id="${id}"]`);
const liveNow = (page: Page) => page.getByTestId('live-now');
const liveLine = (page: Page) => page.getByTestId('live-line');

async function openLive(page: Page, first: Answer, path = '/', at = '2026-11-08T00:50:00Z') {
  await page.clock.install({ time: new Date(at) });
  const api = await mockApi(page, first);
  await page.goto(path);
  return api;
}

test.describe('live results', () => {
  test('the static page reads as live: header and rail tile', async ({ page }) => {
    await page.route(API, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('.event-meta')).toContainText('Live');
    await expect(page.locator('.event-meta')).not.toContainText('Results');
    const tile = page.locator('nav a[href="/events/ufc-fight-night-live-vs-wire/"]');
    await expect(tile).toHaveClass(/tile-live/);
    await expect(tile).not.toHaveClass(/tile-past/);
  });

  test('marks the bout in progress and says when the data was updated', async ({ page }) => {
    await openLive(page, staticCard);
    await expect(liveNow(page)).toHaveCount(1);
    await expect(row(page, CO_MAIN).getByTestId('live-now')).toHaveText('Live now');
    // The page was built from data generated at 00:44Z; it is 00:50Z.
    await expect(liveLine(page)).toHaveText('Live · updated 6 min ago');
    await page.clock.runFor(120_000);
    await expect(liveLine(page)).toHaveText('Live · updated 8 min ago');
  });

  test('a bout that gets a result flips to the completed look, and the marker moves on', async ({ page }) => {
    const api = await openLive(page, staticCard);
    await expect(row(page, CO_MAIN).getByTestId('live-now')).toBeVisible();
    await expect(row(page, CO_MAIN)).not.toHaveClass(/\bdone\b/);
    api.answer = withResults(CO_MAIN, 'f000000000000004', 'f000000000000005');
    await page.clock.runFor(60_000);
    const coMain = row(page, CO_MAIN);
    await expect(coMain).toHaveClass(/\bdone\b/);
    await expect(coMain.getByTestId('outcome')).toHaveText('U-DEC R3 · 5:00');
    await expect(coMain.locator('.corner-blue').getByTestId('win-chip')).toHaveText('Win');
    await expect(coMain.locator('.corner-red')).toHaveClass(/\blost\b/);
    await expect(coMain.getByTestId('elo-delta')).toHaveText(['−12', '+12']);
    await expect(row(page, MAIN).getByTestId('live-now')).toBeVisible();
    await expect(liveNow(page)).toHaveCount(1);
    await expect(liveLine(page)).toHaveText('Live · updated just now');
    // The prelims decided at build time get their Elo change too, now that the API has it.
    await expect(row(page, 'f000000000000005').getByTestId('elo-delta')).toHaveText(['−20', '+20']);
  });

  test('the live row reads the same as the server-built completed row', async ({ page }) => {
    // The prelim f…05 is decided at build time; the co-main flips live. Same parts in the same order.
    const api = await openLive(page, staticCard);
    api.answer = withResults(CO_MAIN, 'f000000000000004', 'f000000000000005');
    await page.clock.runFor(60_000);
    await expect(row(page, CO_MAIN)).toHaveClass(/\bdone\b/);
    const shape = (id: string) =>
      row(page, id).evaluate((li) =>
        [...li.querySelectorAll('*')].map((e) => `${e.tagName}.${[...e.classList].sort().join('.')}`).join(' '),
      );
    const prelim = await shape('f000000000000005');
    const coMain = await shape(CO_MAIN);
    // Both: a blue-corner winner, a red-corner loser, an outcome, a frozen medium badge, Elo going in with a change.
    expect(coMain).toBe(prelim);
  });

  test('stops polling once every bout has a result, and the card reads as finished', async ({ page }) => {
    const api = await openLive(page, staticCard);
    await expect(liveNow(page)).toHaveCount(1);
    api.answer = finalCard;
    await page.clock.runFor(60_000);
    await expect(row(page, MAIN)).toHaveClass(/\bdone\b/);
    await expect(liveNow(page)).toHaveCount(0);
    await expect(liveLine(page)).toBeHidden();
    await expect(page.locator('.event-meta')).toContainText('Results');
    const seen = api.requests;
    await page.clock.runFor(10 * 60_000);
    expect(api.requests).toBe(seen);
  });

  test('an API error or a body that does not parse leaves the page alone, and polling backs off', async ({ page }) => {
    const api = await openLive(page, 'error');
    await expect.poll(() => api.requests).toBe(1);
    const before = await page.locator('main').innerHTML();
    // A failed fetch schedules its retry asynchronously, so step the clock and see when the next request comes.
    const untilNext = async () => {
      const seen = api.requests;
      let waited = 0;
      await expect
        .poll(
          async () => {
            await page.clock.runFor(10_000);
            waited += 10_000;
            return api.requests;
          },
          { timeout: 30_000, intervals: [50] },
        )
        .toBeGreaterThan(seen);
      return waited;
    };
    expect(await untilNext()).toBeLessThanOrEqual(70_000); // 1st retry after 60 s
    api.answer = 'garbage';
    const second = await untilNext();
    expect(second).toBeGreaterThanOrEqual(110_000); // then 2 min
    expect(second).toBeLessThanOrEqual(130_000);
    const third = await untilNext();
    expect(third).toBeGreaterThanOrEqual(230_000); // then 4 min
    expect(third).toBeLessThanOrEqual(250_000);
    expect(await page.locator('main').innerHTML()).toBe(before);
    await expect(liveLine(page)).toBeHidden();
  });

  test('every poll is a CORS-simple request: a GET without headers that need a preflight', async ({ page }) => {
    const api = await openLive(page, staticCard);
    await expect(liveNow(page)).toHaveCount(1);
    await page.clock.runFor(60_000);
    await expect.poll(() => api.requests).toBeGreaterThanOrEqual(2);
    await Promise.all(api.checks);
    expect(api.notSimple).toEqual([]);
  });

  test('never removes a result the page shows', async ({ page }) => {
    await openLive(page, { ...staticCard, fights: staticCard.fights.map((f) => ({ ...f, result: null })) });
    await page.clock.runFor(60_000);
    await expect(row(page, 'f000000000000005')).toHaveClass(/\bdone\b/);
    await expect(row(page, 'f000000000000005').getByTestId('outcome')).toHaveText('KO/TKO R1 · 0:45');
  });

  test('the live event page polls too', async ({ page }) => {
    const api = await openLive(page, withResults(CO_MAIN, 'f000000000000004', 'f000000000000005'), LIVE_PAGE);
    await expect(row(page, CO_MAIN)).toHaveClass(/\bdone\b/);
    expect(api.requests).toBeGreaterThan(0);
  });

  test('a finished card and a card far out get no live script', async ({ page }) => {
    let requests = 0;
    await page.route('https://ufc-data.xlobax.com/**', (route) => {
      requests += 1;
      return route.abort();
    });
    await page.clock.install({ time: new Date('2026-11-08T00:50:00Z') });
    for (const path of ['/events/ufc-fight-night-oldcard-vs-past/', '/events/ufc-324-next-vs-upcoming/']) {
      await page.goto(path);
      await expect(page.getByTestId('live-line')).toHaveCount(0);
    }
    await page.clock.runFor(120_000);
    expect(requests).toBe(0);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the static page is unchanged: no marker, no updated line', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('fight')).toHaveCount(4);
    await expect(liveNow(page)).toHaveCount(0);
    await expect(liveLine(page)).toBeHidden();
  });
});
