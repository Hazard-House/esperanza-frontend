# Working in esperanza-frontend (the O'Neill replacement)

The public Esperanza Homes site: a static replica of the June-8-2026 O'Neill scrape,
re-pointed at our Cloudflare infra, with the data-driven pages rendered from the live API.
Served by `worker.js` (Cloudflare Worker + Static Assets). Read `README.md` for the full picture.

## ⚠️ Verify EVERY rendering change in the browser (not just tests)

**Before calling any change done, QA it in a real browser with `pw`** (`~/.local/bin/pw`, CDP:
`pw navigate <url>`, `pw eval "<expr>"`, `pw screenshot`). Typecheck / `node --check` / `curl` are
NOT enough here — this site is mostly-static + partially-live with harvested maps, lazy-loaded
images, and a preview passthrough, so regressions surface only in the rendered browser state.
Real examples that passed code review but broke in the browser: draft homes flooding the grid
($0 cards + missing images), the sort defaulting to Sq.Ft. instead of price, un-built homes 404ing.
Check the rendered DOM (card counts, prices, sort order, `img.naturalWidth>0` for in-viewport
images) **and** take a screenshot. A `naturalWidth===0` below-the-fold image whose URL returns 200
is just lazy-loaded, not broken — scroll it into view before judging.

## How it deploys (no local dependency)
- CI (`.github/workflows/deploy.yml`) runs `node generate-details.mjs` (bare node, no scrape) to
  re-render community/floor-plan/QMI pages from the live public API, then `wrangler deploy`.
  Push to `main` → prod (esperanzahomes.hazardhouse.ai); push to `staging` → the workers.dev staging.
- `public/` is committed; flagship/theme/blog pages ship as committed static. Regenerating THOSE
  needs the local O'Neill scrape (`~/Downloads/...`), but they don't change build-to-build.
- Islands are copied to `public/` at build. For an island-only fix that must ship without a full
  build, edit BOTH `islands/<name>.js` and the committed `public/<name>.js`.

## Spanish (`/es/`)
Every English page has a committed Spanish twin under `/es/`, baked by `es-bake.mjs` at the
end of `generate-details.mjs` (so both CI paths produce it). Strings live ONLY in
`assets/locales/`; never hand-edit a page under `public/es/`. Runtime translation is banned
— it flickered and was ripped out in PR #105. Read `docs/SPANISH_LOCALE.md` before touching
any of it. The bake must stay idempotent: `rebuild-details.yml` commits the tree back
nightly, so run it twice and confirm the second run changes zero files.

## Live vs static
- LIVE (reflect D1 immediately): `/new-homes/available/` grid, per-home detail shell
  (`/new-homes/available/home/?slug=`), which `worker.js` also serves for un-built home canonical URLs.
- Refreshed on each deploy: community / floor-plan / QMI detail pages (via the CI detail build).
- Draft preview is PER-HOME + explicit: only `?preview=1` hits the ungated `/api/preview/qmi`
  (staging worker adds `PREVIEW_SECRET`). Never blanket-rewrite the public list — it floods every
  surface with drafts.
