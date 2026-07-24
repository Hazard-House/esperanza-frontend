/* incentive-live.js — trim /incentives/{slug}/ #available blocks to communities
 * that have published QMIs where this promotion wins (from /api/public/promotions).
 * Hides empty baked sections and Jump To dropdown entries without a full rebuild. */
(function () {
  'use strict';
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) {
    return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 12000) } : {});
  };
  var un = function (v) { return Array.isArray(v) ? v[0] : v; };
  var slugify = function (s) {
    return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  };
  var normName = function (s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  };

  var STATIC_INCENTIVE = {
    '499-interest-rates': true,
    '499-rate-up-to-5000-in-closing-costs': true,
    'receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash': true,
  };

  function normalizeLink(link) {
    return String(link || '').trim().replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
  }

  function detailSlug() {
    var m = location.pathname.match(/^\/incentives\/([^/]+)\/?$/);
    return m ? m[1] : '';
  }

  function fallbackPromo(slug) {
    if (slug === '499-rate-up-to-5000-in-closing-costs') {
      return {
        active: true,
        title: '4.99% Rate + up to $5,000 in Closing Costs',
        cardBadgeText: '4.99% Rate + up to $5,000 in Closing Costs',
        communityNames: [],
        communityIds: [],
      };
    }
    if (slug === '499-interest-rates') {
      return {
        active: true,
        title: '4.99% Interest Rates',
        cardBadgeText: '4.99% 30 YEAR FIXED RATE*',
        communityNames: [],
        communityIds: [],
      };
    }
    if (slug.indexOf('25000') !== -1 || slug.indexOf('flex-cash') !== -1) {
      return {
        active: true,
        title: 'Receive up to $25,000 off on Your Dream Home with Esperanza Flex Cash!',
        cardBadgeText: 'Unlock Your $25K Flex Discount Now!',
        communityNames: [],
        communityIds: [],
      };
    }
    return null;
  }

  function promoForDetail(slug, promos) {
    if (!slug) return null;
    // Legacy static incentive pages first — generic ctaLink `/incentives/:slug` matches every slug.
    if (slug === '499-rate-up-to-5000-in-closing-costs') {
      var closing = promos.filter(function (p) {
        return p.active && p.showIncentivePage && /closing|\$5,?000/i.test((p.title || '') + (p.cardBadgeText || ''));
      });
      closing.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      if (closing.length) return closing[0];
      return fallbackPromo(slug);
    }
    if (slug === '499-interest-rates') {
      var rateOnly = promos.filter(function (p) {
        if (!p.active || !p.showIncentivePage || /flex/i.test(p.title || '')) return false;
        return /4\.99|rate|fixed/i.test(p.title || '') && !/closing|\$5,?000/i.test(p.title || '');
      });
      rateOnly.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      if (rateOnly.length) return rateOnly[0];
      return fallbackPromo(slug);
    }
    if (slug.indexOf('flex') !== -1 || slug.indexOf('25000') !== -1) {
      var flexPromos = promos.filter(function (p) {
        return p.active && p.showIncentivePage && /flex/i.test(p.title || '');
      });
      flexPromos.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      if (slug.indexOf('25000') !== -1) {
        var big = flexPromos.filter(function (p) { return /25,?000|25000/i.test(p.title || ''); });
        if (big.length) return big[0];
      }
      if (flexPromos.length) return flexPromos[0];
      return fallbackPromo(slug);
    }
    var byLink = promos.filter(function (p) {
      if (!p.active) return false;
      var link = normalizeLink(p.ctaLink).replace(':slug', slug);
      return link.indexOf('/incentives/' + slug) !== -1;
    });
    if (byLink.length) {
      byLink.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      return byLink[0];
    }
    return fallbackPromo(slug);
  }

  function normPromoText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function homeMatchesPromo(fields, promo, slug) {
    if (!fields || !promo) return false;
    var text = String(fields.promo_text || '').trim();
    if (!text) return false;
    var badge = String(promo.cardBadgeText || promo.bannerText || promo.title || '').trim();
    if (normPromoText(text) === normPromoText(badge)) return true;
    if (/499-rate-up-to-5000-in-closing-costs/.test(slug)) {
      return /4\.99/i.test(text) && /closing/i.test(text);
    }
    if (/499-interest-rates/.test(slug)) {
      return /4\.99/i.test(text) && !/closing/i.test(text);
    }
    if (/flex|25000|15000|10000|20000/i.test(slug + badge)) {
      var want = (slug.match(/(\d+)/) || badge.match(/(\d+)/) || [])[1];
      var got = (text.match(/(\d+)/) || [])[1];
      if (want && got) return want === got;
      return /flex/i.test(text);
    }
    return normPromoText(text).indexOf(normPromoText(badge).slice(0, 12)) !== -1;
  }

  function hide(el) {
    if (!el) return;
    el.classList.add('d-none');
    el.setAttribute('data-incentive-hidden', '1');
  }

  function slugFromCard(card) {
    var a = card.querySelector('a[href*="/new-homes/tx/"]');
    if (!a) return null;
    var m = String(a.getAttribute('href') || '').match(/\/([^/]+)\/\d+\/?(?:#|$)/);
    return m ? m[1] : null;
  }

  function pruneAvailable(promo, qmiHomes, slug) {
    var root = document.getElementById('available');
    if (!root || !promo) return;

    var allowedNames = new Set((promo.communityNames || []).map(normName).filter(Boolean));
    var allowedIds = new Set((promo.communityIds || []).filter(Boolean));
    var useApiList = allowedNames.size > 0 || allowedIds.size > 0;

    var byId = {};
    var bySlug = {};
    (qmiHomes || []).forEach(function (h) {
      var f = h.fields || h;
      if (h.id) byId[h.id] = f;
      if (f.slug) bySlug[f.slug] = f;
    });

    function fieldsForCard(card) {
      var id = card.getAttribute('data-listing-id');
      var slugKey = slugFromCard(card);
      return (id && byId[id]) || (slugKey && bySlug[slugKey]) || null;
    }

    function qualifies(fields) {
      if (!fields) return false;
      if (!homeMatchesPromo(fields, promo, slug)) return false;
      if (!useApiList) return true;
      var name = normName(fields.Community);
      var cid = un(fields['Community (Link)']);
      if (allowedNames.has(name)) return true;
      if (cid && allowedIds.has(cid)) return true;
      return false;
    }

    root.querySelectorAll('.card.spec-card[data-listing-id]').forEach(function (card) {
      var col = card.closest('.col-12.col-md-6, .col-12.col-md-6.mb-4, .col-12');
      if (!qualifies(fieldsForCard(card))) hide(col || card);
    });

    var containers = root.querySelectorAll('.container');
    var list = containers[containers.length - 1];
    if (!list) return;

    var visibleCommunityAnchors = new Set();
    var visibleCities = new Set();
    var kids = Array.prototype.slice.call(list.children);
    var currentCity = null;

    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.matches('.row.mb-3, .row.mb-3.mb-lg-4') && el.querySelector('h2.text-primary')) {
        currentCity = el.id || null;
        continue;
      }
      if (!el.matches('.row.mb-2') || !el.querySelector('h3') || !el.id) continue;

      var commAnchor = el.id;
      var commName = normName(el.querySelector('h3').textContent);
      var cardRow = kids[i + 1];
      var visibleCards = 0;
      if (cardRow && cardRow.classList.contains('row')) {
        cardRow.querySelectorAll('.col-12.col-md-6, .col-12.col-md-6.mb-4').forEach(function (col) {
          if (col.classList.contains('d-none') || col.getAttribute('data-incentive-hidden')) return;
          if (col.querySelector('.card.spec-card')) visibleCards++;
        });
      }

      var allowedCommunity = !useApiList || allowedNames.has(commName) || allowedNames.has(normName(commAnchor.replace(/-/g, ' ')));
      if (!allowedCommunity || visibleCards === 0) {
        hide(el);
        if (cardRow) hide(cardRow);
      } else {
        visibleCommunityAnchors.add(commAnchor);
        visibleCommunityAnchors.add(slugify(commName));
        if (currentCity) visibleCities.add(currentCity);
      }
      if (cardRow && cardRow.classList.contains('row')) i++;
    }

    kids.forEach(function (el) {
      if (el.matches('.row.mb-3, .row.mb-3.mb-lg-4') && el.querySelector('h2.text-primary')) {
        if (!visibleCities.has(el.id)) hide(el);
      }
    });

    var commMenu = document.querySelector('#communityDropdownLink + .dropdown-menu, [aria-labelledby="communityDropdownLink"]');
    if (commMenu) {
      commMenu.querySelectorAll('a.dropdown-item').forEach(function (a) {
        var anchor = (a.getAttribute('href') || '').replace('#', '');
        if (!visibleCommunityAnchors.has(anchor)) hide(a.closest('li') || a);
      });
    }
    var cityMenu = document.querySelector('#cityDropdownLink + .dropdown-menu, [aria-labelledby="cityDropdownLink"]');
    if (cityMenu) {
      cityMenu.querySelectorAll('a.dropdown-item').forEach(function (a) {
        var anchor = (a.getAttribute('href') || '').replace('#', '');
        if (!visibleCities.has(anchor)) hide(a.closest('li') || a);
      });
    }
  }

  var slug = detailSlug();
  if (!slug || slug === 'index.html') return;

  Promise.all([
    fetchT(API + '/promotions').then(function (r) { return r.json(); }),
    fetchT(API + '/qmi').then(function (r) { return r.json(); }),
  ]).then(function (parts) {
    var promos = (parts[0] && parts[0].promotions) || [];
    var homes = (parts[1] && parts[1].homes) || [];
    var promo = promoForDetail(slug, promos);
    if (!promo) return;
    pruneAvailable(promo, homes, slug);
  }).catch(function () {});
})();
