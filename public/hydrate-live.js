/* hydrate-live.js — refresh the volatile fields (price/availability/promo) on a
 * generated detail page so they are never stale between rebuilds. The page bakes
 * window.__ESPERANZA_PAGE = {type,id}; we re-fetch the record and patch the DOM. */
(function () {
  'use strict';
  var P = window.__ESPERANZA_PAGE;
  if (!P || !P.id) return;
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  // API fetch with a timeout so a hung API rejects (into the .catch, baked price stays).
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  function set(sel, val) {
    document.querySelectorAll('[data-live="' + sel + '"]').forEach(function (el) {
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    });
  }
  if (P.type !== 'qmi') return; // community/floorplan volatiles added later if needed
  fetchT(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
    var raw = (res.homes || []).filter(function (h) { return h.id === P.id; })[0];
    if (!raw) return;
    var f = raw.fields || raw;
    set('price', money(f.Price));
    // Incentive/promo is now managed in the admin — D1's promo_text is the source of
    // truth, so hydrate it live. The baked value is the frozen June harvest and goes
    // stale the moment marketing changes an incentive. (Availability stays baked: it
    // carries sale-gate logic and is known to drift from what the live original shows.)
    set('promo', f.promo_text);
  }).catch(function () {});
})();
