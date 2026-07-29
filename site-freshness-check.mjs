// =============================================================================
// site-freshness-check.mjs — outcome-based staleness watchdog.
//
// SCOPE: the renderable QMI grid on /new-homes/available/ ONLY. It asserts that the
// baked grid lists exactly the homes the live API reports as published. It says
// NOTHING about promotion, city, community, floor-plan or blog freshness. Those ride
// the same dispatch path, so a dead dispatch surfaces here first, but a renderer bug
// confined to one of those page types will not trip this check. Do not read a green
// probe as "the whole site is fresh".
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

const SITE = process.env.ESP_SITE || 'https://esperanzahomes.hazardhouse.ai';
const API = process.env.ESP_API || 'https://esperanza-api.round-base-ed8c.workers.dev/api/public';
const GRID_PATH = '/new-homes/available/';

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
  for (let i = 1; ; i++) {
    // A TRANSIENT FETCH ERROR IS NOT DRIFT. The runner reaching neither the site nor
    // the API says nothing about whether the grid matches D1 — and #119's own first
    // real failure was exactly this (ETIMEDOUT/ENETUNREACH from a runner). Left
    // unhandled, an uncaught throw exits 1, which this watchdog's caller reads as
    // "the public grid does not match the live API" and files a data incident for a
    // network blip. Retry within the same settle budget; only give up if every attempt
    // failed to observe anything, and then exit 3 (distinct from 1 drift / 2 parser).
    try {
      last = await probeOnce();
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
      console.error(`site-freshness: PARSER ERROR — ${last.payloadCount} homes in the payload but 0 slugs parsed. Refusing to report drift.`);
      process.exit(2);
    }
    // Recomputed from the live response so a worker-side TTL change can't leave this
    // check probing inside a cache window it doesn't know about.
    budgetMs = settleBudgetMs(last.maxAge, { attempts, delayMs });
    console.log(
      `site-freshness attempt ${i}: api_published=${last.expected} grid_baked=${last.baked}`
      + ` missing=${last.missing.length} extra=${last.extra.length}`
      + ` [cf-cache-status=${last.cacheStatus ?? 'n/a'} age=${last.age ?? 'n/a'} max-age=${Number.isFinite(last.maxAge) ? last.maxAge : 'n/a'}]`
    );
    if (!last.drift) {
      console.log('site-freshness: grid matches the live API');
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed + delayMs > budgetMs) {
      console.log(`  drift of ${last.drift} still present after ${Math.round(elapsed / 1000)}s (settle budget ${Math.round(budgetMs / 1000)}s, edge max-age ${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s) — treating as real`);
      break;
    }
    console.log(`  drift of ${last.drift} — the edge may still be serving a pre-deploy copy (age=${last.age ?? '?'}s of max-age=${Number.isFinite(last.maxAge) ? last.maxAge : '?'}s); waiting ${delayMs}ms and re-probing`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  if (last.missing.length) console.log(`  published but NOT on grid: ${last.missing.slice(0, 20).join(', ')}`);
  if (last.extra.length) console.log(`  on grid but NOT published: ${last.extra.slice(0, 20).join(', ')}`);
  console.error(`site-freshness: DRIFT of ${last.drift} home(s) persisted across ${attempts} probes — the public grid does not match the live API.`);
  process.exit(1);
}

async function probeOnce() {
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
  return { ...r, parserError: r.expected === 0, payloadCount: homes.length, cacheStatus, age, maxAge };
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

  console.log('site-freshness-check.mjs --check passed');
} else if (IS_ENTRY) {
  await main();
}
