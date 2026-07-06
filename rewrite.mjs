// rewrite.mjs — shared URL/theme rewrites + shell helpers. Extracted from build.mjs
// so the static-base build AND the data-driven detail generator share one source.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAPBOX_TOKEN = 'pk.eyJ1IjoiaGF6YXJkaG91c2UiLCJhIjoiY21kdG1xMWwwMTFvbDJqb2h1bXgxYmw3ZyJ9.ER4JhSJ2bl89WJ-3Xv5erA';
export const STYLE_HOME = 'mapbox://styles/hazardhouse/cmfxyvjas00bh01qsf8ok5bcg';
export const STYLE_COMMON_URL = '/esperanza-common.json'; // bundled Esperanza-Common style — QMI + community detail maps (matches build.mjs after commit 770a125)
export const PUBLIC_STYLE = 'mapbox://styles/mapbox/streets-v11'; // fallback only
export const API_BASE = '/api/public';
export const NOINDEX = true;

const IMG_EXT = /\.(jpg|jpeg|png|avif|webp)$/i;
const stripExt = (p) => p.replace(IMG_EXT, '');
function loadKeyMap(file, prefix) {
  const m = new Map();
  const p = join(import.meta.dirname, file);
  if (!existsSync(p)) return m;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const key = line.trim(); if (!key) continue;
    m.set(prefix + stripExt(key), prefix + key);
  }
  return m;
}
const ESP_KEYS = loadKeyMap('media-keys-esperanza.txt', '');
const HF_KEYS = loadKeyMap('media-keys-homefiniti.txt', 'homefiniti/');

// Current promo-ticker slides harvested from the live site (harvest-live-facts.mjs).
// The scrape's baked ticker is frozen at June-8 (stale events); swap in the live
// slides as clean PRE-init swiper markup so the theme JS initializes it like O'Neill's.
function loadBannerSlides() {
  const p = join(import.meta.dirname, 'assets', 'live-facts.json');
  if (!existsSync(p)) return null;
  try { const s = JSON.parse(readFileSync(p, 'utf8')).bannerSlides; return s && s.length ? s : null; }
  catch { return null; }
}
const BANNER_SLIDES = loadBannerSlides();
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function freshBannerHtml(slides) {
  const inner = slides.map(sl =>
    `<div class="swiper-slide"><p>${escAttr(sl.text)}</p>${sl.ctaHref ? `<a href="${escAttr(sl.ctaHref)}" class="btn btn-primary">${escAttr(sl.ctaLabel || 'Learn More!')}</a>` : ''}</div>`).join('');
  return '<div class="alert-banner"><div class="swiper-alert-banner swiper"><div class="swiper-wrapper">' + inner + '</div>' +
    '<div class="swiper-alert-banner-button-prev swiper-button-prev"><i class="fa-regular fa-chevron-left d-block" aria-label="Previous slide"></i></div>' +
    '<div class="swiper-alert-banner-button-next swiper-button-next"><i class="fa-regular fa-chevron-right d-block" aria-label="Next slide"></i></div>' +
    '</div></div><!--/fresh-banner-->';
}
const FROZEN_BANNER_RE = /<div class="alert-banner">[\s\S]*?<span class="swiper-notification"[^>]*><\/span><\/div>\s*<\/div>/;
export function resolveMedia(rawPath, prefix, map) {
  const clean = rawPath.split('%EF%B9%96')[0].split('?')[0];
  return map.get(prefix + stripExt(clean)) || (prefix + clean);
}

