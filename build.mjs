#!/usr/bin/env node
// Assemble a Railway-deployable static site from the June-8 O'Neill scrape,
// re-pointing images at our R2 CDN and the flagship "available" page at the
// live public API. Scope: 3 flagship pages + shared theme. Everything else is
// handled at runtime by Caddy (404 -> redirect to live esperanzahomes.com).
//
//   node build.mjs            # -> ./public
//
// ponytail: string rewrites, not a DOM parser. The scrape is HTTrack output with
// a stable shape; regex is enough and adding jsdom for 3 files is overkill.

import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCRAPE = '/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08';
const WWW = join(SCRAPE, 'www.esperanzahomes.com');
const THEME = join(SCRAPE, 'static.esperanzahomes.com');
const OUT = join(import.meta.dirname, 'public');

// --- config that gets baked into the flagship pages -------------------------
const MAPBOX_TOKEN = 'pk.eyJ1IjoiaGF6YXJkaG91c2UiLCJhIjoiY21kdG1xMWwwMTFvbDJqb2h1bXgxYmw3ZyJ9.ER4JhSJ2bl89WJ-3Xv5erA';
const PUBLIC_STYLE = 'mapbox://styles/mapbox/streets-v11'; // O'Neill custom styles 401 under our token
const API_BASE = '/api/public'; // same-origin; Caddy reverse-proxies to the API worker (avoids CORS)
const OPS_PLACEHOLDER = 'esperanza-ops-not-yet-wired.invalid'; // forms deferred (HubSpot later)

const PAGES = {
  home: 'index.html',
  available: 'new-homes/available/index.html',
  community: 'new-homes/tx/mcallen/tres-lagos-master-planned-community/12091/index.html',
};

// Resolved R2 object keys (real extensions). The scrape references each image in
// two forms — with extension (src) and extensionless (responsive srcset) — but the
// R2 object only exists at its real extension. Map base-path -> real key so BOTH
// forms resolve. Lists produced by the R2-upload pass (verified serving 200).
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
function resolveMedia(rawPath, prefix, map) {
  const base = stripExt(rawPath.split('%EF%B9%96')[0]);   // drop resize query + ext
  return map.get(prefix + base) || (prefix + rawPath.split('%EF%B9%96')[0]);
}

