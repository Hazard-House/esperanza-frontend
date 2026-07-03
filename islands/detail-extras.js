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
  if (process.argv.includes('--check')) {
    var m = monthlyPayment(300000, { rate: 6.15 });
    console.assert(m > 2200 && m < 2900, 'monthlyPayment ~2600, got ' + m);
    console.assert(monthlyPayment(0) === 30, 'zero price -> hoa only, got ' + monthlyPayment(0));
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
    function card(h) {
      var url = '/new-homes/tx/' + slugify(h.City) + '/' + slugify(h.Community) + '/' + slugify(h.slug || h.address) + '/';
      var img = fix(h.image_url);
      return '<div class="col-12 col-md-6 col-lg-3 mb-3"><div class="card spec-card border border-gray p-2">' +
        (img ? '<a href="' + esc(url) + '"><div class="oi-aspect sixteen-nine"><img src="' + esc(img) + '" class="oi-aspect-img" loading="lazy" alt="' + esc(h.address) + '"></div></a>' : '') +
        '<div class="card-body"><a href="' + esc(url) + '"><div class="card-title mt-2">' + esc(h.address) + '</div></a>' +
        '<div class="card-location text-green">' + esc(h.City) + ', TX</div><div class="spec-price">' + money(h.Price) + '</div></div></div></div>';
    }
  })();
}
