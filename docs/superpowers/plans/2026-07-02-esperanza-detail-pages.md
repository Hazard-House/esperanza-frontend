# Esperanza 2.0 — Data-Driven Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate full-featured, current QMI / community / floor-plan detail pages from live D1 at build time, styled with the exact O'Neill design, with volatile fields (price/availability/promo) re-hydrated live on load.

**Architecture:** `build.mjs` still assembles the static base (theme + non-detail pages) from the local scrape. A new `generate-details.mjs` reads **committed HTML templates** + **live API data** and writes the detail pages into `public/`, so it can also run standalone in CI later for freshness. Renderers use cheerio to fill one template per page type. Small client islands handle only genuinely interactive bits (live price hydration, Fancybox gallery, payment calculator, Recommended-For-You, maps).

**Tech Stack:** Node 26 (ESM, no bundler, **no new deps** — renderers build HTML strings using the O'Neill CSS classes, the proven `detailHTML`/`cardHTML` island pattern), Caddy (host), Mapbox GL + Fancybox + our own payment calc (bundled O'Neill theme), Cloudflare D1/R2 behind the `esperanza-api` Worker.

## Global Constraints

- Repo: `esperanza-oneill-railway` (Hazard-House/esperanza-homes-2.0). Work on branch `staging`. **Never merge to main** — Matt merges from the Railway side after QA.
- `public/` is committed (Railway `COPY`s it; it does NOT run node). `node_modules/` MUST be gitignored; `public/` MUST NOT be gitignored.
- API base (build-time): `https://esperanza-api.round-base-ed8c.workers.dev/api/public`. Same-origin `/api/public` at runtime (Caddy proxies).
- Envelopes: `/qmi` → `{homes:[{id, fields:{...}}]}`; `/communities` → `{communities:[{...}]}` (flat); `/floorplans` → flat array-ish (handle `.floorplans`/`.floor_plans`/bare array); `/settings` → object.
- Images: absolute `https://img.hazardhouse.ai/...` from the API pass through; scrape-relative media still goes through `resolveMedia`. `img.hazardhouse.ai` ignores resize query params.
- `NOINDEX = true` stays until Matt's cutover (robots.txt Disallow + per-page noindex meta).
- Canonical URLs (fully derivable from our data — O'Neill's internal `cid`/`listing-id` are NOT in our records):
  - QMI: `/new-homes/tx/<citySlug>/<communitySlug>/<addressSlug>/`
  - Community: `/new-homes/tx/<citySlug>/<communitySlug>/`
  - Floor plan: confirmed in the floor-plan template task.
- Tests follow the existing pattern: assert-based `demo()` run via `node <file> --check` (no test framework). Commit after each green task.
- **Active checkout:** `staging` is being edited in parallel (e.g. commit 770a125 switched QMI/community maps to the bundled `STYLE_COMMON_URL = '/esperanza-common.json'`, added `communities-live.js`, and copies `esperanza-common.json` into `public/`). Detail maps therefore use `STYLE_COMMON_URL`, and `community-maps-live.js` reads it via `CFG.MAPBOX_STYLE_COMMON`. Before editing `build.mjs`/islands, `git pull`/re-read the current file — match against real content, not the line numbers quoted here.
- Footer/branding, media rewrites, oi-stub, robots gating in `rewriteCommon`/`injectIsland` are already correct — do not regress them (the `build.mjs --check` demo guards them).

---

## Task 1: Project tooling (package.json, no deps)

**Files:**
- Create: `package.json`
- Create/modify: `.gitignore`

