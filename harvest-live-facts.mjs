#!/usr/bin/env node
// harvest-live-facts.mjs — snapshot per-card facts from the LIVE O'Neill site that
// aren't in our public API: mortgage rate, per-community tax multipliers (from each
// community's mortgage-calc config), and per-home promo badges (text + tan/green).
// Writes assets/live-facts.json (committed snapshot; re-run at rebuild time).
// No deps — global fetch only.  Usage: node harvest-live-facts.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORIGIN = 'https://www.esperanzahomes.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unent = s => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (live-facts harvest)' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

const avail = await getText(ORIGIN + '/new-homes/available/');

// One representative QMI detail-page URL per community slug (2nd path segment).
const detailRe = /\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/[^/]+\/\d+\//g;
const byCommunity = new Map();
for (const m of avail.matchAll(detailRe)) if (!byCommunity.has(m[1])) byCommunity.set(m[1], m[0]);

// Promo badges keyed by address slug (5th path segment), parsed from each listing
// card block. The banner sits above the card's first detail href in the block.
const badges = {};
// Lot-number display format per community — O'Neill shows some communities 3-digit
// zero-padded ("Lot #007") and others bare ("Lot #82"); our D1 stores 8-digit padded.
const lotFormat = {};
for (const block of avail.split('class="card spec-card').slice(1)) {
  const href = block.match(/\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\/([^/]+)\/\d+\//);
  const banner = block.match(/banner overlay-promo (tan|green)[^>]*>\s*([\s\S]*?)\s*</);
  if (href && banner && banner[2]) badges[href[2]] = { text: unent(banner[2]), color: banner[1] };
  const lot = block.match(/Lot #(\d+)/);
  if (href && lot) {
    const fmt = lot[1].length === 3 && lot[1][0] === '0' ? 'pad3' : 'bare';
    if (!(href[1] in lotFormat) || fmt === 'pad3') lotFormat[href[1]] = fmt;
  }
}

// Sequential detail-page fetches (origin throttles bursts); tolerate failures.
let rate = null;
const taxMult = {};
for (const [slug, path] of byCommunity) {
  try {
    const html = await getText(ORIGIN + path);
    const t = html.match(/\['taxmultiplier'\]\s*=\s*\{[\s\S]*?'default'\s*:\s*([\d.]+)/);
    if (t) taxMult[slug] = Number(t[1]);
    if (rate == null) {
      const rm = html.match(/'rate'\s*:\s*\{[\s\S]*?'default'\s*:\s*([\d.]+)/);
      if (rm) rate = Number(rm[1]);
    }
  } catch (e) {
    console.warn(`skip ${slug}: ${e.message}`);
  }
  await sleep(300);
}

// Current promo-ticker slides from the live homepage (the scrape's are frozen/stale).
// Unique slides only (swiper loop mode bakes duplicates); root-relative internal CTAs.
const bannerSlides = [];
try {
  const home = await getText(ORIGIN + '/');
  const wrap = home.match(/swiper-alert-banner[\s\S]*?swiper-alert-banner-button-prev/);
  if (wrap) {
    const seen = new Set();
    for (const sm of wrap[0].matchAll(/<div class="swiper-slide(?![^"]*duplicate)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
      const inner = sm[1];
      const p = inner.match(/<p>\s*([\s\S]*?)\s*<\/p>/);
      if (!p) continue;
      const text = unent(p[1]);
      if (seen.has(text)) continue;
      seen.add(text);
      const a = inner.match(/<a href="([^"]+)"[^>]*>\s*([\s\S]*?)\s*<\/a>/);
      let href = a ? unent(a[1]) : null;
      if (href && href.startsWith(ORIGIN)) href = href.slice(ORIGIN.length);
      bannerSlides.push({ text, ctaLabel: a ? unent(a[2]) : null, ctaHref: href });
    }
  }
} catch (e) { console.warn('banner harvest skipped: ' + e.message); }

// Per-community promo ribbon + incentive line from the live /new-homes/ cards
// (our API's promoBadgeText/promoBannerText are currently empty for all communities).
const communityPromos = {};
try {
  const nh = await getText(ORIGIN + '/new-homes/');
  for (const block of nh.split('oi-map-item').slice(1)) {
    const link = block.match(/href="\/new-homes\/tx\/[^/]+\/([^/]+)\/\d+\//);
    if (!link) continue;
    const ribbon = block.match(/banner (green|gray|tan)[^>]*>\s*([^<]+?)\s*</);
    const texts = [...block.matchAll(/>([^<]+)</g)].map(m => unent(m[1]).trim());
    const incentive = texts.find(t => /^(enjoy|receive)\b/i.test(t)) || null;
    communityPromos[link[1]] = {
      ribbon: ribbon ? { text: unent(ribbon[2]), color: ribbon[1] } : null,
      incentive,
    };
  }
} catch (e) { console.warn('community promos harvest skipped: ' + e.message); }

const out = { rate, taxMult, badges, lotFormat, bannerSlides, communityPromos };
const dst = join(import.meta.dirname, 'assets', 'live-facts.json');
writeFileSync(dst, JSON.stringify(out, null, 2) + '\n');
console.log(`live-facts.json: rate=${rate}, taxMult=${Object.keys(taxMult).length} communities, badges=${Object.keys(badges).length} homes, lotFormat=${Object.keys(lotFormat).length}, bannerSlides=${bannerSlides.length}, communityPromos=${Object.keys(communityPromos).length}`);
