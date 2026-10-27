import type { APIRoute } from 'astro';
import { sitemapXml } from '../lib/seo';
import { site } from '../lib/site-data';

// Every indexable page; the 404 stays out.
export const GET: APIRoute = ({ site: origin }) => {
  const paths = [
    '/',
    '/how-it-works/',
    ...(site.rankings ? ['/rankings/'] : []), // built only when data/ has rankings.json
    ...site.events.map((e) => `/events/${e.slug}/`),
  ];
  return new Response(sitemapXml(paths.map((p) => new URL(p, origin).href)), {
    headers: { 'Content-Type': 'application/xml' },
  });
};
