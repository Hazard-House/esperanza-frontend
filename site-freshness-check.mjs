// =============================================================================
// site-freshness-check.mjs — outcome-based staleness watchdog.
//
// SCOPE — four surfaces, and they are asserted DIFFERENTLY. Read this before adding a
// fifth, because "monitor everything" is the wrong instinct here.
//
//   1. QMI grid, /new-homes/available/ — BIDIRECTIONAL. The baked grid must list exactly
//      the homes the live API reports as published: a published home missing from the
//      grid AND an unpublished home still on it are both drift. This is the strong
//      assertion, and it is only possible because generate-details.mjs both renders and
//      PRUNES QMI pages, so the baked set is meant to equal the published set.
//
//   2. Blog detail pages, /blog/<slug>/ — ONE-DIRECTIONAL: every published post must
//      have a live page. The reverse is deliberately NOT asserted. public/blog also
//      carries the frozen O'Neill scrape's pagination (`page-2` … `page-21`, `category`),
//      and nothing prunes a blog page when a post is unpublished, so "baked but not in
//      the API" is not evidence of anything today. Measured 2026-07-29: 148 baked dirs =
//      127 API posts + 21 scrape pagination dirs, i.e. zero orphaned posts, but that
//      bijection is a coincidence of the current data, not an invariant the build holds.
//
//   3. Floor-plan detail pages, /floorplans/<slug>/ — ONE-DIRECTIONAL, same reasoning:
//      generate-details.mjs writes a page per API plan and never prunes.
//
//   4. Blog search index, /blog-index.json — ONE-DIRECTIONAL: every post that must have a
//      page must ALSO have exactly one index entry. This is a SEPARATE artifact from the
//      pages in (2) and it drifted independently of them for weeks: PR #125 (merged
//      2026-07-29, 9416e039) wired scripts/gen-blog-index.mjs into deploy.yml because it
//      had only ever run from build.mjs, which CI never invokes. The live index sat at 125
//      entries while 127 posts were baked, and "Vista Verde is Off to a Strong Start" —
//      HTTP 200, linked, published — could not be found by site search at all. Page parity
//      alone was green through that entire window, which is exactly why this is its own
//      assertion rather than an inference from (2).
//
// WHY REDIRECTED POSTS ARE EXCLUDED FROM (2) AND (4) RATHER THAN DEMANDED.
// A published D1 row whose canonical URL is 301-ed in redirects.mjs has been deliberately
// retired by hand while the row stays published. Demanding a 200 there would file an
// incident that only a data change can close. #125's generator excludes exactly this set
// from the search index for the same reason, so this check reads the SAME shipped
// REDIRECTS table — if the two disagreed, one of them would be wrong every night.
// Concretely today: 127 API posts, 1 redirected, 126 demanded, 126 live index entries.
//
// STILL OUT OF SCOPE, on purpose: promotions, cities, communities, and the /blog/ and
// /new-homes/floorplans/ LIST pages. Those surfaces do not consume the D1 fields
// marketing edits (Fable's E2E, 2026-07-29), so a parity assertion over them would fail
// permanently and correctly — an incident nobody can close, which is how a watchdog
// trains people to ignore it. The floor-plan LIST page is the live instance: a plan
// renamed in D1 (Antinori -> Santa Cruz, reculREsNefdKhxw1) still has the list linking
// /floorplans/antinori/ while D1 says santa-cruz. BOTH pages serve 200 — nothing prunes
// floor-plan dirs, so a rename forks instead of moving — so surface (3) is genuinely
// green and this check must not be mistaken for covering that bug. Asserting the list's
// LINKS is blocked on a product decision (301 the old slug or 404 it).
// Monitor what should work; fix or document what does not.
//
// WHY THIS WATCHES THE OUTCOME RATHER THAN THE MECHANISM.
//
// Admin saves reach the public site through a chain: D1 write -> api cache purge
// -> GitHub workflow_dispatch (packages/db/lib/site-rebuild.ts) -> deploy.yml
// bake -> Cloudflare deploy -> edge cache. Every link can fail quietly:
//
//   * The dispatch may never fire. site-rebuild.ts swallows every error
//     (`catch { /* manual redeploy */ }`) and only console.errors a non-2xx, and
//     runPostWriteSideEffects catches again. An expired GITHUB_DISPATCH_TOKEN, a
//     rate limit, or a thrown fetch therefore returns "saved" to the editor while
//     NO workflow run is ever created.
//   * A run may be cancelled. deploy.yml coalesces bursts, so cancellation is an
//     EXPECTED outcome, not a failure signal — alerting on it would page on healthy
//     behaviour.
//   * A run may fail. #119 covers this case, but ONLY this case.
//   * The edge may serve a stale copy for up to its max-age after a good deploy, and
//     no request header defeats it. Measured 2026-07-29: plain, `Cache-Control:
//     no-cache`, `Pragma: no-cache`, and a query-string cache-buster ALL returned
//     cf-cache-status: HIT with a byte-identical body. So this check cannot "force"
//     fresh HTML; it must outwait max-age instead (see settleBudgetMs).
//
// The first case is the dangerous one, and it dictates HOW this is invoked. It is
// structurally invisible to any run-watching alert — there is no run to watch, so
// `if: failure()` cannot fire and no "was the last run green?" query helps. Crucially
// it is equally invisible to a check that runs INSIDE deploy.yml: if no run is
// created, that check does not execute either. So this must be driven by its own
// clock, independent of the pipeline it watches — see .github/workflows/
// site-freshness.yml, which runs it every 15 minutes.
//
// Asserting the PROPERTY WE ACTUALLY CARE ABOUT — public HTML matches the source of
// truth — then covers dispatch-never-fired, failed, cancelled-without-replacement,
// and a stuck edge cache with one probe.
//
// Usage:
//   node site-freshness-check.mjs                 # probe live site, exit 1 on drift
//   node site-freshness-check.mjs --check         # self-tests, no network
// =============================================================================

import { fileURLToPath } from 'node:url';

// THE ONE BUILD MODULE THIS WATCHDOG IMPORTS, AND WHY THAT IS SAFE.
// The rule stated at DETAIL-PAGE PARITY below — mirror the build's rules rather than import
// them — is about IMPORT GRAPHS, not about imports as such. The danger there is dragging
// data.mjs -> resolve-qmi-hero.mjs -> sections.mjs into a monitor, where a parse error
// anywhere in the graph exits 1 and site-freshness.yml files a DATA incident for a
// build-code typo. redirects.mjs is a LEAF: 250 lines, ZERO import statements, one
// `export const` of literal data (verified, not assumed). There is no graph to break, and
// worker.js:7 imports it the same way.
//
// Mirroring it would be strictly worse. The retired-URL set is hand-curated and changes
// whenever marketing retires a post, and #125's index generator keys its exclusion on this
// exact table. A copy here would drift the moment someone adds a redirect, and the failure
// mode of that drift is this watchdog demanding 200 from a page a human deliberately
// 301-ed — a nightly incident nobody can close. Shared truth beats a mirror precisely when
// the data is expected to change.
import { REDIRECTS } from './redirects.mjs';

const SITE = process.env.ESP_SITE || 'https://esperanzahomes.hazardhouse.ai';
const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const GRID_PATH = '/new-homes/available/';
// The baked artifact the blog search island fetches. Regenerated in deploy.yml as of #125
// (9416e039); before that it only ever ran from build.mjs and sat 2 entries stale in prod.
const BLOG_INDEX_PATH = '/blog-index.json';

// Detail-page parity is 187 HEAD requests today (127 blogs + 60 plans). Measured
// 2026-07-29 against production: 4.5s wall clock at this concurrency, bodies not
// transferred. Deliberately NOT capped by count — a cap would silently shrink coverage
// as the blog grows, and "the check passed" would quietly start meaning "the check
// looked at some of it". The per-attempt log line prints the count so growth is visible.
const DETAIL_CONCURRENCY = Number(process.env.ESP_DETAIL_CONCURRENCY || 12);

// A card's slug is the authoritative per-home marker in baked list HTML
// (render-lists.mjs:505 emits `<div ... data-qmi-slug="...">`). Counting cards or
// diffing addresses is looser; the slug attribute is what the renderer keys on.
const QMI_SLUG_RE = /\bdata-qmi-slug="([^"]*)"/g;

export function bakedSlugs(html) {
  const out = new Set();
  for (const m of String(html ?? '').matchAll(QMI_SLUG_RE)) {
    const slug = m[1].trim();
    if (slug) out.add(slug);
  }
  return out;
}

// The public /qmi payload is Airtable-shaped: { homes: [ { fields: {...} } ] }, so
// slug/address live under `fields`, NOT at the top level. Reading the top level
// yields an empty set and therefore a fake "206 stale cards" verdict — this bit me
// on the first run of this very script. Accept both shapes so the comparison can
// never silently see zero published homes.
export function homeFields(h) {
  if (!h) return null;
  return h.fields && typeof h.fields === 'object' ? h.fields : h;
}

