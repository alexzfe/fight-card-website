import { formatLongDate, splitEventName } from './format';
import type { Event, Fighter } from './schema';

export const SITE_NAME = 'UFC fight cards';
const TAGLINE = 'UFC fight cards with finish chances';

/** e.g. "UFC 323: A vs. B, Sat, Oct 31, 2026 in Las Vegas, Nevada, USA: all 13 bouts with finish chances and fighter Elo ratings." */
export function eventDescription(event: Event): string {
  const n = event.fights.length;
  const bouts = n === 1 ? 'the 1 bout' : `all ${n} bouts`;
  const body =
    n === 0
      ? 'card to be announced.'
      : `${event.status === 'completed' ? 'results for ' : ''}${bouts} with finish chances and fighter Elo ratings.`;
  const where = event.location ? ` in ${event.location}` : '';
  return `${event.name}, ${formatLongDate(event.date)}${where}: ${body}`;
}

/** The home page shows the next card, but its title leads with the site so it doesn't compete with that card's own page. */
export function homeTitle(event: Event | undefined): string {
  if (!event) return TAGLINE;
  return `${TAGLINE} · ${event.status === 'completed' ? 'Latest' : 'Next'}: ${splitEventName(event.name).headline}`;
}

export function homeDescription(event: Event | undefined): string {
  const completed = event?.status === 'completed';
  const lead = `Every ${completed ? '' : 'upcoming '}UFC card with each bout's chance of a finish and both fighters' Elo ratings.`;
  return event ? `${lead} ${completed ? 'Latest' : 'Next'}: ${event.name}, ${formatLongDate(event.date)}.` : lead;
}

/**
 * schema.org SportsEvent for one card; fighters missing from the roster are left out. Fills Google's recommended
 * Event fields except `offers`: the site sells no tickets.
 */
export function eventJsonLd(event: Event, fighters: { [id: string]: Pick<Fighter, 'name'> }, url: string) {
  const ids = [...new Set(event.fights.flatMap((f) => [f.red, f.blue]))];
  const people = ids.flatMap((id) => (fighters[id] ? [{ '@type': 'Person', name: fighters[id].name }] : []));
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.name,
    startDate: event.date,
    endDate: event.date, // cards run one evening
    url,
    image: new URL('/og.png', url).href,
    description: eventDescription(event),
    sport: 'Mixed martial arts',
    eventStatus: 'https://schema.org/EventScheduled',
    organizer: { '@type': 'Organization', name: 'UFC', url: 'https://www.ufc.com' },
    ...(event.location && { location: { '@type': 'Place', name: event.location, address: event.location } }),
    competitor: people,
    performer: people,
  };
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so data can't close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const XML_ESCAPES: { [c: string]: string } = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function sitemapXml(urls: readonly string[]): string {
  const locs = [...new Set(urls)].map((u) => `<url><loc>${u.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.join('')}</urlset>\n`;
}
