// Esperanza / O'Neill static replica — served by Cloudflare Workers Static Assets.
// The static site lives in ./public (built by build.mjs); this Worker runs first
// (assets.run_worker_first) so it owns headers, the same-origin API proxy, the
// analytics/XHR stubs, and the 404 fallback — all edge logic in one place that
// survives rebuilds.

import { REDIRECTS } from "./redirects.mjs";

const LIVE = "https://www.esperanzahomes.com";
const API = "https://esperanza-api.round-base-ed8c.workers.dev";

// ── Lead forms ────────────────────────────────────────────────────────────────
// The O'Neill pages POST FormData to /xhr/<form>/ and expect
// {"data":{"content":"<thank-you html>"},"success":true} back (oilib injects
// data.content into the form's message div — see handle_valid_response in oilib.js).
// We forward every lead to HubSpot's public Forms Submission API on the portal the
// live site already uses for its embedded forms (8139268), so leads land in the same
// CRM the marketing team works today. No auth needed for form submissions.
// ponytail: one generic form GUID for all lead sources; the source form + every
// unmapped field is preserved in the message body. Swap HS_FORM_GUID (wrangler var)
// for a dedicated "Website Contact" form when marketing creates one.
const HS_PORTAL = "8139268";
const HS_FORM_GUID = "fb2b82de-a3c5-4c40-9dc7-abac54f2c077"; // "Act Now" lead form (firstname/lastname/email/phone)

// /xhr/ endpoints that are real lead forms on the live site (POST-only; live returns
// 405 to GET). Everything else under /xhr/ (oicheck, recommend, filter/load-more) is
// a frozen-snapshot content XHR and keeps the benign stub below.
const LEAD_XHR = new Set([
  "contact", "realtor", "referral", "general", "osc", "footer-chat",
  "request-information", "tour", "general-tour", "coming-soon", "construction",
  "two-year-warranty", "ten-year-warranty", "dontmissoutform", "designprocess",
  "detail-promo", "list-promo",
  "location-specs-download", "location-plans-download", "specs-list-download",
]);

// Direct contact-property mappings; everything else rides along in the message body.
const FIELD_MAP = { first_name: "firstname", last_name: "lastname", email: "email" };
const SKIP_FIELDS = new Set(["oicheck", "oicaptcha", "ga4_client_id", "country_code", "primary_phone", "opt_in", "page_url"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function submitLead(request, env, formName) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ errors: { email: "Invalid form submission." } }, 400);
  }
  const get = (k) => (form.get(k) || "").toString().trim();
  const email = get("email");
  // Live returns 400 to unusable payloads; client-side validation requires email on
  // every lead form, so a missing email means a bot or a broken page — don't fake success.
  if (!email) return json({ errors: { email: "Email is required." } }, 400);

  const fields = [{ name: "email", value: email }];
  if (get("first_name")) fields.push({ name: "firstname", value: get("first_name") });
  if (get("last_name")) fields.push({ name: "lastname", value: get("last_name") });
  const phone = get("primary_phone");
  if (phone) fields.push({ name: "phone", value: (get("country_code") || "") + phone });

  // Preserve everything else (message, tour date/time, item of interest, warranty
  // details, realtor/referral fields, ...) in the message body so no lead data is lost.
  const lines = [];
  const msg = get("message");
  if (msg) lines.push(msg, "");
  lines.push(`[form] ${formName}`);
  for (const [k, v] of form.entries()) {
    const val = (v || "").toString().trim();
    if (!val || k in FIELD_MAP || SKIP_FIELDS.has(k) || k === "message" || k === "email") continue;
    lines.push(`[${k}] ${val}`);
  }
  if (get("opt_in")) lines.push("[opt_in] yes");
  fields.push({ name: "message", value: lines.join("\n") });

  const pageUri = get("page_url") || request.headers.get("referer") || LIVE;
  const submitUrl =
    (env.HS_SUBMIT_URL || "https://api.hsforms.com/submissions/v3/integration/submit") +
    `/${env.HS_PORTAL || HS_PORTAL}/${env.HS_FORM_GUID || HS_FORM_GUID}`;

  const resp = await fetch(submitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields, context: { pageUri, pageName: formName } }),
  });

  if (!resp.ok) {
    console.error(`lead forward failed: ${formName} -> ${resp.status} ${await resp.text().catch(() => "")}`);
    return json({ errors: { email: "Something went wrong sending your message. Please try again or call 956-275-8069." } }, 502);
  }

  // Pages where oilib was replaced by islands submit natively (browser navigation,
  // Accept: text/html) — send them to /thankyou/ like the live site's conventional
  // form flow. AJAX (oilib) submits get the JSON contract oilib expects; it injects
  // data.content into the form's message div.
  if ((request.headers.get("accept") || "").includes("text/html")) {
    return new Response(null, { status: 303, headers: { Location: new URL("/thankyou/", request.url).toString() } });
  }
  const hs = await resp.json().catch(() => ({}));
  const thanks = hs.inlineMessage || "<p>Thank you! We've received your information and will be in touch soon.</p>";
  return json({ data: { content: thanks }, success: true });
}