// Mirrors render-lists.mjs isRenderableHome: a home with neither address nor slug
// is skipped by the renderer, so it must not be counted as "missing" from the grid.
export function publishedSlugs(homes) {
  const out = new Set();
  for (const h of homes ?? []) {
    const f = homeFields(h);
    if (!f) continue;
    if (!f.address && !f.slug) continue; // renderer skips these
    if (f.slug) out.add(String(f.slug).trim());
  }
  return out;
}

/** Pure comparison so it is testable without network. */
export function compareFreshness(apiHomes, gridHtml) {
  const expected = publishedSlugs(apiHomes);
  const baked = bakedSlugs(gridHtml);
  const missing = [...expected].filter((s) => !baked.has(s)).sort(); // published but not on the grid
  const extra = [...baked].filter((s) => !expected.has(s)).sort();   // on the grid but unpublished
  return { expected: expected.size, baked: baked.size, missing, extra, drift: missing.length + extra.length };
}

// ---------------------------------------------------------------------------
// DETAIL-PAGE PARITY (blogs, floor plans)
//
// WHY A LOCAL MIRROR OF THE PATH RULES INSTEAD OF IMPORTING THE REAL ONES.
// paths.floorplanPath() and generate-blogs.blogPath() ARE the authoritative
// derivations, and importing them would guarantee agreement — but it would also drag
// data.mjs -> resolve-qmi-hero.mjs and sections.mjs into a monitor that today imports
// nothing but node:url. A parse error anywhere in that graph would kill this script
// with an uncaught throw, node would exit 1, and site-freshness.yml reads exit 1 as
// "the public site does not match the live API" — a DATA incident filed for a build-code
// typo. So the rules are mirrored here, and the --check block imports the real functions
// and asserts the mirror agrees on a table of cases. Divergence fails `check:render` at
// PR time instead of paging someone at 3am. Same tactic this file already uses to pin
// the workflow YAML in routeExitCode().
//
// Kept byte-identical to data.mjs:24. Pinned by a test below.
const slugifyLocal = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// RETIRED PATHS. See the note on the REDIRECTS import at the top of this file for why this
// one module is imported while the path rules are mirrored.
//
// worker.js:340 is the whole mechanism for these paths: `REDIRECTS[p] || REDIRECTS[slashed]`
// -> 301. Nothing else in the worker redirects a /blog/<slug>/ or /floorplans/<slug>/ URL
// (checked: the other branches key on /new-homes/, /available/, page-N pagination, and the
// literal Retama paren slug), so this table is the complete answer to "is this path
// deliberately retired?" for the two surfaces below.
export function isRetiredPath(path, table = REDIRECTS) {
  const p = String(path ?? '');
  const slashed = p.endsWith('/') ? p : p + '/';
  return Boolean(table[p] || table[slashed]);
}

// Payload accessors, mirroring the shapes the build already tolerates:
// generate-blogs.fetchBlogs reads `blogs || results || <array>`; data.loadData reads
// `floorplans || floor_plans || <array>`. Live today: { blogs: [...] } / { floorplans: [...] },
// FLAT — note that is NOT the /qmi shape, which nests under `fields`. Accepting both here
// is what stops an API reshape from silently yielding "0 expected" and a fake all-clear.
export function blogList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.blogs ?? payload?.results ?? [];
}
export function floorplanList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.floorplans ?? payload?.floor_plans ?? [];
}

// generate-blogs.mjs:`if (!b.slug) continue;` — a slug-less post is SKIPPED by the
// renderer, so it has no page and must not be reported missing. Note it does NOT fall
// back to slugify(title), unlike floor plans. The raw slug is used verbatim: O'Neill
// canonical URLs contain double dashes and re-slugifying would break every SEO link.
export function expectedBlogPaths(blogs) {
  const out = [];
  const seen = new Set();
  for (const b of blogList(blogs)) {
    if (!b?.slug) continue;
    const path = `/blog/${b.slug}/`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ kind: 'blog', slug: String(b.slug), path });
  }
  return out;
}

// paths.mjs:floorplanPath = `/floorplans/${fp.slug || slugify(fp.name)}/`. The name
// fallback is load-bearing and not hypothetical: the live payload carries a plan
// ("Masseto", id admcf7c07e90d5141) with slug === '', and it is served at
// /floorplans/masseto/. Reading fp.slug alone would expect `/floorplans//` and report a
// phantom missing page on every run. Floor plans are NOT re-slugified the way
// normCommunity re-slugifies community slugs, so the raw value is used as-is.
export function expectedFloorplanPaths(floorplans) {
  const out = [];
  const seen = new Set();
  for (const fp of floorplanList(floorplans)) {
    const slug = (fp?.slug || slugifyLocal(fp?.name)) || '';
    if (!slug) continue; // no slug and no name => no derivable URL, so nothing to demand
    const path = `/floorplans/${slug}/`;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ kind: 'floorplan', slug: String(slug), path });
  }
  return out;
}

/**
 * The demanded set, with deliberately-retired URLs removed.
 *
 * Split out from expectedBlogPaths/expectedFloorplanPaths rather than folded into them so
 * the raw derivations stay pinnable against the real builders (the builders DO bake a page
 * for a retired-but-published post; it is only this check's DEMAND that drops it), and so
 * the retired count is reportable instead of silently vanishing from the denominator.
 */
export function detailTargets(blogs, floorplans, { table = REDIRECTS } = {}) {
  const all = [...expectedBlogPaths(blogs), ...expectedFloorplanPaths(floorplans)];
  const targets = [];
  const retired = [];
  for (const t of all) (isRetiredPath(t.path, table) ? retired : targets).push(t);
  return { targets, retired };
}

/**
 * HEAD every expected detail page. Split three ways on purpose:
 *
 *   missing     — a definite non-200 from the site. This IS a freshness verdict.
 *   unreachable — the fetch threw (DNS, TLS, socket). This is NOT a verdict about the
 *                 site; #119's first real failure was exactly this shape (ETIMEDOUT +
 *                 ENETUNREACH from a runner), and counting it as drift would file a data
 *                 incident for a network blip.
 *   checked     — how many were actually looked at, so a shrinking denominator is visible
 *                 in the log rather than hiding behind a green run.
 *
 * HEAD, not GET: existence is the assertion, and 186 full pages is ~29 MB of body per
 * attempt. Verified against production that the worker answers HEAD honestly — 200 for a
 * real page, 404 for an invented slug. That is worth stating because it is NOT true of
 * QMI detail URLs, which soft-404 (worker.js serves the live shell for any
 * /new-homes/tx/<a>/<b>/<c>/ so newly published homes do not 404 before a rebuild). A
 * status-code check would be meaningless there and is meaningful here.
 *
 * `redirect: 'manual'` IS LOAD-BEARING, AND THE DEFAULT WOULD HAVE MADE THIS CHECK LIE.
 * Node's fetch follows redirects by default, so a retired post whose URL 301s to /blog/
 * resolves to a 200 and counts as PRESENT. Measured on the real retired member of the set
 * (vista-verde-groundbreaking-ceremony-…, in REDIRECTS): status 200 following, 301 manual.
 * That is fail-open — a page that no longer serves its own content reads as healthy — and
 * it is indistinguishable from a working check until the day it matters. The default also
 * made the retired/demanded distinction invisible: the probe passed for the wrong reason
 * BEFORE the REDIRECTS exclusion existed, so it would have passed identically if that
 * exclusion were wrong. Verified with a fabricated slug that the check can still fail:
 * /blog/fizz-no-such-post-2026/ and /floorplans/fizz-no-such-plan/ are 404 in both modes.
 *
 * Consequently a 3xx now reports as drift like any other non-200: every DELIBERATE
 * redirect is already excluded upstream by detailTargets(), so an unexpected one means a
 * published page has started redirecting somewhere nobody declared — a renamed slug or a
 * bad REDIRECTS entry, both worth an incident.
 */
