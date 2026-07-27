// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './data.mjs';
import { linksMap, imagesMap, qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { renderQmi } from './render-qmi.mjs';
import { renderCommunity } from './render-community.mjs';
import { renderFloorplan } from './render-floorplan.mjs';
import { setBuildRate } from './sections.mjs';
import { hydrateCommunity, hydrateCommunityStatus, applyHoaLinks } from './hydrate-scraped.mjs';
import { slugify } from './data.mjs';
import { ensureCommunityHomesLive } from './rewrite.mjs';
import { classifyDetail } from './build.mjs';
import { generateBlogs } from './generate-blogs.mjs';
import { bakeSpanish } from './es-bake.mjs';

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

// Drop community header rows whose following card row has no QMI cards left (after stale strip).
export function stripEmptyIncentiveCommunitySections(html) {
  const marker = 'id="available"';
  const idx = html.indexOf(marker);
  if (idx === -1) return html;
  const tail = html.slice(idx);
  const head = html.slice(0, idx);
  const re = /<div id="([^"]+)" class="row mb-2">[\s\S]*?<h3>[\s\S]*?<\/div>\s*<div class="row mb-4 mb-lg-5">([\s\S]*?)<\/div>/g;
  let out = tail;
  out = out.replace(re, (block, _id, inner) => {
    if (inner.includes(CARD_OPEN)) return block;
    return '';
  });
  return head + out;
}

// Rewrite every /incentives/<slug>/index.html in place, dropping stale home cards.
function stripIncentivesPages(publishedSlugs) {
  const incDir = join(OUT, 'incentives');
  if (!existsSync(incDir)) return 0;
  const templateAvail = existsSync(join(incDir, '499-interest-rates', 'index.html'))
    ? extractAvailableSection(readFileSync(join(incDir, '499-interest-rates', 'index.html'), 'utf8'))
    : null;
  let total = 0;
  for (const name of readdirSync(incDir)) {
    const idx = join(incDir, name, 'index.html');
    if (!existsSync(idx)) continue;
    let html = readFileSync(idx, 'utf8');
    if (templateAvail && name !== '499-interest-rates' && name !== 'index.html') {
      html = replaceAvailableSection(html, templateAvail);
    }
    const stripped = stripStaleHomeCards(html, publishedSlugs);
    const cleaned = stripEmptyIncentiveCommunitySections(stripped.html);
    if (stripped.dropped || cleaned !== html) { writeFileSync(idx, cleaned); total += stripped.dropped; }
  }
  return total;
}

function extractAvailableSection(html) {
  const start = html.indexOf('<section id="available"');
  if (start === -1) return null;
  const end = html.indexOf('</section>', start);
  if (end === -1) return null;
  return html.slice(start, end + '</section>'.length);
}

function replaceAvailableSection(html, block) {
  const start = html.indexOf('<section id="available"');
  if (start === -1 || !block) return html;
  const end = html.indexOf('</section>', start);
  if (end === -1) return html;
  return html.slice(0, start) + block + html.slice(end + '</section>'.length);
}

const SHIP_PATH = join(import.meta.dirname, 'ship.txt');

