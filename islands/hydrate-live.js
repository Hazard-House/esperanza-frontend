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
  // API promo_banner_style: "green" | "gold" → theme classes overlay-promo green | tan.
  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }
  function set(sel, val) {
    document.querySelectorAll('[data-live="' + sel + '"]').forEach(function (el) {
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    });
  }
  function setPromo(text, style) {
    document.querySelectorAll('[data-live="promo"]').forEach(function (el) {
      if (text == null || text === '') {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.textContent = text;
      el.style.display = '';
      var color = promoBannerClass(style, text);
      el.classList.remove('green', 'tan');
      el.classList.add(color);
    });
  }
  if (P.type !== 'qmi') return; // community/floorplan volatiles added later if needed
  fetchT(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
    var raw = (res.homes || []).filter(function (h) { return h.id === P.id; })[0];
    if (!raw) return;
    var f = raw.fields || raw;
    // Hydrate every field the page marks data-live from D1 (the source of truth now):
    // price, incentive/promo (text + frame color), and availability. The baked values
    // are the frozen June harvest and go stale the moment marketing edits them in admin.
    set('price', money(f.Price));
    setPromo(f.promo_text, f.promo_banner_style);
    set('availability', f.availability_text);
  }).catch(function () {});
})();