**Interfaces:**
- Produces: `npm run build` (→ `node build.mjs`), `npm run generate` (→ `node generate-details.mjs`), `npm run check` (→ runs every module's `--check` demo).

- [ ] **Step 1: Create `package.json`** (no dependencies — pure Node ESM)

```json
{
  "name": "esperanza-oneill-railway",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs",
    "generate": "node generate-details.mjs",
    "check": "node build.mjs --check && node data.mjs --check && node paths.mjs --check && node sections.mjs --check && node render-qmi.mjs --check && node render-community.mjs --check && node render-floorplan.mjs --check && node islands/detail-extras.js --check"
  }
}
```

- [ ] **Step 2: Ensure `.gitignore` excludes node_modules but NOT public/**

Read `.gitignore` (create if absent). It MUST contain `node_modules/` and MUST NOT contain `public/` (Railway honors gitignore; a previous bug ignored `public/` and broke the deploy).

```
node_modules/
```

- [ ] **Step 3: Verify existing build still checks**

Run: `node build.mjs --check`
Expected: `demo() rewrite + shell checks passed`

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "tooling: package.json (ESM, no deps)"
```

---

## Task 2: `data.mjs` — fetch, normalize, cross-link

**Files:**
- Create: `data.mjs`

**Interfaces:**
- Consumes: the public API (build-time base URL).
- Produces:
  - `export function slugify(s): string`
  - `export async function loadData(): Promise<{ qmis, communities, floorplans, settings, commById, commByName, fpById }>`
  - Normalized QMI: `{ id, price, beds, baths, halfBaths, stories, garage, livingSqft, totalSqft, community, communityId, floorPlan, floorPlanId, collection, slug, city, address, image, gallery:[{url,alt}], fpImage, fpDescription, planViewerUrl, virtualTourUrl, elevation, availability, availableNow, moveInDate, description, promo, pdfUrl, lat, lng, communityObj, floorplanObj }`
  - Normalized community: `{ id, name, slug, city, lat, lng, address, image, secondaryImage, priceFrom, sqft, beds, baths, description, amenities, promo, officePhone, officeHours, scheduleVisit, homes:[qmi], plans:[floorplan] }`
  - Normalized floorplan: `{ id, name, slug, collection, startingPrice, communityPrices:{name:price}, bedroomMin, bedroomMax, bathroomMin, bathroomMax, garage, stories, livingSqft, totalSqft, masterBed, hersScore, communities, image, description, planViewerUrl, virtualTourUrl, brochurePdfUrl, promo, homes:[qmi], communityList:[community] }`
  - `loadData()` THROWS if any of qmi/communities/floorplans is empty (build-fail guard).

- [ ] **Step 1: Write the failing check**

Add to `data.mjs` a `demo()` that does a live load and asserts shape, guarded by `--check`:

```js
async function demo() {
  const d = await loadData();
  console.assert(d.qmis.length > 50, 'qmis loaded');
  console.assert(d.communities.length > 10, 'communities loaded');
  console.assert(d.floorplans.length > 20, 'floorplans loaded');
  const withComm = d.qmis.find(h => h.communityObj);
  console.assert(withComm, 'at least one QMI cross-links to a community');
  const withPlans = d.communities.find(c => c.plans.length);
  console.assert(withPlans, 'at least one community cross-links to floor plans');
  console.assert(typeof slugify('El Edén!') === 'string' && slugify('El Eden') === 'el-eden', 'slugify');
  console.log('data.mjs demo() passed:', d.qmis.length, 'qmi', d.communities.length, 'comm', d.floorplans.length, 'fp');
}
if (process.argv.includes('--check')) demo();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node data.mjs --check`
Expected: FAIL — `loadData is not defined` / module has no such export.

- [ ] **Step 3: Implement `data.mjs`**

```js
// data.mjs — fetch the public API once, normalize, cross-link. Build-time only.
// Reads only the API (no scrape dependency) so it can also run in CI for freshness.
const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';

const un = v => (Array.isArray(v) ? v[0] : v);
const fixHost = u => (u ? String(u).replace(/^https:\/\/pub-9c9bfee574a54b62b2623e361b3ad305\.r2\.dev/, 'https://img.hazardhouse.ai') : u);
export const slugify = s => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function getJSON(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

function normQmi(h) {
  const f = h.fields || h;
  const fp = un(f['FP: Image']);
  let gallery = [];
  const g = f.photo_gallery; // exposed by the esperanza-cf PR (Task 11); absent until then
  if (Array.isArray(g)) gallery = g.map(x => ({ url: fixHost(x.url || x), alt: x.alt || '' }));
  return {
    id: h.id, price: f.Price,
    beds: f.bedroom_count, baths: f.bathroom_count, halfBaths: f.half_bathroom_count,
    stories: f.stories_count, garage: un(f['FP: Garage']),
    livingSqft: f.living_square_footage, totalSqft: f.total_square_footage,
    community: f.Community, communityId: un(f['Community (Link)']),
    floorPlan: f['Floor Plan'], floorPlanId: un(f['Floor Plan (Link)']),
    collection: un(f['FP: Collection']),
    slug: f.slug, city: f.City, address: f.address,
    image: fixHost(f.image_url), gallery,
    fpImage: fp ? fixHost(fp.url || fp) : null, fpDescription: f['FP: Description'],
    planViewerUrl: f['FP: Plan Viewer'], virtualTourUrl: f['FP: Virtual Tour'],
    elevation: f.elevation,
    availability: f.availability_text, availableNow: f['Available Now'], moveInDate: f['Move-In Date'],
    description: f.Description, promo: f.promo_text, pdfUrl: f['Dynamic PDF'],
    lat: f.latitude != null ? Number(f.latitude) : (f.geo_latitude != null ? Number(f.geo_latitude) : null),
    lng: f.longitude != null ? Number(f.longitude) : (f.geo_longitude != null ? Number(f.geo_longitude) : null),
  };
}

function normCommunity(c) {
  const p = c.coordinates ? String(c.coordinates).split(',') : [];
  return {
    id: c.id, name: c.name, slug: c.slug, city: c.town,
    lat: p[0] != null && p[0] !== '' ? Number(p[0]) : null,
    lng: p[1] != null && p[1] !== '' ? Number(p[1]) : null,
    address: c.address, image: c.image, secondaryImage: c.secondaryImage,
    priceFrom: c.priceFrom, sqft: c.sqft, beds: c.beds, baths: c.baths,
    description: c.description, amenities: c.amenities, promo: c.promoBannerText,
    officePhone: c.officePhone, officeHours: c.officeHours, scheduleVisit: c.scheduleVisit,
  };
}

function normFloorplan(fp) {
  return {
    id: fp.id, name: fp.name, slug: fp.slug, collection: fp.collection,
    startingPrice: fp.startingPrice, communityPrices: fp.communityPrices || {},
    bedroomMin: fp.bedroomMin, bedroomMax: fp.bedroomMax, bathroomMin: fp.bathroomMin, bathroomMax: fp.bathroomMax,
    garage: fp.carGarageCount, stories: fp.storiesCount,
    livingSqft: fp.livingSquareFootage, totalSqft: fp.totalSquareFootage,
    masterBed: fp.masterBedLocation, hersScore: fp.hersScore, communities: fp.communities,
    image: fp.image, description: fp.description,
    planViewerUrl: fp.planViewerUrl, virtualTourUrl: fp.virtualTourUrl, brochurePdfUrl: fp.brochurePdfUrl,
    promo: fp.promoBannerText,
  };
}

export async function loadData() {
  const [q, c, f, s] = await Promise.all([
    getJSON('/qmi'), getJSON('/communities'), getJSON('/floorplans'), getJSON('/settings').catch(() => ({})),
  ]);
  const qmis = (q.homes || []).map(normQmi);
  const communities = (c.communities || []).map(normCommunity);
  const fpRaw = f.floorplans || f.floor_plans || (Array.isArray(f) ? f : []);
  const floorplans = fpRaw.map(normFloorplan);
  if (!qmis.length || !communities.length || !floorplans.length) {
    throw new Error(`empty API payload: qmi=${qmis.length} comm=${communities.length} fp=${floorplans.length} — refusing to build`);
  }
  const commById = new Map(communities.map(x => [x.id, x]));
  const commByName = new Map(communities.map(x => [String(x.name).toLowerCase(), x]));
  const fpById = new Map(floorplans.map(x => [x.id, x]));
  for (const h of qmis) { h.communityObj = commById.get(h.communityId) || null; h.floorplanObj = fpById.get(h.floorPlanId) || null; }
  for (const cm of communities) {
    cm.homes = qmis.filter(h => h.communityId === cm.id);
    cm.plans = floorplans.filter(fp => fp.communityPrices[cm.name] != null || String(fp.communities || '').toLowerCase().includes(String(cm.name).toLowerCase()));
  }
  for (const fp of floorplans) {
    fp.homes = qmis.filter(h => h.floorPlanId === fp.id);
    fp.communityList = Object.keys(fp.communityPrices).map(n => commByName.get(n.toLowerCase())).filter(Boolean);
  }
  return { qmis, communities, floorplans, settings: s, commById, commByName, fpById };
}
```

(Append the `demo()` block from Step 1.)

- [ ] **Step 4: Run to verify it passes**

Run: `node data.mjs --check`
Expected: PASS — prints counts (e.g. `108 qmi 32 comm 60 fp`).

- [ ] **Step 5: Commit**

```bash
git add data.mjs
git commit -m "data: fetch+normalize+cross-link public API (build-fail guard on empty)"
```

---

## Task 3: `paths.mjs` — canonical URLs + qmi-links map

**Files:**
- Create: `paths.mjs`

**Interfaces:**
- Consumes: `slugify` from `data.mjs`; normalized records.
- Produces:
  - `export function qmiPath(h): string` → `/new-homes/tx/<citySlug>/<communitySlug>/<addressSlug>/` (uses `h.communityObj?.city` when present, else `h.city`; `h.communityObj?.slug` else `slugify(h.community)`; `h.slug`).
  - `export function communityPath(c): string` → `/new-homes/tx/<citySlug>/<communitySlug>/`.
  - `export function floorplanPath(fp): string` → `/floorplans/<slug>/`.
  - `export function linksMap(qmis, communities): {qmi:{}, community:{}}` — keyed to match `available-live.js` `homeUrl()` (QMI key `slugify(community)/slug`, community key `slugify(community)`), values = canonical URLs. Written to `public/qmi-links.json` by the generator.

- [ ] **Step 1: Write the failing check**

```js
function demo() {
  const c = { name: 'El Eden', slug: 'el-eden', city: 'Laredo' };
  const h = { community: 'El Eden', slug: '5131-carambola-ln', city: 'Laredo', communityObj: c };
  console.assert(qmiPath(h) === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', qmiPath(h));
  console.assert(communityPath(c) === '/new-homes/tx/laredo/el-eden/', communityPath(c));
  const m = linksMap([h], [c]);
  console.assert(m.qmi['el-eden/5131-carambola-ln'] === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', 'qmi link');
  console.assert(m.community['el-eden'] === '/new-homes/tx/laredo/el-eden/', 'community link');
  console.log('paths.mjs demo() passed');
}
if (process.argv.includes('--check')) demo();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node paths.mjs --check`
Expected: FAIL — `qmiPath is not defined`.

- [ ] **Step 3: Implement `paths.mjs`**

```js
// paths.mjs — canonical detail-page URLs, derived entirely from our data.
import { slugify } from './data.mjs';

const citySlug = h => slugify((h.communityObj && h.communityObj.city) || h.city || '');
const commSlug = h => (h.communityObj && h.communityObj.slug) || slugify(h.community || '');

export function qmiPath(h) {
  return `/new-homes/tx/${citySlug(h)}/${commSlug(h)}/${slugify(h.slug || h.address)}/`;
}
export function communityPath(c) {
  return `/new-homes/tx/${slugify(c.city)}/${c.slug || slugify(c.name)}/`;
}
export function floorplanPath(fp) {
  return `/floorplans/${fp.slug || slugify(fp.name)}/`;
}
export function linksMap(qmis, communities) {
  const qmi = {}, community = {};
  for (const h of qmis) qmi[`${slugify(h.community)}/${h.slug || ''}`] = qmiPath(h);
  for (const c of communities) community[slugify(c.name)] = communityPath(c);
  return { qmi, community };
}
```

Also add to the demo: `console.assert(floorplanPath({slug:'agave'}) === '/floorplans/agave/', 'fp path');`

- [ ] **Step 4: Run to verify it passes**

Run: `node paths.mjs --check`
Expected: PASS — `paths.mjs demo() passed`.

- [ ] **Step 5: Commit**

```bash
git add paths.mjs
git commit -m "paths: canonical detail URLs + links map"
```

---

## Task 4: `islands/hydrate-live.js` — live price/availability/promo

**Files:**
- Create: `islands/hydrate-live.js`

**Interfaces:**
- Consumes: same-origin `/api/public/qmi`; a per-page marker `window.__ESPERANZA_PAGE = { type:'qmi'|'community', id:'<recid>' }` baked into each generated detail page (added in the renderer tasks).
- Produces: updates in-DOM elements tagged `[data-live="price"]`, `[data-live="availability"]`, `[data-live="promo"]` with the current value from the API. No-op when the page has no `__ESPERANZA_PAGE`.

- [ ] **Step 1: Implement the island** (browser islands follow the existing no-unit-test pattern; the runnable check is the post-build smoke test in Task 9)

```js
/* hydrate-live.js — refresh the volatile fields (price/availability/promo) on a
 * generated detail page so they are never stale between rebuilds. The page bakes
 * window.__ESPERANZA_PAGE = {type,id}; we re-fetch the record and patch the DOM. */
(function () {
  'use strict';
  var P = window.__ESPERANZA_PAGE;
  if (!P || !P.id) return;
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  function set(sel, val) {
    document.querySelectorAll('[data-live="' + sel + '"]').forEach(function (el) {
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    });
  }
  if (P.type !== 'qmi') return; // community/floorplan volatiles added later if needed
  fetch(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
    var raw = (res.homes || []).filter(function (h) { return h.id === P.id; })[0];
    if (!raw) return;
    var f = raw.fields || raw;
    set('price', money(f.Price));
    set('availability', f.availability_text);
    set('promo', f.promo_text);
  }).catch(function () {});
})();
```

- [ ] **Step 2: Commit**

```bash
git add islands/hydrate-live.js
git commit -m "island: hydrate-live — live price/availability/promo on detail pages"
```

---

## Task 5: `rewrite.mjs` — extract shared rewrites from build.mjs

**Files:**
- Create: `rewrite.mjs`
- Modify: `build.mjs` (import from rewrite.mjs; delete the moved definitions)

**Interfaces:**
- Produces: `rewriteCommon`, `injectIsland`, `disableOilib`, `resolveMedia`, `extractShell`, and consts `API_BASE, MAPBOX_TOKEN, STYLE_HOME, PUBLIC_STYLE, NOINDEX`.
- Consumed by: `build.mjs` (static base), `sections.mjs` + `generate-details.mjs` (detail pages).

- [ ] **Step 1: Create `rewrite.mjs`** (moves build.mjs lines 21–33 and 68–156 verbatim, adds `disableOilib` + `extractShell`)

```js
// rewrite.mjs — shared URL/theme rewrites + shell helpers. Extracted from build.mjs
// so the static-base build AND the data-driven detail generator share one source.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
    .replace(/pk\.eyJ1Ijoib25la[A-Za-z0-9._-]*/g, MAPBOX_TOKEN)
    .replace(/mapbox:\/\/styles\/oneilinteractive\/[A-Za-z0-9]+/g, PUBLIC_STYLE)
    .replace(/<div class="col-12 oneilinteractive-attribution[^>]*>[\s\S]*?<\/div>/,
      '<div class="col-12 oneilinteractive-attribution text-center text-white fs-9 mb-2"><a href="https://hazardhouse.ai" rel="noopener" target="_blank" class="text-small text-white">Powered by Hazard House</a></div>');
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
  console.log('rewrite.mjs demo() passed');
}
if (process.argv.includes('--check') && import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 2: Refactor `build.mjs` to import from `rewrite.mjs`**

Add near the top of `build.mjs` (after the existing `node:` imports):

```js
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, PUBLIC_STYLE, NOINDEX, rewriteCommon, injectIsland } from './rewrite.mjs';
```

Then DELETE from `build.mjs` (now living in rewrite.mjs): the config-const block (the `MAPBOX_TOKEN`, `STYLE_HOME`, `STYLE_COMMON_URL`, `PUBLIC_STYLE`, `API_BASE`, `NOINDEX` declarations near the top) and the block containing `IMG_EXT`, `stripExt`, `loadKeyMap`, `ESP_KEYS`, `HF_KEYS`, `resolveMedia`, `rewriteCommon`, `injectIsland`. KEEP everything in between (`ALWAYS`/`LIVE_PAGES`/`SHELL`/`CONTAINER_ISLANDS`/`EXTRA_SCRIPTS`/`shipList`) and after (`buildShellHtml`, `writeLinksMap`, `build`, `demo`). NOTE: `build.mjs` was edited concurrently (commit 770a125 added `STYLE_COMMON_URL`, a `communities-live.js` island, and copies `esperanza-common.json` to `public/`) — match against the CURRENT file, not fixed line numbers. `buildShellHtml`/`build`/`demo` keep working because `rewriteCommon`/`injectIsland` are imported; the `esperanza-common.json` copy step in `build.mjs` stays.

- [ ] **Step 3: Verify both check**

Run: `node rewrite.mjs --check && node build.mjs --check`
Expected: `rewrite.mjs demo() passed` then `demo() rewrite + shell checks passed`.

- [ ] **Step 4: Commit**

```bash
git add rewrite.mjs build.mjs
git commit -m "refactor: extract shared rewrites to rewrite.mjs (+ disableOilib, extractShell)"
```

---

## Task 6: `templates/detail-shell.html` — the committed chrome shell

**Files:**
- Create: `extract-shell.mjs`
- Create (generated, committed): `templates/detail-shell.html`

**Interfaces:**
- Produces: a committed shell (rewritten nav/head/footer/modals with a `<!--CONTENT-->` marker) so `generate-details.mjs` needs no scrape at runtime.

- [ ] **Step 1: Create `extract-shell.mjs`**

```js
// extract-shell.mjs — one-shot: turn a scraped QMI detail page into the committed
// chrome shell used by every generated detail page. Re-run if the site chrome changes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractShell } from './rewrite.mjs';

const SCRAPE = '/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08/www.esperanzahomes.com';
const SRC = join(SCRAPE, 'new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html');
const OUT = join(import.meta.dirname, 'templates', 'detail-shell.html');

mkdirSync(join(import.meta.dirname, 'templates'), { recursive: true });
const shell = extractShell(readFileSync(SRC, 'utf8'));
if (!shell.includes('<!--CONTENT-->')) throw new Error('extractShell did not produce a content marker');
if (!/<footer/.test(shell)) throw new Error('shell lost its footer');
writeFileSync(OUT, shell);
console.log(`wrote ${OUT} (${shell.length} bytes)`);
```

- [ ] **Step 2: Run it**

Run: `node extract-shell.mjs`
Expected: `wrote .../templates/detail-shell.html`. Inspect: the file has `<!--CONTENT-->` between the nav and the `<footer>`, no home-specific `<section class="header">` content, and the theme CSS/JS `<link>`/`<script>` in `<head>`.

- [ ] **Step 3: Commit** (the template is committed so CI/freshness runs need no scrape)

```bash
git add extract-shell.mjs templates/detail-shell.html
git commit -m "template: committed detail chrome shell (nav/head/footer/modals + CONTENT marker)"
```

---

## Task 7: `sections.mjs` — shared section builders

**Files:**
- Create: `sections.mjs`

**Interfaces:**
- Consumes: `qmiPath`, `communityPath`, `floorplanPath` (paths.mjs); consts + `disableOilib` (rewrite.mjs).
- Produces: `esc, money, num, ICON, statItem, descHtml, bannerHtml, galleryHtml, subnavHtml, tourHtml, elevationHtml, idaproPlanHtml, communityBlurbHtml, mapSalesHtml, formSlotHtml, recommendedHtml, qmiCardHtml, planCardHtml, setHead, finalizePage`.

- [ ] **Step 1: Get the exact stat-icon paths** (fills `ICON`, incl. `garage`, without guessing hashes)

Run:
```bash
grep -oE 'stats/[a-z]+%EF%B9%96v=[a-z0-9]+\.svg' "/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08/www.esperanzahomes.com/new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html" | sort -u
```
Expected: one line each for `bedroom`, `bathroom`, `garage`, `stairs`, `sqft`, `livingsqft`, `lot`. Use these exact strings for the `ICON` map below (the bed/bath/story/living/total values already match `available-live.js`; substitute the real `garage` filename).

- [ ] **Step 2: Write the failing check**

```js
function demo() {
  console.assert(esc('a<b>&"') === 'a&lt;b&gt;&amp;&quot;', 'esc');
  console.assert(money(236990) === '$236,990', 'money');
  const g = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  console.assert(g.includes('id="detail-gallery"') && g.includes('data-fancybox="photos"') && g.includes('View 2 Photos'), 'gallery');
  const d = descHtml('Highlights:\n- Big yard\n- New roof');
  console.assert(d.includes('<ul>') && d.includes('<li>Big yard</li>'), 'desc bullets -> ul');
  const head = setHead('<head><title>x</title><link rel="canonical" href="y"></head>', { title: 'T', canonical: '/c/', url: '/c/', description: 'D' });
  console.assert(head.includes('<title>T</title>') && head.includes('href="/c/"'), 'setHead');
  const page = finalizePage('<head></head><body><!--CONTENT--></body>', { content: '<p>hi</p>', head: { title: 'T', canonical: '/c/', url: '/c/' }, page: { type: 'qmi', id: 'rec1' }, islands: ['detail-extras.js'] });
  console.assert(page.includes('<p>hi</p>') && page.includes('__ESPERANZA_PAGE') && page.includes('detail-extras.js'), 'finalizePage');
  console.log('sections.mjs demo() passed');
}
if (process.argv.includes('--check') && import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 3: Run to verify it fails**

Run: `node sections.mjs --check`
Expected: FAIL — `esc is not defined`.

- [ ] **Step 4: Implement `sections.mjs`**

```js
// sections.mjs — shared HTML section builders for the detail-page renderers.
import { qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, disableOilib } from './rewrite.mjs';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = n => '$' + Number(n || 0).toLocaleString('en-US');
export const num = n => Number(n || 0).toLocaleString('en-US');

const STAT = '/static/esperanza_homes/images/stats/';
// Values verified in available-live.js; `garage` filled from Task 7 Step 1.
export const ICON = {
  bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
  bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
  story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
  living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
  total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  garage: STAT + 'garage%EF%B9%96v=REPLACE_FROM_STEP1.svg',
};

export function statItem(icon, txt) {
  return `<div class="item detail pb-4 col-12 col-lg-6"><img class="me-2" src="${icon}" aria-hidden="true" width="24">${txt}</div>`;
}

export function descHtml(raw) {
  if (!raw) return '';
  if (/<\w+[\s>]/.test(raw)) return `<div class="wysiwyg pt-2 pt-lg-4">${raw}</div>`;
  let out = '', inList = false;
  for (const ln of String(raw).split(/\r?\n/)) {
    const t = ln.trim();
    if (/^[-•]\s+/.test(t)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${esc(t.replace(/^[-•]\s+/, ''))}</li>`; }
    else { if (inList) { out += '</ul>'; inList = false; } if (t) out += `<p>${esc(t)}</p>`; }
  }
  if (inList) out += '</ul>';
  return `<div class="wysiwyg pt-2 pt-lg-4">${out}</div>`;
}

export function bannerHtml(availability, promo) {
  let s = '';
  if (promo) s += `<div class="status-banner overlay-promo mt-2 align-top tan" data-live="promo">${esc(promo)}</div>`;
  if (availability) s += `<div class="status-banner gray mt-2 align-top" data-live="availability">${esc(availability)}</div>`;
  return s;
}

export function galleryHtml(gallery, fallback, address) {
  const imgs = (gallery && gallery.length) ? gallery : (fallback ? [{ url: fallback, alt: address }] : []);
  if (!imgs.length) return '';
  const alt = esc(address || ''), hero = imgs[0];
  const heroCol = imgs.length > 1 ? 'col-12 col-lg-8' : 'col-12';
  const mosaic = `<div class="${heroCol} d-flex align-items-stretch p-0 pe-lg-2-5"><div class="oi-aspect three-two"><img src="${esc(hero.url)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div>`
    + `<div class="photo-overlay"><a href="#" class="open-gallery btn card-button" data-fancybox-trigger="photos">View ${imgs.length} Photos</a></div></div>`;
  const side = imgs.length > 1 ? `<div class="col-12 col-lg-4 d-none d-lg-flex flex-column p-0">`
    + imgs.slice(1, 3).map(g => `<div class="oi-aspect sixteen-nine mb-2"><img src="${esc(g.url)}" class="oi-aspect-img" loading="lazy" alt="${alt}"></div>`).join('')
    + `</div>` : '';
  const hidden = `<div class="d-none">` + imgs.map(g => `<a href="${esc(g.url)}" data-fancybox="photos" data-caption="${esc(g.alt || '')}"><img src="${esc(g.url)}" alt="${esc(g.alt || alt)}"></a>`).join('') + `</div>`;
  return `<div id="detail-gallery" class="container-fluid p-0"><div class="row m-0">${mosaic}${side}</div>${hidden}</div>`;
}

export function subnavHtml(anchors) {
  if (!anchors.length) return '';
  const links = anchors.map(a => a[0] === 'photos'
    ? `<a class="col-auto text-center py-2 px-3" href="#" data-fancybox-trigger="photos">${esc(a[1])}</a>`
    : `<a class="col-auto text-center py-2 px-3" href="#${a[0]}">${esc(a[1])}</a>`).join('');
  return `<div class="subnav bg-white border-bottom sticky-top"><div class="container"><div id="desktop-menu" class="row subnav justify-content-center">${links}</div></div></div>`;
}

export function tourHtml(url) {
  if (!url) return '';
  return `<section id="virtualtour" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Virtual Tour</h2><div class="oi-aspect sixteen-nine oi-matterport"><iframe class="oi-video-iframe" src="${esc(url)}" frameborder="0" allowfullscreen allow="xr-spatial-tracking" style="width:100%;height:100%"></iframe></div></div></section>`;
}

export function elevationHtml(label, image) {
  if (!image) return '';
  return `<section id="elevations" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Elevations</h2><div class="row oi-listings justify-content-center"><div class="col-12 col-md-6"><a data-fancybox="elevations" data-caption="${esc(label || '')}" href="${esc(image)}"><div class="oi-aspect three-two">${label ? `<div class="banner dark-green">${esc(label)}</div>` : ''}<img src="${esc(image)}" class="oi-aspect-img" alt="${esc(label || 'elevation')}"></div></a></div></div></div></section>`;
}

export function idaproPlanHtml(url, image, name, desc) {
  const body = url
    ? `<div class="text-center mb-3"><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Launch Interactive Floor Plan</a></div><iframe src="${esc(url)}" name="modelframe" frameborder="0" style="width:100%;height:600px"></iframe>`
    : (image ? `<div class="oi-aspect three-two"><img src="${esc(image)}" class="oi-aspect-img" alt="${esc(name || '')} floor plan"></div>` : '');
  if (!body) return '';
  return `<section id="plans" class="pagejump floor-plan py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Floor Plan</h2>${body}${desc ? `<div class="wysiwyg mt-4">${esc(desc)}</div>` : ''}</div></section>`;
}

export function communityBlurbHtml(c) {
  if (!(c && (c.description || c.image))) return '';
  const bg = c.image ? ` style="background-image:url(${esc(c.image)})"` : '';
  return `<section id="community" class="pagejump bg-photo-block"${bg}><div class="container"><div class="photo-block-info"><h2 class="bodoni text-white fs-2">About the Community</h2>${c.description ? `<div class="mt-4 text-white fs-7 lh-lg wysiwyg">${c.description}</div>` : ''}<a class="btn btn-white mt-3" href="${communityPath(c)}">Learn More About ${esc(c.name)}</a></div></div></section>`;
}

export function mapSalesHtml(c) {
  if (!(c && c.lat && c.lng)) return '';
  const tel = c.officePhone ? `<a class="oi-click-to-call d-block text-green" href="tel:${esc(String(c.officePhone).replace(/[^0-9+]/g, ''))}">${esc(c.officePhone)}</a>` : '';
  const hours = c.officeHours ? `<div class="fs-9 text-gray mt-1">${esc(c.officeHours)}</div>` : '';
  return `<section id="sales" class="pagejump py-4 py-lg-5"><div class="container"><div class="row"><div class="col-12 col-lg-7 mb-3"><div id="map" style="height:420px" data-latitude="${c.lat}" data-longitude="${c.lng}" data-zoom="13" data-vendor="mapbox"></div></div><div class="col-12 col-lg-5"><h2 class="bodoni text-gray fs-3">Visit Us</h2>${c.address ? `<address class="mt-3">${esc(c.address)}<br>${esc(c.city)}, TX</address>` : ''}${tel}${hours}<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-green mt-3 oi-directions-click">Get Directions</a></div></div></div></section>`;
}

export function formSlotHtml(kind, ctx) {
  return `<section id="request-a-tour" class="pagejump py-4 py-lg-5"><div class="container"><div class="row justify-content-center"><div class="col-12 col-lg-8 text-center"><h2 class="bodoni text-gray fs-3 mb-3">Request a Tour</h2><div class="hs-form-slot" data-form="${esc(kind)}" data-context="${esc(ctx || '')}"><p class="text-gray">Contact us or <a href="#offcanvas-contact" data-bs-toggle="offcanvas">request information</a>.</p></div></div></div></div></section>`;
}

export function recommendedHtml() {
  return `<section class="py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Recommended For You</h2><div class="recommended-content row oi-listings" id="recommended"></div></div></section>`;
}

function banners(availability, promo) {
  let s = '';
  if (promo) s += `<div class="banner overlay-promo green">${esc(promo)}</div>`;
  if (availability) s += `<div class="banner gray"${promo ? ' style="top:2.5rem"' : ''}>${esc(availability)}</div>`;
  return s;
}

export function qmiCardHtml(h) {
  const url = qmiPath(h);
  const specs = [h.beds != null ? esc(h.beds) + ' bd' : '', h.baths != null ? Number(h.baths).toFixed(1) + ' ba' : '', h.livingSqft != null ? num(h.livingSqft) + ' sq ft' : ''].filter(Boolean).join(' · ');
  return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card spec-card spec-card-detail border border-gray p-2">${h.image ? `<a href="${esc(url)}"><div class="oi-aspect sixteen-nine">${banners(h.availability, h.promo)}<img src="${esc(h.image)}" class="oi-aspect-img" loading="lazy" alt="${esc(h.address)}"></div></a>` : ''}<div class="card-body"><a href="${esc(url)}"><div class="card-title lh-1 mt-2">${esc(h.address)}</div></a><div class="card-location text-green mb-2">${esc(h.city)}, TX</div><div class="spec-price">${money(h.price)}</div><div class="fs-9 text-gray mt-1">${specs}</div></div></div></div>`;
}

export function planCardHtml(fp) {
  const url = floorplanPath(fp);
  const beds = fp.bedroomMin === fp.bedroomMax ? fp.bedroomMin : `${fp.bedroomMin}-${fp.bedroomMax}`;
  const baths = fp.bathroomMin === fp.bathroomMax ? fp.bathroomMin : `${fp.bathroomMin}-${fp.bathroomMax}`;
  const specs = [`${beds} bd`, `${baths} ba`, fp.garage ? `${fp.garage} gar` : '', fp.livingSqft ? num(fp.livingSqft) + ' sq ft' : ''].filter(Boolean).join(' · ');
  return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card plan-card border border-gray p-2">${fp.image ? `<a href="${esc(url)}"><div class="oi-aspect three-two"><img src="${esc(fp.image)}" class="oi-aspect-img" loading="lazy" alt="${esc(fp.name)}"></div></a>` : ''}<div class="card-body"><a href="${esc(url)}"><div class="card-title mt-2"><span class="fs-4">${esc(fp.name)}</span></div></a>${fp.collection ? `<div class="text-brown fs-9">${esc(fp.collection)} Collection</div>` : ''}${fp.startingPrice ? `<div class="price-title">From</div><div class="price">${money(fp.startingPrice)}</div>` : ''}<div class="fs-9 text-gray mt-1">${specs}</div><a href="${esc(url)}" class="btn btn-green mt-2 d-inline-block">View Details</a></div></div></div>`;
}

export function setHead(html, m) {
  const rep = (re, val) => { if (re.test(html)) html = html.replace(re, val); };
  rep(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);
  rep(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(m.description || '')}">`);
  rep(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(m.canonical || '')}">`);
  rep(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(m.title)}">`);
  rep(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(m.description || '')}">`);
  rep(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(m.url || '')}">`);
  if (m.image) {
    rep(/<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${esc(m.image)}">`);
    rep(/<meta name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${esc(m.image)}">`);
  }
  return html;
}

export function finalizePage(shell, { content, head, page, islands }) {
  let html = setHead(shell, head);
  html = html.replace('<!--CONTENT-->', content);
  html = disableOilib(html);
  const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: STYLE_COMMON_URL, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_COMMON: STYLE_COMMON_URL };
  const scripts = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};window.__ESPERANZA_PAGE=${JSON.stringify(page)};</script>\n`
    + islands.map(f => `<script src="/${f}" defer></script>`).join('\n') + '\n';
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + scripts : html.slice(0, i) + scripts + html.slice(i);
}
```

(Append the `demo()` from Step 2.)

- [ ] **Step 5: Run to verify it passes**

Run: `node sections.mjs --check`
Expected: PASS — `sections.mjs demo() passed`.

- [ ] **Step 6: Commit**

```bash
git add sections.mjs
git commit -m "sections: shared detail-page section builders + finalizePage"
```

---

## Task 8: `render-qmi.mjs`

**Files:**
- Create: `render-qmi.mjs`

**Interfaces:**
- Consumes: normalized QMI (with `communityObj`), `sections.mjs`, `qmiPath`.
- Produces: `export function qmiContent(h): string`, `export function renderQmi(h, shell): string`.

- [ ] **Step 1: Write the failing check**

```js
function demo() {
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, description: '<p>Nice</p>', image: '/c.jpg', officePhone: '956-395-1516', officeHours: 'Mon-Sat 9-6' };
  const h = { id: 'recH', address: '5131 Carambola Ln', community: 'El Eden', city: 'Laredo', slug: '5131-carambola-ln', price: 236990, beds: 3, baths: 2, garage: 2, stories: 1, livingSqft: 1106, totalSqft: 1471, description: 'Highlights:\n- Big yard', gallery: [{ url: '/1.jpg', alt: '' }], image: '/1.jpg', virtualTourUrl: 'https://my.matterport.com/show/?m=x', planViewerUrl: 'https://idapro.cloud/flr_pln/presidio', fpImage: '/fp.jpg', elevation: 'Presidio - Tuscan', pdfUrl: 'https://pdf/x', availability: 'Available Now', promo: '', communityObj: c };
  const out = qmiContent(h);
  for (const id of ['id="detail-gallery"', 'id="overview"', 'id="virtualtour"', 'id="plans"', 'id="community"', 'id="sales"', 'id="request-a-tour"']) console.assert(out.includes(id), 'has ' + id);
  console.assert(out.includes('data-live="price"') && out.includes('$236,990'), 'price');
  console.assert(out.includes('<ul>') && out.includes('Big yard'), 'desc bullets');
  console.assert(out.includes('matterport.com') && out.includes('idapro.cloud'), 'tour+plan');
  console.assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'no leftover markers/undefined');
  const page = renderQmi(h, '<head><title>x</title></head><body><!--CONTENT--></body>');
  console.assert(page.includes('hydrate-live.js') && page.includes('community-maps-live.js') && page.includes('__ESPERANZA_PAGE'), 'islands+config');
  console.log('render-qmi.mjs demo() passed');
}
if (process.argv.includes('--check') && import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 2: Run to verify it fails** — `node render-qmi.mjs --check` → FAIL (`qmiContent is not defined`).

- [ ] **Step 3: Implement `render-qmi.mjs`**

```js
// render-qmi.mjs — full QMI detail page from a normalized home + the chrome shell.
import { esc, money, num, statItem, ICON, descHtml, bannerHtml, galleryHtml, subnavHtml, tourHtml, elevationHtml, idaproPlanHtml, communityBlurbHtml, mapSalesHtml, formSlotHtml, recommendedHtml, setHead, finalizePage } from './sections.mjs';
import { qmiPath } from './paths.mjs';

export function qmiContent(h) {
  const c = h.communityObj || {};
  const has = { tour: !!h.virtualTourUrl, plans: !!(h.planViewerUrl || h.fpImage), elev: !!h.fpImage, comm: !!(c.description || c.image), sales: !!(c.lat && c.lng) };
  const stats = [
    h.beds != null && statItem(ICON.bed, esc(h.beds) + ' Bed'),
    h.garage != null && statItem(ICON.garage, esc(h.garage) + ' Car Garage'),
    h.baths != null && statItem(ICON.bath, Number(h.baths).toFixed(1) + ' Bath'),
    h.stories != null && statItem(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories')),
    h.totalSqft != null && statItem(ICON.total, num(h.totalSqft) + ' Total Sq. Ft.'),
    h.livingSqft != null && statItem(ICON.living, num(h.livingSqft) + ' Living Sq. Ft.'),
  ].filter(Boolean).join('');
  const ctas = [
    h.pdfUrl && `<a href="${esc(h.pdfUrl)}" target="_blank" rel="noopener" class="btn btn-green oi-brochure-download me-2 mb-2">Download Brochure</a>`,
    `<a href="#request-a-tour" class="btn btn-green me-2 mb-2">Schedule a Tour</a>`,
    `<a href="https://www.houseloan.com/" target="_blank" rel="noopener" class="btn btn-auto btn-learn me-2 mb-2">Get Prequalified</a>`,
    (c.lat && c.lng) && `<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-auto btn-learn mb-2 oi-directions-click">Get Directions</a>`,
  ].filter(Boolean).join('');
  const anchors = [['overview', 'Overview'], has.tour && ['virtualtour', 'Virtual Tour'], has.elev && ['elevations', 'Elevations'], has.plans && ['plans', 'Floor Plan'], ['photos', 'Photo Gallery'], has.comm && ['community', 'Community'], has.sales && ['sales', 'Sales & Map']].filter(Boolean);

  return [
    `<section class="header pagejump text-center bg-tan-white pb-2 py-lg-4"><div class="container"><div class="row align-items-center"><div class="col-12 col-md-9"><div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 me-auto d-none d-lg-block"></div><h1 class="bodoni text-gray fs-1 ls-sm">${esc(h.address)}</h1>${h.floorPlan ? `<div class="d-block text-brown">${esc(h.floorPlan)} Floor Plan</div>` : ''}<div class="d-block text-brown">${esc(h.community)}${h.city ? ` in ${esc(h.city)}, TX` : ''}</div>${bannerHtml(h.availability, h.promo)}</div><div class="col-12 col-md-3"><div class="overpass fs-7">PRICED AT</div><div class="overpass bold text-dark-green fs-4" data-live="price">${money(h.price)}</div><a data-bs-toggle="modal" data-bs-target="#payment-calculator" href="#" class="d-block fs-9 text-brown mt-1">Calculate Monthly Payment</a></div></div></div></section>`,
    galleryHtml(h.gallery, h.image, h.address),
    subnavHtml(anchors),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${descHtml(h.description)}<div class="row mt-4"><div class="col-12">${ctas}</div></div></div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4 mt-md-2 mt-lg-3"><div class="row stat-group border-gray mt-4 py-2">${stats}</div></div></div></div></section>`,
    has.tour && tourHtml(h.virtualTourUrl),
    has.elev && elevationHtml(h.elevation, h.fpImage),
    has.plans && idaproPlanHtml(h.planViewerUrl, h.fpImage, h.floorPlan, h.fpDescription),
    has.comm && communityBlurbHtml(c),
    has.sales && mapSalesHtml(c),
    recommendedHtml(),
    formSlotHtml('tour', h.address),
  ].filter(Boolean).join('\n');
}

export function renderQmi(h, shell) {
  const head = {
    title: `${h.address}, ${h.city || 'TX'} | Esperanza Homes`,
    description: `${h.floorPlan || ''} home for sale in ${h.community}, ${h.city}, TX — ${money(h.price)}.`.trim(),
    canonical: qmiPath(h), image: (h.gallery[0] && h.gallery[0].url) || h.image, url: qmiPath(h),
  };
  return finalizePage(shell, { content: qmiContent(h), head, page: { type: 'qmi', id: h.id, communitySlug: (h.communityObj && h.communityObj.slug) || '' }, islands: ['hydrate-live.js', 'detail-extras.js', 'community-maps-live.js'] });
}
```

(Append the `demo()` from Step 1.)

- [ ] **Step 4: Run to verify it passes** — `node render-qmi.mjs --check` → `render-qmi.mjs demo() passed`.

- [ ] **Step 5: Commit**

```bash
git add render-qmi.mjs
git commit -m "render: QMI detail page (gallery, tour, plan, community, map, calc, recommended)"
```

---

## Task 9: `render-community.mjs`

**Files:**
- Create: `render-community.mjs`

**Interfaces:**
- Consumes: normalized community (with `homes`, `plans`), `sections.mjs`, `communityPath`.
- Produces: `export function communityContent(c): string`, `export function renderCommunity(c, shell): string`.

- [ ] **Step 1: Write the failing check**

```js
function demo() {
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, priceFrom: 209990, beds: '3 - 5', baths: '2 - 4', sqft: '1,148 - 2,328', description: '<p>Great</p>', amenities: '<ul><li>Pool</li></ul>', image: '/c.jpg', secondaryImage: '/c2.jpg',
    homes: [{ id: 'h1', address: '1 A St', community: 'El Eden', city: 'Laredo', slug: '1-a-st', price: 236990, beds: 3, baths: 2, livingSqft: 1106, image: '/h.jpg', communityObj: null }],
    plans: [{ id: 'p1', name: 'Presidio', slug: 'presidio', collection: 'Haven', startingPrice: 219990, bedroomMin: 3, bedroomMax: 4, bathroomMin: 2, bathroomMax: 3, garage: 2, livingSqft: 1400, image: '/p.jpg' }] };
  const out = communityContent(c);
  for (const id of ['id="overview"', 'id="specs"', 'id="plans"', 'id="sales"', 'id="request-a-tour"']) console.assert(out.includes(id), 'has ' + id);
  console.assert(out.includes('Starting at $209,990') && out.includes('Pool') && out.includes('1 A St') && out.includes('Presidio'), 'content');
  console.assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'clean');
  console.log('render-community.mjs demo() passed');
}
if (process.argv.includes('--check') && import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 2: Run to verify it fails** — `node render-community.mjs --check` → FAIL.

- [ ] **Step 3: Implement `render-community.mjs`**

```js
// render-community.mjs — full community detail page.
import { esc, money, galleryHtml, mapSalesHtml, formSlotHtml, qmiCardHtml, planCardHtml, bannerHtml, finalizePage } from './sections.mjs';
import { communityPath } from './paths.mjs';

export function communityContent(c) {
  const gallery = [c.image, c.secondaryImage].filter(Boolean).map(u => ({ url: u, alt: c.name }));
  const homes = (c.homes || []).map(qmiCardHtml).join('');
  const plans = (c.plans || []).map(planCardHtml).join('');
  return [
    `<section class="header pagejump text-center bg-tan-white pb-2 py-lg-4"><div class="container"><h1 class="bodoni text-gray fs-1 ls-sm">${esc(c.name)}</h1><div class="text-brown">${esc(c.city)}, TX</div>${c.priceFrom ? `<div class="overpass bold text-dark-green fs-4 mt-2">Starting at ${money(c.priceFrom)}</div>` : ''}${c.address ? `<div class="text-gray fs-9 mt-1">${esc(c.address)}</div>` : ''}${bannerHtml('', c.promo)}</div></section>`,
    galleryHtml(gallery, c.image, c.name),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${c.description ? `<div class="wysiwyg">${c.description}</div>` : ''}</div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4"><div class="stat-group border-gray py-2">${c.priceFrom ? `<div class="item detail col-12">Homes from <span class="text-dark-green">${money(c.priceFrom)}</span></div>` : ''}${c.beds ? `<div class="item detail col-12">${esc(c.beds)} Bedrooms</div>` : ''}${c.baths ? `<div class="item detail col-12">${esc(c.baths)} Bathrooms</div>` : ''}${c.sqft ? `<div class="item detail col-12">${esc(c.sqft)} Sq. Ft.</div>` : ''}</div>${c.amenities ? `<div class="mt-4"><h3 class="overpass bold fs-7">Community Amenities</h3><div id="amenities-list" class="wysiwyg">${c.amenities}</div></div>` : ''}</div></div></div></section>`,
    homes ? `<section id="specs" class="pagejump py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Quick Move-Ins</h2><div class="row oi-listings">${homes}</div></div></section>` : '',
    plans ? `<section id="plans" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Available Floor Plans</h2><div class="row oi-listings oi-listings-plan">${plans}</div></div></section>` : '',
    mapSalesHtml(c),
    formSlotHtml('tour', c.name),
  ].filter(Boolean).join('\n');
}

export function renderCommunity(c, shell) {
  const head = {
    title: `${c.city}, TX New Homes | ${c.name} from Esperanza Homes`,
    description: `New homes in ${c.name}, ${c.city}, TX${c.priceFrom ? ` from ${money(c.priceFrom)}` : ''}.`,
    canonical: communityPath(c), image: c.image, url: communityPath(c),
  };
  return finalizePage(shell, { content: communityContent(c), head, page: { type: 'community', id: c.id, communitySlug: c.slug || '' }, islands: ['detail-extras.js', 'community-maps-live.js'] });
}
```

(Append the `demo()` from Step 1.)

- [ ] **Step 4: Run to verify it passes** — `node render-community.mjs --check` → passed.

- [ ] **Step 5: Commit**

```bash
git add render-community.mjs
git commit -m "render: community detail page (ranges, amenities, embedded homes+plans, map)"
```

---

## Task 10: `render-floorplan.mjs`

**Files:**
- Create: `render-floorplan.mjs`

**Interfaces:**
- Consumes: normalized floorplan (with `homes`, `communityList`, `communityPrices`), `sections.mjs`, `floorplanPath`, `communityPath`.
- Produces: `export function floorplanContent(fp): string`, `export function renderFloorplan(fp, shell): string`. Generated at `/floorplans/<slug>/` (brand-wide variant with `#mp-locations` per-community pricing).

- [ ] **Step 1: Write the failing check**

```js
function demo() {
  const fp = { id: 'recF', name: 'Agave', slug: 'agave', collection: 'Homestead', startingPrice: 396990, communityPrices: { 'Aqualina at Tres Lagos': 451990 }, bedroomMin: 4, bedroomMax: 5, bathroomMin: 3, bathroomMax: 3, garage: 3, stories: 1, livingSqft: 2786, totalSqft: 3639, hersScore: 43, image: '/fp.jpg', description: 'Spacious home.', planViewerUrl: 'https://idapro.cloud/flr_pln/agave', virtualTourUrl: 'https://my.matterport.com/show/?m=x', brochurePdfUrl: 'https://pdf/agave',
    communityList: [{ id: 'c1', name: 'Aqualina at Tres Lagos', slug: 'aqualina-at-tres-lagos', city: 'Edinburg' }],
    homes: [{ id: 'h1', address: '1 A St', community: 'Aqualina at Tres Lagos', city: 'Edinburg', slug: '1-a-st', price: 451990, beds: 4, baths: 3, livingSqft: 2786, image: '/h.jpg', communityObj: null }] };
  const out = floorplanContent(fp);
  for (const id of ['id="overview"', 'id="virtualtour"', 'id="plans"', 'id="mp-locations"', 'id="specs"', 'id="request-a-tour"']) console.assert(out.includes(id), 'has ' + id);
  console.assert(out.includes('Starting at $396,990') && out.includes('HERS Score: 43') && out.includes('Aqualina at Tres Lagos') && out.includes('$451,990'), 'content');
  console.assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'clean');
  console.log('render-floorplan.mjs demo() passed');
}
if (process.argv.includes('--check') && import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 2: Run to verify it fails** — `node render-floorplan.mjs --check` → FAIL.

- [ ] **Step 3: Implement `render-floorplan.mjs`**

```js
// render-floorplan.mjs — full brand-wide floor-plan detail page (/floorplans/<slug>/).
import { esc, money, num, galleryHtml, tourHtml, idaproPlanHtml, formSlotHtml, qmiCardHtml, finalizePage } from './sections.mjs';
import { floorplanPath, communityPath } from './paths.mjs';

export function floorplanContent(fp) {
  const beds = fp.bedroomMin === fp.bedroomMax ? fp.bedroomMin : `${fp.bedroomMin}-${fp.bedroomMax}`;
  const baths = fp.bathroomMin === fp.bathroomMax ? fp.bathroomMin : `${fp.bathroomMin}-${fp.bathroomMax}`;
  const stats = [
    `<div class="item detail col-12 col-lg-6">${beds} Bed</div>`,
    fp.garage != null ? `<div class="item detail col-12 col-lg-6">${esc(fp.garage)} Car Garage</div>` : '',
    `<div class="item detail col-12 col-lg-6">${baths} Bath</div>`,
    fp.stories != null ? `<div class="item detail col-12 col-lg-6">${esc(fp.stories)} ${fp.stories == 1 ? 'Story' : 'Stories'}</div>` : '',
    fp.totalSqft != null ? `<div class="item detail col-12 col-lg-6">${num(fp.totalSqft)} Total Sq. Ft.</div>` : '',
    fp.livingSqft != null ? `<div class="item detail col-12 col-lg-6">${num(fp.livingSqft)} Living Sq. Ft.</div>` : '',
    fp.hersScore != null ? `<div class="item detail col-12 col-lg-6">HERS Score: ${esc(fp.hersScore)}</div>` : '',
  ].filter(Boolean).join('');
  const locs = (fp.communityList || []).map(c => {
    const price = fp.communityPrices[c.name];
    return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card oi-map-item border border-gray p-2"><a href="${communityPath(c)}"><div class="card-title mt-2">${esc(c.name)}</div></a><div class="card-location text-green">${esc(c.city)}, TX</div>${price ? `<div class="price-title">Homes From</div><div class="price">${money(price)}</div>` : ''}<a href="${communityPath(c)}" class="btn btn-green mt-2 d-inline-block">View Community</a></div></div>`;
  }).join('');
  const homes = (fp.homes || []).map(qmiCardHtml).join('');
  const locCount = (fp.communityList || []).length;
  return [
    `<section class="header pagejump text-center bg-tan-white pb-2 py-lg-4"><div class="container"><h1 class="bodoni text-gray fs-1 ls-sm">${esc(fp.name)}</h1>${fp.collection ? `<div class="text-brown">${esc(fp.collection)} Collection</div>` : ''}${locCount ? `<a href="#mp-locations" class="d-block text-brown">Available in ${locCount} Communit${locCount == 1 ? 'y' : 'ies'}</a>` : ''}${fp.startingPrice ? `<div class="overpass bold text-dark-green fs-4 mt-2">Starting at ${money(fp.startingPrice)}</div>` : ''}</div></section>`,
    galleryHtml(fp.image ? [{ url: fp.image, alt: fp.name }] : [], fp.image, fp.name),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${fp.description ? `<div class="wysiwyg">${esc(fp.description)}</div>` : ''}<div class="mt-4">${fp.brochurePdfUrl ? `<a href="${esc(fp.brochurePdfUrl)}" target="_blank" rel="noopener" class="btn btn-green oi-brochure-download me-2 mb-2">Download Brochure</a>` : ''}<a href="#request-a-tour" class="btn btn-auto btn-learn mb-2">Request Information</a></div></div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4"><div class="row stat-group border-gray py-2">${stats}</div></div></div></div></section>`,
    tourHtml(fp.virtualTourUrl),
    idaproPlanHtml(fp.planViewerUrl, fp.image, fp.name, ''),
    locs ? `<section id="mp-locations" class="pagejump py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Available Locations</h2><div class="row oi-listings">${locs}</div></div></section>` : '',
    homes ? `<section id="specs" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Quick Move-Ins with this Plan</h2><div class="row oi-listings">${homes}</div></div></section>` : '',
    formSlotHtml('general', fp.name),
  ].filter(Boolean).join('\n');
}

export function renderFloorplan(fp, shell) {
  const head = {
    title: `The ${fp.name} New Home | Esperanza Homes`,
    description: `The ${fp.name} floor plan${fp.collection ? ` (${fp.collection} Collection)` : ''}${fp.startingPrice ? ` from ${money(fp.startingPrice)}` : ''}.`,
    canonical: floorplanPath(fp), image: fp.image, url: floorplanPath(fp),
  };
  return finalizePage(shell, { content: floorplanContent(fp), head, page: { type: 'floorplan', id: fp.id, communitySlug: '' }, islands: ['detail-extras.js'] });
}
```

(Append the `demo()` from Step 1.)

- [ ] **Step 4: Run to verify it passes** — `node render-floorplan.mjs --check` → passed.

- [ ] **Step 5: Commit**

```bash
git add render-floorplan.mjs
git commit -m "render: floor-plan detail page (specs, per-community pricing, tour, plan viewer)"
```

---

## Task 11: Detail-page islands

**Files:**
- Create: `islands/detail-extras.js`
- Modify: `islands/community-maps-live.js` (prefer `__ESPERANZA_PAGE.communitySlug`)

**Interfaces:**
- `detail-extras.js` exposes a node-testable `monthlyPayment(price, opts)`; in the browser it binds Fancybox, computes the calculator, and fills `#recommended`.

- [ ] **Step 1: Create `islands/detail-extras.js`**

```js
/* detail-extras.js — client glue for generated detail pages: Fancybox gallery,
 * monthly-payment calculator (rate from /settings), Recommended-For-You. The pure
 * payment math is node-testable via `node islands/detail-extras.js --check`. */
function monthlyPayment(price, opts) {
  opts = opts || {};
  var down = opts.down != null ? opts.down : 0.035;
  var rate = (opts.rate != null ? opts.rate : 6.15) / 100 / 12;
  var n = (opts.term != null ? opts.term : 30) * 12;
  var principal = price * (1 - down);
  var pi = rate ? principal * rate / (1 - Math.pow(1 + rate, -n)) : principal / n;
  var tax = price * 0.0207 / 12;
  var ins = price * 0.004 / 12;
  var pmi = down < 0.2 ? principal * 0.0075 / 12 : 0;
  var hoa = 360 / 12;
  return Math.round(pi + tax + ins + pmi + hoa);
}

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) {
    var m = monthlyPayment(300000, { rate: 6.15 });
    console.assert(m > 2200 && m < 2900, 'monthlyPayment ~2600, got ' + m);
    console.assert(monthlyPayment(0) === 30, 'zero price -> hoa only, got ' + monthlyPayment(0));
    console.log('detail-extras.js demo() passed: $' + m + '/mo on $300k @6.15%');
  }
} else {
  (function () {
    'use strict';
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    var PAGE = window.__ESPERANZA_PAGE || {};
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
    var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

    if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');

    var calcResult = document.getElementById('mort-calc-total');
    if (calcResult || document.getElementById('payment-calculator')) {
      var priceEl = document.querySelector('[data-live="price"]');
      var price = Number((priceEl && priceEl.textContent || '').replace(/[^0-9.]/g, '')) || 0;
      fetch(API + '/settings').then(function (r) { return r.json(); }).then(function (d) {
        var rate = (d.settings && Number(d.settings.mortgage_rate)) || 6.15;
        if (calcResult) calcResult.textContent = money(monthlyPayment(price, { rate: rate })) + '/mo';
      }).catch(function () {});
    }

    var rec = document.getElementById('recommended');
    if (rec && PAGE.type === 'qmi' && PAGE.id) {
      fetch(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
        var homes = (res.homes || []).map(function (h) { return h.fields ? Object.assign({ id: h.id }, h.fields) : h; });
        var me = homes.filter(function (h) { return h.id === PAGE.id; })[0]; if (!me) return;
        var ck = function (h) { var v = h['Community (Link)']; return Array.isArray(v) ? v[0] : v; };
        var score = function (h) { return ck(h) === ck(me) ? 3 : (h['FP: Collection'] && h['FP: Collection'] === me['FP: Collection'] ? 2 : (h.City === me.City ? 1 : 0)); };
        var pool = homes.filter(function (h) { return h.id !== PAGE.id; }).sort(function (a, b) { return score(b) - score(a); });
        rec.innerHTML = pool.slice(0, 4).map(card).join('');
      }).catch(function () {});
    }
    function fix(u) { return u ? String(u).replace(/^https:\/\/pub-9c9bfee574a54b62b2623e361b3ad305\.r2\.dev/, 'https://img.hazardhouse.ai') : u; }
    function card(h) {
      var url = '/new-homes/tx/' + slugify(h.City) + '/' + slugify(h.Community) + '/' + slugify(h.slug || h.address) + '/';
      var img = fix(h.image_url);
      return '<div class="col-12 col-md-6 col-lg-3 mb-3"><div class="card spec-card border border-gray p-2">' +
        (img ? '<a href="' + esc(url) + '"><div class="oi-aspect sixteen-nine"><img src="' + esc(img) + '" class="oi-aspect-img" loading="lazy" alt="' + esc(h.address) + '"></div></a>' : '') +
        '<div class="card-body"><a href="' + esc(url) + '"><div class="card-title mt-2">' + esc(h.address) + '</div></a>' +
        '<div class="card-location text-green">' + esc(h.City) + ', TX</div><div class="spec-price">' + money(h.Price) + '</div></div></div></div>';
    }
  })();
}
```

- [ ] **Step 2: Verify the payment math** — `node islands/detail-extras.js --check` → `detail-extras.js demo() passed: $...`.

- [ ] **Step 3: Update `islands/community-maps-live.js` `buildDetail` to prefer the baked slug**

In `buildDetail(el, comms)`, replace the URL-parsing slug derivation with a preference for the page config. Change:

```js
  function buildDetail(el, comms) {
    // The community for this page = the slug segment just before the trailing id in the URL.
    var segs = location.pathname.replace(/\/+$/, '').split('/');
    var slug = segs[segs.length - 2] || '';
```

to:

```js
  function buildDetail(el, comms) {
    // Prefer the slug the generator baked into the page; fall back to URL parsing.
    var PAGE = window.__ESPERANZA_PAGE || {};
    var segs = location.pathname.replace(/\/+$/, '').split('/');
    var slug = PAGE.communitySlug || segs[segs.length - 2] || '';
```

- [ ] **Step 4: Commit**

```bash
git add islands/detail-extras.js islands/community-maps-live.js
git commit -m "islands: detail-extras (gallery/calc/recommended) + map reads baked community slug"
```

---

## Task 12: `generate-details.mjs` + build.mjs wiring

**Files:**
- Create: `generate-details.mjs`
- Modify: `build.mjs` (skip frozen detail pages, ship the detail islands, call `generateDetails`, drop the old scrape-based `writeLinksMap` call)

**Interfaces:**
- `generate-details.mjs` exports `async function generateDetails()`; runs standalone (reads `templates/detail-shell.html` + the API) or is awaited by `build.mjs`.

- [ ] **Step 1: Create `generate-details.mjs`**

```js
// generate-details.mjs — render all detail pages from live D1 into public/.
// Standalone (needs only committed templates + the API) OR called by build.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadData } from './data.mjs';
import { linksMap, qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { renderQmi } from './render-qmi.mjs';
import { renderCommunity } from './render-community.mjs';
import { renderFloorplan } from './render-floorplan.mjs';

const OUT = join(import.meta.dirname, 'public');
const SHELL_PATH = join(import.meta.dirname, 'templates', 'detail-shell.html');

function writePage(urlPath, html) {
  const dst = join(OUT, urlPath.replace(/^\//, ''), 'index.html'); // urlPath ends with '/'
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, html);
}

export async function generateDetails() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const shell = readFileSync(SHELL_PATH, 'utf8');
  const d = await loadData();
  for (const h of d.qmis) writePage(qmiPath(h), renderQmi(h, shell));
  for (const c of d.communities) writePage(communityPath(c), renderCommunity(c, shell));
  for (const fp of d.floorplans) writePage(floorplanPath(fp), renderFloorplan(fp, shell));
  writeFileSync(join(OUT, 'qmi-links.json'), JSON.stringify(linksMap(d.qmis, d.communities)));
  console.log(`generate-details: ${d.qmis.length} qmi + ${d.communities.length} community + ${d.floorplans.length} floorplan pages`);
  return { qmi: d.qmis.length, community: d.communities.length, floorplan: d.floorplans.length };
}

if (import.meta.url === `file://${process.argv[1]}`) generateDetails();
```

- [ ] **Step 2: Wire `build.mjs`** — three edits:

(a) Skip shipping the FROZEN detail pages (we now generate canonical ones). In `build.mjs`, inside the `for (const rel of shipList())` loop, right after `if (!existsSync(src)) {...continue;}`, add:

```js
    // Detail pages are generated fresh from D1 (Task 12) — don't ship the frozen scrape copies.
    if (/^new-homes\/tx\/[^/]+\/[^/]+\/[^/]+\//.test(rel) || /^floorplans\/[^/]+\/[^/]+\//.test(rel)) continue;
```

(b) Ship the detail islands + drop the old links map. Change the `islands` Set to include the new islands, and remove the `writeLinksMap();` call from `build()` (generate-details writes `qmi-links.json`). The islands Set line becomes:

```js
  const islands = new Set([...Object.values(LIVE_PAGES), ...CONTAINER_ISLANDS.map(c => c.island), ...Object.values(EXTRA_SCRIPTS).flat(), SHELL.island, 'hydrate-live.js', 'detail-extras.js']);
```

(c) Make `build()` async and generate details at the end. Change `function build() {` → `async function build() {`, and replace the final `writeLinksMap();\n  console.log(...assembled...)` lines with:

```js
  await generateDetails();
  console.log(`public/ assembled at ${OUT}`);
```

Add the import at the top: `import { generateDetails } from './generate-details.mjs';`
And change the entrypoint at the bottom: `else build();` → `else build().catch(e => { console.error(e); process.exit(1); });`

- [ ] **Step 3: Full build + smoke test**

Run: `node build.mjs`
Expected: prints `rewrote N pages`, `generate-details: 108 qmi + 32 community + 60 floorplan pages`, `public/ assembled`.

Run the smoke check:
```bash
node -e "const fs=require('fs');const l=require('./public/qmi-links.json');const k=Object.keys(l.qmi);console.assert(k.length>50,'qmi links '+k.length);const p='./public'+k[0]+'index.html';console.assert(fs.existsSync(p),'missing '+p);const h=fs.readFileSync(p,'utf8');console.assert(h.includes('hydrate-live.js')&&h.includes('id=\"detail-gallery\"')&&h.includes('__ESPERANZA_PAGE'),'sections/islands');console.assert(!h.includes('<!--CONTENT-->'),'marker replaced');console.log('smoke ok:',k.length,'qmi pages, sample',p);"
```
Expected: `smoke ok: <N> qmi pages, sample ...`.

- [ ] **Step 4: Commit**

```bash
git add build.mjs generate-details.mjs public
git commit -m "generate: build-time data-driven detail pages (qmi/community/floorplan) from D1"
```

---

## Task 13: esperanza-cf API PR — expose `photo_gallery` + community office fields

**Files (repo `/Users/mgd/Library/CloudStorage/Dropbox/Claude Projects/esperanza-cf`):**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/test/golden/communities.json`
- Modify: `packages/api/test/contract.test.ts` (title only)

**Interfaces:** adds `fields.photo_gallery` (`{url,alt}[]`) to `/qmi` and `officePhone`/`officeHours`/`scheduleVisit` to `/communities`. Both fields already exist in D1 + the public views — no migration.

- [ ] **Step 1: Branch**

```bash
cd "/Users/mgd/Library/CloudStorage/Dropbox/Claude Projects/esperanza-cf" && git checkout -b api-detail-fields
```

- [ ] **Step 2: Add the gallery parser** (after `packages/api/src/index.ts:136`, near `unwrapStored`)

```ts
function parseGallery(raw: unknown): Array<{ url: string; alt: string }> {
  if (raw == null || raw === '') return [];
  let arr: unknown;
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: Array<{ url: string; alt: string }> = [];
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const url = asStr((item as Record<string, unknown>)['url']);
      if (url) out.push({ url, alt: asStr((item as Record<string, unknown>)['alt']) });
    } else if (typeof item === 'string' && item.trim()) {
      out.push({ url: item.trim(), alt: '' });
    }
  }
  return out;
}
```

- [ ] **Step 3: Emit the gallery in `serializeQmiRow`** (after the self-tour block, ~index.ts:308)

```ts
  const gallery = parseGallery(row['photo_gallery_json']);
  if (gallery.length) fields['photo_gallery'] = gallery;
```

- [ ] **Step 4: Add community office fields** — interface (after `comingSoon;`, ~index.ts:398):

```ts
  officePhone: string;
  officeHours: string;
  scheduleVisit: string;
```

serializer (after `comingSoon:` line, ~index.ts:433):

```ts
    officePhone: asStr(row['office_phone']),
    officeHours: asStr(row['office_hours']),
    scheduleVisit: asStr(row['schedule_visit']),
```

- [ ] **Step 5: Update the community golden** — `packages/api/test/golden/communities.json`: add `"officePhone"`, `"officeHours"`, `"scheduleVisit"` keys to EVERY object (values matching the seeded fixture rows; use `""` where the fixture has no office data). Update the test title `contract.test.ts:613` from "20 contract keys" → "23 contract keys" (the assertion is count-agnostic; the title is cosmetic).

- [ ] **Step 6: Typecheck + tests**

Run: `cd packages/api && npm run typecheck && npm run test`
Expected: `tsc` clean; vitest green (contract test passes with the updated golden).

- [ ] **Step 7: Commit + PR (do NOT merge — Matt merges to master)**

```bash
git add packages/api/src/index.ts packages/api/test/golden/communities.json packages/api/test/contract.test.ts
git commit -m "api: expose qmi photo_gallery + community office phone/hours (additive)"
git push -u origin api-detail-fields
gh pr create --draft --title "API: expose photo_gallery + community office fields" --body "Additive serializer changes; fields already in D1+views. Unblocks detail-page gallery + sales office on the Railway site. No migration."
```

- [ ] **Step 8: After Matt merges** — the change auto-deploys (api-only, change detection). Verify: `curl -s "https://esperanza-api.round-base-ed8c.workers.dev/api/public/qmi?purge=1" | grep -o photo_gallery | head -1` returns `photo_gallery`, and `/communities?purge=1` shows `officePhone`. The generator (Task 2/12) then picks the fields up on the next build automatically.

---

## Task 14: Freshness — scheduled/webhook regeneration (P4)

**Files (repo `esperanza-oneill-railway`):**
- Create: `.github/workflows/refresh-details.yml`

**Interfaces:** regenerates detail pages from live D1 on a schedule + on demand, commits `public/` changes to `staging`, which auto-deploys on Railway. Runs `generate-details.mjs` only (no scrape needed).

- [ ] **Step 1: Create the workflow**

```yaml
name: Refresh detail pages
on:
  schedule:
    - cron: '*/30 * * * *'   # every 30 min
  workflow_dispatch: {}
  repository_dispatch:
    types: [d1-sync]          # POST from the D1 sync to refresh immediately
concurrency:
  group: refresh-details
  cancel-in-progress: true
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: staging
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node generate-details.mjs
      - name: Commit if changed
        run: |
          git config user.name "esperanza-bot"
          git config user.email "bot@hazard.house"
          if [ -n "$(git status --porcelain public)" ]; then
            git add public
            git commit -m "chore: refresh detail pages from D1 [skip ci]"
            git push origin staging
          else
            echo "no changes"
          fi
```

- [ ] **Step 2: Commit** (workflow only runs from the default branch's copy once present on `staging`; Matt enables/tunes cron as desired)

```bash
git add .github/workflows/refresh-details.yml
git commit -m "ci: scheduled/webhook refresh of detail pages from D1"
```

> ponytail: 30-min cron + live price hydration (Task 4) is enough for launch. A tighter loop or a real D1-sync webhook (`repository_dispatch`) is a later tuning knob, not a launch blocker.

---

## Self-Review

- **Spec coverage:** QMI/community/floorplan generation (T6–T12); gallery/tour/plan/community/map/description/stats/CTAs (T7–T8); per-community pricing (T10); calculator + recommended + sales office (T11, T13); live hydration (T4); build-fail guard (T2); canonical URLs + homeUrl compatibility via `qmi-links.json` (T3/T12); NOINDEX + Caddy fallthrough preserved (unchanged); freshness (T14); API additions (T13). Forms = explicitly a separate task (slots emitted by `formSlotHtml`).
- **Placeholder scan:** the only intentional fill-in is `ICON.garage`, resolved by Task 7 Step 1 (grep produces the exact value before it's used). No TBD/TODO elsewhere.
- **Type consistency:** normalized field names (`communityObj`, `communityList`, `communityPrices`, `officePhone`) are defined in `data.mjs` (T2) and consumed unchanged in T8–T10; `finalizePage({content,head,page,islands})` shape matches every renderer call; `__ESPERANZA_PAGE.{type,id,communitySlug}` written in T7 and read in T4/T11.
- **Known execution refinements (not placeholders):** section markup uses O'Neill classes at island-fidelity; a per-task PW visual-diff vs the live O'Neill page at 390/768/1440 (reuse the audit harness) tunes spacing/classes.