export function rewriteCommon(html) {
  html = html
    .replace(/https:\/\/www\.esperanzahomes\.com\/xhr\//g, '/xhr/')
    .replace(/(?:\.\.\/)*static\.esperanzahomes\.com\//g, '/static/')
    .replace(/(?:https?:\/\/)?(?:\.\.\/)*media\.esperanzahomes\.com\/([^"'\s)]*)/g,
      (_m, p) => `//img.hazardhouse.ai/assets-media/${resolveMedia(p, '', ESP_KEYS)}`)
    .replace(/(?:https?:\/\/)?(?:\.\.\/)*media\.homefiniti\.com\/([^"'\s)]*)/g,
      (_m, p) => `//img.hazardhouse.ai/assets-media/${resolveMedia(p, 'homefiniti/', HF_KEYS)}`)
    .replace(/(?:\.\.\/)*api\.mapbox\.com\//g, 'https://api.mapbox.com/')
    // shim oilib-owned maps (city/filter/lot maps): branded style + map_pin sprite
    .replace(/(<script[^>]*api\.mapbox\.com\/mapbox-gl-js[^>]*><\/script>)/,
      '$1<script src="/mapbox-patch.js"></script>')
    .replace(/pk\.eyJ1Ijoib25la[A-Za-z0-9._-]*/g, MAPBOX_TOKEN)
    .replace(/mapbox:\/\/styles\/oneilinteractive\/[A-Za-z0-9]+/g, PUBLIC_STYLE)
    .replace(/<div class="col-12 oneilinteractive-attribution[^>]*>[\s\S]*?<\/div>/,
      '<div class="col-12 oneilinteractive-attribution text-center text-white fs-9 mb-2"><a href="https://hazardhouse.ai" rel="noopener" target="_blank" class="text-small text-white">Powered by Hazard House</a></div>')
    // Internal links in the June-8 scrape end in /index.html; the live site uses clean
    // trailing-slash URLs (and 404s on index.html). Strip the filename so nav matches 1:1 —
    // Caddy's try_files rewrites the trailing-slash dir back to index.html when serving.
    .replace(/(href=")([^"]*)index\.html(?=[?#"])/g, (_m, p, path) => p + (path || './'));
  if (BANNER_SLIDES) html = html.replace(FROZEN_BANNER_RE, freshBannerHtml(BANNER_SLIDES));
  if (NOINDEX) {
    const meta = '<meta name="robots" content="noindex,nofollow">';
    html = /<meta name="robots"[^>]*>/i.test(html)
      ? html.replace(/<meta name="robots"[^>]*>/gi, meta)
      : html.replace(/<head([^>]*)>/i, `<head$1>\n${meta}`);
  }
  return html;
}

// Disable oilib's map/filter/form init + stub `oi` so orphaned inline calls are silent.
export function disableOilib(html) {
  html = html.replace(/<script[^>]*\/static\/assets\/js\/oilib[^>]*><\/script>/g, '<!-- oilib removed for islands -->');
  if (!html.includes('window.oi=')) {
    const stub = '<script>window.oi=new Proxy(function(){},{get:function(){return window.oi},apply:function(){return window.oi}});</script>';
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${stub}`);
  }
  return html;
}

// Single-island injector (build.mjs uses it for /available + container maps).
export function injectIsland(html, islandFile) {
  html = disableOilib(html);
  const marker = `src="/${islandFile}"`;
  if (!html.includes(marker)) {
    const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: STYLE_COMMON_URL, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_COMMON: STYLE_COMMON_URL };
    const tag = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};</script>\n<script src="/${islandFile}" defer></script>\n`;
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

// Chrome shell for data-driven detail pages: rewritten page with the home-specific
// region (first <section class="header"> up to <footer>) replaced by a marker.
export function extractShell(rawHtml) {
  return rewriteCommon(rawHtml).replace(/<section class="header[\s\S]*?(?=<footer)/, '\n<!--CONTENT-->\n');
}

function demo() {
  const s = rewriteCommon;
  console.assert(s('src="../../../media.esperanzahomes.com/153/2026/5/22/LP047_Rendering.png%EF%B9%96width=848&amp;ois=8e9bec3.avif"')
    === 'src="//img.hazardhouse.ai/assets-media/153/2026/5/22/LP047_Rendering.png"', 'media rewrite/decode');
  console.assert(s('content="https://media.homefiniti.com/153/2022/5/16/1-14.jpg"')
    === 'content="//img.hazardhouse.ai/assets-media/homefiniti/153/2022/5/16/1-14.jpg"', 'absolute media');
  const foot = s('<div class="col-12 oneilinteractive-attribution text-center"><a href="https://oneilinteractive.com/x"><img class="oneil-icon"> Powered by Homefiniti</a>.</div>');
  console.assert(foot.includes('Powered by Hazard House') && !foot.includes('oneilinteractive.com'), 'footer');
  const shell = extractShell('<head></head><body><nav>n</nav><section class="header">HOME</section><section>x</section><footer>f</footer></body>');
  console.assert(shell.includes('<!--CONTENT-->') && !shell.includes('HOME') && shell.includes('<footer>f</footer>'), 'extractShell');
  const links = s('<a href="design-studio/index.html">a</a><a href="index.html">home</a><a href="../new-homes/index.html?x=1">q</a><a href="/static/style.css">keep</a>');
  console.assert(links === '<a href="design-studio/">a</a><a href="./">home</a><a href="../new-homes/?x=1">q</a><a href="/static/style.css">keep</a>', 'index.html strip: ' + links);
  console.log('rewrite.mjs demo() passed');
}
// ponytail: compare real paths, not raw URL strings — file:// URLs percent-encode
// spaces (this repo lives under a "Claude Projects" dir), so a naive `file://${argv[1]}`
// string compare silently never matches and demo() never runs.
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
