# Esperanza 2.0 — Data-Driven Detail Pages

**Date:** 2026-07-02
**Repo:** `esperanza-oneill-railway` (Hazard-House/esperanza-homes-2.0), branch `staging`
**Related repo:** `esperanza-cf` (the `esperanza-api` Worker + D1 + R2)

## Problem

The site is a June-8-2026 static scrape of the O'Neill/Homefiniti Esperanza site, hosted
on Railway via Caddy and re-pointed at our Cloudflare D1/R2. It works, but the **detail
pages are frozen snapshots**:

- **All 83 scraped QMI detail pages ship June-8 prices/availability.** For a real-estate
  site, stale prices on for-sale homes is a launch blocker.
- **25 QMI homes are newer than the scrape** and have no detail page at all; `available-live.js`
  silently drops those cards on the community page (wrong home, generic photos).
- Community and floor-plan detail pages are likewise frozen (stale embedded home cards,
  stale plan pricing).
- The stop-gap runtime shell (`qmi-detail-live.js`) renders ~20% of the real page
  (no gallery, tour, floor-plan viewer, community section, map, calculator, recommended).

## Goal

Replace the frozen detail pages **and** the runtime shell with **build-time, data-driven,
full-featured pages** for all three dynamic types — QMI homes, communities, floor plans —
rendered from live D1 via the public API, styled with the exact O'Neill design, with
current data and SEO-friendly static HTML. Volatile fields (price/availability/promo) are
re-hydrated live on load so they are never stale between rebuilds.

Non-goal: an Astro/Next framework rebuild (re-authors the O'Neill design → drift + weeks of
work). Non-goal: changing the homepage or `/new-homes/available` list island (already live).

## Approach

**One canonical template per page type, filled from live D1 at build time** — not mutating
200 frozen snapshots.

Pick the best scraped example of each type, extract it into a template with named slots,
then render *every* record by filling that template. Rationale:

- Consistent output across all homes; newer homes render from the *same* template (no special
  "shell", kills the fall-back-to-community bug).
- Current data on every page; content lives in the HTML → SEO-friendly.
- Reuses the exact O'Neill design (theme CSS/JS already bundled at `/static`) + the existing
  build pipeline. No new framework, no design drift.

### Tooling decision: cheerio for templating

The shared theme/host/footer rewrites stay as regex (`rewriteCommon` — proven, keeps working
for the homepage and static pages). But filling structured content slots (gallery grids, tour
iframes, per-community pricing tables, embedded card lists) across ~200 pages is where regex
stops being lazy and becomes a liability. The renderers use **cheerio** for structured DOM
insertion on the template.

> ponytail note: regex was correct for "3 flagship files". Generating ~200 data-driven pages
> with structured inserts is exactly the case the original `build.mjs` comment said was out of
> scope ("adding jsdom for 3 files is overkill"). cheerio is the right tool now; it is the one
> new dependency this design adds.

## Architecture / Components

Each unit is small and testable in isolation.

| Unit | Purpose | Depends on |
|---|---|---|
| `data.mjs` | Fetch the 3 endpoints once, normalize, cross-link (QMI→community, QMI→floorplan, floorplan→its communities/QMIs). Returns clean lookup maps. | `fetch`, API |
| `templates/qmi-detail.html`<br>`templates/community-detail.html`<br>`templates/floorplan-detail.html` | Extracted O'Neill structures with slot markers, derived from the best scraped example of each type. | scrape |
| `render-qmi.mjs`<br>`render-community.mjs`<br>`render-floorplan.mjs` | `(record, maps, template) → full HTML`. Each ships a `demo()` self-check. | cheerio, templates, data.mjs |
| `islands/hydrate-live.js` | On every detail page, re-fetch *that record's* price/availability/promo and update the DOM. Small. | API |
| `islands/detail-extras.js` | Client glue on detail pages: Fancybox gallery binding, payment calculator (`oicalc` + `/settings` rate), Recommended-For-You (from `/qmi`). | Fancybox/oicalc (theme), API |
| `build.mjs` (extended) | Orchestrate: fetch data → render every record → write to the O'Neill URL path. Non-detail pages keep shipping as they do today. | all above |

