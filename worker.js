// Esperanza / O'Neill static replica — served by Cloudflare Workers Static Assets.
// Replaces the Railway + Caddy setup 1:1. The static site lives in ./public (built by
// build.mjs); this Worker runs first (assets.run_worker_first) so it owns headers,
// the same-origin API proxy, the analytics/XHR stubs, and the 404 fallback — the exact
// behaviour the old Caddyfile provided, in one place that survives rebuilds.

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
      const resp = await env.API.fetch(sub);
      const out = new Response(resp.body, resp);
      out.headers.set("Cache-Control", "public, s-maxage=60, max-age=30");
      return out;
    }

    // Homefiniti analytics beacons — 204 so the client stops chasing a dead 302.
    if (p.startsWith("/hfa/")) return new Response("", { status: 204 });

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

    // Static assets. html_handling resolves pretty URLs (/contact -> /contact/index.html).
    const resp = await env.ASSETS.fetch(request);

    if (resp.status === 404) {
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
