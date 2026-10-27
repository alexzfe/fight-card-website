import { describe, expect, it } from 'vitest';
import { eventDescription, eventJsonLd, homeDescription, homeTitle, jsonLdScript, sitemapXml } from '../../src/lib/seo';
import type { Event, Fight } from '../../src/lib/schema';

const fight = (id: string, red: string, blue: string): Fight => ({
  id,
  red,
  blue,
  title_fight: false,
  weight_class: null,
  finish_tier: null,
  segment: null,
  tier_frozen_at: null,
  result: null,
});

const event = (over: Partial<Event> = {}): Event => ({
  id: 'e1',
  slug: 'ufc-fight-night-moicano-vs-nolan',
  name: 'UFC Fight Night: Moicano vs. Nolan',
  date: '2026-10-31',
  location: 'Las Vegas, Nevada, USA',
  status: 'upcoming',
  fights: [fight('f1', 'a', 'b'), fight('f2', 'c', 'd')],
  ...over,
});

const fighters = {
  a: { name: 'Renato Moicano' },
  b: { name: 'Beneil Nolan' },
  c: { name: 'Ann Smith' },
  d: { name: 'Bea Jones' },
};

describe('eventDescription', () => {
  it('names the date, venue, bout count and both numbers the card shows', () => {
    expect(eventDescription(event())).toBe(
      'UFC Fight Night: Moicano vs. Nolan, Sat, Oct 31, 2026 in Las Vegas, Nevada, USA: all 2 bouts with finish chances and fighter Elo ratings.',
    );
  });

  it('lands in the 120-160 character range search engines show for a typical card', () => {
    const d = eventDescription(event({ fights: Array.from({ length: 13 }, (_, i) => fight(`f${i}`, 'a', 'b')) }));
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it('says results for a completed event', () => {
    expect(eventDescription(event({ status: 'completed' }))).toContain(': results for all 2 bouts');
  });

  it('drops the venue when it is unknown', () => {
    expect(eventDescription(event({ location: null }))).toMatch(/^UFC Fight Night: Moicano vs\. Nolan, Sat, Oct 31, 2026: /);
  });

  it('uses the singular for a one-bout card', () => {
    expect(eventDescription(event({ fights: [fight('f1', 'a', 'b')] }))).toContain('the 1 bout with');
  });

  it('does not promise bouts on an empty card', () => {
    expect(eventDescription(event({ fights: [] }))).toMatch(/: card to be announced\.$/);
  });
});

describe('homeTitle', () => {
  it('leads with what the site is, then the next headline', () => {
    expect(homeTitle(event())).toBe('UFC fight cards with finish chances · Next: Moicano vs. Nolan');
  });

  it('calls a completed event the latest, not the next', () => {
    expect(homeTitle(event({ status: 'completed' }))).toBe('UFC fight cards with finish chances · Latest: Moicano vs. Nolan');
  });

  it('falls back to the bare site name without events', () => {
    expect(homeTitle(undefined)).toBe('UFC fight cards with finish chances');
  });
});

describe('homeDescription', () => {
  it('describes the site, then names the next card, in the 120-160 character range', () => {
    const d = homeDescription(event());
    expect(d).toBe(
      "Every upcoming UFC card with each bout's chance of a finish and both fighters' Elo ratings. Next: UFC Fight Night: Moicano vs. Nolan, Sat, Oct 31, 2026.",
    );
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it('describes just the site without events', () => {
    expect(homeDescription(undefined)).toBe(
      "Every upcoming UFC card with each bout's chance of a finish and both fighters' Elo ratings.",
    );
  });
});

describe('eventJsonLd', () => {
  const url = 'https://ufc.xlobax.com/events/ufc-fight-night-moicano-vs-nolan/';

  it('describes the card as a schema.org SportsEvent', () => {
    const ld = eventJsonLd(event(), fighters, url);
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SportsEvent',
      name: 'UFC Fight Night: Moicano vs. Nolan',
      startDate: '2026-10-31',
      url,
      sport: 'Mixed martial arts',
      eventStatus: 'https://schema.org/EventScheduled',
      location: { '@type': 'Place', name: 'Las Vegas, Nevada, USA', address: 'Las Vegas, Nevada, USA' },
    });
  });

  it("fills Google's recommended Event fields: same-day end, share image, UFC as organizer", () => {
    const ld = eventJsonLd(event(), fighters, url);
    expect(ld.endDate).toBe('2026-10-31');
    expect(ld.image).toBe('https://ufc.xlobax.com/og.png');
    expect(ld.organizer).toEqual({ '@type': 'Organization', name: 'UFC', url: 'https://www.ufc.com' });
  });

  it('names the fighters as performers too', () => {
    const ld = eventJsonLd(event(), fighters, url);
    expect(ld.performer).toEqual(ld.competitor);
    expect(ld.performer).toHaveLength(4);
  });

  it('lists every fighter on the card once, as people', () => {
    const ld = eventJsonLd(event({ fights: [fight('f1', 'a', 'b'), fight('f2', 'a', 'c')] }), fighters, url);
    expect(ld.competitor).toEqual([
      { '@type': 'Person', name: 'Renato Moicano' },
      { '@type': 'Person', name: 'Beneil Nolan' },
      { '@type': 'Person', name: 'Ann Smith' },
    ]);
  });

  it('skips fighters missing from the roster rather than inventing names', () => {
    const ld = eventJsonLd(event({ fights: [fight('f1', 'a', 'zzz')] }), fighters, url);
    expect(ld.competitor).toEqual([{ '@type': 'Person', name: 'Renato Moicano' }]);
  });

  it('leaves out location when the venue is unknown', () => {
    expect(eventJsonLd(event({ location: null }), fighters, url)).not.toHaveProperty('location');
  });
});

describe('jsonLdScript', () => {
  it('cannot be closed early by a value containing </script>', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});

describe('sitemapXml', () => {
  it('lists each URL once in a sitemaps.org urlset', () => {
    const xml = sitemapXml(['https://x.test/', 'https://x.test/a/', 'https://x.test/']);
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.match(/<loc>/g)).toHaveLength(2);
    expect(xml).toContain('<loc>https://x.test/a/</loc>');
  });

  it('escapes XML special characters in URLs', () => {
    expect(sitemapXml(['https://x.test/?a=1&b=2'])).toContain('<loc>https://x.test/?a=1&amp;b=2</loc>');
  });
});