Map rendering on detail pages reuses the existing `community-maps-live.js` island (our Mapbox
token/style + `map_pin.png`), fed the linked community's coordinates.

## Data flow & freshness

```
Snowflake → D1 (v_public_* views) → esperanza-api (/api/public/*)
   → build.mjs FETCHES at build time → renders templates → static HTML in public/
       → Caddy (Railway) → browser
           → hydrate-live.js re-fetches price/availability/promo for that record
```

- **Rebuild on data change:** a webhook (D1 sync → Railway redeploy) with a scheduled-rebuild
  fallback (~30 min). Same pattern as the existing framer-push model. Exact trigger finalized
  in implementation; the build itself is idempotent so either mechanism works.
- **Live hydration** covers the interim so money/availability is never stale between rebuilds.

## URL strategy

O'Neill's deep QMI URLs embed internal ids (`/<cid>/<slug>/<listing-id>/`) that our API records
**do not carry** — we only have `community.town` (city), `community.slug`, and the home's `address`
slug. So the canonical path is **fully derivable from our data**, uniform across all 108 homes
(including the 25 newer ones):

- **QMI canonical:** `/new-homes/tx/<city>/<community-slug>/<address-slug>/index.html`
  (`city` = `community.town` lowercased+slugified). The scrape's 83 deep O'Neill paths (already in
  `qmi-links.json`) are emitted as **301 redirects to the canonical** (Caddy), so any existing/inbound
  link survives.
- **Community canonical:** `/new-homes/tx/<city>/<community-slug>/index.html` — already O'Neill's clean
  pattern (no internal id); matches the scrape 1:1.
- **Floor plan canonical:** O'Neill's floor-plan detail path keyed by `slug` — exact pattern confirmed
  from the scrape in P3.

Keep `/new-homes/available/home/?slug=` as an alias (302 → the canonical QMI page) so the old shell URL
survives. Update `available-live.js` `homeUrl()` to point **all** cards at the canonical generated page —
this removes the "25 homes fall back to community page" bug.

## Section coverage

All sections below are backed by data the API returns today (or after the two small additive API
edits in Phase 0b). Line numbers reference the scrape template
`www.esperanzahomes.com/new-homes/tx/brownsville/palo-alto-groves/7522/2144-sand-lane/1751815/index.html`
unless noted.

### QMI detail
- Header: address, community + city, availability + promo banners, price. Price/availability/promo
  hydrated live.
