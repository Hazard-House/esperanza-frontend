/* promotions-live.js — refresh the site-wide ticker and the /incentives/ hub cards from
 * /api/public/promotions, so an admin edit reaches the site without a full rebuild.
 *
 * EVERYTHING HERE IS ID-KEYED. The previous version derived a detail URL from the
 * promotion TITLE: three hardcoded flex/rate/closing regex branches, then a slugify
 * fallback into a directory that does not exist. Two consequences, both live bugs:
 * a promotion whose title matched no pattern got a 404, and two similarly-worded offers
 * collided on ONE page — the four Flex tiers ($10K/$15K/$20K/$25K) differ only by amount,
 * so `/flex/i` cannot tell them apart. Card links now come from offerPath(p.id), the same
 * helper the worker routes on (promo-identity.mjs), so a card and the edge cannot disagree.
 * The legacy `?promo=<id>` query is gone with the slugs it qualified: the id is IN the path.
 *
 * The ticker's centered text is cardBadgeText, which is what the Builder labels "Banner
 * Overlay Promo" and what its preview binds. bannerText is a DOCUMENTED, TEMPORARY
 * compatibility fallback: the one currently banner-enabled promotion
 * (adm-3-new-floor-plans) has cardBadgeText:"" and bannerText populated, so dropping the
 * fallback today would blank the live ticker. build.mjs --check reports every record still
 * relying on it (bannerFallbackPromos) so the backfill is visible instead of permanent.
 *
 * showBannerButton is INDEPENDENT of the banner text: false removes the anchor and nothing
 * else. Coupling them is how "hide the button" silently blanked a whole slide.
 */