// Real assets fail fast on 404; page misses serve our branded 404 page (a mangled asset
// URL must not fall through and pull down a full HTML page for every missing image).
const ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|mp4|json|xml|txt|pdf)$/i;

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

    // Cleartext http must 301 to https (live does; "Always Use HTTPS" isn't on for
    // this hostname). Sniff the visitor's real scheme from cf-visitor/x-forwarded-proto
    // when the edge request is already https. url.protocol stays "http:" under wrangler
    // dev, so local/Cursor preview subresources aren't caught in a 301 loop.
    const visitor = request.headers.get("cf-visitor") || "";
    const isCleartext =
      visitor.includes('"scheme":"http"') || request.headers.get("x-forwarded-proto") === "http";
    // url.protocol stays "http:" under wrangler dev (and Cursor's port-forward proxy
    // sends x-forwarded-proto: http on every subresource). Only upgrade when the edge
    // request itself is https — i.e. production behind Cloudflare.
    if (url.protocol !== "http:" && isCleartext) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

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

      // Draft preview (STAGING ONLY). env.PREVIEW_SECRET is bound only on the staging
      // Worker (never prod). When set, route the QMI list to the API's ungated
      // /api/preview/qmi and attach the secret, so the detail/list islands render DRAFT
      // homes on staging. Prod has no secret -> normal gated /api/public/qmi. The secret
      // is added server-side here; the browser never sees it.
      let upstreamPath = p;
      let previewing = false;
      if (env.PREVIEW_SECRET && (p === "/api/public/qmi" || p === "/api/public/qmi/")) {
        upstreamPath = "/api/preview/qmi";
        h.set("X-Esperanza-Preview", env.PREVIEW_SECRET);
        previewing = true;
      }

      const sub = new Request(API + upstreamPath + url.search, {
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
      // Never edge-cache draft previews (drafts change); cache the public JSON as before.
      out.headers.set("Cache-Control", previewing ? "no-store" : "public, s-maxage=60, max-age=30");
      return out;
    }

    // Staging preview: neutralize the HARVESTED live-facts badges + per-home cardFacts so
    // the dynamic cards (available-live.js) render the LIVE incentive/availability from the
    // API. The harvested map otherwise WINS over the API, hiding unpublished incentive
    // edits. Keep rate/taxMult/lotFormat (monthly calc + lot display). Gated by
    // env.PREVIEW_SECRET (staging only) — prod serves the file unchanged.
    if (env.PREVIEW_SECRET && p === "/live-facts.json") {
      const r = await env.ASSETS.fetch(new Request(new URL("/live-facts.json", request.url)));
      if (r.status === 200) {
        try {
          const f = await r.json();
          f.badges = {};
          f.cardFacts = {};
          return new Response(JSON.stringify(f), {
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        } catch { /* fall through to the normal asset serve below */ }
      }
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

    // Lead-form endpoints: forward the POST to HubSpot; match live's 405 on other
    // methods. Frozen-snapshot XHRs (oicheck, recommend, filter/load-more) keep the
    // benign stub so page JS resolves quietly.
    if (p.startsWith("/xhr/")) {
      const name = p.slice(5).replace(/\/+$/, "");
      if (LEAD_XHR.has(name)) {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        return submitLead(request, env, name);
      }
      return json({ data: { content: "" }, success: true });
    }

    // Live blog pagination is query-string based (?i=0&page=N); the scrape stores each
    // page as <path>/page-N/index.html. Map the query onto that directory when it exists.
    const page = url.searchParams.get("page");
    if (p.startsWith("/blog/") && page && +page >= 2) {
      const paged = await env.ASSETS.fetch(new Request(new URL(`${p}page-${+page}/`, request.url)));
      if (paged.status === 200) {
        const out = new Response(paged.body, paged);
        for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
        out.headers.set("Cache-Control", "public, max-age=300");
        return out;
      }
    }

    // Legacy live-site URL shapes (long QMI ids, drifted floor-plan ids, /new-homes/tx/
    // city stubs, retired blog slugs) 301 onto the mirror page with the same content.
    // Data lives in redirects.mjs (generated by scripts/gen-redirects.mjs against the
    // live sitemap, plus a hand-curated section at the bottom).
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
    // Never stamp long-lived caching on a non-200 (ASSETS 307-normalizes the legacy
    // "﹖v=" URLs; an immutable-cached redirect poisons that URL for a whole POP).
    if (!resp.ok) {
      out.headers.set("Cache-Control", "no-store");
    } else if (p.startsWith("/static/")) {
      out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if ((resp.headers.get("content-type") || "").includes("text/html")) {
      out.headers.set("Cache-Control", "public, max-age=300");
    }
    return out;
  },
};