// --- rewrite rules ----------------------------------------------------------
// Applied to every flagship page. Order matters: xhr before the broad host rules.
function rewriteCommon(html) {
  return html
    // R1: XHR form/lead endpoints -> placeholder (deferred). Absolute + root-relative.
    .replace(/https:\/\/www\.esperanzahomes\.com\/xhr\//g, `https://${OPS_PLACEHOLDER}/xhr/`)
    .replace(/(["'])\/xhr\//g, `$1https://${OPS_PLACEHOLDER}/xhr/`)
    // R3: theme host -> /static/ (bundled). Absorb the variable ../ chain.
    .replace(/(?:\.\.\/)*static\.esperanzahomes\.com\//g, '/static/')
    // R2: images -> R2 CDN. Capture the whole path token, drop the resize query
    // (img.hazardhouse.ai ignores it and serves the original), strip the .avif
    // mirror artifact by splitting on the encoded '?' (%EF%B9%96).
    .replace(/(?:\.\.\/)*media\.esperanzahomes\.com\/([^"'\s)]*)/g,
      (_m, p) => `//img.hazardhouse.ai/assets-media/${resolveMedia(p, '', ESP_KEYS)}`)
    .replace(/(?:\.\.\/)*media\.homefiniti\.com\/([^"'\s)]*)/g,
      (_m, p) => `//img.hazardhouse.ai/assets-media/${resolveMedia(p, 'homefiniti/', HF_KEYS)}`)
    // R4: mapbox-gl lib CDN (relativized by HTTrack) -> restore https.
    .replace(/(?:\.\.\/)*api\.mapbox\.com\//g, 'https://api.mapbox.com/')
    // R7: swap O'Neill Mapbox token + custom styles (custom styles 401 under our token).
    .replace(/pk\.eyJ1Ijoib25la[A-Za-z0-9._-]*/g, MAPBOX_TOKEN)
    .replace(/mapbox:\/\/styles\/oneilinteractive\/[A-Za-z0-9]+/g, PUBLIC_STYLE);
}

// The flagship available page: disable oilib (so it doesn't fight our island for
// #oi-map / #oi-filter-results), then inject the live QMI+Mapbox island.
function rewriteAvailable(html) {
  html = rewriteCommon(html);
  // Neutralize oilib: drop its <script src>. Its map/filter init listeners fire on
  // the 'oilib_loaded' event, which never dispatches once the lib isn't loaded.
  html = html.replace(/<script[^>]*\/static\/assets\/js\/oilib[^>]*><\/script>/g, '<!-- oilib map/filter init removed for the live island -->');
  if (!/src="\/available-live\.js"/.test(html)) {
    const tag = `\n<script>window.__ESPERANZA={API_BASE:${JSON.stringify(API_BASE)},MAPBOX_TOKEN:${JSON.stringify(MAPBOX_TOKEN)},MAPBOX_STYLE:${JSON.stringify(PUBLIC_STYLE)}};</script>\n<script src="/available-live.js" defer></script>\n`;
    // inject before the LAST </body> (inline JS can contain a literal "</body>")
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. Theme bundle -> /static (preserve the ﹖v=hash filenames verbatim).
  cpSync(THEME, join(OUT, 'static'), { recursive: true });

  // 2. Flagship pages, rewritten.
  for (const [key, rel] of Object.entries(PAGES)) {
    const src = join(WWW, rel);
    if (!existsSync(src)) throw new Error(`missing scrape page: ${src}`);
    let html = readFileSync(src, 'utf8');
    html = key === 'available' ? rewriteAvailable(html) : rewriteCommon(html);
    const dst = join(OUT, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, html);
    console.log(`built ${rel}  (${(html.length / 1024).toFixed(0)}kb)`);
  }

  // 3. The live island.
  cpSync(join(import.meta.dirname, 'islands', 'available-live.js'), join(OUT, 'available-live.js'));
  console.log(`\npublic/ assembled at ${OUT}`);
}

// ponytail self-check: the rewrites are the load-bearing logic; assert their shape.
function demo() {
  const s = rewriteCommon;
  console.assert(s('src="../../../media.esperanzahomes.com/153/2026/5/22/LP047_Rendering.png%EF%B9%96width=848&amp;ois=8e9bec3.avif"')
    === 'src="//img.hazardhouse.ai/assets-media/153/2026/5/22/LP047_Rendering.png"', 'media rewrite/decode');
  // extensionless srcset ref must resolve to the real .jpg key (first line of the esp key list)
  console.assert(s('srcset="../media.esperanzahomes.com/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27%EF%B9%96width=300&amp;fit=bounds.png 300w"')
    === 'srcset="//img.hazardhouse.ai/assets-media/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27.jpg 300w"', 'extensionless srcset -> real key');
  console.assert(s('href="../static.esperanzahomes.com/esperanza_homes/css/style.min%EF%B9%96v=85c08ef.css"')
    === 'href="/static/esperanza_homes/css/style.min%EF%B9%96v=85c08ef.css"', 'theme keeps ﹖ filename');
  console.assert(s('action="https://www.esperanzahomes.com/xhr/request-information/"')
    .includes(`https://${OPS_PLACEHOLDER}/xhr/request-information/`), 'xhr repoint');
  console.assert(s('"map_key":"pk.eyJ1Ijoib25laWxpbnRlcmFjdGl2ZSIsImEiOiJjbDFmYWZ1d24wc2ZyM2ZtdXU2ZjF2ejczIn0.1TnDjEQqUtXCeBvpP2ZSnA"')
    === `"map_key":"${MAPBOX_TOKEN}"`, 'token swap');
  console.assert(s('src="../../../api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"')
    === 'src="https://api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"', 'mapbox lib https');
  console.log('demo() rewrite checks passed');
}

if (process.argv.includes('--check')) demo();
else build();