var PromotionsLive = (function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  // ponytail: bake pass injects window.__ES_I18N on /es/ pages; English pages get {}.
  var T = W.__ES_I18N || {};
  function t(s) { return T[s] || s; }
  // ponytail: /es/ pages keep island-injected links in-namespace; English pages are a no-op.
  // Mirrors esHref() in es-bake.mjs — same exclusions, so baked and injected links agree.
  // Set at boot, not read at module scope, so the fixtures can exercise both namespaces.
  var ES = false;
  function setEs(v) { ES = !!v; }
  function u(p) {
    if (!ES || !p || p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('/es/') === 0 || p === '/es') return p; // charAt(1): protocol-relative //host is external
    if (/^\/(?:api|static|xhr|hfa|fonts|locales)\//.test(p)) return p;
    if (/\.(?:js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|json|pdf|mp4|xml|txt)(?:[?#]|$)/i.test(p)) return p;
    return '/es' + p;
  }
  // ponytail: /es/ is a URL namespace, not a different site — routing logic must see the bare
  // English path, or every path-gated island silently no-ops on the Spanish twin.
  function barePath(pathname) {
    var p = pathname || location.pathname;
    if (p === '/es') return '/';
    return p.indexOf('/es/') === 0 ? (p.slice(3) || '/') : p;
  }
  var CFG = W.__ESPERANZA || {};
  var API = CFG.API_BASE || '/api/public';
  var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var IMG_TX = 'format=auto,quality=82,width=1920';
  var fixHost = function (u) {
    if (!u) return u;
    var s = String(u).replace(/^https:\/\//, '//').replace(/^http:\/\//, '//');
    if (/^\/\/img\.hazardhouse\.ai\//.test(s) && s.indexOf('/cdn-cgi/image/') === -1 && /\.(jpe?g|png|webp|avif)($|\?)/i.test(s)) {
      s = s.replace('//img.hazardhouse.ai/', '//img.hazardhouse.ai/cdn-cgi/image/' + IMG_TX + '/');
    }
    return s;
  };

  // ── Identity (mirrors promo-identity.mjs; asserted equal to it in --check) ────────────
  var OFFER_PREFIX = '/incentives/offer/';
  var PROMO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function isValidPromoId(id) { return PROMO_ID_RE.test(String(id == null ? '' : id)); }
  /** '' for an id that must never reach a URL, so a caller cannot build /incentives/offer//. */
  function offerPath(id) { return isValidPromoId(id) ? OFFER_PREFIX + id + '/' : ''; }
  /** active && showIncentivePage ONLY. Location targeting must never decide publication. */
  function isHubPromo(p) { return !!(p && p.active && p.showIncentivePage); }

  var str = function (v) { return String(v == null ? '' : v).trim(); };

  // Admin-entered links reach an href, so the same scheme guard the offer shell applies is
  // applied here: javascript:/data: refused, and a bare relative path refused rather than
  // resolved against whatever URL depth we happen to be rendered at.
  var EXTERNAL_LINK_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  function safeLink(link) {
    var s = str(link).replace(/^https:\/\/www\.esperanzahomes\.com/i, '');
    if (!s) return '';
    if (!EXTERNAL_LINK_RE.test(s)) return (s.charAt(0) === '/' || s.charAt(0) === '#') ? s : '';
    return /^(?:https?:|mailto:|tel:|\/\/)/i.test(s) ? s : '';
  }

  /** Centered ticker text. cardBadgeText canonical, bannerText the documented temporary
   *  fallback, title the last resort so a banner-enabled promotion is never an empty slide.
   *  Mirrors bannerCenterText in promo-identity.mjs (asserted equal in --check). */
  function bannerCenterText(p) {
    if (!p) return '';
    return str(p.cardBadgeText) || str(p.bannerText) || str(p.title);
  }

  /** The hub card's destination: the canonical ID-backed route, never a title-derived slug.
   *  '' when the id is unusable — the caller then renders no link rather than a 404. */
  function cardHref(p) { return p ? offerPath(p.id) : ''; }

  function communityBlurb(p) {
    var names = (p && p.communityNames) || [];
    if (!names.length) return '';
    return t('Available in') + ' ' + names.length + (names.length === 1 ? t(' community.') : t(' communities.'));
  }

  function incentiveCard(p) {
    var href = cardHref(p);
    // No usable id means no link at all. A card that cannot name its offer is still worth
    // showing (the title and image are real), but linking it anywhere would be a guess.
    var localHref = href ? u(href) : '';
    var img = fixHost(p.image);
    var title = str(p.title);
    var cta = str(p.ctaLabel) || t('View Details');
    var blurb = communityBlurb(p);
    var imgInner = img
      ? '<div class="oi-aspect four-three"><img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img rounded-4"></div>'
      : '';
    var imgHtml = localHref ? '<a href="' + esc(localHref) + '">' + imgInner + '</a>' : imgInner;
    var titleHtml = '<div class="h4 text-dark fw-bold">' + esc(title) + '</div>';
    if (localHref) titleHtml = '<a href="' + esc(localHref) + '">' + titleHtml + '</a>';
    var blurbHtml = blurb ? '<p class="small">' + esc(blurb) + '</p>' : '';
    // Both buttons point INTO the one shell: the offer page carries its own #available
    // homes grid (offer-live.js), so "View Available Homes" is a fragment of the same URL
    // rather than a second scraped page that may not exist.
    var btns = localHref
      ? '<div class="col-lg-6"><a class="btn btn-primary" href="' + esc(localHref) + '" role="button">' + esc(cta) + '</a></div>'
        + '<div class="col-lg-6"><a class="btn btn-outline-primary" href="' + esc(localHref) + '#available" role="button">' + t('View Available Homes') + '</a></div>'
      : '';
    return '<div class="col-md-6 col-xl-4 mb-4"' + (isValidPromoId(p.id) ? ' data-promo-id="' + esc(p.id) + '"' : '') + '>' +
      '<div class="incentive-card d-flex flex-column rounded-4 h-100">' +
      imgHtml +
      '<div class="d-flex flex-column h-100 p-3">' +
      titleHtml +
      '<div class="green-bar-light my-2"></div>' + blurbHtml +
      '<div class="row g-2 mt-auto pt-2">' + btns + '</div></div></div></div>';
  }

  /** Hub cards: every hub-published promotion, in sortOrder. Returns the number rendered,
   *  or -1 when this page has no hub grid. */
  function refreshIncentivesIndex(doc, promos) {
    var section = doc.querySelector('#incentives .row');
    if (!section) return -1;
    var cards = (promos || []).filter(isHubPromo);
    cards.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    // An empty hub is a legitimate state (nothing is published right now), but the baked
    // grid is the June-8 snapshot, so leaving it would advertise retired offers. Only a
    // FAILED fetch may leave the bake alone, and that path never reaches here.
    section.innerHTML = cards.map(incentiveCard).join('');
    return cards.length;
  }

  /** The site-wide ticker. A slide needs `active && showSiteBanner` and some centered text;
   *  the button is gated separately, so showBannerButton=false removes ONLY the anchor. */
  function bannerSlides(promos) {
    return (promos || [])
      .filter(function (p) { return p && p.active && p.showSiteBanner && bannerCenterText(p); })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
  }

  function slideHtml(p) {
    var text = bannerCenterText(p);
    // The button's own link: the admin ctaLink when it is safe, else the offer page. A
    // banner promotion with neither cannot have a button.
    var href = safeLink(p.ctaLink) || offerPath(p.id);
    var btn = (p.showBannerButton !== false && href)
      ? '<a href="' + esc(u(href)) + '" class="btn btn-primary" data-promo-surface="banner-cta">' + esc(str(p.ctaLabel) || t('Learn More!')) + '</a>'
      : '';
    return '<div class="swiper-slide"' + (isValidPromoId(p.id) ? ' data-promo-id="' + esc(p.id) + '"' : '') + '>'
      + '<p>' + esc(text) + '</p>' + btn + '</div>';
  }

  /** Returns the number of slides rendered, -1 when the page has no ticker, or 0 when
   *  nothing is banner-enabled (in which case the ticker is emptied, not left stale). */
  function refreshBanner(doc, promos) {
    var wrap = doc.querySelector('.alert-banner .swiper-wrapper');
    if (!wrap) return -1;
    var slides = bannerSlides(promos);
    wrap.innerHTML = slides.map(slideHtml).join('');
    return slides.length;
  }

  function boot(win, doc) {
    var path = barePath(win.location.pathname).replace(/\/index\.html$/, '/');
    return fetchT(API + '/promotions').then(function (r) { return r.json(); }).then(function (res) {
      var promos = (res && res.promotions) || [];
      var out = { banner: refreshBanner(doc, promos), hub: -1 };
      if (path === '/incentives/') out.hub = refreshIncentivesIndex(doc, promos);
      return out;
      // A failed fetch leaves the baked ticker and hub alone: stale beats blank when we
      // cannot tell what is live. The retirement of a DELETED offer is the worker's job
      // (the canonical route 302s it), not something to guess at from a broken payload.
    }).catch(function () { return null; });
  }

  return {
    OFFER_PREFIX: OFFER_PREFIX, isValidPromoId: isValidPromoId, offerPath: offerPath,
    isHubPromo: isHubPromo, safeLink: safeLink, bannerCenterText: bannerCenterText,
    cardHref: cardHref, incentiveCard: incentiveCard, refreshIncentivesIndex: refreshIncentivesIndex,
    bannerSlides: bannerSlides, slideHtml: slideHtml, refreshBanner: refreshBanner,
    barePath: barePath, setEs: setEs, u: u, boot: boot,
  };
})();

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) promotionsLiveDemo();
} else {
  PromotionsLive.setEs(document.documentElement.lang === 'es');
  PromotionsLive.boot(window, document);
}

/* ponytail self-check. The point of this file's rewrite is that NOTHING is inferred from
 * marketing copy, so most of these assertions are about what must never happen: two
 * similarly-titled offers must not collide, a title must not become a URL, and the ticker's
 * text and its button must be independently controllable. Run against test-dom so the
 * assertions are about real parsed markup, and pinned to promo-identity.mjs so the island
 * and the edge cannot disagree about identity. */
async function promotionsLiveDemo() {
  var assert = function (c, m) { if (!c) throw new Error('assertion failed: ' + m); };
  var dom = await import('../test-dom.mjs');
  var identity = await import('../promo-identity.mjs');
  var sections = await import('../sections.mjs');
  var makeDocument = dom.makeDocument;
  var P = PromotionsLive;

  // --- identity agrees with the module the WORKER routes on ---------------------------
  var ids = ['recLS31iR3INg5THb', 'adm-3-new-floor-plans', 'adm077fd9d9ee7844', 'recyBSi11zNL5CLFi'];
  for (var i = 0; i < ids.length; i++) {
    assert(P.offerPath(ids[i]) === identity.offerPath(ids[i]), 'offerPath agrees with promo-identity for ' + ids[i]);
    assert(identity.offerIdFromPath(P.offerPath(ids[i])) === ids[i], 'and the worker parses the id back out of it');
  }
  var bad = ['../../etc/passwd', 'a/b', 'a.b', 'a b', 'a%2Fb', 'a"b', '', null, 'x'.repeat(65)];
  for (var j = 0; j < bad.length; j++) {
    assert(P.isValidPromoId(bad[j]) === identity.isValidPromoId(bad[j]), 'id validation agrees for ' + JSON.stringify(bad[j]));
    assert(P.offerPath(bad[j]) === '', 'an unusable id yields NO path: ' + JSON.stringify(bad[j]));
  }
  for (var k = 0; k < 6; k++) {
    var lk = ['/incentives/offer/recP1/', '#visit', 'https://partner.test/a', 'javascript:alert(1)', 'incentives/x/', ''][k];
    assert(P.safeLink(lk) === sections.safePromoLink(lk), 'link safety agrees with sections.safePromoLink for ' + JSON.stringify(lk));
  }

  // The four live-shaped promotions, deliberately including the two collisions the old
  // title regexes could not separate.
  var FLEX25 = { id: 'adm077fd9d9ee7844', title: 'Receive up to $25,000 off on Your Dream Home with Esperanza Flex Cash!', cardBadgeText: 'Unlock Your $25K Flex Discount Now!', active: true, showIncentivePage: true, sortOrder: 2, image: 'https://img.hazardhouse.ai/a.jpg', ctaLabel: 'See Details', communityNames: ['Wolf Creek', 'El Eden'] };
  var FLEX20 = { id: 'recyBSi11zNL5CLFi', title: 'Receive up to $20,000 off on Your Dream Home with Esperanza Flex Cash!', cardBadgeText: 'Unlock Your $20K Flex Discount Now!', active: true, showIncentivePage: true, sortOrder: 3 };
  var ARM = { id: 'adm5387b23e59a442', title: '4.99% ARM*', cardBadgeText: '', active: true, showIncentivePage: true, showSiteBanner: true, sortOrder: 1, ctaLink: 'https://www.esperanzahomes.com/new-homes/available/', ctaLabel: 'See Homes' };
  var BANNER_ONLY = { id: 'adm-3-new-floor-plans', title: '3 New Floor Plans', cardBadgeText: '', bannerText: '3 NEW Floor Plans Just Released!', active: true, showIncentivePage: false, showSiteBanner: true, sortOrder: 4 };
  var INACTIVE = { id: 'recDead', title: 'Retired Offer', cardBadgeText: 'RETIRED', active: false, showIncentivePage: true, showSiteBanner: true, sortOrder: 0 };
  var ALL = [INACTIVE, ARM, FLEX25, FLEX20, BANNER_ONLY];

  // --- 1. THE COLLISION. Two Flex tiers differ only by amount -------------------------
  // /flex/i matched both, so the old code sent them to ONE legacy page and the first one
  // sorted won. Exact ids give two distinct URLs.
  assert(P.cardHref(FLEX25) === '/incentives/offer/adm077fd9d9ee7844/', '$25K links to its own id');
  assert(P.cardHref(FLEX20) === '/incentives/offer/recyBSi11zNL5CLFi/', '$20K links to its own id');
  assert(P.cardHref(FLEX25) !== P.cardHref(FLEX20), 'THE TWO FLEX TIERS NO LONGER COLLIDE ON ONE PAGE');
  // Nothing in the href comes from the title. Change the copy, keep the URL.
  var retitled = Object.assign({}, FLEX25, { title: 'Something Marketing Invented Today', cardBadgeText: '' });
  assert(P.cardHref(retitled) === P.cardHref(FLEX25), 'the destination is the id, so re-titling an offer cannot move or break its page');
  // And a title that matches NO pattern still gets a working URL (the old slugify fallback
  // pointed at /incentives/<slug>/, a directory that does not exist -> 404).
  var novel = { id: 'recNovel1', title: 'Bring Your Own Builder Bonus', active: true, showIncentivePage: true };
  assert(P.cardHref(novel) === '/incentives/offer/recNovel1/', 'a non-pattern title still resolves to a real page');
  assert(P.cardHref({ id: 'a/b', title: 'x' }) === '' && P.cardHref({ title: 'x' }) === '',
    'an unusable id yields no href at all rather than a guessed slug');

  // --- 2. the hub grid ---------------------------------------------------------------
  var hubDoc = makeDocument('<section id="incentives"><div class="row"><div class="col-md-6 col-xl-4 mb-4">FROZEN JUNE CARD</div></div></section>');
  var n = P.refreshIncentivesIndex(hubDoc, ALL);
  assert(n === 3, 'exactly the three hub-published promotions render (inactive and banner-only excluded)');
  assert(hubDoc.body.innerHTML.indexOf('FROZEN JUNE CARD') === -1, 'the baked June-8 grid is replaced');
  assert(hubDoc.body.innerHTML.indexOf('Retired Offer') === -1, 'an INACTIVE promotion is not advertised');
  assert(hubDoc.body.innerHTML.indexOf('3 New Floor Plans') === -1, 'a banner-only promotion is not a hub card');
  var cards = hubDoc.querySelectorAll('[data-promo-id]');
  assert(cards.length === 3, 'every card carries identity');
  assert(cards[0].getAttribute('data-promo-id') === ARM.id && cards[1].getAttribute('data-promo-id') === FLEX25.id
    && cards[2].getAttribute('data-promo-id') === FLEX20.id, 'cards are ordered by sortOrder');
  var hrefs = hubDoc.querySelectorAll('a[href]');
  for (var h = 0; h < hrefs.length; h++) {
    assert(hrefs[h].getAttribute('href').indexOf('/incentives/offer/') === 0,
      'every hub link is in the ID namespace, never a title-derived slug: ' + hrefs[h].getAttribute('href'));
    assert(hrefs[h].getAttribute('href').indexOf('?promo=') === -1, 'and carries no ?promo= query (the id IS the path)');
  }
  assert(hubDoc.body.innerHTML.indexOf('/incentives/offer/adm077fd9d9ee7844/#available') !== -1,
    '"View Available Homes" is a fragment of the offer page, which renders its own homes grid');
  // An empty hub must CLEAR the stale grid rather than keep advertising retired offers.
  var emptyHub = makeDocument('<section id="incentives"><div class="row"><div>FROZEN JUNE CARD</div></div></section>');
  assert(P.refreshIncentivesIndex(emptyHub, [INACTIVE]) === 0, 'nothing published -> zero cards');
  assert(emptyHub.querySelector('#incentives .row').innerHTML === '', 'and the frozen grid is emptied, not left advertising a dead offer');
  assert(P.refreshIncentivesIndex(makeDocument('<div>no hub here</div>'), ALL) === -1, 'a page with no hub grid is untouched');
  // A card whose id is unusable still renders, but links nowhere.
  var noIdDoc = makeDocument('<section id="incentives"><div class="row"></div></section>');
  P.refreshIncentivesIndex(noIdDoc, [{ id: 'a/b', title: 'Broken Id Offer', active: true, showIncentivePage: true }]);
  assert(noIdDoc.body.innerHTML.indexOf('Broken Id Offer') !== -1, 'a card with an unusable id still shows its title');
  assert(noIdDoc.querySelectorAll('a[href]').length === 0, 'but links NOWHERE rather than to a guessed URL');
  assert(noIdDoc.body.innerHTML.indexOf('data-promo-id') === -1, 'and claims no identity');

  // --- 3. the ticker: cardBadgeText canonical, bannerText the documented fallback ------
  assert(P.bannerCenterText(BANNER_ONLY) === identity.bannerCenterText(BANNER_ONLY),
    'ticker text agrees with promo-identity.bannerCenterText');
  assert(P.bannerCenterText(BANNER_ONLY) === '3 NEW Floor Plans Just Released!',
    'THE LIVE RECORD: adm-3-new-floor-plans has cardBadgeText:"" and bannerText populated, so the fallback keeps the ticker alive');
  assert(P.bannerCenterText({ cardBadgeText: 'CANON', bannerText: 'legacy', title: 'ttl' }) === 'CANON',
    'cardBadgeText WINS when both are present');
  assert(P.bannerCenterText({ cardBadgeText: '   ', bannerText: 'legacy' }) === 'legacy', 'whitespace-only badge is empty');
  assert(P.bannerCenterText({ title: 'Only A Title' }) === 'Only A Title', 'title is the last resort, never an empty slide');
  assert(P.bannerCenterText({}) === '' && P.bannerCenterText(null) === '', 'no text at all -> no slide');

  var bakedTicker = '<div class="alert-banner"><div class="swiper-alert-banner swiper"><div class="swiper-wrapper">'
    + '<div class="swiper-slide"><p>FROZEN JUNE SLIDE</p></div></div></div></div>';
  var tickDoc = makeDocument(bakedTicker);
  var slides = P.refreshBanner(tickDoc, ALL);
  assert(slides === 2, 'two banner-enabled promotions produce two slides (the inactive one does not)');
  assert(tickDoc.body.innerHTML.indexOf('FROZEN JUNE SLIDE') === -1, 'the frozen slide is replaced');
  assert(tickDoc.body.innerHTML.indexOf('RETIRED') === -1, 'an inactive promotion never reaches the ticker');
  var slideEls = tickDoc.querySelectorAll('.swiper-slide');
  assert(slideEls[0].getAttribute('data-promo-id') === ARM.id && slideEls[1].getAttribute('data-promo-id') === BANNER_ONLY.id,
    'slides are ordered by sortOrder and carry identity');
  assert(slideEls[1].querySelector('p').textContent === '3 NEW Floor Plans Just Released!', 'the live fallback text renders');
  assert(P.refreshBanner(makeDocument('<div>no ticker</div>'), ALL) === -1, 'a page with no ticker is untouched');
  // Nothing banner-enabled: empty the ticker rather than keep showing June's events.
  var noneDoc = makeDocument(bakedTicker);
  assert(P.refreshBanner(noneDoc, [FLEX25]) === 0, 'no banner-enabled promotion -> zero slides');
  assert(noneDoc.querySelector('.swiper-wrapper').innerHTML === '', 'and the stale slide is removed');

  // --- 4. showBannerButton is INDEPENDENT of the banner text --------------------------
  // Coupling them is how "hide the button" silently blanked a whole slide.
  var withBtn = makeDocument(P.slideHtml(ARM));
  assert(withBtn.querySelector('[data-promo-surface="banner-cta"]') !== null, 'a banner promotion gets its button by default');
  assert(withBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/new-homes/available/',
    'the button uses the admin ctaLink (own-host prefix stripped)');
  var noBtn = makeDocument(P.slideHtml(Object.assign({}, ARM, { showBannerButton: false })));
  assert(noBtn.querySelector('[data-promo-surface="banner-cta"]') === null, 'showBannerButton=false REMOVES THE ANCHOR');
  assert(noBtn.querySelector('p').textContent === '4.99% ARM*', 'and the slide text is untouched — only the anchor went');
  assert(noBtn.querySelector('.swiper-slide').getAttribute('data-promo-id') === ARM.id, 'identity survives the button going');
  // The other direction: no text, no slide — regardless of the button flag.
  assert(P.bannerSlides([{ id: 'x', active: true, showSiteBanner: true, showBannerButton: true }]).length === 0,
    'a button flag cannot conjure a slide with no text');
  // ...and end to end through refreshBanner, because slideHtml alone cannot see a slide
  // being FILTERED OUT upstream — which is exactly the shape of the old bug.
  var btnOffDoc = makeDocument(bakedTicker);
  var btnOffCount = P.refreshBanner(btnOffDoc, [Object.assign({}, ARM, { showBannerButton: false })]);
  assert(btnOffCount === 1, 'showBannerButton=false still produces A SLIDE (the promotion is banner-enabled)');
  assert(btnOffDoc.querySelector('.swiper-slide') !== null && btnOffDoc.querySelector('p').textContent === '4.99% ARM*',
    'with its text intact');
  assert(btnOffDoc.querySelector('[data-promo-surface="banner-cta"]') === null, 'and ONLY the anchor removed');
  // A banner promotion with no ctaLink falls back to its own offer page, not to nothing.
  var fallbackBtn = makeDocument(P.slideHtml(BANNER_ONLY));
  assert(fallbackBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/incentives/offer/adm-3-new-floor-plans/',
    'with no ctaLink the button points at the offer page');
  // ...and an unsafe ctaLink is refused, falling back the same way.
  var unsafeBtn = makeDocument(P.slideHtml(Object.assign({}, ARM, { ctaLink: 'javascript:alert(1)' })));
  assert(unsafeBtn.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/incentives/offer/adm5387b23e59a442/',
    'an unsafe ctaLink is refused and the offer page used instead');
  // A promotion with neither a safe link nor a usable id has no button at all.
  var noHref = makeDocument(P.slideHtml({ id: 'a/b', cardBadgeText: 'TEXT', active: true, showSiteBanner: true }));
  assert(noHref.querySelector('[data-promo-surface="banner-cta"]') === null && noHref.querySelector('p').textContent === 'TEXT',
    'no destination -> text only, never a dead button');

  // --- 5. hostile copy ---------------------------------------------------------------
  var nasty = makeDocument(P.slideHtml({ id: 'recX', cardBadgeText: '<script>alert(1)</script>', active: true, showSiteBanner: true, showBannerButton: false }));
  assert(nasty.querySelector('p').innerHTML === '&lt;script&gt;alert(1)&lt;/script&gt;', 'ticker copy is escaped, never parsed');
  var nastyHub = makeDocument('<section id="incentives"><div class="row"></div></section>');
  P.refreshIncentivesIndex(nastyHub, [{ id: 'recY', title: '"><b>x', active: true, showIncentivePage: true }]);
  assert(nastyHub.body.innerHTML.indexOf('<b>') === -1, 'hub card titles are escaped');

  // --- 6. /es/ parity ----------------------------------------------------------------
  P.setEs(true);
  try {
    var esHub = makeDocument('<section id="incentives"><div class="row"></div></section>');
    P.refreshIncentivesIndex(esHub, [FLEX25]);
    assert(esHub.querySelector('a[href]').getAttribute('href') === '/es/incentives/offer/adm077fd9d9ee7844/',
      'hub cards on /es/ link into the Spanish namespace');
    assert(esHub.body.innerHTML.indexOf('/es/incentives/offer/adm077fd9d9ee7844/#available') !== -1, 'including the #available link');
    var esSlide = makeDocument(P.slideHtml(ARM));
    assert(esSlide.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/es/new-homes/available/',
      'the ticker button stays inside /es/');
    // Routing must see the BARE path, or the island no-ops on every Spanish page.
    assert(P.barePath('/es/incentives/') === '/incentives/' && P.barePath('/es') === '/' && P.barePath('/incentives/') === '/incentives/',
      'barePath strips the /es/ namespace for routing decisions');
  } finally {
    P.setEs(false);
  }
  var enSlide = makeDocument(P.slideHtml(ARM));
  assert(enSlide.querySelector('[data-promo-surface="banner-cta"]').getAttribute('href') === '/new-homes/available/', 'English is unaffected');

  // --- 7. boot(): the whole path, and what a failure must NOT do ----------------------
  var bootDoc = makeDocument('<section id="incentives"><div class="row"><div>FROZEN</div></div></section>' + bakedTicker);
  var bootWin = {
    location: { pathname: '/incentives/' },
    fetch: async function () { return { json: async function () { return { promotions: ALL }; } }; },
  };
  var savedFetch = globalThis.fetch;
  globalThis.fetch = bootWin.fetch;
  try {
    var out = await P.boot(bootWin, bootDoc);
    assert(out && out.hub === 3 && out.banner === 2, 'boot refreshes both the hub and the ticker');
    assert(bootDoc.body.innerHTML.indexOf('FROZEN') === -1, 'and replaces the baked markup');
    // Not the hub page: the ticker still refreshes (it is site-wide), the hub does not.
    var otherDoc = makeDocument('<section id="incentives"><div class="row"><div>FROZEN</div></div></section>' + bakedTicker);
    out = await P.boot({ location: { pathname: '/new-homes/available/' } }, otherDoc);
    assert(out.banner === 2 && out.hub === -1, 'off the hub page only the site-wide ticker refreshes');
    assert(otherDoc.body.innerHTML.indexOf('FROZEN') !== -1, 'a stray #incentives grid elsewhere is left alone');
    // /es/ hub: the path gate must see through the namespace.
    var esDoc = makeDocument('<section id="incentives"><div class="row"></div></section>' + bakedTicker);
    out = await P.boot({ location: { pathname: '/es/incentives/' } }, esDoc);
    assert(out.hub === 3, 'the /es/ hub is refreshed too (barePath strips the namespace)');
    // A failed fetch must leave the bake ALONE: stale beats blank when we cannot tell what
    // is live. Retiring a deleted offer is the worker's job, not a guess from a dead payload.
    var failDoc = makeDocument('<section id="incentives"><div class="row"><div>FROZEN</div></div></section>' + bakedTicker);
    globalThis.fetch = async function () { throw new TypeError('network'); };
    out = await P.boot({ location: { pathname: '/incentives/' } }, failDoc);
    assert(out === null, 'a failed promotions fetch reports failure');
    assert(failDoc.body.innerHTML.indexOf('FROZEN') !== -1 && failDoc.body.innerHTML.indexOf('FROZEN JUNE SLIDE') !== -1,
      'and changes NOTHING: an island fault must not blank the site banner or the hub');
  } finally {
    globalThis.fetch = savedFetch;
  }

  console.log('promotions-live.js demo() passed');
}