- Description: API `Description` is plain text with `- ` bullets — parse `- ` lines into a real `<ul>`
  (O'Neill renders real `<ul>`).
- Stats: bed / bath / **garage** (`FP: Garage`) / stories / living + total sqft.
- CTAs: Download Brochure (`Dynamic PDF` worker), Get Directions (community coords), Get Prequalified
  (static lender link).
- **Photo gallery** (`#detail-gallery`, lines 1598-1643; "View N Photos" `a.open-gallery`, 1627-1629;
  Fancybox lightbox `img[data-fancybox="photos"]`, 1646-1680): bind from API `photo_gallery` (see 0b);
  fallback to `image_url` for galleryless homes.
- **Virtual Tour** (`FP: Virtual Tour`, Matterport iframe).
- **Floor-Plan viewer** (`FP: Plan Viewer` idapro iframe + `FP: Image` + `FP: Description`).
- **Elevation** (`elevation` label + `FP: Image`).
- **Community section** (join via `Community (Link)` → `/communities`: description, image, amenities, Learn More).
- **Map + sales office** (`#sales`, lines 2155-2185: `#oi-map` + `<address>` + `a.oi-click-to-call`
  + Get Directions). Coords + office phone/hours from the linked community (see 0b).
- **Monthly-payment calculator** (trigger 1584-1590; modal `#payment-calculator` 2587-2897; engine
  `oicalc.js`): keep markup + engine, seed price from the record and `rate` from `/settings`.
- **Recommended For You** (container 2554-2581; XHR-filled originally so no card markup in scrape —
  reuse the browse card): from `/qmi`, exclude self, rank same-community → same-collection → same-city, take 4.
- Sticky sub-nav jump bar (Overview / Tour / Elevations / Floor Plan / Photos / Community / Contact).
- Form slot (HubSpot "Schedule a Tour" / "Request Info" — filled by the separate forms task).

### Community detail
- Hero, description (HTML), amenities (HTML `<ul>`), price-from + bed/bath/sqft ranges, image + secondaryImage.
- Embedded **QMI list** (homes in this community) + embedded **floor-plan list** (plans offered).
- Map, sales office (phone/hours, see 0b), promo banner, CTAs / form slot.

### Floor-plan detail
- Specs: beds/baths/garage/stories/living+total sqft/master location/**HERS** (`hersScore`).
- Description.
- **Per-community pricing table** (`communityPrices`).
- Virtual Tour (`virtualTourUrl`), Plan Viewer (`planViewerUrl`), Download Brochure (`brochurePdfUrl`).
- Elevations / image, availability (QMIs of this plan), promo, form slot.

## Required API additions (esperanza-cf, Phase 0b)

Two additive, backward-compatible edits to `esperanza-cf/packages/api/src/index.ts`. Both fields
already exist in D1 and in the public views — only the serializer drops them. Deploys on push to
`esperanza-cf` master (separate PR + review from this repo).

1. `serializeQmiRow` (~index.ts:289; add to the `QMI_PLAIN` allow-list ~196-251): emit
   `photo_gallery` from `photo_gallery_json` (`v_public_qmi`, `views.sql:65`). ~5 lines.
2. `serializeCommunityRow` (~index.ts:405-439): emit `officePhone` / `officeHours` (+ optional
   `scheduleVisit`) from the community row (`v_public_communities`, `views.sql:158`; columns from
   `0000_init.sql:253-256`). ~3 lines.

The generator reads these when present and **degrades gracefully** when absent (gallery → single
`image_url`; office → omit phone/hours) — so this repo does not hard-block on the API PR.

## Error handling

- **Build fails hard** if any endpoint is empty or unreachable — never ship a site with zero homes
  (the mass-unpublish guard lesson). Assert record counts are non-zero before writing.
- Per record: a missing optional field omits its section — no empty shells. Log per-type coverage counts.
- API image URLs are already absolute `img.hazardhouse.ai`; pass through. Any scrape-relative media in
  the template still goes through `resolveMedia`.
- Keep the `NOINDEX` gate (robots.txt Disallow + per-page noindex meta) until domain cutover.
- Keep Caddy's 404 → 302-to-O'Neill fallthrough for anything not generated (blog, misc library pages).

## Testing

- Each `render-*.mjs` ships a `demo()` self-check: one fixture record → assert required sections
  present, no unresolved `{{slot}}` markers, and price/tour/map present.
- Post-build smoke: generated page count == record count (108 QMI / 32 community / 60 floor plan);
  sample image-200 check on a few generated pages; assert `hydrate-live.js` present on detail pages.
- Playwright visual diff of one generated page per type vs the live O'Neill equivalent at 390 / 768 /
  1440 (reuse the audit harness in `pw-cli/node_modules/playwright`, CommonJS require, not the CLI).

## Phasing (feeds the implementation plan)

- **P0** — `data.mjs` (fetch + normalize + cross-link) + build-fail guard; `hydrate-live.js`;
  `homeUrl()` + `/available/home/?slug=` alias fix.
- **P0b** — esperanza-cf API PR: expose `photo_gallery` + `officePhone/officeHours` (separate repo/PR).
- **P1** — QMI detail template + `render-qmi.mjs` (highest pain) incl. gallery, tour, floor-plan viewer,
  community section, map, description fix, stats/CTAs, calculator, recommended, sub-nav.
- **P2** — community detail template + `render-community.mjs`.
- **P3** — floor-plan detail template + `render-floorplan.mjs`.
- **P4** — freshness trigger (webhook + scheduled fallback); confirm NOINDEX-flip readiness for cutover.
- **Separate task (after):** HubSpot forms fill the form slots on all three types.

## Explicitly out of scope

- Astro/Next framework rebuild.
- Homepage and `/new-homes/available` list redesign (already live).
- Any DNS cutover / flipping `NOINDEX` (Matt does that from the Railway side after QA).
