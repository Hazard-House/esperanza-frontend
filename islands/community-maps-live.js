/* Live community-pin maps for the homepage ("Find Your Home", #home-map) and the
 * community detail pages (#map).
 *   - homepage: our "Texas Counties Map" style, every community as a non-clustered pin
 *   - detail:   Esperanza-Common base (STYLE_COMMON), the page's one community as a single pin
 * Uses our token (O'Neill's is domain-locked). The green map_pin isn't in these styles,
 * so it's loaded at runtime via addImage from /map_pin.png (the exact O'Neill sprite).
 * Coordinates come from the O'Neill live capture (authoritative — pins tuned so they
 * don't stack); name/town/price/image come fresh from our public API. oi-infowindow
 * popups reuse the bundled theme CSS, so they render identically to the legacy site.
 * Config injected by build.mjs as window.__ESPERANZA. */
(function () {
  'use strict';
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN;
  var STYLE_HOME = CFG.MAPBOX_STYLE_HOME, STYLE_DETAIL = CFG.MAPBOX_STYLE_COMMON;
  var PIN_URL = '/map_pin.png';
  // STYLE_DETAIL is a URL to our bundled Esperanza-Common JSON; fetch -> style object.
  // STYLE_HOME is a mapbox:// URL (our account) -> passed through.
  function resolveStyle(s, cb) {
    if (typeof s === 'string' && /\.json($|\?)/.test(s)) fetch(s).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(s); });
    else cb(s);
  }

  /* O'Neill live coords (lng,lat), keyed by lowercased community name — 32 */
  var ONEILL_COORDS = {"los arroyos":[-97.73547,26.20356],"paso real":[-97.652266,26.167944],"villas las lagunas":[-97.48215,25.98349],"anaqua at tres lagos":[-98.271207,26.341125],"bentsen palm master planned community":[-98.377877,26.188364],"harvest coves":[-98.257827,26.230957],"los prados":[-97.910906,26.186209],"mccoll groves":[-98.188835,26.335132],"palo alto groves":[-97.513037,26.006922],"rogers coves":[-98.167508,26.331197],"sapphire at la sienna":[-98.141002,26.346121],"sendero at bentsen palm":[-98.356076,26.204436],"stewart coves":[-98.15048,26.17018],"tres lagos master planned community":[-98.247653,26.33799],"villas at la sienna":[-98.137014,26.343096],"villas at tres lagos":[-98.259949,26.343432],"meadow ridge":[-97.636358,27.848156],"antlers crossing":[-99.490612,27.597713],"aqualina at tres lagos":[-98.270618,26.343318],"aquero":[-99.535081,27.606462],"cascada at tres lagos":[-98.269991,26.340914],"cielo vista":[-99.464151,27.45219],"el eden":[-99.457105,27.437661],"las brisas at tres lagos":[-98.228922,26.346366],"retama village (55+) at bentsen palm":[-98.370114,26.190479],"silos at la sienna":[-98.140586,26.339415],"tanglewood at bentsen palm":[-98.376965,26.195208],"texas heights":[-97.990847,26.190448],"villas on freddy":[-98.219059,26.294784],"vista verde":[-99.451208,27.435027],"wolf creek":[-99.464531,27.425892],"wright ranch":[-99.444104,27.4729]};

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return n ? '$' + Number(n).toLocaleString('en-US') : ''; };
  var slugify = function (s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var LINKS = { qmi: {}, community: {} }; // qmi-links.json community map: slug -> community page URL
  function communityUrl(c) { return LINKS.community[c.slug] || LINKS.community[slugify(c.name)] || ''; }

  // Prefer the O'Neill coord (by name); fall back to the API's own coordinate.
  function coordOf(c) {
    var k = (c.name || '').trim().toLowerCase();
    if (ONEILL_COORDS[k]) return ONEILL_COORDS[k];
    if (c.coordinates) { var p = c.coordinates.split(','); return [Number(p[1]), Number(p[0])]; } // API is "lat,lng"
    return null;
  }

  function popupHTML(c) {
    var url = communityUrl(c), a0 = url ? '<a href="' + esc(url) + '">' : '', a1 = url ? '</a>' : '';
    return '<div class="oi-infowindow overflow-hidden">' + a0 +
      (c.image ? '<div class="oi-aspect two-one rounded-top"><img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + esc(c.name) + '"></div>' : '') +
      '<div class="row my-2 g-0">' +
      '<div class="col px-2 my-auto">' +
      '<div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location">' + esc(c.town) + ', TX</div>' +
      '</div>' +
      (c.priceFrom ? '<div class="col-auto px-2 my-auto"><div class="price-title">From</div><div class="price mt-1">' + money(c.priceFrom) + '</div></div>' : '') +
      '</div>' + a1 + '</div>';
  }

  function toGeoJSON(list) {
    return { type: 'FeatureCollection', features: list.map(function (x) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: x.coord }, properties: { html: popupHTML(x.c) } };
    }) };
  }

  // Run cb once the map is loaded. (isStyleLoaded()+styledata is unreliable — it reads
  // false through the styledata burst and only flips true at idle, after the events stop.)
  function whenStyleReady(map, cb) {
    if (map.loaded()) return cb();
    map.on('load', cb);
  }

  // Load the green map_pin sprite (not in the streets/counties styles) once, then cb.
  function ensurePin(map, cb) {
    if (map.hasImage('map_pin')) return cb();
    map.loadImage(PIN_URL, function (err, img) {
      if (!err && img && !map.hasImage('map_pin')) map.addImage('map_pin', img, { pixelRatio: 2 }); // 90x120@2x -> 45x60
      cb();
    });
  }

  // Shared: add the map_pin symbol layer + popup wiring (matches the live places-symbol).
  function addPins(map, fc) {
    ensurePin(map, function () {
      if (!map.getSource('places')) map.addSource('places', { type: 'geojson', data: fc });
      if (!map.getLayer('places-symbol')) map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', layout: { 'icon-allow-overlap': true, 'icon-image': 'map_pin', 'icon-anchor': 'bottom' } });
      map.on('click', 'places-symbol', function (e) {
        var c = e.features[0].geometry.coordinates.slice();
        new mapboxgl.Popup({ offset: [0, -52] }).setLngLat(c).setHTML(e.features[0].properties.html).addTo(map);
      });
      map.on('mouseenter', 'places-symbol', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'places-symbol', function () { map.getCanvas().style.cursor = ''; });
    });
  }

  function buildHome(el, comms) {
    var pts = comms.map(function (c) { return { c: c, coord: coordOf(c) }; }).filter(function (x) { return x.coord; });
    el.innerHTML = '';
    resolveStyle(STYLE_HOME, function (style) {
      var map = new mapboxgl.Map({ container: 'home-map', style: style, center: [-98.23, 26.9], zoom: 6.5, minZoom: 3, maxZoom: 16.5 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      whenStyleReady(map, function () {
        addPins(map, toGeoJSON(pts));
        var b = new mapboxgl.LngLatBounds();
        pts.forEach(function (x) { b.extend(x.coord); });
        if (!b.isEmpty()) map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
      });
    });
  }

  function buildDetail(el, comms) {
    // Prefer the slug the generator baked into the page; fall back to URL parsing.
    var PAGE = window.__ESPERANZA_PAGE || {};
    var segs = location.pathname.replace(/\/+$/, '').split('/');
    var slug = PAGE.communitySlug || segs[segs.length - 2] || '';
    var c = comms.filter(function (x) { return x.slug === slug; })[0]
         || comms.filter(function (x) { return (x.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug; })[0];
    if (!c) return; // unknown community -> leave the base map as-is
    var coord = coordOf(c); if (!coord) return;
    el.innerHTML = '';
    resolveStyle(STYLE_DETAIL, function (style) {
      var map = new mapboxgl.Map({ container: 'map', style: style, center: coord, zoom: 13, minZoom: 3, maxZoom: 17 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      whenStyleReady(map, function () { addPins(map, toGeoJSON([{ c: c, coord: coord }])); });
    });
  }

  function boot() {
    var home = document.getElementById('home-map');
    var detail = document.getElementById('map');
    if ((!home && !detail) || typeof mapboxgl === 'undefined') return;
    mapboxgl.accessToken = TOKEN;
    Promise.all([
      fetch(API + '/communities').then(function (r) { return r.json(); }),
      fetch('/qmi-links.json').then(function (r) { return r.json(); }).catch(function () { return { qmi: {}, community: {} }; }),
    ]).then(function (res) {
      if (res[1]) LINKS = res[1];
      var comms = (res[0].communities || []).filter(function (c) { return c.active !== false; });
      if (home) buildHome(home, comms);
      if (detail) buildDetail(detail, comms);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
