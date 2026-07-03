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
import { execSync } from 'node:child_process';

const SCRAPE = '/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08';
const WWW = join(SCRAPE, 'www.esperanzahomes.com');
const THEME = join(SCRAPE, 'static.esperanzahomes.com');
const OUT = join(import.meta.dirname, 'public');

// --- config that gets baked into the flagship pages -------------------------
// Our own Mapbox token. O'Neill's token is URL-locked to esperanzahomes.com, so it
// 403s every tile read off-domain (blank base maps on Railway). Our token reads tiles
// fine; it can't read O'Neill's *private* styles, so we use our own styles instead.
const MAPBOX_TOKEN = 'pk.eyJ1IjoiaGF6YXJkaG91c2UiLCJhIjoiY21kdG1xMWwwMTFvbDJqb2h1bXgxYmw3ZyJ9.ER4JhSJ2bl89WJ-3Xv5erA';
// Homepage "Find Your Home" uses our recreated counties style ("Texas Counties Map").
const STYLE_HOME = 'mapbox://styles/hazardhouse/cmfxyvjas00bh01qsf8ok5bcg';
// QMI + community-detail maps roll back to generic streets for now (custom styles for
// those in our account are a follow-up). available-live.js reads PUBLIC_STYLE as MAPBOX_STYLE.
const PUBLIC_STYLE = 'mapbox://styles/mapbox/streets-v11';
const API_BASE = '/api/public'; // same-origin; Caddy reverse-proxies to the API worker (avoids CORS)

// Sentry browser error monitoring. The DSN's public key ships in client JS by design
// (it is not a secret), so we inject the Sentry Loader Script on every page for
// visibility into user-facing JS errors. Set SENTRY_FRONTEND_DSN at build time to
// enable; unset -> no Sentry (local/POC builds stay clean). The loader lazy-loads the
// SDK and auto-captures unhandled errors + promise rejections; sampling/replay/perf
// toggle live in the Sentry UI (Settings -> Client Keys -> Loader Script).
const SENTRY_KEY = (process.env.SENTRY_FRONTEND_DSN || '').match(/\/\/([^@]+)@/)?.[1] || '';

// Pages to ship are listed in ship.txt (one rel path per line, relative to WWW),
// grown per phase. Always include the homepage. Pages get rewriteCommon; the ones
// in LIVE_PAGES additionally get their island injected.
const ALWAYS = ['index.html'];
// Pages get their island by explicit path (LIVE_PAGES) or by which map container
// their HTML contains (CONTAINER_ISLANDS) — the latter auto-covers every homepage /
// community-detail map without listing all 30+ paths. available-live.js stays explicit
// (it renders QMI cards + filters, not just a map, so it can't be container-inferred).
const LIVE_PAGES = { 'new-homes/available/index.html': 'available-live.js' };
// Generic runtime QMI-detail shell for homes newer than the scrape (no static page).
// Built from an existing scraped detail page so it inherits the site chrome/theme;
// its home-specific content is stripped and qmi-detail-live.js fills #qmi-live from
// the live API. Served by Caddy try_files at /new-homes/available/home/ (?slug= passes through).
const SHELL = {
  out: 'new-homes/available/home/index.html',
  island: 'qmi-detail-live.js',
  template: 'new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html',
};
const CONTAINER_ISLANDS = [
  { id: 'id="home-map"', island: 'community-maps-live.js' }, // homepage Find-Your-Home (Counties)
  { id: 'id="map"', island: 'community-maps-live.js' },      // community detail single-location (Common)
];
// Extra scripts appended to a page (before </body>) without disabling oilib — layered
// on top of any island. Homepage Search -> /new-homes/available/ with filter params.
const EXTRA_SCRIPTS = { 'index.html': ['homepage-filter.js'] };
function shipList() {
  const manifest = join(import.meta.dirname, 'ship.txt');
  const extra = existsSync(manifest)
    ? readFileSync(manifest, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)
    : [];
  return [...new Set([...ALWAYS, ...extra])];
}

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
  const clean = rawPath.split('%EF%B9%96')[0].split('?')[0]; // drop resize query (encoded or literal ?)
  return map.get(prefix + stripExt(clean)) || (prefix + clean);
}

