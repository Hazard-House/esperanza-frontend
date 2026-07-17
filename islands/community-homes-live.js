/* community-homes-live — remove statically-baked Quick-Move-In cards for homes that are
 * no longer published (sold or unpublished).
 *
 * The community page's card grid is baked at BUILD time from the published-gated API.
 * Admin unpublish only purges the API edge cache; it does NOT rebuild this static site,
 * so a formerly-live home (including homes auto-unpublished when they sell) can linger on
 * the community page until the next deploy. This re-checks the gated /api/public/qmi on
 * load and drops any baked card whose home is no longer in the published set, so
 * sold/unpublished homes disappear immediately. Config is window.__ESPERANZA. */
(function () {
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';

  var cards = document.querySelectorAll('[data-qmi-slug]');
  if (!cards.length) return;

  fetch(API + '/qmi')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var homes = (res && res.homes) || [];
      // Never reconcile against an empty/failed response — that would wrongly nuke the
      // whole grid. Only prune when we have a usable published set.
      if (!homes.length) return;

      var live = {};
      for (var i = 0; i < homes.length; i++) {
        var f = homes[i].fields || homes[i];
        if (f && f.slug) live[f.slug] = true;
      }

      cards.forEach(function (card) {
        var slug = card.getAttribute('data-qmi-slug');
        if (slug && !live[slug] && card.parentNode) card.parentNode.removeChild(card);
      });

      // If the grid is now empty, hide the whole "Quick Move-Ins" section.
      var grid = document.querySelector('.oi-listings');
      if (grid && !grid.querySelector('[data-qmi-slug]')) {
        var sec = document.getElementById('specs');
        if (sec) sec.style.display = 'none';
      }
    })
    .catch(function () { /* leave baked cards untouched on any error */ });
})();
