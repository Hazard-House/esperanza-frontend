/* detail-extras.js — client glue for generated detail pages: Fancybox gallery,
 * monthly-payment calculator (rate from /settings), Recommended-For-You. The pure
 * payment math is node-testable via `node islands/detail-extras.js --check`. */
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
    console.log('detail-extras.js demo() passed: $' + m + '/mo on $300k @6.15%');
  }
} else {
  (function () {
    'use strict';
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    var PAGE = window.__ESPERANZA_PAGE || {};
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
    var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

    if (window.Fancybox) window.Fancybox.bind('[data-fancybox]');

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
      fetch(API + '/settings').then(function (r) { return r.json(); }).then(function (d) {
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

    var rec = document.getElementById('recommended');
    if (rec && PAGE.type === 'qmi' && PAGE.id) {
      fetch(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
        var homes = (res.homes || []).map(function (h) { return h.fields ? Object.assign({ id: h.id }, h.fields) : h; });
        var me = homes.filter(function (h) { return h.id === PAGE.id; })[0]; if (!me) return;
        var ck = function (h) { var v = h['Community (Link)']; return Array.isArray(v) ? v[0] : v; };
        var score = function (h) { return ck(h) === ck(me) ? 3 : (h['FP: Collection'] && h['FP: Collection'] === me['FP: Collection'] ? 2 : (h.City === me.City ? 1 : 0)); };
        var pool = homes.filter(function (h) { return h.id !== PAGE.id; }).sort(function (a, b) { return score(b) - score(a); });
        rec.innerHTML = pool.slice(0, 4).map(card).join('');
      }).catch(function () {});
    }
    function fix(u) { return u ? String(u).replace(/^https:\/\/pub-9c9bfee574a54b62b2623e361b3ad305\.r2\.dev/, 'https://img.hazardhouse.ai') : u; }
    var num = function (n) { return Number(n || 0).toLocaleString('en-US'); };
    var CSTAT = '/static/esperanza_homes/images/stats/';
    var CICON = { bed: CSTAT + 'bedroom%EF%B9%96v=7516482.svg', garage: CSTAT + 'garage%EF%B9%96v=f234cc0.svg', bath: CSTAT + 'bathroom%EF%B9%96v=f390d85.svg', story: CSTAT + 'stairs%EF%B9%96v=348b88c.svg', living: CSTAT + 'livingsqft%EF%B9%96v=fc46974.svg', total: CSTAT + 'sqft%EF%B9%96v=64b8d65.svg' };
    // 1:1 O'Neill spec-card (browse-page markup) from a raw /qmi record.
    function card(h) {
      var N = Number;
      var url = '/new-homes/tx/' + slugify(h.City) + '/' + slugify(h.Community) + '/' + slugify(h.slug || h.address) + '/';
      var img = fix(h.image_url);
      var coll = h['FP: Collection'] ? String(h['FP: Collection']).replace(/\s*collection\s*$/i, '') + ' Collection' : '';
      var bn = '';
      if (h.promo_text) bn += '<div class="banner overlay-promo green">' + esc(h.promo_text) + '</div>';
      if (h.availability_text) bn += '<div class="banner gray"' + (h.promo_text ? ' style="top:2.5rem"' : '') + '>' + esc(h.availability_text) + '</div>';
      function commRow(vis) {
        return '<div class="row community-row m-0 p-2 w-100 ' + vis + '">' +
          '<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">COMMUNITY</div><div class="text-gray fs-9">' + esc(h.Community) + '</div></div>' +
          '<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">FLOOR PLAN</div><div class="text-gray fs-9">' + esc(h['Floor Plan']) + '</div>' + (coll ? '<div class="text-brown fs-9">' + esc(coll) + '</div>' : '') + '</div></div></div>' +
        '</div>';
      }
      function stat(icon, txt) { return '<div class="item col-12 d-flex align-items-center mb-1"><img class="me-2" src="' + icon + '" aria-hidden="true" loading="lazy" width="18">' + txt + '</div>'; }
      var stats = '';
      if (h.bedroom_count != null) stats += stat(CICON.bed, esc(h.bedroom_count) + ' Bedroom' + (N(h.bedroom_count) === 1 ? '' : 's'));
      if (h['FP: Garage'] != null) stats += stat(CICON.garage, esc(h['FP: Garage']) + ' Car Garage');
      if (h.bathroom_count != null) stats += stat(CICON.bath, esc(h.bathroom_count) + ' Bathroom' + (N(h.bathroom_count) === 1 ? '' : 's'));
      if (h.stories_count != null) stats += stat(CICON.story, esc(h.stories_count) + ' Stor' + (N(h.stories_count) === 1 ? 'y' : 'ies'));
      if (h.living_square_footage != null) stats += stat(CICON.living, num(h.living_square_footage) + ' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.');
      if (h.total_square_footage != null) stats += stat(CICON.total, num(h.total_square_footage) + ' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.');
      var est = h.Price ? '<a href="' + esc(url) + '#payment-calculator" class="lh-1"><span class="fs-9 overpass text-gray">ESTIMATED MONTHLY</span><br><span class="fs-9 overpass text-gray">PRICE: </span><span class="fs-9 overpass bold text-green">' + money(monthlyPayment(N(h.Price))) + '/mo*</span></a>' : '';
      var imageCol = '<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap"><div class="oi-aspect sixteen-nine four-three-xl three-two-xxl">' + bn +
        (img ? '<a href="' + esc(url) + '"><img src="' + esc(img) + '" class="oi-aspect-img" loading="lazy" alt="' + esc(h.address) + '"></a>' : '') +
        '<div class="hover-button d-none d-lg-flex"><div class="m-auto"><a href="' + esc(url) + '"><div class="btn card-button d-block my-3">VIEW HOME</div></a><a href="' + esc(url) + '#request-a-tour"><div class="btn card-button green d-block my-3">REQUEST A TOUR</div></a></div></div>' +
        '</div>' + commRow('d-none d-xl-flex') + '</div>';
      var bodyCol = '<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">' +
        '<div class="row"><a href="' + esc(url) + '"><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">' + esc(h.address) + '</div></a><div class="card-location text-green mb-2">' + esc(h.City) + ', TX' + (h.postal_code ? ' ' + esc(h.postal_code) : '') + '</div></div>' +
        '<div class="row h-100"><div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">' + money(h.Price) + '</div>' + est + '</div></div><div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">' + stats + '</div></div>' +
        '</div></div>';
      return '<div class="col-12 col-md-6 mb-2"><div class="card spec-card spec-card-detail mb-0 border border-gray p-2 h-100"><div class="row m-0 h-100">' + imageCol + bodyCol + commRow('d-flex d-xl-none') + '</div></div></div>';
    }
  })();
}
