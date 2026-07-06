var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var LIVE = "https://www.esperanzahomes.com";
var API = "https://esperanza-api.round-base-ed8c.workers.dev";
var ASSET_RE = /\.(js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|mp4|json|xml|txt|pdf)$/i;
var REDIRECTS = {
  // live QMI slug is "5315-moses-lp"; the generated mirror page uses the full street name
  "/new-homes/tx/laredo/wolf-creek/5315-moses-lp/": "/new-homes/tx/laredo/wolf-creek/5315-moses-loop/",
  // retired blog slugs — live 301s both to the blog index
  "/blog/vista-verde-groundbreaking-new-homes-coming-to-laredo-tx/": "/blog/",
  "/blog/vista-verde-groundbreaking-ceremony-celebrates-new-community-coming-to-laredo/": "/blog/"
};
var SEC = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p.startsWith("/api/")) {
      const h = new Headers();
      const accept = request.headers.get("accept");
      if (accept) h.set("accept", accept);
      const ct = request.headers.get("content-type");
      if (ct) h.set("content-type", ct);
      h.set("origin", LIVE);
      const sub = new Request(API + p + url.search, {
        method: request.method,
        headers: h,
        body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
        redirect: "manual"
      });
      let resp2 = env.API ? await env.API.fetch(sub) : null;
      if (!resp2 || resp2.status === 503) resp2 = await fetch(new Request(sub, { redirect: "manual" }));
      const out2 = new Response(resp2.body, resp2);
      out2.headers.set("Cache-Control", "public, s-maxage=60, max-age=30");
      return out2;
    }
    if (p.startsWith("/hfa/")) return new Response("", { status: 204 });
    if (p.startsWith("/xhr/")) {
      return new Response(JSON.stringify({ data: { content: "" }, success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    const slashed = p.endsWith("/") ? p : p + "/";
    const dest = REDIRECTS[p] || REDIRECTS[slashed];
    if (dest) return Response.redirect(url.origin + dest, 301);
    if (p.includes("/retama-village-(55-)-at-bentsen-palm")) {
      return Response.redirect(url.origin + p.replace("retama-village-(55-)-at-bentsen-palm", "retama-village-55-at-bentsen-palm"), 301);
    }
    if (slashed.startsWith("/available/")) {
      return Response.redirect(url.origin + "/new-homes" + p + url.search, 301);
    }
    let req = request;
    if (slashed === "/new-homes/pdf/") {
      req = new Request(new URL("/new-homes/pdf/Communities.pdf", request.url), request);
    } else if (/^\/pdf-features\/.+\/$/.test(slashed) && p === slashed) {
      req = new Request(new URL(slashed + "Features List.pdf", request.url), request);
    } else if (slashed === "/floorplan-collections/pdf/") {
      return Response.redirect("https://esperanza-pdf.round-base-ed8c.workers.dev/pdf/list/all-plans", 302);
    }
    const resp = await env.ASSETS.fetch(req);
    if (resp.status === 404) {
      if (ASSET_RE.test(p)) return new Response("Not found", { status: 404 });
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
  }
};

// ../../../Users/mgd/.npm/_npx/355575301275d472/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../Users/mgd/.npm/_npx/355575301275d472/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-9v9H9V/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../Users/mgd/.npm/_npx/355575301275d472/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-9v9H9V/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
