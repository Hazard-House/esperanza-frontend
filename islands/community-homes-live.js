/* community-homes-live — reconcile baked Quick-Move-In cards on community (and
 * floor-plan) detail pages against the live public API.
 *
 * 1. Drop cards for homes no longer published (sold/unpublished).
 * 2. Refresh promo banner text + frame color from promo_text / promo_banner_style
 *    (green for 4.99% rate promos, gold/tan for Flex discounts).
 *
 * Config is window.__ESPERANZA. */
(function () {
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };

  var cards = document.querySelectorAll('[data-qmi-slug]');
  if (!cards.length) return;

  function promoBannerClass(style, text) {
    if (style === 'green') return 'green';
    if (style === 'gold') return 'tan';
    return /flex/i.test(text || '') ? 'tan' : 'green';
  }

  function patchPromo(card, f) {
    var promoEl = card.querySelector('.banner.overlay-promo');
    if (!f.promo_text) {
      if (promoEl && promoEl.parentNode) promoEl.parentNode.removeChild(promoEl);
      return;
    }
    if (!promoEl) return;
    promoEl.textContent = f.promo_text;
    var color = promoBannerClass(f.promo_banner_style, f.promo_text);
    promoEl.classList.remove('green', 'tan');
    promoEl.classList.add(color);
  }

  fetchT(API + '/qmi')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var homes = (res && res.homes) || [];
      if (!homes.length) return;

      var bySlug = {};
      for (var i = 0; i < homes.length; i++) {
        var f = homes[i].fields || homes[i];
        if (f && f.slug) bySlug[f.slug] = f;
      }

      cards.forEach(function (card) {
        var slug = card.getAttribute('data-qmi-slug');
        if (!slug) return;
        var f = bySlug[slug];
        if (!f) {
          if (card.parentNode) card.parentNode.removeChild(card);
          return;
        }
        patchPromo(card, f);
      });

      var grid = document.querySelector('.oi-listings');
      if (grid && !grid.querySelector('[data-qmi-slug]')) {
        var sec = document.getElementById('specs');
        if (sec) sec.style.display = 'none';
      }
    })
    .catch(function () { /* leave baked cards untouched on any error */ });
})();