// Scraped community ID paths (ship.txt …/<id>/index.html) keep the rich June-8 layout
// but must be re-hydrated each build so Quick Move-In cards match live API data AND
// sort low→high by price (same order as renderCommunity / data.mjs).
export function rehydrateScrapedCommunities(d, { outDir = OUT } = {}) {
  const bySlug = new Map(d.communities.map(c => [c.slug, c]));
  const paths = new Map();
  if (!existsSync(SHIP_PATH)) return { updated: 0, skipped: 0, checked: 0 };

  for (const rel of readFileSync(SHIP_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    paths.set(rel, det.slug);
    const c = bySlug.get(det.slug);
    if (c) paths.set(communityPath(c).replace(/^\//, '') + 'index.html', det.slug);
  }

  let updated = 0, skipped = 0;
  for (const [rel, slug] of paths) {
    const c = bySlug.get(slug);
    if (!c) { skipped++; continue; }
    const file = join(outDir, rel);
    if (!existsSync(file)) { skipped++; continue; }
    const raw = readFileSync(file, 'utf8');
    let html = hydrateCommunityStatus(hydrateCommunity(raw, c, d), d);
    html = ensureCommunityHomesLive(html);
    if (html !== raw) {
      writeFileSync(file, html);
      updated++;
    }
  }
  return { updated, skipped, checked: paths.size };
}

// Communities with a scraped ID path in ship.txt ship 1:1 from the O'Neill page
// (rescrape-community.mjs). CI must not overwrite their clean slug path with the
// generated renderCommunity() template.
function scrapedCommunitySkipSet(communities) {
  const bySlug = new Map(communities.map(c => [c.slug, c]));
  const skip = new Set();
  if (!existsSync(SHIP_PATH)) return skip;
  for (const rel of readFileSync(SHIP_PATH, 'utf8').split('\n').map(s => s.trim()).filter(Boolean)) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    const c = bySlug.get(det.slug);
    if (c) skip.add(communityPath(c));
  }
  return skip;
}

// Scraped plan-in-community pages carry the same frozen "Download Community Resources"
// CCR anchor as the community page, but rehydrateScrapedCommunities never touches them.
// For every community with admin HOA uploads, walk its whole page tree and refresh the
// anchor from hoaLinks (applyHoaLinks is idempotent + a no-op on pages without it).
function refreshHoaLinksInCommunityTrees(d, { outDir = OUT } = {}) {
  let updated = 0;
  for (const c of d.communities) {
    if (!c.hoaLinks.length || !c.slug) continue;
    const stack = [join(outDir, 'new-homes', 'tx', slugify(c.city), c.slug)];
    while (stack.length) {
      const dir = stack.pop();
      if (!existsSync(dir)) continue;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) stack.push(join(dir, ent.name));
        else if (ent.name === 'index.html') {
          const file = join(dir, ent.name);
          const raw = readFileSync(file, 'utf8');
          const html = applyHoaLinks(raw, c);
          if (html !== raw) { writeFileSync(file, html); updated++; }
        }
      }
    }
  }
  return updated;
}

// data + skip-sets are injectable so build.mjs can load the API once and skip
// entities it already shipped as hydrated scrape copies (clean paths in the sets).
export async function generateDetails(data, { skipCommunities, skipFloorplans } = {}) {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const d = data || await loadData();
  // Bake payments off the live Settings mortgage rate (not the frozen 6.15 harvest).
  setBuildRate(d.settings?.settings?.mortgage_rate ?? d.settings?.mortgage_rate);
  // shell nav carries frozen June-8 "Coming Soon" badges — refresh from the API once
  const shell = hydrateCommunityStatus(readFileSync(SHELL_PATH, 'utf8'), d);
  const skipC = skipCommunities || scrapedCommunitySkipSet(d.communities);
  const skipF = skipFloorplans || new Set();
  for (const h of d.qmis) writePage(qmiPath(h), renderQmi(h, shell));
  let nc = 0, nf = 0;
  for (const c of d.communities) if (!skipC.has(communityPath(c))) { writePage(communityPath(c), renderCommunity(c, shell)); nc++; }
  for (const fp of d.floorplans) if (!skipF.has(floorplanPath(fp))) { writePage(floorplanPath(fp), renderFloorplan(fp, shell)); nf++; }
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  writeFileSync(join(OUT, 'qmi-images.json'), JSON.stringify(imagesMap(d.qmis)));
  const strippedCards = stripIncentivesPages(new Set(d.qmis.map((h) => h.slug)));
  const { updated: rehydrated } = rehydrateScrapedCommunities(d);
  const hoaUpdated = refreshHoaLinksInCommunityTrees(d);
  // Blog pages from D1 (was: frozen June-8 scrape). Non-fatal so a blog hiccup never blocks
  // the pricing/inventory deploy; the count-parity guard still logs loudly on a shortfall.
  const blogs = await generateBlogs().catch(e => { console.error('generate-blogs:', e.message); return 0; });
  // Spanish LAST: es-bake mirrors the finished English tree, so it must see every page
  // this run rewrote (QMI prices, incentive strips, blogs) or /es/ ships yesterday's data.
  // Non-fatal for the same reason blogs are — a locale hiccup must never block a pricing
  // deploy; the existing /es/ pages just stay one build behind.
  const es = await bakeSpanish().catch(e => { console.error('es-bake:', e.message); return { pages: 0 }; });
  console.log(`generate-details: ${d.qmis.length} qmi + ${nc}/${d.communities.length} community + ${nf}/${d.floorplans.length} floorplan pages (rest shipped from scrape); ${blogs} blog pages; rehydrated ${rehydrated} scraped community pages; refreshed HOA links on ${hoaUpdated} pages; stripped ${strippedCards} stale /incentives/ home cards; ${es.pages} Spanish pages`);
  return { qmi: d.qmis.length, community: nc, floorplan: nf, blogs, strippedCards, rehydrated, hoaUpdated, es: es.pages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) generateDetails();
