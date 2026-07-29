/* promotions-live.js — refresh site-wide banner + /incentives/ cards/hero from
 * /api/public/promotions so admin edits reach the site without a full rebuild. */
(function () {
  'use strict';
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = window.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  var ES = document.documentElement.lang === 'es';
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath() {
    var p = location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var IMG_TX = 'format=auto,quality=82,width=1920';
  var fixHost = function (u) {
    if (!u) return u;
    var s = String(u).replace(/^https:\/\//, '//').replace(/^http:\/\//, '//');
    if (/^\/\/img\.hazardhouse\.ai\//.test(s) && s.indexOf('/cdn-cgi/image/') === -1 && /\.(jpe?g|png|webp|avif)($|\?)/i.test(s)) {
      s = s.replace('//img.hazardhouse.ai/', '//img.hazardhouse.ai/cdn-cgi/image/' + IMG_TX + '/');
    }
    return s;
  };

  // Scraped incentive detail pages that still ship from the June-8 mirror.
  var STATIC_INCENTIVE = {
    '499-interest-rates': true,
    '499-rate-up-to-5000-in-closing-costs': true,
    'receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash': true,
  };

  function normalizeLink(link) {
    return String(link || '').trim().replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
  }

  /** Legacy scraped detail shells — flex tiers share one HTML page keyed by ?promo=. */
  function legacyIncentivePath(p) {
    var title = String(p.title || '');
    var badge = String(p.cardBadgeText || '');
    var blob = title + ' ' + badge;
    if (/flex/i.test(blob)) {
      return '/incentives/receive-up-to-25000-off-on-your-dream-home-with-esperanza-flex-cash/';
    }
    if (/closing|\$5,?000/i.test(blob)) {
      return '/incentives/499-rate-up-to-5000-in-closing-costs/';
    }
    if (/4\.99|rate|fixed|arm/i.test(blob)) {
      return '/incentives/499-interest-rates/';
    }
    var derived = slugify(title.replace(/\*/g, ''));
    if (STATIC_INCENTIVE[derived]) return '/incentives/' + derived + '/';
    return '/incentives/' + derived + '/';
  }

  function promoHref(p) {
    var link = normalizeLink(p.ctaLink);
    if (link.indexOf(':slug') !== -1) {
      link = legacyIncentivePath(p);
    }
    if (!link) link = legacyIncentivePath(p);
    if (!link.endsWith('/')) link += '/';
    if (p.id && link.indexOf('/incentives/') === 0) {
      link += (link.indexOf('?') === -1 ? '?' : '&') + 'promo=' + encodeURIComponent(p.id);
    }
    return link;
  }

  function promoFromQuery(promos) {
    var id = new URLSearchParams(location.search).get('promo');
    if (!id) return null;
    for (var i = 0; i < promos.length; i++) {
      if (promos[i].id === id && promos[i].active) return promos[i];
    }
    return null;
  }

  function communityBlurb(p) {
    var names = p.communityNames || [];
    if (!names.length) return '';
    return t('Available in') + ' ' + names.length + (names.length === 1 ? t(' community.') : t(' communities.'));
  }

  function incentiveCard(p) {
    var href = promoHref(p);
    var img = fixHost(p.image);
    var title = p.title || '';
    var cta = p.ctaLabel || t('View Details');
    var blurb = communityBlurb(p);
    var imgHtml = img
      ? '<div class="oi-aspect four-three"><img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img rounded-4"></div>'
      : '';
    var blurbHtml = blurb ? '<p class="small">' + esc(blurb) + '</p>' : '';
    var availHref = u(href.indexOf('/incentives/') === 0 ? href.replace(/#.*$/, '') + '#available' : '');
    href = u(href);
    var availBtn = availHref
      ? '<div class="col-lg-6"><a class="btn btn-outline-primary" href="' + esc(availHref) + '" role="button">' + t('View Available Homes') + '</a></div>'
      : '';
    return '<div class="col-md-6 col-xl-4 mb-4" data-promo-id="' + esc(p.id) + '">' +
      '<div class="incentive-card d-flex flex-column rounded-4 h-100">' +
      '<a href="' + esc(href) + '">' + imgHtml + '</a>' +
      '<div class="d-flex flex-column h-100 p-3">' +
      '<a href="' + esc(href) + '"><div class="h4 text-dark fw-bold">' + esc(title) + '</div></a>' +
      '<div class="green-bar-light my-2"></div>' + blurbHtml +
      '<div class="row g-2 mt-auto pt-2">' +
      '<div class="col-lg-6"><a class="btn btn-primary" href="' + esc(href) + '" role="button">' + esc(cta) + '</a></div>' +
      availBtn + '</div></div></div></div>';
  }

  function refreshIncentivesIndex(promos) {
    var section = document.querySelector('#incentives .row');
    if (!section) return;
    var cards = promos.filter(function (p) { return p.active && p.showIncentivePage; });
    cards.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    if (!cards.length) return;
    section.innerHTML = cards.map(incentiveCard).join('');
  }

  function refreshBanner(promos) {
    var slides = promos.filter(function (p) { return p.active && p.showSiteBanner && (p.bannerText || p.title); });
    slides.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    if (!slides.length) return;
    var wrap = document.querySelector('.alert-banner .swiper-wrapper');
    if (!wrap) return;
    wrap.innerHTML = slides.map(function (p) {
      var text = p.bannerText || p.title || '';
      var href = u(normalizeLink(p.ctaLink));
      var btn = (p.showBannerButton !== false && href)
        ? '<a href="' + esc(href) + '" class="btn btn-primary">' + esc(p.ctaLabel || t('Learn More!')) + '</a>'
        : '';
      return '<div class="swiper-slide"><p>' + esc(text) + '</p>' + btn + '</div>';
    }).join('');
    var swEl = document.querySelector('.swiper-alert-banner');
    if (swEl && swEl.swiper) {
      swEl.swiper.update();
      swEl.swiper.slideTo(0, 0);
    }
  }

  function detailSlug() {
    var m = barePath().match(/^\/incentives\/([^/]+)\/?$/);
    return m ? m[1] : '';
  }

  function promoForDetail(slug, promos) {
    if (!slug) return null;
    if (slug === '499-rate-up-to-5000-in-closing-costs') {
      var closing = promos.filter(function (p) {
        return p.active && p.showIncentivePage && /closing|\$5,?000/i.test((p.title || '') + (p.cardBadgeText || ''));
      });
      closing.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      if (closing.length) return closing[0];
      return null;
    }
    if (slug === '499-interest-rates') {
      var rateOnly = promos.filter(function (p) {
        if (!p.active || !p.showIncentivePage || /flex/i.test(p.title || '')) return false;
        return /4\.99|rate|fixed/i.test(p.title || '') && !/closing|\$5,?000/i.test(p.title || '');
      });
      rateOnly.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      if (rateOnly.length) return rateOnly[0];
      return null;
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
      return flexPromos[0] || null;
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
    return null;
  }

  function refreshDetailHero(p) {
    if (!p) return;
    var hero = document.querySelector('section.container.my-4, section.container.my-md-7');
    if (!hero) hero = document.querySelector('section.container');
    if (!hero) return;
    var h1 = hero.querySelector('h1.fw-bold');
    if (h1 && p.title) h1.textContent = p.title;
    var img = hero.querySelector('.oi-aspect-img');
    if (img && p.image) {
      var src = fixHost(p.image);
      img.src = src;
      img.removeAttribute('srcset');
    }
  }

  var path = barePath().replace(/\/index\.html$/, '/');
  fetchT(API + '/promotions').then(function (r) { return r.json(); }).then(function (res) {
    var promos = res.promotions || [];
    if (path === '/incentives/') refreshIncentivesIndex(promos);
    refreshBanner(promos);
    var slug = detailSlug();
    if (slug) refreshDetailHero(promoFromQuery(promos) || promoForDetail(slug, promos));
  }).catch(function () {});
})();
