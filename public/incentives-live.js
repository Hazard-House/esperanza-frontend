/* incentives-live.js — refresh per-home promo banners on /incentives/* pages.
 * Cards ship from the June scrape with the page-level incentive text baked in;
 * each home's live promo_text from D1 wins (flex vs rate vs none). */
(function () {
  'use strict';
  if (!/^\/incentives\//.test(location.pathname)) return;
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };

  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  function slugFromCard(card) {
    var a = card.querySelector('a[href*="/new-homes/tx/"]');
    if (!a) return null;
    var m = String(a.getAttribute('href') || '').match(/\/([^/]+)\/\d+\/?(?:#|$)/);
    return m ? m[1] : null;
  }

  function patchPromo(card, f) {
    var aspect = card.querySelector('.oi-aspect');
    if (!aspect) return;
    var promoEl = card.querySelector('.banner.overlay-promo');
    var avail = card.querySelector('.banner.green:not(.overlay-promo), .banner.gray:not(.overlay-promo)');
    if (!f || !f.promo_text) {
      if (promoEl && promoEl.parentNode) promoEl.parentNode.removeChild(promoEl);
      if (avail) avail.style.top = '';
      return;
    }
    var color = promoBannerClass(f.promo_banner_style, f.promo_text);
    if (!promoEl) {
      promoEl = document.createElement('div');
      promoEl.className = 'banner overlay-promo ' + color;
      aspect.insertBefore(promoEl, aspect.firstChild);
    } else {
      promoEl.classList.remove('green', 'tan');
      promoEl.classList.add(color);
    }
    promoEl.textContent = f.promo_text;
    if (avail) avail.style.top = '2.5rem';
  }

  fetchT(API + '/qmi').then(function (r) { return r.json(); }).then(function (res) {
    var byId = {}, bySlug = {};
    (res.homes || []).forEach(function (h) {
      var f = h.fields || h;
      if (h.id) byId[h.id] = f;
      if (f.slug) bySlug[f.slug] = f;
    });
    document.querySelectorAll('.card.spec-card[data-listing-id]').forEach(function (card) {
      var id = card.getAttribute('data-listing-id');
      var slug = slugFromCard(card);
      var f = (id && byId[id]) || (slug && bySlug[slug]);
      patchPromo(card, f);
    });
  }).catch(function () {});
})();
