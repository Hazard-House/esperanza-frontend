// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data.mjs';
import { linksMap, qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { renderQmi } from './render-qmi.mjs';
import { renderCommunity } from './render-community.mjs';
import { renderFloorplan } from './render-floorplan.mjs';
import { hydrateCommunityStatus } from './hydrate-scraped.mjs';

const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

function writePage(urlPath, html) {
  const dst = join(OUT, urlPath.replace(/^\//, ''), 'index.html'); // urlPath ends with '/'
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, html);
}

// The /incentives/* promo pages ship 1:1 from the June-8 scrape — no live island, no
// publish gate — so QMI cards for homes since drafted/sold/unpublished linger (e.g. a
// draft spec still showing on a Flex-Cash page). Strip any baked card whose home slug
// isn't in the published set (the SAME gate the API uses). Bare string scan with a
// balanced-<div> walk (generate-details has no DOM/npm deps). Cards whose slug can't be
// parsed are kept (safe default).
// ponytail: string scan, not a parser — matches the frozen grid's fixed card wrapper.
const CARD_OPEN = '<div class="col-12 col-md-6 mb-4">';
export function stripStaleHomeCards(html, publishedSlugs) {
  let out = '', pos = 0, dropped = 0;
  for (;;) {
    const start = html.indexOf(CARD_OPEN, pos);
    if (start === -1) { out += html.slice(pos); break; }
    out += html.slice(pos, start);
    let i = start + CARD_OPEN.length, depth = 1;
    while (i < html.length && depth > 0) {
      const o = html.indexOf('<div', i);
      const c = html.indexOf('</div>', i);
      if (c === -1) { i = html.length; break; }
      if (o !== -1 && o < c) { depth++; i = o + 4; } else { depth--; i = c + 6; }
    }
    const card = html.slice(start, i);
    // …/new-homes/tx/<city>/<community>/<id>/<slug>/<homeId>/ — the slug is the segment
    // before the trailing numeric homeId.
    const m = card.match(/\/new-homes\/tx\/[^/"]+\/[^/"]+\/[^/"]+\/([^/"]+)\/\d+\/?"/);
    const slug = m && m[1];
    if (slug && !publishedSlugs.has(slug)) dropped++;   // stale/unpublished → drop
    else out += card;                                    // keep
    pos = i;
  }
  return { html: out, dropped };
}

// Rewrite every /incentives/<slug>/index.html in place, dropping stale home cards.
function stripIncentivesPages(publishedSlugs) {
  const incDir = join(OUT, 'incentives');
  if (!existsSync(incDir)) return 0;
  let total = 0;
  for (const name of readdirSync(incDir)) {
    const idx = join(incDir, name, 'index.html');
    if (!existsSync(idx)) continue;
    const { html, dropped } = stripStaleHomeCards(readFileSync(idx, 'utf8'), publishedSlugs);
    if (dropped) { writeFileSync(idx, html); total += dropped; }
  }
  return total;
}

// data + skip-sets are injectable so build.mjs can load the API once and skip
// entities it already shipped as hydrated scrape copies (clean paths in the sets).
export async function generateDetails(data, { skipCommunities, skipFloorplans } = {}) {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const d = data || await loadData();
  // shell nav carries frozen June-8 "Coming Soon" badges — refresh from the API once
  const shell = hydrateCommunityStatus(readFileSync(SHELL_PATH, 'utf8'), d);
  const skipC = skipCommunities || new Set();
  const skipF = skipFloorplans || new Set();
  for (const h of d.qmis) writePage(qmiPath(h), renderQmi(h, shell));
  let nc = 0, nf = 0;
  for (const c of d.communities) if (!skipC.has(communityPath(c))) { writePage(communityPath(c), renderCommunity(c, shell)); nc++; }
  for (const fp of d.floorplans) if (!skipF.has(floorplanPath(fp))) { writePage(floorplanPath(fp), renderFloorplan(fp, shell)); nf++; }
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  const strippedCards = stripIncentivesPages(new Set(d.qmis.map((h) => h.slug)));
  console.log(`generate-details: ${d.qmis.length} qmi + ${nc}/${d.communities.length} community + ${nf}/${d.floorplans.length} floorplan pages (rest shipped from scrape); stripped ${strippedCards} stale /incentives/ home cards`);
  return { qmi: d.qmis.length, community: nc, floorplan: nf, strippedCards };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generateDetails();
