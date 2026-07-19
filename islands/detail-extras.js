/* detail-extras.js — client glue for generated detail pages: Fancybox gallery,
 * monthly-payment calculator (rate from /settings), and a no-lib zoom fallback for
 * the inline floor-plan viewer. The pure math is node-testable via
 * `node islands/detail-extras.js --check`. */
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

// Floor-plan viewer zoom clamp (fallback viewer scales 1x-3x).
function clampZoom(z) { return Math.min(3, Math.max(1, z)); }

if (typeof window === 'undefined') {
  // ponytail: this file also ships as a plain (non-module) browser <script>, so it
  // can't use `import`/`import.meta` at top level (SyntaxError outside a module) —
  // a throwing local check gives the same real-failure/non-zero-exit behavior as
  // node:assert without adding module syntax. Never imported by another .mjs module,
  // so there's no --check import cascade to guard against here (unlike the other demos).
  if (process.argv.includes('--check')) {
    var check = function (cond, msg) { if (!cond) throw new Error(msg); };
    var m = monthlyPayment(300000, { rate: 6.15 });
    check(m > 2200 && m < 2900, 'monthlyPayment ~2600, got ' + m);
    check(monthlyPayment(0) === 30, 'zero price -> hoa only, got ' + monthlyPayment(0));
    check(clampZoom(0.5) === 1 && clampZoom(2) === 2 && clampZoom(9) === 3, 'clampZoom 1..3');
    console.log('detail-extras.js demo() passed: $' + m + '/mo on $300k @6.15%');
  }
} else {
  (function () {
    'use strict';
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    // API fetch with a timeout so a hung API rejects (into the .catch, default rate stays).
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };

    if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');

    // Floor-plan viewer fallback: the generated #plans section ships the original's
    // jQuery-iviewer markup + inline init; when the iviewer plugin isn't available
    // (vendor script missing/failed), wire #in/#out/#fit to a plain CSS-transform
    // zoom (clamped 1x-3x) on the plan drawing instead, so the controls always work.
    var viewer = document.getElementById('viewer');
    if (viewer && !(window.jQuery && window.jQuery.fn && window.jQuery.fn.iviewer)) {
      var planImg = document.querySelector('.plan-img-1 img');
      if (planImg && !viewer.querySelector('img')) {
        var vimg = document.createElement('img');
        vimg.src = planImg.getAttribute('src');
        vimg.alt = planImg.getAttribute('alt') || '';
        vimg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;transform-origin:center center;transition:transform .15s';
        viewer.appendChild(vimg);
        var zoom = 1;
        var apply = function () { vimg.style.transform = 'scale(' + zoom + ')'; };
        var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', function (e) { e.preventDefault(); fn(); apply(); }); };
        on('in', function () { zoom = clampZoom(zoom + 0.5); });
        on('out', function () { zoom = clampZoom(zoom - 0.5); });
        on('fit', function () { zoom = 1; });
      }
    }

    // render-qmi's hero links to data-bs-target="#payment-calculator", but the shell
    // template has no such modal (it's only in the legacy static scrape, as a full
    // jQuery oicalc widget). Inject a minimal one so the trigger has somewhere to go.
    // ponytail: price + term only (no tax/PMI/HOA inputs like the legacy widget) —
    // add fields if users need to tweak them beyond the term toggle.
    var calcTrigger = document.querySelector('[data-bs-target="#payment-calculator"]');
    if (calcTrigger && !document.getElementById('payment-calculator')) {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div class="modal fade rounded" id="payment-calculator" tabindex="-1" aria-labelledby="payment-calculator-label" aria-hidden="true">' +
        '<div class="modal-dialog modal-dialog-centered modal-lg"><div class="modal-content">' +
        '<button type="button" class="btn-close fs-6 ms-auto me-2 mt-2" data-bs-dismiss="modal" aria-label="Close"></button>' +
        '<div class="modal-header py-0"><div class="col text-center">' +
        '<div class="fs-4 bodoni ls-sm" id="payment-calculator-label">Calculate Monthly Payment</div>' +
        '<div class="green-bar-light my-2 my-lg-3 mx-auto"></div></div></div>' +
        '<div class="modal-body"><div class="row"><div class="col-11 col-lg-8 mx-auto text-center">' +
        '<div class="btn-group mb-3" role="group" id="calc-term-group">' +
        '<button type="button" class="btn btn-outline-green" data-term="15">15 Yr</button>' +
        '<button type="button" class="btn btn-outline-green active" data-term="30">30 Yr</button></div>' +
        '<div class="gray-box p-3"><div class="fs-9 text-brown">Estimated Monthly Payment</div>' +
        '<div id="mort-calc-total" class="fs-3 bold text-dark-green mt-1">--</div></div>' +
        '</div></div></div></div></div>';
      document.body.appendChild(wrap.firstChild);
    }

    var calcResult = document.getElementById('mort-calc-total');
    if (calcResult) {
      var priceEl = document.querySelector('[data-live="price"]');
      var price = Number((priceEl && priceEl.textContent || '').replace(/[^0-9.]/g, '')) || 0;
      var rate = 6.15, term = 30;
      var renderCalc = function () { calcResult.textContent = price ? money(monthlyPayment(price, { rate: rate, term: term })) + '/mo' : '--'; };
      renderCalc();
      fetchT(API + '/settings').then(function (r) { return r.json(); }).then(function (d) {
        rate = (d.settings && Number(d.settings.mortgage_rate)) || rate;
        renderCalc();
      }).catch(function () {});
      var termGroup = document.getElementById('calc-term-group');
      if (termGroup) termGroup.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('[data-term]'); if (!btn) return;
        term = Number(btn.getAttribute('data-term'));
        Array.prototype.forEach.call(termGroup.children, function (b) { b.classList.toggle('active', b === btn); });
        renderCalc();
      });
    }

    // ponytail: the old #recommended QMI-card hydration is gone — generated pages now
    // ship a static Recommended For You floor-plan carousel (sections.mjs).
  })();
}
