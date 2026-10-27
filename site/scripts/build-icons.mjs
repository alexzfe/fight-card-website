// Draws the site icons into public/: an ember octagon outline in the accent colour from global.css.
// Run after changing the accent or the background tokens: npm run icons
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SITE = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(SITE, 'public');
const css = fs.readFileSync(path.join(SITE, 'src/styles/global.css'), 'utf8');
const [lightCss, darkCss] = css.split('@media (prefers-color-scheme: dark)');
const token = (block, name) => {
  const v = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1];
  if (!v) throw new Error(`no hex value for --${name}`);
  return v;
};
const ember = token(lightCss, 'color-accent');
const emberDark = token(darkCss, 'color-accent');
const paper = token(lightCss, 'color-bg');

// A regular octagon on a 32 grid; the 4-unit stroke is 2px at 16px and centred on the path,
// so the flat edges land on whole pixels at 16, 32 and 48.
const BARE = '10,2 22,2 30,10 30,22 22,30 10,30 2,22 2,10';
// Inset version for opaque tiles, with room around it like the tab icon has.
const INSET = '12,6 20,6 26,12 26,20 20,26 12,26 6,20 6,12';
const outline = (points, stroke) =>
  `<polygon points="${points}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linejoin="miter"/>`;

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>polygon { stroke: ${ember} } @media (prefers-color-scheme: dark) { polygon { stroke: ${emberDark} } }</style>
  <polygon points="${BARE}" fill="none" stroke-width="4" stroke-linejoin="miter"/>
</svg>
`;
// Home screens: square and opaque (iOS rounds the corners itself and turns transparency black).
const tileSvg = (viewBox) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><rect x="-8" y="-8" width="48" height="48" fill="${paper}"/>${outline(INSET, ember)}</svg>`;
// Maskable icons get cropped to a circle as small as 80% of the tile; the wider viewBox keeps the
// octagon's corners (radius ~13 units from the centre) inside it.
const TILE = tileSvg('0 0 32 32');
const MASKABLE = tileSvg('-2 -2 36 36');

const render = (svg, size, opaque) => {
  const img = sharp(Buffer.from(svg), { density: 72 * (size / 32) * 2 }).resize(size, size);
  return (opaque ? img.flatten({ background: paper }).removeAlpha() : img).png().toBuffer();
};

// An .ico is a directory of PNGs.
const ico = (pngs) => {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header[e] = size;
    header[e + 1] = size;
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
};

// The .ico has no dark mode, so it takes the light ember (the colour most tab bars suit).
const flatSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${outline(BARE, ember)}</svg>`;
const icoPngs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await render(flatSvg, size, false) })));

const manifest = {
  name: 'UFC fight cards',
  short_name: 'Fight cards',
  start_url: '/',
  display: 'browser',
  background_color: paper,
  theme_color: paper,
  icons: [
    { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    { src: '/icon-maskable.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
  ],
};

// Link previews (Open Graph / Twitter): 1200x630, opaque, octagon beside the site name. Text is drawn here, with
// this machine's fonts, and the PNG committed, so the image build never needs fonts.
const ink = token(lightCss, 'color-text');
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${paper}"/>
  <g transform="translate(110 195) scale(7.5)">${outline(BARE, ember)}</g>
  <g font-family="Inter, 'Noto Sans', 'DejaVu Sans', Arial, sans-serif" fill="${ink}">
    <text x="420" y="290" font-size="84" font-weight="700">UFC fight cards</text>
    <text x="420" y="370" font-size="40">Finish chances and Elo ratings</text>
    <text x="420" y="425" font-size="40">for every bout on the card</text>
  </g>
</svg>`;
const og = await sharp(Buffer.from(ogSvg)).flatten({ background: paper }).removeAlpha().png().toBuffer();

const out = {
  'og.png': og,
  'favicon.svg': faviconSvg,
  'favicon.ico': ico(icoPngs),
  'apple-touch-icon.png': await render(TILE, 180, true),
  'icon-192.png': await render(TILE, 192, true),
  'icon-512.png': await render(TILE, 512, true),
  'icon-maskable.png': await render(MASKABLE, 512, true),
  'manifest.webmanifest': `${JSON.stringify(manifest, null, 2)}\n`,
};
for (const [name, data] of Object.entries(out)) {
  fs.writeFileSync(path.join(PUBLIC, name), data);
  console.log(`public/${name}`);
}
