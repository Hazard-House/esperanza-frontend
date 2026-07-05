// hydrate-scraped.mjs — build-time data hydration for SCRAPED community and
// floor-plan detail pages (June-8 mirror). The scraped pages are 1:1 with the
// original; only the volatile numbers (prices) and the Quick Move-Ins cards go
// stale, so we surgically refresh those from the live API and ship the rest
// verbatim. Pure string surgery; every step falls back (console.warn) so a
// non-matching page ships un-hydrated instead of breaking the build.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { qmiCardHtml } from './sections.mjs';
import { slugify } from './data.mjs';
import { rewriteCommon, freshBannerHtml } from './rewrite.mjs';

// Harvested live-site facts (see harvest-live-facts.mjs): community-page ticker
// slides + the /xhr/recommend responses our Caddy stub can't serve.
const FACTS = (() => {
  const p = join(import.meta.dirname, 'assets', 'live-facts.json');
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; } catch { return {}; }
})();
const RECOMMEND = {};
for (const [kind, raw] of Object.entries(FACTS.recommendHtml || {})) {
  // live URLs use real ?v= queries; the theme snapshot's files are literally named
  // "X.svg\uFE56v=hash" (HTTrack), so map the query into the filename form.
  RECOMMEND[kind] = rewriteCommon(raw).replace(/\/static\/([^"'?\s]+)\?v=(\w+)/g, '/static/$1%EF%B9%96v=$2');
}

// Community-scoped pages carry an extra ticker slide vs the sitewide default —
// swap the fresh default banner (rewriteCommon already replaced the frozen one)
// for the community-page slide set.
export function swapCommunityBanner(html, page) {
  const slides = FACTS.bannerSlidesCommunity;
  if (!slides || !slides.length) return html;
  if (!html.includes('class="alert-banner"')) return html; // page ships no ticker (matches its original)
  const re = /<div class="alert-banner">[\s\S]*?<!--\/fresh-banner-->/;
  if (!re.test(html)) { miss(page, 'community banner'); return html; }
  return html.replace(re, freshBannerHtml(slides));
}

// Recommended For You: the original fills .recommended-content via POST
// /xhr/recommend/ (kind from the page's own inline ajax call); our Caddy stubs
// /xhr/* empty. Bake the harvested response and strip the ajax so the stub's
// empty reply can't wipe it.
export function bakeRecommend(html, page) {
  const kindM = html.match(/data:\s*"m=(\w+)&/);
  const kind = kindM && (RECOMMEND[kindM[1]] ? kindM[1] : null);
  if (!kindM) return html; // page has no recommend section
  if (!kind) { miss(page, `recommend (no harvested ${kindM[1]})`); return html; }
  // The container may be empty (community pages) or carry the crawler-baked XHR
  // content (most plan/fp pages) — replace its balanced innerHTML either way.
  const openM = html.match(/<div class="recommended-content[^"]*"[^>]*>/);
  if (!openM) { miss(page, 'recommend container'); return html; }
  const start = openM.index + openM[0].length;
  let depth = 1, i = start;
  const tag = /<\/?div\b/g;
  tag.lastIndex = start;
  let m2;
  while (depth > 0 && (m2 = tag.exec(html))) { depth += m2[0][1] === '/' ? -1 : 1; i = m2.index; }
  if (depth !== 0) { miss(page, 'recommend container (unbalanced)'); return html; }
  html = html.slice(0, start) + RECOMMEND[kind] + html.slice(i);
  // strip the ajax so our /xhr/ stub's empty reply can't wipe the baked content
  html = html.replace(/<script>\s*\$\(function\(\)\{\s*\$\.ajax\(\{[\s\S]*?xhr\/recommend[\s\S]*?<\/script>/, '');
  return html;
}

const num = n => Number(n).toLocaleString('en-US');
const money = n => '$' + num(n);
const miss = (page, step) => console.warn(`hydrate: ${step} missed on ${page}`);

// Replace-or-warn: apply re once; warn (and keep html) when it doesn't match.
// (Match-test, not output-compare: the fresh value often equals the frozen one.)
function sub(html, re, fn, page, step) {
  if (!re.test(html)) { miss(page, step); return html; }
  return html.replace(re, fn);
}

// Community page (new-homes/tx/<city>/<slug>/<id>/):
// 1. hero "Starting at $X" -> c.priceFrom
// 2. Quick Move-Ins (<section id="specs">) cards -> current c.homes (section
//    removed entirely when 0 homes, matching the live original)
// 3. Available Floor Plans row prices -> per-community fp.communityPrices[c.name]
export function hydrateCommunity(html, c, d) {
  const page = `community ${c.slug}`;
  try {
    if (c.priceFrom) html = sub(html, /(Starting at \$)[\d,]+/, (_, a) => a + num(c.priceFrom), page, 'hero price');
  } catch (e) { miss(page, `hero price (${e.message})`); }

  try {
    const homes = c.homes || [];
    const secStart = html.indexOf('<section id="specs"');
    if (secStart === -1) {
      if (homes.length) miss(page, `qmi section (absent, ${homes.length} current homes)`);
    } else {
      const secEnd = html.indexOf('</section>', secStart) + '</section>'.length;
      if (!homes.length) {
        html = html.slice(0, secStart) + html.slice(secEnd);
      } else {
        const sec = html.slice(secStart, secEnd);
        const listOpen = '<div class="row oi-listings mt-3 g-2">';
        const li = sec.indexOf(listOpen);
        if (li === -1) miss(page, 'qmi listings container');
        else {
          // Everything after the listings open tag is cards + the three closes
          // (row / container-lg / section) — rebuild that tail with live cards.
          const cards = homes.map(h => qmiCardHtml(h)).join('\n');
          html = html.slice(0, secStart)
            + sec.slice(0, li + listOpen.length) + '\n' + cards + '\n</div>\n</div>\n</section>'
            + html.slice(secEnd);
        }
      }
    }
  } catch (e) { miss(page, `qmi cards (${e.message})`); }

  try {
    const priceBySlug = new Map((c.plans || []).map(fp => [fp.slug, fp.communityPrices[c.name]]));
    html = html.replace(/<div class="card plan-card"[\s\S]*?(?=<div class="card plan-card"|<\/section>)/g, seg => {
      const m = seg.match(/href="\.\.\/([^/]+)\/\d+\/index\.html"/);
      const price = m ? priceBySlug.get(m[1]) : undefined;
      if (price == null) return seg; // plan gone or unpriced here -> frozen price stays
      return seg
        .replace(/(class="card plan-card" data-price=")\d+/, (_, a) => a + Number(price))
        .replace(/(<div class="price">)\$[\d,]+(<\/div>)/g, (_, a, b) => a + money(price) + b);
    });
  } catch (e) { miss(page, `plan prices (${e.message})`); }
  return html;
}

// Floor-plan page (floorplans/<slug>/<id>/):
// 1. header "Available in N Communities Starting at $X" -> min over communityPrices
//    of the location cards RENDERED on the page (count N + card list stay frozen;
//    fp.startingPrice is a known dev-wide-MIN data bug and never used)
// 2. overview sidebar "PRICED FROM $X" -> same min
// 3. Available Locations cards "HOMES FROM $X" -> that community's price
export function hydrateFloorplan(html, fp, d) {
  const page = `floorplan ${fp.slug}`;
  // Card link slug -> price, keyed by slugified communityPrices name (works even
  // when the community itself is gone from /communities, e.g. Retama Village).
  const priceBySlug = new Map(Object.entries(fp.communityPrices || {}).map(([n, p]) => [slugify(n), p]));
  const cardRe = /<div class="card oi-map-item"[\s\S]*?(?=<div class="card oi-map-item"|<\/section>)/g;
  const priceOf = seg => {
    const m = seg.match(/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/index\.html/);
    return m ? priceBySlug.get(m[1]) : undefined;
  };
  // Min over the communities whose location cards are RENDERED on this page —
  // the live original's own min. An all-communityPrices min can pull in a
  // community with no card on the page (e.g. Agave/Silos), a visible deviation.
  const rendered = (html.match(cardRe) || []).map(priceOf).filter(p => p != null);
  if (!rendered.length) { miss(page, 'no rendered location card matches communityPrices (prices frozen)'); return html; }
  const min = Math.min(...rendered);
  try {
    html = sub(html, /(Starting at \$)[\d,]+/, (_, a) => a + num(min), page, 'header starting-at');
    html = sub(html, /(PRICED FROM<\/div>\s*<div class="overpass bold text-dark-green fs-4">)\$[\d,]+/,
      (_, a) => a + money(min), page, 'priced-from');
  } catch (e) { miss(page, `min price (${e.message})`); }

  try {
    // Card "HOMES FROM $X" shows the COMMUNITY's overall from-price on the
    // original (not this plan's price in that community).
    const commFromBySlug = new Map((d.communities || []).map(c => [c.slug, c.priceFrom]));
    html = html.replace(cardRe, seg => {
      const m = seg.match(/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/index\.html/);
      const price = m ? commFromBySlug.get(m[1]) : undefined;
      if (price == null) return seg; // community gone from API -> card stays frozen
      return seg.replace(/(<div class="price(?: mt-1)?">)\$[\d,]+(<\/div>)/g, (_, a, b) => a + money(price) + b);
    });
  } catch (e) { miss(page, `location cards (${e.message})`); }
  return html;
}

// ponytail self-check: fixture-sized pages, no network.
function demo() {
  const home = { address: '3706 Westway Court', community: 'Harvest Coves', city: 'McAllen', slug: '3706-westway-court', price: 289990, beds: 3, floorPlan: 'Indigo' };
  const c = {
    slug: 'harvest-coves', name: 'Harvest Coves', priceFrom: 250990, homes: [home],
    plans: [{ slug: 'indigo', communityPrices: { 'Harvest Coves': 249990 } }],
  };
  const page = '<h1>Harvest Coves</h1>Starting at $244,990'
    + '<section id="specs"><div class="container-lg"><div class="row">head</div>'
    + '<div class="row oi-listings mt-3 g-2"><div class="col-12">OLD CARD 9999 Stale St</div></div></div></section>'
    + '<section id="plans"><div class="card plan-card" data-price="244990"><div class="price"></div><div class="price">$244,990</div>'
    + '<a href="../indigo/231384/index.html">View Details</a></div></section><footer>f</footer>';
  let out = hydrateCommunity(page, c, {});
  assert(out.includes('Starting at $250,990'), 'hero price updated');
  assert(out.includes('3706 Westway Court') && !out.includes('9999 Stale St'), 'qmi cards replaced');
  assert(out.includes('data-price="249990"') && out.includes('<div class="price">$249,990</div>'), 'plan row price updated');
  assert(out.includes('<div class="price"></div>'), 'empty price div untouched');
  assert(out.includes('<footer>f</footer>'), 'chrome preserved');
  // 0 homes -> whole Quick Move-Ins section removed
  out = hydrateCommunity(page, { ...c, homes: [] }, {});
  assert(!out.includes('id="specs"') && out.includes('id="plans"'), 'empty community drops qmi section only');

  const fp = { slug: 'agave', communityPrices: { 'Aqualina at Tres Lagos': 451990, 'Silos at La Sienna': 396990 } };
  const d = { communities: [{ slug: 'aqualina-at-tres-lagos', name: 'Aqualina at Tres Lagos', priceFrom: 333990 }] };
  const fpage = '<a href="#mp-locations">Available in 2 Communities</a><div>Starting at $421,990</div>'
    + '<div class="overpass fs-7">PRICED FROM</div><div class="overpass bold text-dark-green fs-4">$421,990</div>'
    + '<section id="mp-locations"><div class="card oi-map-item"><a href="../../../new-homes/tx/mcallen/aqualina-at-tres-lagos/8658/index.html">x</a>'
    + '<div class="price">$419,990</div><div class="price mt-1">$419,990</div></div>'
    + '<div class="card oi-map-item"><a href="../../../new-homes/tx/laredo/gone-community/1/index.html">x</a><div class="price">$111,111</div></div></section>';
  const fout = hydrateFloorplan(fpage, fp, d);
  // min over RENDERED cards only: Silos ($396,990) has a communityPrice but no card
  assert(fout.includes('Starting at $451,990'), 'header min = rendered-cards min');
  assert(fout.includes('fs-4">$451,990'), 'priced-from = rendered-cards min');
  assert(!fout.includes('$396,990'), 'cardless communityPrice excluded from min');
  assert((fout.match(/\$451,990/g) || []).length === 2, 'header + priced-from use rendered min');
  assert((fout.match(/\$333,990/g) || []).length >= 1, 'card HOMES FROM = community priceFrom');
  assert(fout.includes('$111,111'), 'unknown community card stays frozen');
  // no card matches communityPrices -> everything stays frozen
  const frozen = hydrateFloorplan(fpage, { slug: 'x', communityPrices: { Nowhere: 1 } }, d);
  assert(frozen.includes('Starting at $421,990') && frozen.includes('$419,990'), 'no-match page fully frozen');
  assert(!fout.includes('undefined') && !fout.includes('$NaN'), 'no undefined/$NaN');
  console.log('hydrate-scraped.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
