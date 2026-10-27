import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site: origin }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', origin).href}\n`, {
    headers: { 'Content-Type': 'text/plain' },
  });