export async function probeDetailPages(targets, { concurrency = DETAIL_CONCURRENCY, fetchImpl = fetch } = {}) {
  const queue = [...targets];
  const missing = [];
  const unreachable = [];
  const workers = Math.max(1, Math.min(concurrency, queue.length || 1));
  const run = async () => {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      try {
        const r = await fetchImpl(SITE + t.path, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (r.status !== 200) missing.push({ ...t, status: r.status });
      } catch (err) {
        unreachable.push({ ...t, error: err?.message || String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  const bySlug = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { checked: targets.length, missing: missing.sort(bySlug), unreachable: unreachable.sort(bySlug) };
}

/**
 * Surface 4: the blog search index.
 *
 * ONE-DIRECTIONAL on purpose. A demanded post missing from the index is #125's exact bug —
 * live, linked, unfindable by site search — and it is what this asserts. The reverse (an
 * index entry with no API row) is REPORTED IN THE LOG BUT NOT COUNTED AS DRIFT, because
 * nothing prunes blog directories: unpublish a post in D1 and its baked dir survives, so
 * the generator keeps indexing it, and there is no code path today that would clear the
 * incident. Measured 2026-07-29 19:3xZ, live: 126 demanded, 126 entries, set-equal in both
 * directions — so the reverse is clean today and turning it into an assertion later is a
 * one-line change IF blog pruning ever lands. Until then, log it; do not page on it.
 *
 * Keyed on `href`, which is what the search island consumes (gen-blog-index emits
 * `{ href, title, image, date, excerpt }` — there is no `slug` field, and reading one
 * yields undefined for every entry and a fake "126 missing" verdict; that mistake cost me
 * a bogus reading of this very payload before I checked the shape).
 */
/**
 * The verdict arithmetic, extracted from main() so it can be TESTED rather than trusted.
 *
 * This exists for the same reason routeExitCode() does. Every surface added to this file has
 * to be added in TWO places — the comparison that finds drift, and the sum that decides
 * whether drift fails the run — and a new surface wired into the first but not the second
 * produces a check that measures, logs, and then reports success. That is my own recurring
 * bug shape (a condition read in one statement, the decision taken in another), so the sum
 * is a function with a test per surface instead of an expression buried in a loop.
 *
 * `unverified` is deliberately NOT clean: no drift found, but some pages were never read, so
 * the parity claim is incomplete and must route to exit 3 rather than close an incident.
 */
export function summarize({ drift = 0, detailMissing = 0, indexMissing = 0, detailUnreachable = 0 } = {}) {
  const totalDrift = drift + detailMissing + indexMissing;
  return {
    totalDrift,
    clean: totalDrift === 0 && detailUnreachable === 0,
    unverified: totalDrift === 0 && detailUnreachable > 0,
  };
}

export function compareBlogIndex(indexPayload, demandedBlogTargets) {
  const entries = Array.isArray(indexPayload) ? indexPayload : (indexPayload?.posts ?? []);
  const hrefs = entries.map((e) => String(e?.href ?? '')).filter(Boolean);
  const present = new Set(hrefs);
  const demanded = demandedBlogTargets.map((t) => t.path);
  const missing = demanded.filter((p) => !present.has(p)).sort();
  const orphaned = [...present].filter((h) => !demanded.includes(h)).sort(); // logged, never drift
  const duplicated = hrefs.length - present.size;
  return { entries: entries.length, demanded: demanded.length, missing, orphaned, duplicated };
}

// THE SETTLE WINDOW MUST OUTLAST THE EDGE CACHE, OR THIS CHECK CRIES WOLF.
//
// Measured 2026-07-29 17:47Z against production: the grid is returned with
// `cache-control: public, max-age=300` (worker.js sets this on every HTML response)
// and `cf-cache-status: HIT` for a plain request, for `Cache-Control: no-cache`, for
// `Pragma: no-cache`, and for a query-string cache-buster — all four produced the
// byte-identical body (md5 15db013b…). So a requester CANNOT force origin truth from
// outside: the edge may serve a copy up to 300s old.
//
// I previously believed a real `Cache-Control: no-cache` request header bypassed this
// zone. That belief does not survive re-testing, and it matters here: this step runs
// straight after a deploy, so a pre-deploy edge copy is the EXPECTED first read. A
// settle window shorter than max-age would report the old grid as drift on a site that
// is actually correct — a false alarm on every genuine unpublish.
//
// So derive the floor for the settle window from the response's own max-age rather
// than a hand-picked constant that silently rots if the TTL changes.
// The cap matters: the TTL is read from a RESPONSE HEADER, i.e. server-controlled
// input. Terra measured `max-age=86400` on this site earlier the same day, and an
// 86400s TTL would derive a 24-HOUR settle budget — a wedged CI job holding a runner,
// caused by nothing worse than a cache-header change. Bound it. Past the cap the check
// reports drift rather than waiting: a TTL that long is itself the freshness bug.
export const MAX_SETTLE_MS = 8 * 60_000;

export function settleBudgetMs(maxAgeSeconds, { attempts, delayMs }) {
  const configured = Math.max(0, (attempts - 1)) * delayMs;
  const edgeFloor = Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
    ? maxAgeSeconds * 1000 + 30_000 // TTL + margin for the fetch and clock skew
    : 0;
  return Math.min(MAX_SETTLE_MS, Math.max(configured, edgeFloor));
}

export function parseMaxAge(cacheControl) {
  const m = /(?:^|[\s,])max-age=(\d+)/i.exec(String(cacheControl ?? ''));
  return m ? Number(m[1]) : NaN;
}

// The workflow's exit-code contract, declared here rather than only in YAML comments so
// it can be TESTED. site-freshness.yml routes on these codes; the routing was where the
// silent path lived, so the routing gets asserted.
//
//   OBSERVED codes: the probe reached both the site and the API and returned a verdict.
//   Anything else means it produced no verdict at all.
export const OBSERVED_EXIT_CODES = ['0', '1', '2'];

/**
 * Mirror of the four `if:` predicates in .github/workflows/site-freshness.yml, so the
 * routing can be proven exhaustive without dispatching a run.
 *
 * This exists because of a real bug: the drift branch tested `code == 1 || code == 2` and
 * the close branch tested `outcome == 'success'`, and exit 3 matched NEITHER. Since the
 * step is `continue-on-error`, a persistently blind watchdog produced a GREEN run with no
 * incident — silent failure in the one workflow whose entire job is to end silent failure.
 *
 * Keep these expressions in lockstep with the YAML. If they diverge, the test below is
 * asserting a fiction, so the assertions also pin the exact literal predicates.
 */
export function routeExitCode(code) {
  const c = code == null ? '' : String(code);
  const observed = OBSERVED_EXIT_CODES.includes(c);
  return {
    openDrift: c === '1' || c === '2',
    closeDrift: c === '0',
    openUnavailable: !observed,
    closeUnavailable: observed,
  };
}

async function main() {
  // Retry before declaring drift: a flaky watchdog is worse than none, because people
  // learn to ignore it. Real drift persists across the whole window and still trips;
  // an edge copy from before this deploy ages out and clears.
  // Poll frequently but bound the total wait by the edge TTL. The interval is short so
  // a run exits as soon as the edge refreshes; the BUDGET is what must outlast max-age.
  // (Long interval + few attempts would idle a runner for minutes past the point the
  // site was already correct.)
  const attempts = Number(process.env.ESP_FRESHNESS_ATTEMPTS || 8);
  const delayMs = Number(process.env.ESP_FRESHNESS_DELAY_MS || 20000);
  const startedAt = Date.now();
  let last = null;
  let budgetMs = Math.max(0, attempts - 1) * delayMs;
  // Attempt 1 HEADs every expected detail page; later attempts re-probe ONLY the ones
  // that failed. A settle loop is waiting for the edge to age out a stale copy, so
  // re-asking about the 180 pages already proven 200 costs requests and proves nothing.
  // `null` means "probe them all"; an array narrows the set.
  let retryDetail = null;
  // The narrowed retry set would otherwise make the final log line read `detail=0/0`,
  // which looks exactly like "coverage silently vanished". Carry attempt 1's real
  // denominator so the closing verdict reports what was actually inspected.
  let detailCheckedFirst = null;
  for (let i = 1; ; i++) {
    // A TRANSIENT FETCH ERROR IS NOT DRIFT. The runner reaching neither the site nor
    // the API says nothing about whether the grid matches D1 — and #119's own first
    // real failure was exactly this (ETIMEDOUT/ENETUNREACH from a runner). Left
    // unhandled, an uncaught throw exits 1, which this watchdog's caller reads as
    // "the public grid does not match the live API" and files a data incident for a
    // network blip. Retry within the same settle budget; only give up if every attempt
    // failed to observe anything, and then exit 3 (distinct from 1 drift / 2 parser).
    try {
      last = await probeOnce({ retryDetail });
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      console.error(`site-freshness attempt ${i}: probe could not complete — ${err.message}`);
      if (elapsed + delayMs > budgetMs) {
        console.error('site-freshness: UNABLE TO OBSERVE the site or the API within the settle budget. This is NOT a freshness verdict.');
        process.exit(3);
      }
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    if (last.parserError) {
      console.error(`site-freshness: PARSER ERROR — ${last.parserErrorDetail}. Refusing to report drift.`);
      process.exit(2);
    }
    if (detailCheckedFirst == null) detailCheckedFirst = last.detail.checked;
    // Recomputed from the live response so a worker-side TTL change can't leave this
    // check probing inside a cache window it doesn't know about.
    budgetMs = settleBudgetMs(last.maxAge, { attempts, delayMs });
    console.log(
      `site-freshness attempt ${i}: api_published=${last.expected} grid_baked=${last.baked}`
      + ` missing=${last.missing.length} extra=${last.extra.length}`
      + ` | detail_checked=${last.detail.checked} detail_missing=${last.detail.missing.length}`
      + ` detail_unreachable=${last.detail.unreachable.length}`
      + ` (blogs=${last.detail.blogCount} plans=${last.detail.floorplanCount} retired=${last.detail.retiredCount})`
      + ` | index_entries=${last.blogIndex.entries} index_missing=${last.blogIndex.missing.length}`
      + ` index_orphaned=${last.blogIndex.orphaned.length}`
      + ` [cf-cache-status=${last.cacheStatus ?? 'n/a'} age=${last.age ?? 'n/a'} max-age=${Number.isFinite(last.maxAge) ? last.maxAge : 'n/a'}]`
    );
    const detailMissing = last.detail.missing.length;
    const detailUnreachable = last.detail.unreachable.length;
    const indexMissing = last.blogIndex.missing.length;
    // Orphaned index entries and duplicates are REPORTED, never counted as drift — see
    // compareBlogIndex. Nothing prunes blog dirs, so there is no code path that could
    // clear such an incident, and an alert that cannot be closed is an alert people mute.
    if (last.blogIndex.orphaned.length || last.blogIndex.duplicated) {
      console.log(`  note (not drift): ${last.blogIndex.orphaned.length} index entr(ies) with no API row, ${last.blogIndex.duplicated} duplicate href(s)`);
    }
    const { totalDrift, clean, unverified } = summarize({
      drift: last.drift, detailMissing, indexMissing, detailUnreachable,
    });
    if (clean) {
      console.log(`site-freshness: grid matches the live API; ${detailCheckedFirst} blog/floor-plan detail pages all present; all ${last.blogIndex.demanded} posts in the search index`);
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed + delayMs > budgetMs) {
      if (totalDrift) {
        console.log(`  drift of ${totalDrift} (grid ${last.drift} + detail ${detailMissing} + index ${indexMissing}) still present after ${Math.round(elapsed / 1000)}s (settle budget ${Math.round(budgetMs / 1000)}s, edge max-age ${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s) — treating as real`);
        break;
      }
      // No drift, but some pages were never observed. That is NOT a clean bill of health:
      // the parity claim is incomplete, so it must not close the drift incident. Exit 3 is
      // the "no verdict" code and routes to the watchdog-unavailable incident instead.
      if (unverified) {
        console.error(`site-freshness: ${detailUnreachable} detail page(s) could not be read for the whole settle budget — parity is UNVERIFIED, not clean.`);
        for (const u of last.detail.unreachable.slice(0, 10)) console.error(`    ${u.kind} ${u.path} — ${u.error}`);
        process.exit(3);
      }
      // Unreachable by construction — clean returned above, and summarize() partitions the
      // rest into totalDrift and unverified (asserted exhaustively in --check). Kept, and
      // kept as exit 3, because the alternative is worse in both directions: falling through
      // would busy-loop (the budget is already spent, so the guard above stays true and the
      // loop would spin without waiting), and throwing would exit 1, which site-freshness.yml
      // reads as "the public site does not match the live API" — a DATA incident filed for an
      // internal arithmetic bug. A state this file cannot explain is by definition not a
      // verdict, so it routes to watchdog-unavailable.
      console.error('site-freshness: INTERNAL — no drift, not clean, not unverified. Refusing to report a verdict; treat this as a broken monitor.');
      process.exit(3);
    }
    const waitingOn = totalDrift
      ? `drift of ${totalDrift} (grid ${last.drift} + detail ${detailMissing} + index ${indexMissing})`
      : `${detailUnreachable} unreadable detail page(s)`;
    console.log(`  ${waitingOn} — the edge may still be serving a pre-deploy copy (age=${last.age ?? '?'}s of max-age=${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s); waiting ${delayMs}ms and re-probing`);
    // Narrow the next attempt to the pages that actually failed. Both families are
    // retried: a missing page may simply not have reached the edge yet, and an
    // unreachable one may be a one-off socket error.
    retryDetail = [...last.detail.missing, ...last.detail.unreachable]
      .map(({ kind, slug, path }) => ({ kind, slug, path }));
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (last.missing.length) console.log(`  published but NOT on grid: ${last.missing.slice(0, 20).join(', ')}`);
  if (last.extra.length) console.log(`  on grid but NOT published: ${last.extra.slice(0, 20).join(', ')}`);
  for (const m of last.detail.missing.slice(0, 20)) console.log(`  published but NO page: ${m.kind} ${m.path} -> HTTP ${m.status}`);
  if (last.detail.unreachable.length) {
    console.log(`  ${last.detail.unreachable.length} detail page(s) unreadable this attempt (not counted as drift): ${last.detail.unreachable.slice(0, 5).map((u) => u.path).join(', ')}`);
  }
  for (const p of last.blogIndex.missing.slice(0, 20)) console.log(`  published but NOT in the search index: ${p} — live and linked, yet unfindable by site search (#125's bug)`);
  const parts = [];
  if (last.drift) parts.push(`${last.drift} QMI grid home(s)`);
  if (last.detail.missing.length) parts.push(`${last.detail.missing.length} missing detail page(s) of ${detailCheckedFirst} checked`);
  if (last.blogIndex.missing.length) parts.push(`${last.blogIndex.missing.length} post(s) missing from ${BLOG_INDEX_PATH}`);
  console.error(`site-freshness: DRIFT — ${parts.join(' + ')} persisted across ${attempts} probes. The public site does not match the live API.`);
  process.exit(1);
}

async function probeOnce({ retryDetail = null } = {}) {
  // `Cache-Control: no-cache` is sent as a courtesy, NOT as a guarantee. Measured
  // 2026-07-29 against production: this zone returns cf-cache-status: HIT and a
  // byte-identical body for a plain request, this header, `Pragma: no-cache`, and a
  // query-string cache-buster alike. Nothing a client sends forces origin truth here,
  // which is exactly why main() sizes its settle window from the response max-age
  // instead of trusting a single read.
  const gridRes = await fetch(SITE + GRID_PATH, { headers: { 'Cache-Control': 'no-cache' } });
  if (!gridRes.ok) throw new Error(`grid ${GRID_PATH} -> ${gridRes.status}`);
  const html = await gridRes.text();
  const cacheStatus = gridRes.headers.get('cf-cache-status');
  const ageHeader = gridRes.headers.get('age');
  const age = ageHeader == null ? null : Number(ageHeader);
  const maxAge = parseMaxAge(gridRes.headers.get('cache-control'));

  const apiRes = await fetch(`${API}/qmi`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!apiRes.ok) throw new Error(`api /qmi -> ${apiRes.status}`);
  const payload = await apiRes.json();
  const homes = Array.isArray(payload) ? payload : (payload.homes ?? payload.qmi ?? []);
  if (!homes.length) throw new Error('empty API payload — refusing to judge freshness');

  const r = compareFreshness(homes, html);
  // Guard against judging the site with a broken parser. A payload-shape change
  // (e.g. slugs moving out of `fields`) would yield expected=0 and report every
  // baked card as stale — a 206-home false positive, which is exactly what the
  // first run of this script did. Zero parsed slugs from a non-empty payload is a
  // parser bug, never a real site state, so fail loudly and distinctly.
  if (r.expected === 0) {
    return {
      ...r, parserError: true,
      parserErrorDetail: `${homes.length} homes in the /qmi payload but 0 slugs parsed`,
      payloadCount: homes.length, cacheStatus, age, maxAge,
      detail: emptyDetail(), blogIndex: emptyBlogIndex(),
    };
  }

  // --- blog + floor-plan detail parity -------------------------------------
  // Same failure discipline as /qmi above: an empty payload is refused rather than
  // judged (a build with zero plans is a broken API, not a site with zero plans), and a
  // non-empty payload that yields zero expected URLs is a PARSER bug, never a real state.
  const [blogPayload, fpPayload] = await Promise.all([
    fetchJson('/blogs'),
    fetchJson('/floorplans'),
  ]);
  const blogRows = blogList(blogPayload);
  const fpRows = floorplanList(fpPayload);
  if (!blogRows.length) throw new Error('empty API payload for /blogs — refusing to judge detail parity');
  if (!fpRows.length) throw new Error('empty API payload for /floorplans — refusing to judge detail parity');

  const blogTargets = expectedBlogPaths(blogRows);
  const fpTargets = expectedFloorplanPaths(fpRows);
  // Blogs legitimately yield fewer targets than rows (generate-blogs skips slug-less
  // posts), so the guard is "zero out of many", not "fewer than the row count".
  if (!blogTargets.length || !fpTargets.length) {
    return {
      ...r, parserError: true,
      parserErrorDetail: `detail payloads parsed to 0 URLs (blogs ${blogRows.length} rows -> ${blogTargets.length} urls, floorplans ${fpRows.length} rows -> ${fpTargets.length} urls)`,
      payloadCount: homes.length, cacheStatus, age, maxAge,
      detail: { ...emptyDetail(), blogCount: blogTargets.length, floorplanCount: fpTargets.length },
      blogIndex: emptyBlogIndex(),
    };
  }

  // Drop deliberately-retired URLs from the demand. Done on the DERIVED paths rather than
  // the rows so blogs and plans go through one rule, and so `retired` is a real count in
  // the log instead of a silent shrink in the denominator.
  const { targets: all, retired } = detailTargets(blogRows, fpRows);
  if (!all.length) {
    return {
      ...r, parserError: true,
      parserErrorDetail: `every derived detail URL is in REDIRECTS (${retired.length} retired of ${blogTargets.length + fpTargets.length}) — refusing to report an all-clear from an empty demand`,
      payloadCount: homes.length, cacheStatus, age, maxAge,
      detail: { ...emptyDetail(), blogCount: blogTargets.length, floorplanCount: fpTargets.length },
      blogIndex: emptyBlogIndex(),
    };
  }
  // A narrowed retry set is filtered against the CURRENT expected set, so a post deleted
  // in D1 between attempts stops being demanded instead of failing forever.
  const wanted = new Set(all.map((t) => t.path));
  const toProbe = retryDetail ? retryDetail.filter((t) => wanted.has(t.path)) : all;
  const probed = await probeDetailPages(toProbe);

  // Surface 4. Fetched from the SITE, not the repo: a committed-but-undeployed artifact is
  // precisely the drift #125 fixed, so reading the tree would assert the wrong thing.
  // A failed fetch THROWS, which main() classifies as unobservable (exit 3) rather than as
  // drift — the index being unreadable says nothing about whether it is correct.
  const indexRes = await fetch(SITE + BLOG_INDEX_PATH, { headers: { 'Cache-Control': 'no-cache' } });
  if (!indexRes.ok) throw new Error(`site ${BLOG_INDEX_PATH} -> ${indexRes.status}`);
  const blogIndex = compareBlogIndex(await indexRes.json(), all.filter((t) => t.kind === 'blog'));
  if (blogIndex.entries === 0) {
    return {
      ...r, parserError: true,
      parserErrorDetail: `${BLOG_INDEX_PATH} parsed to 0 entries — the artifact shape changed, so every post would read as unfindable`,
      payloadCount: homes.length, cacheStatus, age, maxAge,
      detail: { ...emptyDetail(), blogCount: blogTargets.length, floorplanCount: fpTargets.length },
      blogIndex: emptyBlogIndex(),
    };
  }

  return {
    ...r,
    parserError: false,
    payloadCount: homes.length,
    cacheStatus, age, maxAge,
    detail: {
      ...probed,
      blogCount: blogTargets.length,
      floorplanCount: fpTargets.length,
      retiredCount: retired.length,
    },
    blogIndex,
  };
}

// A factory, not a shared constant: the two arrays would otherwise be the SAME objects
// on every returned result, so anything that later appends to one would silently mutate
// every earlier verdict. Cheap to get right, miserable to debug.
const emptyDetail = () => ({ checked: 0, missing: [], unreachable: [], blogCount: 0, floorplanCount: 0, retiredCount: 0 });
const emptyBlogIndex = () => ({ entries: 0, demanded: 0, missing: [], orphaned: [], duplicated: 0 });

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`api ${path} -> ${res.status}`);
  return res.json();
}

// ENTRY-POINT GUARD, matching the repo convention (data.mjs:235, render-lists.mjs,
// build.mjs:358 all use this exact form). Without it, merely IMPORTING this module to
// reuse compareFreshness() executes main() and fires a live probe as a side effect —
// which is exactly what happened the first time I imported it from a test harness: two
// spurious "site-freshness attempt 1" probes ran before my own assertions. A library
// that hits the network on import is a trap for the next caller.
const IS_ENTRY = process.argv[1] === fileURLToPath(import.meta.url);

if (process.argv.includes('--check') && IS_ENTRY) {
  const assert = (await import('node:assert/strict')).default;

  // Slug extraction from real renderer output shape.
  const html = '<div class="col-12 col-md-6 mb-2" data-qmi-slug="a-st"><h3>A</h3></div>'
    + '<div class="col-12 col-md-6 mb-2" data-qmi-slug="b-st"><h3>B</h3></div>';
  assert.deepEqual([...bakedSlugs(html)].sort(), ['a-st', 'b-st']);
  assert.equal(bakedSlugs('').size, 0, 'empty html yields no slugs');
  assert.equal(bakedSlugs('<div data-qmi-slug="">x</div>').size, 0, 'blank slug ignored');

  // A home with neither address nor slug is skipped by render-lists, so it is not
  // "missing" — mirroring isRenderableHome keeps this from crying wolf.
  assert.deepEqual([...publishedSlugs([{ slug: 'a-st' }, { community: 'c', price: 1 }])], ['a-st']);

  // REAL PAYLOAD SHAPE. The live API returns { homes: [ { fields: { slug } } ] }.
  // Reading the top level instead produced expected=0 and a bogus "206 stale cards"
  // verdict on this script's first live run. Assert the nested shape explicitly so a
  // regression here fails a test rather than paging someone at 3am.
  assert.deepEqual(
    [...publishedSlugs([{ id: 'rec1', fields: { slug: 'a-st', address: '1 A St' } }])],
    ['a-st'],
    'Airtable-shaped payload: slug read from fields'
  );
  assert.deepEqual(
    [...publishedSlugs([{ fields: { address: '1 A St' } }])],
    [],
    'fields present but no slug => not counted'
  );
  // Flat shape must keep working, so the check survives an API flattening.
  assert.deepEqual([...publishedSlugs([{ slug: 'flat-st' }])], ['flat-st'], 'flat shape still supported');

  // The nested-shape regression, end to end: had homeFields() not existed, this
  // would report both cards as stale extras instead of a clean match.
  const nested = [{ fields: { slug: 'a-st' } }, { fields: { slug: 'b-st' } }];
  assert.equal(compareFreshness(nested, html).drift, 0, 'nested payload vs baked grid => clean');
  assert.equal(compareFreshness(nested, html).expected, 2, 'nested payload parses 2 homes');

  // Clean state.
  let r = compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }], html);
  assert.equal(r.drift, 0, 'matching sets => no drift');
  assert.equal(r.expected, 2);
  assert.equal(r.baked, 2);

  // The 3926 Peggy Dr incident: unpublished in D1, still baked on the grid.
  r = compareFreshness([{ slug: 'a-st' }], html);
  assert.deepEqual(r.extra, ['b-st'], 'stale card still on grid is caught');
  assert.equal(r.drift, 1);

  // Inverse: a newly published home that never got baked.
  r = compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }, { slug: 'c-st' }], html);
  assert.deepEqual(r.missing, ['c-st'], 'published-but-unbaked home is caught');

  // NEGATIVE CONTROL: the check must be capable of reporting drift=0 AND nonzero.
  // A probe that always returns 0 would pass every test above vacuously.
  assert.ok(compareFreshness([{ slug: 'a-st' }], html).drift > 0, 'harness can detect drift');
  assert.ok(compareFreshness([{ slug: 'a-st' }, { slug: 'b-st' }], html).drift === 0, 'harness can report clean');

  // SETTLE WINDOW vs EDGE TTL. The whole reason this check is not a single fetch:
  // production serves the grid with max-age=300 and no client header bypasses it, so
  // the first post-deploy read is EXPECTED to be a pre-deploy copy. If the settle
  // budget were shorter than the TTL, every genuine unpublish would raise a false
  // alarm at the moment it was actually working.
  assert.equal(parseMaxAge('public, max-age=300'), 300);
  assert.equal(parseMaxAge('max-age=300, public'), 300);
  assert.ok(Number.isNaN(parseMaxAge('public, no-store')), 'absent max-age => NaN');
  assert.ok(Number.isNaN(parseMaxAge(null)), 'missing header => NaN');
  // Boundary guard on the directive name. NOTE: `s-maxage` is spelled without the
  // hyphen, so it is NOT a trap for a naive /max-age=/ — I first asserted it was, and
  // the assertion was vacuous (a naive regex passes it too; verified by mutation).
  // The real trap is a directive that ENDS in `max-age`, which a naive regex matches
  // mid-token and misreads as the TTL.
  assert.ok(Number.isNaN(parseMaxAge('public, x-max-age=999')), 'a directive ending in max-age must not match');
  assert.ok(Number.isNaN(parseMaxAge('public, s-maxage=600')), 's-maxage carries no max-age value');
  // When both are present the real max-age wins, not whichever appears first.
  assert.equal(parseMaxAge('public, s-maxage=600, max-age=300'), 300, 'max-age wins over s-maxage');

  // The budget must outlast the real 300s TTL even when the configured retry schedule
  // is far too short — this is the regression that would reintroduce false alarms.
  assert.ok(
    settleBudgetMs(300, { attempts: 5, delayMs: 15000 }) > 300_000,
    '300s TTL must dominate a 60s configured schedule'
  );
  assert.equal(settleBudgetMs(300, { attempts: 5, delayMs: 15000 }), 330_000, 'TTL + 30s margin');
  // HARD CAP on server-controlled input. An 86400s max-age must not wedge the job for a
  // day; it is bounded and reported instead.
  assert.equal(settleBudgetMs(86400, { attempts: 8, delayMs: 20000 }), MAX_SETTLE_MS, 'absurd TTL is capped');
  assert.equal(settleBudgetMs(3600, { attempts: 8, delayMs: 20000 }), MAX_SETTLE_MS, '1h TTL is capped');
  assert.ok(MAX_SETTLE_MS > 330_000, 'the cap must still allow the real 300s TTL to settle');
  // A configured schedule cannot exceed the cap either.
  assert.equal(settleBudgetMs(300, { attempts: 200, delayMs: 45000 }), MAX_SETTLE_MS, 'configured schedule is capped too');
  // Unknown/absent TTL falls back to the configured schedule rather than 0 or Infinity.
  assert.equal(settleBudgetMs(NaN, { attempts: 8, delayMs: 45000 }), 315_000, 'NaN TTL => configured schedule');
  assert.equal(settleBudgetMs(0, { attempts: 3, delayMs: 1000 }), 2000, 'zero TTL => configured schedule');
  // Defaults shipped in main() must clear the measured 300s TTL. With a short poll
  // interval the configured schedule alone does NOT — the TTL floor is what carries it,
  // which is precisely why the floor exists rather than a bigger attempt count.
  assert.ok(
    settleBudgetMs(300, { attempts: 8, delayMs: 20000 }) > 300_000,
    'shipped defaults must yield a budget past the 300s edge TTL'
  );
  assert.ok(
    Math.max(0, 8 - 1) * 20000 < 300_000,
    'shipped interval x attempts is deliberately under the TTL; the floor supplies the rest'
  );

  // ==========================================================================
  // WORKFLOW ROUTING — the exit code must never fall between the branches.
  //
  // This is a regression test for a bug Sol caught in review: exit 3 matched neither the
  // drift branch nor the close branch, and `continue-on-error` swallowed the failure, so a
  // watchdog that could not see the site AT ALL produced a green run and no incident. The
  // monitor built to end silent failure was failing silently.
  //
  // Every code below asserts what BOTH incidents do, not just the one under discussion,
  // because the dangerous states are the combinations: a code that opens nothing, or one
  // that closes a drift incident it has no evidence about.
  const routes = [
    // code, openDrift, closeDrift, openUnavailable, closeUnavailable
    ['0', false, true, false, true], // healthy: clears both
    ['1', true, false, false, true], // drift: opens drift, and CLEARS unavailable (it saw the site)
    ['2', true, false, false, true], // parser broken: same — it observed, it just can't parse
    ['3', false, false, true, false], // blind: opens unavailable, touches NEITHER drift branch
  ];
  for (const [code, openDrift, closeDrift, openUnavail, closeUnavail] of routes) {
    const r = routeExitCode(code);
    assert.equal(r.openDrift, openDrift, `exit ${code}: openDrift`);
    assert.equal(r.closeDrift, closeDrift, `exit ${code}: closeDrift`);
    assert.equal(r.openUnavailable, openUnavail, `exit ${code}: openUnavailable`);
    assert.equal(r.closeUnavailable, closeUnavail, `exit ${code}: closeUnavailable`);
  }

  // THE ACTUAL BUG, named. Exit 3 must produce an incident, and it must not be the data
  // one. Before the fix both of these were false and true respectively.
  assert.ok(routeExitCode('3').openUnavailable, 'exit 3 MUST open the unavailable incident');
  assert.ok(!routeExitCode('3').openDrift, 'exit 3 must NOT open a data-drift incident');
  assert.ok(!routeExitCode('3').closeDrift, 'exit 3 must NOT close a data-drift incident');

  // Sol's separation requirement: closing "watchdog unavailable" must never resolve real
  // drift. Exit 1 is the case that proves the two are independent — observability is back,
  // the data is still wrong, so one closes and the other opens.
  assert.ok(routeExitCode('1').closeUnavailable && routeExitCode('1').openDrift,
    'recovered-but-drifting: clears unavailable, keeps/opens drift');

  // EXHAUSTIVENESS, including codes nobody planned for. A node crash, a 127 from a missing
  // binary, or a step that died before writing $GITHUB_OUTPUT at all must default to
  // surfacing something rather than to silence.
  for (const code of ['3', '4', '127', '', null, undefined, 'abc', '00', ' 0']) {
    const r = routeExitCode(code);
    const opens = r.openDrift || r.openUnavailable;
    assert.ok(opens, `unhandled exit ${JSON.stringify(code)} must open SOME incident, never pass silently`);
  }
  // Exactly-one-of on the open branches, and on the close branches, for every code: the
  // two families partition the space rather than overlapping or leaving a gap.
  for (const code of ['0', '1', '2', '3', '4', '127', '', 'abc']) {
    const r = routeExitCode(code);
    assert.notEqual(r.openDrift && r.openUnavailable, true, `exit ${code}: cannot open both incidents`);
    assert.equal(r.openUnavailable, !r.closeUnavailable, `exit ${code}: unavailable open/close are complements`);
  }
  // '0' as a string is what GitHub gives us; a numeric 0 must route identically rather
  // than falling through a truthiness check.
  assert.deepEqual(routeExitCode(0), routeExitCode('0'), 'numeric 0 routes as "0"');

  // ==========================================================================
  // DETAIL-PAGE PARITY — blogs and floor plans.

  // PIN THE PATH RULES AGAINST THE REAL BUILDERS. slugifyLocal/expectedBlogPaths/
  // expectedFloorplanPaths are hand mirrors kept here so the watchdog imports nothing at
  // runtime (see the comment on slugifyLocal). That is only safe if the mirror is proven
  // to agree, so import the authoritative functions HERE, in the offline self-test, and
  // assert equality over the cases that actually differ between them. If the builder's
  // URL derivation moves, `npm run check:render` fails at PR time instead of the watchdog
  // filing a phantom incident at 3am.
  // Heads-up for the next reader: importing data.mjs here also prints
  // "resolve-qmi-hero.mjs demo() passed". That module guards its demo on
  // `process.argv.includes('--check')` ALONE, with no entry-point check, so it self-tests
  // on import whenever --check is in argv. Harmless and offline, and check:render already
  // runs it first in its own right — but the extra line is expected output, not a bug here.
  const { slugify: realSlugify } = await import('./data.mjs');
  const { floorplanPath: realFloorplanPath } = await import('./paths.mjs');
  const { blogPath: realBlogPath } = await import('./generate-blogs.mjs');

  for (const s of [
    'Masseto', 'Acuna II', 'Bear & Bull', 'El Edén', '  spaced  name  ', '', null, undefined,
    'Trailing-', '-Leading', 'Multiple   Spaces', '123 Numeric', 'Vista Verde - Now Selling',
  ]) {
    assert.equal(slugifyLocal(s), realSlugify(s), `slugify mirror diverges on ${JSON.stringify(s)}`);
  }

  // floorplanPath's `fp.slug || slugify(fp.name)` fallback, case by case. The empty-slug
  // row is REAL live data ("Masseto"), not a hypothetical: reading fp.slug alone would
  // demand `/floorplans//` on every single run.
  for (const fp of [
    { slug: 'agave', name: 'Agave' },
    { slug: '', name: 'Masseto' },
    { slug: null, name: 'Acuna II' },
    { slug: undefined, name: 'Bear & Bull' },
    { slug: 'acuna-ii', name: 'Completely Different' },
  ]) {
    assert.deepEqual(
      expectedFloorplanPaths([fp]).map((t) => t.path),
      [realFloorplanPath(fp)],
      `floorplan path mirror diverges on ${JSON.stringify(fp)}`
    );
  }
  // slug AND name both empty => no derivable URL, so demand nothing rather than
  // demanding `/floorplans//` forever.
  assert.deepEqual(expectedFloorplanPaths([{ slug: '', name: '' }]), [], 'unnameable plan yields no target');

  // blogPath keeps the RAW slug — O'Neill canonical URLs carry double dashes and
  // re-slugifying would 404 every inbound SEO link. Pin that against the real function.
  const dbl = { slug: 'vista-verde-is-off-to-a-strong-start--now-selling-in-laredo', title: 'Vista Verde' };
  assert.deepEqual(expectedBlogPaths([dbl]).map((t) => t.path), [realBlogPath(dbl)], 'double-dash blog slug preserved');
  assert.equal(expectedBlogPaths([dbl])[0].path, '/blog/vista-verde-is-off-to-a-strong-start--now-selling-in-laredo/');

  // generate-blogs.mjs does `if (!b.slug) continue` — a slug-less post is SKIPPED by the
  // renderer, so it has no page and must never be reported missing. Note this is the
  // OPPOSITE of floor plans, which fall back to the name. Getting these two backwards is
  // the obvious mistake, so both directions are asserted.
  assert.deepEqual(expectedBlogPaths([{ slug: '', title: 'No Slug' }]), [], 'slug-less post is skipped, not missing');
  assert.deepEqual(expectedBlogPaths([{ title: 'No Slug At All' }]), [], 'absent slug is skipped');
  assert.equal(expectedFloorplanPaths([{ slug: '', name: 'No Slug' }]).length, 1, 'plan WITHOUT a slug still expects a page');

  // Payload shapes. The live endpoints are FLAT ({blogs:[…]}, {floorplans:[…]}) — not the
  // `fields`-nested /qmi shape — and the build tolerates the aliases below, so this does
  // too. An accessor that returned [] on a reshape would produce a fake all-clear.
  assert.equal(blogList({ blogs: [{ slug: 'a' }] }).length, 1, 'blogs key');
  assert.equal(blogList({ results: [{ slug: 'a' }] }).length, 1, 'results alias');
  assert.equal(blogList([{ slug: 'a' }]).length, 1, 'bare array');
  assert.equal(blogList({}).length, 0, 'unknown shape yields nothing');
  assert.equal(floorplanList({ floorplans: [{ slug: 'a' }] }).length, 1, 'floorplans key');
  assert.equal(floorplanList({ floor_plans: [{ slug: 'a' }] }).length, 1, 'floor_plans alias');
  assert.equal(floorplanList([{ slug: 'a' }]).length, 1, 'bare array');

  // Duplicate rows must collapse to one demanded URL, or a duplicated D1 row would make
  // the probe fire the same HEAD twice and double-count a single missing page.
  assert.equal(expectedBlogPaths([{ slug: 'a' }, { slug: 'a' }]).length, 1, 'duplicate blog slugs collapse');
  assert.equal(expectedFloorplanPaths([{ slug: 'a' }, { slug: 'a' }]).length, 1, 'duplicate plan slugs collapse');
  // …and a slug-less plan that slugifies onto an existing slug collapses too.
  assert.equal(expectedFloorplanPaths([{ slug: 'masseto' }, { slug: '', name: 'Masseto' }]).length, 1, 'name fallback collides with explicit slug');

  {
    const t = detailTargets([{ slug: 'b' }], [{ slug: 'f' }], { table: {} });
    assert.equal(t.targets.length, 2, 'combined targets');
    assert.deepEqual(t.targets.map((x) => x.kind), ['blog', 'floorplan'], 'kinds tagged');
    assert.deepEqual(t.retired, [], 'nothing retired with an empty table');
  }

  // ==========================================================================
  // RETIRED PATHS — the exclusion that keeps this check from demanding a 200 from a URL
  // a human deliberately 301-ed.
  assert.equal(isRetiredPath('/blog/gone/', { '/blog/gone/': '/blog/' }), true, 'exact key matches');
  assert.equal(isRetiredPath('/blog/gone', { '/blog/gone/': '/blog/' }), true, 'unslashed path matches the slashed key');
  assert.equal(isRetiredPath('/blog/here/', { '/blog/gone/': '/blog/' }), false, 'unlisted path is not retired');
  assert.equal(isRetiredPath('', {}), false, 'empty path is not retired');
  assert.equal(isRetiredPath(null, {}), false, 'null path is not retired');
  // A falsy VALUE must not count as a redirect, or a typo'd table entry would silently
  // drop a page from the demand.
  assert.equal(isRetiredPath('/blog/x/', { '/blog/x/': '' }), false, 'empty destination is not a redirect');

  // PIN AGAINST THE SHIPPED TABLE, not a fixture. This is the real retired member of the
  // set, and it is the reason the exclusion exists at all: it is a PUBLISHED row in D1
  // whose URL 301s to /blog/. If someone removes this redirect the assertion fails here,
  // at PR time, rather than the watchdog demanding a page that no longer redirects.
  const RETIRED_SLUG = 'vista-verde-groundbreaking-ceremony-celebrates-new-community-coming-to-laredo';
  const LIVE_SLUG = 'vista-verde-is-off-to-a-strong-start--now-selling-in-laredo';
  assert.equal(isRetiredPath(`/blog/${RETIRED_SLUG}/`), true, 'the real retired post is excluded using the SHIPPED table');
  assert.equal(isRetiredPath(`/blog/${LIVE_SLUG}/`), false, 'the real live post is still demanded');

  // THE TWO EXCLUSIONS MUST AGREE. #125's generator decides what goes INTO the index;
  // this file decides what is DEMANDED of it. If they diverge, one of them is wrong every
  // single night: a post the generator skips but this file demands is a permanent red, and
  // the reverse silently stops checking a post that is in the index. Same table, asserted
  // to agree on the real slugs rather than assumed to.
  const { isIndexablePostDir } = await import('./scripts/gen-blog-index.mjs');
  for (const slug of [RETIRED_SLUG, LIVE_SLUG]) {
    assert.equal(
      isRetiredPath(`/blog/${slug}/`), !isIndexablePostDir(slug),
      `retired/indexable must be exact complements for ${slug}`
    );
  }

  {
    // A retired post is dropped from the demand and counted, not silently vanished.
    const table = { '/blog/gone/': '/blog/' };
    const t = detailTargets([{ slug: 'here' }, { slug: 'gone' }], [{ slug: 'plan' }], { table });
    assert.deepEqual(t.targets.map((x) => x.path), ['/blog/here/', '/floorplans/plan/'], 'retired path dropped from the demand');
    assert.deepEqual(t.retired.map((x) => x.path), ['/blog/gone/'], 'retired path is reported, not discarded');
    // The raw derivations must STILL produce it — the builders do bake a page for a
    // retired-but-published post; only the demand drops it. If expectedBlogPaths itself
    // filtered, the mirror would no longer match the real blogPath() it is pinned against.
    assert.equal(expectedBlogPaths([{ slug: 'gone' }]).length, 1, 'the derivation is unfiltered; only the demand excludes');
  }

  // probeDetailPages classification, with a stub fetch. The THREE-WAY split is the point:
  // a 404 is a verdict, a thrown fetch is NOT (that is #119's ETIMEDOUT shape, and
  // counting it as drift files a data incident for a network blip).
  {
    const stub = async (url) => {
      if (url.includes('/boom/')) throw new Error('ETIMEDOUT');
      return { status: url.includes('/gone/') ? 404 : 200 };
    };
    const targets = [
      { kind: 'blog', slug: 'ok', path: '/blog/ok/' },
      { kind: 'blog', slug: 'gone', path: '/blog/gone/' },
      { kind: 'floorplan', slug: 'boom', path: '/floorplans/boom/' },
    ];
    const res = await probeDetailPages(targets, { fetchImpl: stub, concurrency: 2 });
    assert.equal(res.checked, 3, 'checked counts every target');
    assert.deepEqual(res.missing.map((m) => m.path), ['/blog/gone/'], '404 is drift');
    assert.equal(res.missing[0].status, 404, 'status is recorded for the incident body');
    assert.deepEqual(res.unreachable.map((u) => u.path), ['/floorplans/boom/'], 'a throw is NOT drift');
    assert.equal(res.unreachable[0].error, 'ETIMEDOUT', 'the transport error is kept for the log');

    // NEGATIVE CONTROL: the harness must be able to report a clean result too, or every
    // assertion above passes vacuously against a probe that always finds something.
    const clean = await probeDetailPages(
      [{ kind: 'blog', slug: 'ok', path: '/blog/ok/' }],
      { fetchImpl: stub, concurrency: 2 }
    );
    assert.equal(clean.missing.length + clean.unreachable.length, 0, 'harness can report clean');

    // HEAD, not GET — 186 GETs is ~29 MB of body per attempt. Assert the method actually
    // sent, because "it still passes" would hide a silent regression to GET.
    //
    // `redirect: 'manual'` IS ASSERTED THE SAME WAY AND FOR A SHARPER REASON. Node's fetch
    // FOLLOWS redirects by default, so a page that 301s to a 200 reads as present: measured
    // on the real retired post, status 200 following vs 301 manual. Dropping this option
    // would make the check fail open, and — this is the part that matters — every other
    // assertion in this file would still pass, because they all stub fetch. So the option
    // itself is pinned.
    const opts = [];
    await probeDetailPages(targets.slice(0, 1), {
      fetchImpl: async (_u, o) => { opts.push(o); return { status: 200 }; },
    });
    assert.deepEqual(opts.map((o) => o?.method), ['HEAD'], 'detail parity must use HEAD');
    assert.deepEqual(opts.map((o) => o?.redirect), ['manual'],
      'detail parity must NOT follow redirects — following makes a 301-ed page read as present');

    // And the consequence: a 3xx counts as drift. Every DELIBERATE redirect is already gone
    // from the demand (detailTargets), so one arriving here means a published page started
    // redirecting somewhere nobody declared.
    const red = await probeDetailPages(
      [{ kind: 'blog', slug: 'moved', path: '/blog/moved/' }],
      { fetchImpl: async () => ({ status: 301 }) }
    );
    assert.deepEqual(red.missing.map((m) => m.status), [301], 'an undeclared 301 is drift, not a pass');

    // Empty target list must not hang or divide by zero on the worker count.
    const none = await probeDetailPages([], { fetchImpl: stub });
    assert.equal(none.checked, 0, 'empty target list is a no-op');
  }

  // ==========================================================================
  // THE VERDICT SUM — one assertion per surface, because the way this check dies quietly is
  // a surface that gets compared and logged but never counted.
  assert.equal(summarize({}).clean, true, 'nothing wrong => clean');
  assert.equal(summarize({}).totalDrift, 0);
  for (const surface of ['drift', 'detailMissing', 'indexMissing']) {
    const r = summarize({ [surface]: 1 });
    assert.equal(r.totalDrift, 1, `${surface} must contribute to totalDrift`);
    assert.equal(r.clean, false, `${surface} must not report clean`);
    assert.equal(r.unverified, false, `${surface} is drift, not an unverified state`);
  }
  // All three at once, so a sum that overwrites instead of adding is caught.
  assert.equal(summarize({ drift: 2, detailMissing: 3, indexMissing: 4 }).totalDrift, 9, 'surfaces add, they do not replace');
  // Unreachable pages: not drift, but emphatically not clean either.
  {
    const r = summarize({ detailUnreachable: 1 });
    assert.equal(r.totalDrift, 0, 'an unreadable page is not drift');
    assert.equal(r.clean, false, 'but it is NOT a clean bill of health');
    assert.equal(r.unverified, true, 'it is the unverified state, which routes to exit 3');
  }
  // Real drift outranks unverified: a confirmed 404 is a verdict even if other pages were
  // unreadable, so it must exit 1 (drift) rather than 3 (no verdict).
  {
    const r = summarize({ detailMissing: 1, detailUnreachable: 5 });
    assert.equal(r.unverified, false, 'confirmed drift wins over unreadable pages');
    assert.equal(r.clean, false);
  }
  // clean/unverified are mutually exclusive for every combination, so main()'s branches
  // cannot both fire or both miss.
  for (const d of [0, 1]) for (const dm of [0, 1]) for (const im of [0, 1]) for (const du of [0, 1]) {
    const r = summarize({ drift: d, detailMissing: dm, indexMissing: im, detailUnreachable: du });
    assert.notEqual(r.clean && r.unverified, true, `clean and unverified overlap at ${d}${dm}${im}${du}`);
    assert.equal(r.clean, r.totalDrift === 0 && du === 0, `clean is exactly no-drift-and-all-read at ${d}${dm}${im}${du}`);
  }

  // ==========================================================================
  // SURFACE 4 — the blog search index. This is #125's bug turned into an assertion.
  {
    const demanded = [
      { kind: 'blog', slug: 'live', path: '/blog/live/' },
      { kind: 'blog', slug: 'other', path: '/blog/other/' },
    ];
    const entry = (href) => ({ href, title: 't', image: '', date: 'July 8, 2026', excerpt: '' });

    let r = compareBlogIndex([entry('/blog/live/'), entry('/blog/other/')], demanded);
    assert.equal(r.missing.length, 0, 'complete index => clean');
    assert.equal(r.entries, 2);
    assert.equal(r.demanded, 2);

    // #125's EXACT bug: a live, linked, published post absent from the index — unfindable
    // by site search while its page serves 200. Page parity cannot see this.
    r = compareBlogIndex([entry('/blog/live/')], demanded);
    assert.deepEqual(r.missing, ['/blog/other/'], 'a demanded post missing from the index is drift');

    // An index entry with no API row is REPORTED, NOT DRIFT. Nothing prunes blog dirs, so
    // no code path could clear such an incident — see compareBlogIndex.
    r = compareBlogIndex([entry('/blog/live/'), entry('/blog/other/'), entry('/blog/stale/')], demanded);
    assert.deepEqual(r.orphaned, ['/blog/stale/'], 'an orphaned entry is surfaced');
    assert.equal(r.missing.length, 0, 'an orphaned entry must NOT be reported as drift');

    // Duplicates are counted (a doubled search hit), also not drift.
    r = compareBlogIndex([entry('/blog/live/'), entry('/blog/live/'), entry('/blog/other/')], demanded);
    assert.equal(r.duplicated, 1, 'duplicate hrefs counted');
    assert.equal(r.missing.length, 0, 'a duplicate is not a missing post');

    // KEYED ON `href`. gen-blog-index emits { href, title, image, date, excerpt } and there
    // is NO slug field. Reading `slug` yields undefined for every entry and a full-set
    // "everything is missing" verdict — I made exactly that mistake reading this payload by
    // hand before checking its shape, and it looked like a production outage.
    r = compareBlogIndex([{ slug: 'live' }, { slug: 'other' }], demanded);
    assert.equal(r.missing.length, 2, 'slug-keyed entries carry no href, so nothing is present');
    assert.equal(r.entries, 2, 'but the entry count still reflects a non-empty payload');
    // …which is why probeOnce distinguishes "0 entries" (parser error, exit 2) from
    // "entries present but none match" (real drift). Both must be reachable.
    assert.equal(compareBlogIndex([], demanded).entries, 0, 'empty payload is detectable as empty');

    // Object-wrapped shape tolerated alongside the bare array the generator writes.
    assert.equal(compareBlogIndex({ posts: [entry('/blog/live/')] }, demanded).entries, 1, 'posts-wrapped shape');
    // Blank/absent hrefs are ignored rather than matching a blank demand.
    assert.equal(compareBlogIndex([entry(''), entry('/blog/live/')], demanded).missing.length, 1, 'blank href ignored');

    // NEGATIVE CONTROL: the comparison must be able to report both clean and dirty, or
    // every assertion above is vacuous.
    assert.ok(compareBlogIndex([entry('/blog/live/')], demanded).missing.length > 0, 'harness can detect index drift');
    assert.ok(compareBlogIndex([entry('/blog/live/'), entry('/blog/other/')], demanded).missing.length === 0, 'harness can report clean');

    // Floor plans must never be demanded of the BLOG index. probeOnce filters on
    // kind === 'blog'; if that filter were dropped, all 60 plans would read as missing.
    const mixed = [...demanded, { kind: 'floorplan', slug: 'p', path: '/floorplans/p/' }];
    assert.equal(
      compareBlogIndex([entry('/blog/live/'), entry('/blog/other/')], mixed.filter((t) => t.kind === 'blog')).missing.length,
      0,
      'only blog targets are demanded of the blog index'
    );
  }

  // PIN THE YAML. routeExitCode() is only a valid model of the workflow if the workflow
  // still says what it says here. Assert the four literal `if:` predicates, so editing the
  // YAML without editing this file fails the build instead of silently invalidating every
  // assertion above.
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const wf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '.github/workflows/site-freshness.yml'), 'utf8');
  const expectedIfs = [
    "if: steps.probe.outputs.exit_code == '1' || steps.probe.outputs.exit_code == '2'",
    "if: steps.probe.outputs.exit_code == '0'",
    "if: steps.probe.outputs.exit_code != '0' && steps.probe.outputs.exit_code != '1' && steps.probe.outputs.exit_code != '2'",
    "if: steps.probe.outputs.exit_code == '0' || steps.probe.outputs.exit_code == '1' || steps.probe.outputs.exit_code == '2'",
  ];
  for (const expr of expectedIfs) {
    assert.ok(wf.includes(expr), `site-freshness.yml must still contain: ${expr}`);
  }
  // No branch may route on step OUTCOME again. `continue-on-error` makes outcome/conclusion
  // diverge, and `outcome == 'success'` is precisely what let exit 3 escape.
  assert.ok(
    !/^\s*if:.*steps\.probe\.outcome/m.test(wf),
    'no branch may key on steps.probe.outcome — that is the bug that let exit 3 fall through'
  );
  // The two incident titles must be distinct, or "watchdog unavailable" would close real
  // drift by title collision — the thing Sol explicitly required must not happen.
  const titles = [...wf.matchAll(/^\s+TITLE:\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(titles.length >= 4, `expected 4 title-keyed steps, found ${titles.length}`);
  assert.equal(new Set(titles).size, 2, 'exactly two distinct incident titles');
  const [driftTitle, unavailTitle] = [...new Set(titles)];
  assert.notEqual(driftTitle, unavailTitle, 'drift and unavailable incidents must be separately titled');
  assert.equal(titles.filter((t) => t === driftTitle).length, 2, 'drift title used by exactly its open+close pair');
  assert.equal(titles.filter((t) => t === unavailTitle).length, 2, 'unavailable title used by exactly its open+close pair');

  console.log('site-freshness-check.mjs --check passed');
} else if (IS_ENTRY) {
  await main();
}
