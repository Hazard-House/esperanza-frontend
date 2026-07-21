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
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  function set(sel, val) {
    document.querySelectorAll('[data-live="' + sel + '"]').forEach(function (el) {
      if (val == null || val === '') { el.textContent = ''; el.style.display = 'none'; }
      else { el.textContent = val; el.style.display = ''; }
    });
  }
  function setPromo(text, color) {
    document.querySelectorAll('[data-live="promo"]').forEach(function (el) {
      if (!text) { el.textContent = ''; el.style.display = 'none'; return; }
      el.textContent = text;
      el.style.display = '';
      if (color) {
        el.classList.remove('tan', 'green');
        el.classList.add(color);
      }
    });
  }
  if (P.type !== 'qmi') return; // community/floorplan volatiles added later if needed
  Promise.all([
    fetchT(API + '/qmi').then(function (r) { return r.json(); }),
    fetchT('/live-facts.json').then(function (r) { return r.json(); }).catch(function () { return {}; }),
  ]).then(function (res) {
    var data = res[0], facts = res[1] || {};
    var raw = (data.homes || []).filter(function (h) { return h.id === P.id; })[0];
    if (!raw) return;
    var f = raw.fields || raw;
    var cf = facts.cardFacts || {};
    var hit = cf[slugify(f.address)];
    if (!hit) {
      var hn = String(f.address || '').match(/^(\d+)/);
      if (hn) hit = cf[slugify(f.Community) + '/' + hn[1]];
    }
    var badge = (hit && hit.badge) || (facts.badges || {})[slugify(f.address)];
    var promoText = (badge && badge.text) || f.promo_text;
    var promoColor = badge ? badge.color : (/flex discount/i.test(promoText || '') ? 'tan' : 'green');
    // Price + availability come from D1; promo uses harvested live-facts when present
    // because fields.promo_text is often the generic site-wide flex-cash banner.
    set('price', money(f.Price));
    setPromo(promoText, promoColor);
    set('availability', f.availability_text);
  }).catch(function () {});
})();
