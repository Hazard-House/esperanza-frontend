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

// Third-party analytics/pixel scripts baked into the June-8 scrape. HTTrack localized
// their URLs to same-origin relative paths, so on the replica each one 404s ->
// handle_errors redirects to the dead live path -> ORB-blocked: a ~60-80 request
// redirect storm that keeps the network busy for 30-45s and blocks first paint. They
// collect nothing (broken) and this is a noindex replica, so we drop them entirely —
// external loaders AND their inline bootstraps. GTM gets re-wired centrally later.
// Matched by src host or *distinctive* inline init token. Deliberately NOT matching
// generic `dataLayer`/`gtag`: the theme bundles its own config (window.oi_preload,
// oiVideoOnLoad) into inline scripts that also push a hfaDataLayer, so THEME_KEEP
// vetoes removal of anything carrying theme internals — only true pixel/tag scripts go.
// The inline GTM snippet self-injects gtm.js, so it must be dropped too (matched by GTM-).
const TRACKER_SIG = /(hs-analytics|hs-banner|hsadspixel|hs-scripts|hs-script-loader|analytics\.tiktok\.com|clarity\.ms|static\.hotjar\.com|script\.hotjar\.com|connect\.facebook\.net|googletagmanager\.com|google-analytics\.com|googleads\.g\.doubleclick\.net|platform\.twitter\.com|firstparty\/|fbq\(|_fbq\b|ttq\.(?:load|page|track)|TiktokAnalyticsObject|_hjSettings|\bhj\(|window\.clarity|GTM-[A-Z0-9]{4,})/;
const THEME_KEEP = /(oi_preload\s*=|oiVideoOnLoad|oiReady|new Swiper|AOS\.init|swiper-alert-banner|oilib_version|oi\.loaded)/i;
export function stripTrackers(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
    m => TRACKER_SIG.test(m) && !THEME_KEEP.test(m) ? '' : m);
}

// Warm up the connection to the image CDN early (detail pages pull ~270 images from
// img.hazardhouse.ai) and the Mapbox tile/JS host.
const PRECONNECT = '<link rel="preconnect" href="https://img.hazardhouse.ai" crossorigin>\n<link rel="preconnect" href="https://api.mapbox.com" crossorigin>';

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
  html = stripTrackers(html);
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${PRECONNECT}`);
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
  const tr = stripTrackers('<script src="../js.hs-analytics.net/x.js"></script><script src="/static/esperanza_homes/js/vendor.header.min.js"></script><script>fbq("init","123")</script><script>new Swiper(".x")</script><script async src="firstparty/abc.js"></script>');
  console.assert(tr === '<script src="/static/esperanza_homes/js/vendor.header.min.js"></script><script>new Swiper(".x")</script>', 'stripTrackers: ' + tr);
  // theme config bundled with a dataLayer push must SURVIVE (regression: oi_preload was nuked)
  const keep = stripTrackers('<script>window.oi_preload = {"map_key":"pk"}; window.hfaDataLayer.push({});</script><script>(function(){})(window,document,"script","dataLayer","GTM-WNGZHH3")</script>');
  console.assert(keep === '<script>window.oi_preload = {"map_key":"pk"}; window.hfaDataLayer.push({});</script>', 'theme-keep guard: ' + keep);
  console.log('rewrite.mjs demo() passed');
}
// ponytail: compare real paths, not raw URL strings — file:// URLs percent-encode
// spaces (this repo lives under a "Claude Projects" dir), so a naive `file://${argv[1]}`
// string compare silently never matches and demo() never runs.
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
