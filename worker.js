// Esperanza / O'Neill static replica — served by Cloudflare Workers Static Assets.
// Replaces the Railway + Caddy setup 1:1. The static site lives in ./public (built by
// build.mjs); this Worker runs first (assets.run_worker_first) so it owns headers,
// the same-origin API proxy, the analytics/XHR stubs, and the 404 fallback — the exact
// behaviour the old Caddyfile provided, in one place that survives rebuilds.

const LIVE = "https://www.esperanzahomes.com";
const API = "https://esperanza-api.round-base-ed8c.workers.dev";

// Real assets fail fast on 404; page misses serve our branded 404 page (a mangled asset
// URL must not fall through and pull down a full HTML page for every missing image).
const ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|mp4|json|xml|txt|pdf)$/i;

// Hand-curated 301s for live URL shapes the static tree stores differently.
// NOTE: PR #10 introduces a GENERATED redirects.mjs keyed the same way; when it lands,
// fold these entries into that lookup (one mechanism) — keys don't overlap today.
const REDIRECTS = {
  // live QMI slug is "5315-moses-lp"; the generated mirror page uses the full street name
  "/new-homes/tx/laredo/wolf-creek/5315-moses-lp/": "/new-homes/tx/laredo/wolf-creek/5315-moses-loop/",
  // retired blog slugs — live 301s both to the blog index
  "/blog/vista-verde-groundbreaking-new-homes-coming-to-laredo-tx/": "/blog/",
  "/blog/vista-verde-groundbreaking-ceremony-celebrates-new-community-coming-to-laredo/": "/blog/",
};

// Site-wide security headers. No CSP on purpose: the scrape carries many third-party
// pixels a policy would break (same decision as the old Caddyfile).
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // Same-origin proxy to the public API so the browser avoids CORS (the API only
    // allows the esperanzahomes.com origin). Build a clean subrequest — forwarding the
    // incoming Host header bounces the request back to this Worker instead of the API.
    // Let the CF edge cache the JSON 60s.
    if (p.startsWith("/api/")) {
      const h = new Headers();
      const accept = request.headers.get("accept");
      if (accept) h.set("accept", accept);
      const ct = request.headers.get("content-type");
      if (ct) h.set("content-type", ct);
      h.set("origin", LIVE); // the API's allow-listed origin
      const sub = new Request(API + p + url.search, {
        method: request.method,
        headers: h,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });
      // env.API is the deployed service binding. Under `wrangler dev` the binding is a
      // 503 stub (no local esperanza-api session); fall back to a plain fetch there —
      // the 1042 worker-to-worker block that motivated the binding only applies deployed.
      let resp = env.API ? await env.API.fetch(sub) : null;
      if (!resp || resp.status === 503) resp = await fetch(new Request(sub, { redirect: "manual" }));
      const out = new Response(resp.body, resp);
      out.headers.set("Cache-Control", "public, s-maxage=60, max-age=30");
      return out;
    }

    // Homefiniti analytics beacons — 204 so the client stops chasing a dead 302.
    if (p.startsWith("/hfa/")) return new Response("", { status: 204 });

    // oilib's gallery keyword search fetches /sitesearch.json?scope=tag (the live
    // server filters by scope; static assets ignore queries). Serve the harvested
    // tag index for that scope; the frozen default file already covers the header
    // search scopes (location,plan,spec,lot,blogpost).
    if (p === "/sitesearch.json" && (url.searchParams.get("scope") || "").startsWith("tag")) {
      return env.ASSETS.fetch(new Request(new URL("/sitesearch-tag.json", request.url)));
    }

    // Frozen-snapshot XHRs (recommend, oicheck, form posts) — benign JSON so they
    // resolve quietly instead of erroring on the dead domain.
    if (p.startsWith("/xhr/")) {
      return new Response(JSON.stringify({ data: { content: "" }, success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const slashed = p.endsWith("/") ? p : p + "/";
    const dest = REDIRECTS[p] || REDIRECTS[slashed];
    if (dest) return Response.redirect(url.origin + dest, 301);

    // Old D1 community slug carried literal parens; the tree (and live) use the clean form.
    if (p.includes("/retama-village-(55-)-at-bentsen-palm")) {
      return Response.redirect(url.origin + p.replace("retama-village-(55-)-at-bentsen-palm", "retama-village-55-at-bentsen-palm"), 301);
    }

    // Scraped nav hrefs are relative; on the one-dir-shallower CLEAN community paths
    // the Quick Move-Ins link resolves to /available/ (root-clamped) instead of
    // /new-homes/available/. One redirect fixes the header on every affected page.
    if (slashed.startsWith("/available/")) {
      return Response.redirect(url.origin + "/new-homes" + p + url.search, 301);
    }

    // Live serves PDFs at extension-less URLs; the scrape stored them as named files.
    // Map the live shapes onto the stored assets (mirror pages link the filename form
    // directly, so this only matters for external/live-shape links).
    let req = request;
    if (slashed === "/new-homes/pdf/") {
      req = new Request(new URL("/new-homes/pdf/Communities.pdf", request.url), request);
    } else if (/^\/pdf-features\/.+\/$/.test(slashed) && p === slashed) {
      req = new Request(new URL(slashed + "Features List.pdf", request.url), request);
    } else if (slashed === "/floorplan-collections/pdf/") {
      // 86MB scraped PDF exceeds the 25MiB static-asset cap; the esperanza-pdf Worker
      // generates the same all-plans list from D1 (fresher data, same UX).
      return Response.redirect("https://esperanza-pdf.round-base-ed8c.workers.dev/pdf/list/all-plans", 302);
    }

    // Static assets. html_handling resolves pretty URLs (/contact -> /contact/index.html).
    const resp = await env.ASSETS.fetch(req);

    if (resp.status === 404) {
      // HTTrack stored versioned theme files as "name﹖v=hash.ext"; some scraped
      // templates (gallery) reference the real "name.ext?v=hash" URL. Map the query
      // form onto the stored filename before giving up.
      const v = url.searchParams.get("v");
      if (p.startsWith("/static/") && v && /\.\w+$/.test(p)) {
        const alt = p.replace(/\.(\w+)$/, (_, ext) => `﹖v=${encodeURIComponent(v)}.${ext}`);
        const r = await env.ASSETS.fetch(new Request(new URL(alt, request.url)));
        if (r.status === 200) {
          const out = new Response(r.body, r);
          for (const [k, val] of Object.entries(SEC)) out.headers.set(k, val);
          out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
          return out;
        }
      }
      if (ASSET_RE.test(p)) return new Response("Not found", { status: 404 });
      // Serve our branded 404 page (1:1 with the legacy site) with a real 404 status.
      const nf = await env.ASSETS.fetch(new Request(new URL("/404.html", request.url)));
      const headers = new Headers(nf.status === 200 ? nf.headers : {});
      headers.set("Content-Type", "text/html; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=300");
      for (const [k, v] of Object.entries(SEC)) headers.set(k, v);
      return new Response(nf.status === 200 ? nf.body : "Page not found", { status: 404, headers });
    }

    const out = new Response(resp.body, resp);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    if (p.startsWith("/static/")) {
      out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if ((resp.headers.get("content-type") || "").includes("text/html")) {
      out.headers.set("Cache-Control", "public, max-age=300");
    }
    return out;
  },
};
