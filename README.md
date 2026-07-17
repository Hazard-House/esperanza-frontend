# esperanza-oneill-railway

The O'Neill/Homefiniti Esperanza Homes site (June-8-2026 static scrape) re-hosted on
Railway, with every dependency re-pointed at **our** Cloudflare infrastructure instead
of O'Neill's. Proof-of-concept: 3 flagship pages, one of them running off the **live**
public API.

**Live:** https://esperanza-oneill-static-production.up.railway.app
- `/` — homepage (static, images from R2, homepage Mapbox map)
- `/new-homes/available/` — **live** Quick-Move-Ins: cards + clustered Mapbox map fetched
  from the public API at runtime (not the frozen scrape)
- `/new-homes/tx/mcallen/tres-lagos-master-planned-community/12091/` — community page
  (static, R2 images, live LotVue site-map iframe)

Any other path 302-redirects to the still-live `www.esperanzahomes.com` (Caddyfile
`handle_errors`), so nav stays clickable until more pages are migrated.

## How it works

`build.mjs` assembles `public/` from the scrape at
`/Users/mgd/Downloads/esperanzahomes.com-static-2026-06-08` and rewrites the 3 pages:

| From (O'Neill) | To (ours) |
|---|---|
| `media.esperanzahomes.com/…` | `img.hazardhouse.ai/assets-media/…` (R2 CDN) |
| `media.homefiniti.com/…` | `img.hazardhouse.ai/assets-media/homefiniti/…` |
| `static.esperanzahomes.com/…` | `/static/…` (theme bundled into the deploy) |
| `/xhr/*` form endpoints | placeholder host (forms deferred — HubSpot later) |
| O'Neill Mapbox token + custom styles | our token + `mapbox/streets-v11` |

Images: the scrape references each image with **and** without a file extension
(responsive srcset), but R2 objects only exist at the real extension —
`media-keys-esperanza.txt` / `media-keys-homefiniti.txt` map base path → real key so both
forms resolve. Those lists came from the one-time R2 upload of the two static pages'
images (fetched from live O'Neill, uploaded under `assets-media/`).

The **available page** is special: `build.mjs` removes oilib's `<script>` and injects
`islands/available-live.js`, which fetches `/api/public/qmi` + `/api/public/communities`
(same-origin — Caddy reverse-proxies to `esperanza-api…workers.dev` to dodge CORS),
renders cards in the scrape's own markup, and draws a clustered Mapbox map.

## Rebuild & deploy

**Site:** https://esperanzahomes.hazardhouse.ai (Cloudflare Workers Static Assets)

```bash
node build.mjs            # assemble ./public (needs the June-8 scrape on the build machine)
node build.mjs --check      # run the rewrite self-checks
git add public && git commit -m "…" && git push origin main   # ship HTML/assets in git

npm install                 # once — pulls wrangler
npx wrangler login          # once — or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run deploy              # uploads ./public to esperanzahomes.hazardhouse.ai
```

`wrangler.jsonc` defines the Worker (`worker.js` + `./public` assets). The deploy
command targets the top-level environment (`--env=""`) so it always hits the custom
domain, not the optional `staging` workers.dev preview.

⚠ `public/` must NOT be git-ignored — both git and Wrangler ship from the committed
`public/` tree (CI does not run `build.mjs`).

## Deferred (per scope — "match up the rest later")

- **Forms** → HubSpot: `/xhr/*` point at a placeholder. Wire per-endpoint HubSpot form
  GUIDs (contact, request-information, tour, osc/footer-chat, general, referral, realtor)
  once provided, ideally through the `esperanza-ops` worker.
- **Full image migration**: only the 3 flagship pages' images are in R2. The other ~980
  pages still 404 their images (they redirect to live O'Neill anyway). Bulk top-up = fetch
  remaining originals from live O'Neill → `assets-media/` (mind the R2 rate limit).
- **PDF gates** (`/xhr/*-download/`) → point at our auto-generated QMI-filter / community
  PDF workers.
- **Dynamic PDFs** already work: available-page cards link "VIEW HOME" to each home's live
  `Dynamic PDF` brochure.
