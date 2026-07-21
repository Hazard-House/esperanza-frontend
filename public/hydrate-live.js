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
    var sec = document.getElementById('self-tour-callout');
    var show = !!(f.self_tour_available && f.nter_now);
    if (show) {
      if (!sec) {
        var ov = document.getElementById('overview');
        if (ov) {
          var wrap = document.createElement('div');
          wrap.innerHTML = '<section id="self-tour-callout" class="bg-light pb-2 pb-md-0 pt-5 text-center bg-tan-white" data-live="self-tour"><div class="container"><div class="align-items-center row justify-content-md-center"><div class="col-lg-7 ml-auto mr-auto"><div class="mobile-container"><h2 class="font-weight-bold mb-2">Tour This Home Today — On Your Terms</h2><p>Schedule a self-guided tour in just a few clicks.</p><div class="mx-auto decoration-bar-gold brown-bar mt-4 mb-4"></div><a href="" class="btn btn-primary m-2" target="_blank" rel="noopener" data-live="nter-now">Self-Tour</a></div></div></div></div></section>';
          sec = wrap.firstElementChild;
          ov.parentNode.insertBefore(sec, ov);
        }
      }
      if (sec) {
        sec.style.display = '';
        var link = sec.querySelector('[data-live="nter-now"]');
        if (link) link.href = f.nter_now;
      }
    } else if (sec) {
      sec.style.display = 'none';
    }
  }).catch(function () {});
})();