// --- rewrite rules ----------------------------------------------------------
// Applied to every flagship page. Order matters: xhr before the broad host rules.
function rewriteCommon(html) {
  html = html
    // R1: XHR form/lead endpoints -> placeholder (deferred). Absolute + root-relative.
    // xhr endpoints -> same-origin /xhr/ (Caddy answers with benign JSON so the
    // frozen snapshot's recommend/oicheck/form calls resolve quietly instead of
    // erroring against the dead live domain). Root-relative /xhr/ already correct.
    .replace(/https:\/\/www\.esperanzahomes\.com\/xhr\//g, '/xhr/')
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
    // R7: swap O'Neill's token -> ours, and their private styles -> a public style our
    // token can read (islands override the style per map; this only covers leftover
    // oilib refs on non-island pages).
    .replace(/pk\.eyJ1Ijoib25la[A-Za-z0-9._-]*/g, MAPBOX_TOKEN)
    .replace(/mapbox:\/\/styles\/oneilinteractive\/[A-Za-z0-9]+/g, PUBLIC_STYLE)
    // R8: footer credit -> "Powered by Hazard House" (drop O'Neill/Homefiniti logo + links).
    // Shared footer on every page; the attribution div has no nested <div> so the
    // non-greedy match to the first </div> is safe.
    .replace(/<div class="col-12 oneilinteractive-attribution[^>]*>[\s\S]*?<\/div>/,
      '<div class="col-12 oneilinteractive-attribution text-center text-white fs-9 mb-2"><a href="https://hazardhouse.ai" rel="noopener" target="_blank" class="text-small text-white">Powered by Hazard House</a></div>');
  return injectSentry(html, SENTRY_KEY);
}

// Inject the Sentry browser Loader Script into <head> so it initializes before the
// scrape's own scripts (catching their errors too). Pure for demo(); no key or an
// already-injected page -> unchanged (idempotent).
function injectSentry(html, key) {
  if (!key || html.includes('js.sentry-cdn.com')) return html;
  const tag = `<script src="https://js.sentry-cdn.com/${key}.min.js" crossorigin="anonymous"></script>`;
  return html.replace(/<head([^>]*)>/i, `<head$1>\n${tag}`);
}

// Live pages: disable oilib (so it doesn't fight our island for #oi-map /
// #oi-filter-results) and inject the page's island + config before the LAST </body>
// (inline JS can contain a literal "</body>").
function injectIsland(html, islandFile) {
  html = html.replace(/<script[^>]*\/static\/assets\/js\/oilib[^>]*><\/script>/g, '<!-- oilib map/filter init removed for the live island -->');
  // oilib is gone but the page still has inline oilib map code (oi.map.multi, fitToBounds
  // reading oi.loaded.map, resize handlers) -> "oi is not defined". Stub `oi` in <head>
  // with a chainable no-op proxy so those orphaned calls are silent.
  if (!html.includes('window.oi=')) {
    const stub = '<script>window.oi=new Proxy(function(){},{get:function(){return window.oi},apply:function(){return window.oi}});</script>';
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${stub}`);
  }
  const marker = `src="/${islandFile}"`;
  if (!html.includes(marker)) {
    const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: PUBLIC_STYLE, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_DETAIL: PUBLIC_STYLE };
    const tag = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};</script>\n<script src="/${islandFile}" defer></script>\n`;
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

// Build the QMI-detail shell: take a real scraped detail page, apply the common
// rewrites, replace the home-specific content span (the price header through the end
// of the detail body, i.e. everything up to <footer>) with an empty #qmi-live mount,
// and inject the runtime island. Pure function so demo() can assert its shape.
function buildShellHtml(raw) {
  let html = rewriteCommon(raw);
  const mount = '\n<div id="qmi-live" class="qmi-detail-live"><div class="container py-5 text-center text-gray">Loading home details…</div></div>\n';
  html = html.replace(/<section class="header[\s\S]*?(?=<footer)/, mount);
  return injectIsland(html, SHELL.island);
}

// Map live API homes -> shipped detail pages (for the available island's card links).
// Key QMI by <communitySlug>/<addressSlug> (near-unique); community pages by <communitySlug>
// as a fallback for homes newer than the scrape. Written to public/qmi-links.json.
function writeLinksMap() {
  const find = a => execSync(`find ${a}`, { cwd: WWW }).toString().trim().split('\n').filter(Boolean);
  const qmi = {};
  for (const p of find('new-homes/tx -mindepth 6 -name index.html')) {
    const s = p.split('/'); qmi[`${s[3]}/${s[5]}`] = '/' + s.slice(0, 7).join('/') + '/';
  }
  const community = {};
  for (const p of find('new-homes/tx -mindepth 4 -maxdepth 4 -name index.html')) {
    const s = p.split('/'); community[s[3]] = '/' + s.slice(0, 5).join('/') + '/';
  }
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify({ qmi, community }));
  console.log(`qmi-links.json: ${Object.keys(qmi).length} detail + ${Object.keys(community).length} community`);
}

function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. Theme bundle -> /static (preserve the ﹖v=hash filenames verbatim).
  cpSync(THEME, join(OUT, 'static'), { recursive: true });

  // 2. Ship every page in the manifest; islands for the LIVE_PAGES.
  let n = 0;
  for (const rel of shipList()) {
    const src = join(WWW, rel);
    if (!existsSync(src)) { console.warn(`skip missing: ${rel}`); continue; }
    let html = rewriteCommon(readFileSync(src, 'utf8'));
    if (LIVE_PAGES[rel]) {
      html = injectIsland(html, LIVE_PAGES[rel]);
    } else {
      const hit = CONTAINER_ISLANDS.find(c => html.includes(c.id));
      if (hit) html = injectIsland(html, hit.island);
    }
    for (const f of EXTRA_SCRIPTS[rel] || []) {
      if (!html.includes(`src="/${f}"`)) {
        const i = html.lastIndexOf('</body>');
        const tag = `\n<script src="/${f}" defer></script>\n`;
        html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
      }
    }
    const dst = join(OUT, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, html);
    n++;
  }
  console.log(`rewrote ${n} pages`);

  // 2b. Generic QMI-detail shell (for homes newer than the scrape). Served by Caddy
  // try_files at /new-homes/available/home/; qmi-detail-live.js fills it from the API.
  const shellSrc = join(WWW, SHELL.template);
  if (existsSync(shellSrc)) {
    const shellDst = join(OUT, SHELL.out);
    mkdirSync(dirname(shellDst), { recursive: true });
    writeFileSync(shellDst, buildShellHtml(readFileSync(shellSrc, 'utf8')));
    console.log(`shell: ${SHELL.out}`);
  } else {
    console.warn(`skip shell (template missing): ${SHELL.template}`);
  }

  // 3. Islands (from both explicit LIVE_PAGES and container-inferred CONTAINER_ISLANDS).
  const islands = new Set([...Object.values(LIVE_PAGES), ...CONTAINER_ISLANDS.map(c => c.island), ...Object.values(EXTRA_SCRIPTS).flat(), SHELL.island]);
  for (const island of islands) {
    cpSync(join(import.meta.dirname, 'islands', island), join(OUT, island));
  }
  // Marker sprite for the community maps (streets/counties styles have no map_pin),
  // loaded at runtime via addImage. The exact O'Neill green teardrop (90x120 @2x).
  cpSync(join(import.meta.dirname, 'islands', 'map_pin.png'), join(OUT, 'map_pin.png'));
  // Frozen site-search index (oilib fetches /sitesearch.json) — served same-origin so
  // header search works and doesn't CORS-fail against the dead live domain.
  cpSync(join(import.meta.dirname, 'assets', 'sitesearch.json'), join(OUT, 'sitesearch.json'));
  writeLinksMap();
  console.log(`public/ assembled at ${OUT}`);
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
  // footer credit -> Hazard House (logo + O'Neill links removed)
  const foot = s('<div class="col-12 oneilinteractive-attribution text-center"><a href="https://oneilinteractive.com/x"><img class="oneil-icon" src="../static.esperanzahomes.com/x.avif"> Powered by Homefiniti</a>. Designed by <a href="https://oneilinteractive.com">ONeil Interactive</a>.</div>');
  console.assert(foot.includes('Powered by Hazard House') && !foot.includes('oneilinteractive.com') && !foot.includes('oneil-icon'), 'footer -> Hazard House');
  console.assert(s('action="https://www.esperanzahomes.com/xhr/request-information/"')
    === 'action="/xhr/request-information/"', 'xhr -> same-origin');
  console.assert(s('"map_key":"pk.eyJ1Ijoib25laWxpbnRlcmFjdGl2ZSIsImEiOiJjbDFmYWZ1d24wc2ZyM2ZtdXU2ZjF2ejczIn0.1TnDjEQqUtXCeBvpP2ZSnA"')
    === `"map_key":"${MAPBOX_TOKEN}"`, 'token swap');
  console.assert(s('src="../../../api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"')
    === 'src="https://api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"', 'mapbox lib https');

  // shell builder: home-specific content span replaced by #qmi-live, island injected.
  const mini = '<head></head><body><nav>nav</nav></div><section class="header">PRICE $9<div id="detail-gallery">imgs</div></section><section id="overview">specs</section><footer>f</footer></body>';
  const shell = buildShellHtml(mini);
  console.assert(shell.includes('id="qmi-live"'), 'shell: #qmi-live mount injected');
  console.assert(!shell.includes('id="detail-gallery"') && !shell.includes('PRICE $9'), 'shell: home content stripped');
  console.assert(shell.includes('<footer>f</footer>'), 'shell: footer/chrome preserved');
  console.assert(shell.includes('src="/qmi-detail-live.js"') && shell.includes('window.oi='), 'shell: island + oi stub injected');

  // Sentry loader: injected into <head> when a key is set; no-op without one; idempotent.
  console.assert(injectSentry('<head><title>t</title></head>', 'abc123').includes('https://js.sentry-cdn.com/abc123.min.js'), 'sentry: loader injected with key');
  console.assert(injectSentry('<head></head>', '') === '<head></head>', 'sentry: no key -> unchanged');
  console.assert(injectSentry('<head><script src="https://js.sentry-cdn.com/x.min.js"></script></head>', 'y').match(/js\.sentry-cdn\.com/g).length === 1, 'sentry: idempotent');
  console.log('demo() rewrite + shell + sentry checks passed');
}

if (process.argv.includes('--check')) demo();
else build();
