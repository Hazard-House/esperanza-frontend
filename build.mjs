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

import assert from 'node:assert';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, PUBLIC_STYLE, NOINDEX, rewriteCommon, injectIsland } from './rewrite.mjs';
import { generateDetails } from './generate-details.mjs';

const SCRAPE = '/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08';
const WWW = join(SCRAPE, 'www.esperanzahomes.com');
const THEME = join(SCRAPE, 'static.esperanzahomes.com');
const OUT = join(import.meta.dirname, 'public');

// Pages to ship are listed in ship.txt (one rel path per line, relative to WWW),
// grown per phase. Always include the homepage. Pages get rewriteCommon; the ones
// in LIVE_PAGES additionally get their island injected.
const ALWAYS = ['index.html'];
// Pages get their island by explicit path (LIVE_PAGES) or by which map container
// their HTML contains (CONTAINER_ISLANDS) — the latter auto-covers every homepage /
// community-detail map without listing all 30+ paths. available-live.js stays explicit
// (it renders QMI cards + filters, not just a map, so it can't be container-inferred).
const LIVE_PAGES = {
  'new-homes/available/index.html': 'available-live.js', // Quick Move-Ins (QMI homes)
  'new-homes/index.html': 'communities-live.js',         // Communities
};
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

async function build() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. Theme bundle -> /static (preserve the ﹖v=hash filenames verbatim).
  cpSync(THEME, join(OUT, 'static'), { recursive: true });

  // 2. Ship every page in the manifest; islands for the LIVE_PAGES.
  let n = 0;
  for (const rel of shipList()) {
    const src = join(WWW, rel);
    if (!existsSync(src)) { console.warn(`skip missing: ${rel}`); continue; }
    // Detail pages are generated fresh from D1 (Task 12) — don't ship the frozen scrape copies.
    if (/^new-homes\/tx\/[^/]+\/[^/]+\/[^/]+\//.test(rel) || /^floorplans\/[^/]+\/[^/]+\//.test(rel)) continue;
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
  const islands = new Set([...Object.values(LIVE_PAGES), ...CONTAINER_ISLANDS.map(c => c.island), ...Object.values(EXTRA_SCRIPTS).flat(), SHELL.island, 'hydrate-live.js', 'detail-extras.js']);
  for (const island of islands) {
    cpSync(join(import.meta.dirname, 'islands', island), join(OUT, island));
  }
  // Marker sprite for the community maps (streets/counties styles have no map_pin),
  // loaded at runtime via addImage. The exact O'Neill green teardrop (90x120 @2x).
  cpSync(join(import.meta.dirname, 'islands', 'map_pin.png'), join(OUT, 'map_pin.png'));
  // Captured "Esperanza-Common" style JSON — QMI/Communities/detail maps load it as a
  // style object (renders 1:1 under our token; data is the public streets tileset).
  cpSync(join(import.meta.dirname, 'islands', 'esperanza-common.json'), join(OUT, 'esperanza-common.json'));
  // Frozen site-search index (oilib fetches /sitesearch.json) — served same-origin so
  // header search works and doesn't CORS-fail against the dead live domain.
  cpSync(join(import.meta.dirname, 'assets', 'sitesearch.json'), join(OUT, 'sitesearch.json'));
  // pre-launch crawl block (NOINDEX): belt-and-suspenders with the per-page noindex meta.
  if (NOINDEX) writeFileSync(join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  await generateDetails();
  console.log(`public/ assembled at ${OUT}`);
}

// ponytail self-check: the rewrites are the load-bearing logic; assert their shape.
function demo() {
  const s = rewriteCommon;
  assert(s('src="../../../media.esperanzahomes.com/153/2026/5/22/LP047_Rendering.png%EF%B9%96width=848&amp;ois=8e9bec3.avif"')
    === 'src="//img.hazardhouse.ai/assets-media/153/2026/5/22/LP047_Rendering.png"', 'media rewrite/decode');
  // absolute og:image/twitter:image form must not stack slashes (was https:////img…)
  assert(s('content="https://media.homefiniti.com/153/2022/5/16/1-14.jpg"')
    === 'content="//img.hazardhouse.ai/assets-media/homefiniti/153/2022/5/16/1-14.jpg"', 'absolute media -> protocol-relative CDN (no https:///)');
  // extensionless srcset ref must resolve to the real .jpg key (first line of the esp key list)
  assert(s('srcset="../media.esperanzahomes.com/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27%EF%B9%96width=300&amp;fit=bounds.png 300w"')
    === 'srcset="//img.hazardhouse.ai/assets-media/153/2019/6/29/Tres_Lagos_Community_Center_Full_WEB-27.jpg 300w"', 'extensionless srcset -> real key');
  assert(s('href="../static.esperanzahomes.com/esperanza_homes/css/style.min%EF%B9%96v=85c08ef.css"')
    === 'href="/static/esperanza_homes/css/style.min%EF%B9%96v=85c08ef.css"', 'theme keeps ﹖ filename');
  // footer credit -> Hazard House (logo + O'Neill links removed)
  const foot = s('<div class="col-12 oneilinteractive-attribution text-center"><a href="https://oneilinteractive.com/x"><img class="oneil-icon" src="../static.esperanzahomes.com/x.avif"> Powered by Homefiniti</a>. Designed by <a href="https://oneilinteractive.com">ONeil Interactive</a>.</div>');
  assert(foot.includes('Powered by Hazard House') && !foot.includes('oneilinteractive.com') && !foot.includes('oneil-icon'), 'footer -> Hazard House');
  assert(s('action="https://www.esperanzahomes.com/xhr/request-information/"')
    === 'action="/xhr/request-information/"', 'xhr -> same-origin');
  assert(s('"map_key":"pk.eyJ1Ijoib25laWxpbnRlcmFjdGl2ZSIsImEiOiJjbDFmYWZ1d24wc2ZyM2ZtdXU2ZjF2ejczIn0.1TnDjEQqUtXCeBvpP2ZSnA"')
    === `"map_key":"${MAPBOX_TOKEN}"`, 'token swap');
  assert(s('src="../../../api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"')
    === 'src="https://api.mapbox.com/mapbox-gl-js/v2.1.1/mapbox-gl.js"', 'mapbox lib https');

  // shell builder: home-specific content span replaced by #qmi-live, island injected.
  const mini = '<head></head><body><nav>nav</nav></div><section class="header">PRICE $9<div id="detail-gallery">imgs</div></section><section id="overview">specs</section><footer>f</footer></body>';
  const shell = buildShellHtml(mini);
  assert(shell.includes('id="qmi-live"'), 'shell: #qmi-live mount injected');
  assert(!shell.includes('id="detail-gallery"') && !shell.includes('PRICE $9'), 'shell: home content stripped');
  assert(shell.includes('<footer>f</footer>'), 'shell: footer/chrome preserved');
  assert(shell.includes('src="/qmi-detail-live.js"') && shell.includes('window.oi='), 'shell: island + oi stub injected');
  console.log('demo() rewrite + shell checks passed');
}

if (process.argv.includes('--check')) demo();
else build().catch(e => { console.error(e); process.exit(1); });
