/* Live Communities listing + Mapbox map for /new-homes/ (the Communities page).
 * Mirrors available-live.js but for communities: fetches our public API, renders
 * community cards into the scrape's grid, and draws the 1:1 clustered map
 * (Esperanza-Common style, #295135 clusters, green map_pin, oi-infowindow popup).
 * Coordinates use the O'Neill authoritative set (baked) with API fallback.
 * Config injected by build.mjs as window.__ESPERANZA. */
(function () {
  'use strict';
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN, STYLE = CFG.MAPBOX_STYLE_COMMON;

  /* O'Neill live coords (lng,lat), keyed by lowercased community name — 32 */
  var ONEILL_COORDS = {"los arroyos":[-97.73547,26.20356],"paso real":[-97.652266,26.167944],"villas las lagunas":[-97.48215,25.98349],"anaqua at tres lagos":[-98.271207,26.341125],"bentsen palm master planned community":[-98.377877,26.188364],"harvest coves":[-98.257827,26.230957],"los prados":[-97.910906,26.186209],"mccoll groves":[-98.188835,26.335132],"palo alto groves":[-97.513037,26.006922],"rogers coves":[-98.167508,26.331197],"sapphire at la sienna":[-98.141002,26.346121],"sendero at bentsen palm":[-98.356076,26.204436],"stewart coves":[-98.15048,26.17018],"tres lagos master planned community":[-98.247653,26.33799],"villas at la sienna":[-98.137014,26.343096],"villas at tres lagos":[-98.259949,26.343432],"meadow ridge":[-97.636358,27.848156],"antlers crossing":[-99.490612,27.597713],"aqualina at tres lagos":[-98.270618,26.343318],"aquero":[-99.535081,27.606462],"cascada at tres lagos":[-98.269991,26.340914],"cielo vista":[-99.464151,27.45219],"el eden":[-99.457105,27.437661],"las brisas at tres lagos":[-98.228922,26.346366],"retama village (55+) at bentsen palm":[-98.370114,26.190479],"silos at la sienna":[-98.140586,26.339415],"tanglewood at bentsen palm":[-98.376965,26.195208],"texas heights":[-97.990847,26.190448],"villas on freddy":[-98.219059,26.294784],"vista verde":[-99.451208,27.435027],"wolf creek":[-99.464531,27.425892],"wright ranch":[-99.444104,27.4729]};

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return n ? '$' + Number(n).toLocaleString('en-US') : ''; };

  function coordOf(c) {
    var k = (c.name || '').trim().toLowerCase();
    if (ONEILL_COORDS[k]) return ONEILL_COORDS[k];
    if (c.coordinates) { var p = c.coordinates.split(','); return [Number(p[1]), Number(p[0])]; } // API "lat,lng"
    return null;
  }

  // ---- cards ----
  function cardHTML(c) {
    var stat = function (v, label) { return v ? '<div class="col-auto pe-3"><span class="overpass bold">' + esc(v) + '</span> ' + label + '</div>' : ''; };
    return '' +
      '<div class="col-12 col-md-6 col-lg-4 mb-3 px-2">' +
      '<div class="card oi-map-item h-100 border border-gray" data-latitude="' + (coordOf(c) ? coordOf(c)[1] : '') + '" data-longitude="' + (coordOf(c) ? coordOf(c)[0] : '') + '">' +
      '<div class="oi-aspect two-one rounded-top">' + (c.image ? '<img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + esc(c.name) + '">' : '') + '</div>' +
      '<div class="card-body p-3">' +
      '<div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location mb-2">' + esc(c.town) + ', TX</div>' +
      (c.priceFrom ? '<div class="price-title">From</div><div class="price mb-2">' + money(c.priceFrom) + '</div>' : '') +
      '<div class="row g-0 fs-9 text-gray">' + stat(c.beds, 'Beds') + stat(c.baths, 'Baths') + stat(c.sqft, 'Sq.Ft.') + '</div>' +
      '</div></div></div>';
  }

  // ---- map (identical spec to the QMI map) ----
  var map, mapReady = false;
  function popupHTML(c) {
    return '<div class="oi-infowindow overflow-hidden">' +
      (c.image ? '<div class="oi-aspect two-one rounded-top"><img src="' + esc(c.image) + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + esc(c.name) + '"></div>' : '') +
      '<div class="row my-2 g-0"><div class="col px-2 my-auto"><div class="card-title">' + esc(c.name) + '</div>' +
      '<div class="card-location">' + esc(c.town) + ', TX</div></div>' +
      (c.priceFrom ? '<div class="col-auto px-2 my-auto"><div class="price-title">From</div><div class="price mt-1">' + money(c.priceFrom) + '</div></div>' : '') +
      '</div></div>';
  }
  function toGeoJSON(list) {
    return { type: 'FeatureCollection', features: list.filter(function (x) { return x.coord; }).map(function (x) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: x.coord }, properties: { html: popupHTML(x.c) } };
    }) };
  }
  function resolveStyle(s, cb) {
    if (typeof s === 'string' && /\.json($|\?)/.test(s)) fetch(s).then(function (r) { return r.json(); }).then(cb).catch(function () { cb(s); });
    else cb(s);
  }
  function ensurePin(m, cb) {
    if (m.hasImage('map_pin')) return cb();
    m.loadImage('/map_pin.png', function (err, img) { if (!err && img && !m.hasImage('map_pin')) m.addImage('map_pin', img, { pixelRatio: 2 }); cb(); });
  }
  function initMap(pts) {
    if (typeof mapboxgl === 'undefined') return;
    var el = document.getElementById('oi-map'); if (el) el.innerHTML = '';
    mapboxgl.accessToken = TOKEN;
    resolveStyle(STYLE, function (style) {
      map = new mapboxgl.Map({ container: 'oi-map', style: style, center: [-98.23, 26.5], zoom: 7, minZoom: 3, maxZoom: 16.5 });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.on('load', function () {
        ensurePin(map, function () {
          map.addSource('places', { type: 'geojson', data: toGeoJSON(pts), cluster: true, clusterMaxZoom: 14 });
          map.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['>', 'point_count', 0], paint: { 'circle-color': '#295135', 'circle-radius': 20, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
          map.addLayer({ id: 'cluster-counts', type: 'symbol', source: 'places', filter: ['>', 'point_count', 0], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
          map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', filter: ['!', ['has', 'point_count']], layout: { 'icon-allow-overlap': true, 'icon-image': 'map_pin', 'icon-anchor': 'bottom' } });
          map.on('click', 'clusters', function (e) {
            var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
            map.getSource('places').getClusterExpansionZoom(f[0].properties.cluster_id, function (err, z) { if (!err) map.easeTo({ center: f[0].geometry.coordinates, zoom: z }); });
          });
          map.on('click', 'places-symbol', function (e) {
            new mapboxgl.Popup({ offset: [0, -52] }).setLngLat(e.features[0].geometry.coordinates.slice()).setHTML(e.features[0].properties.html).addTo(map);
          });
          ['clusters', 'places-symbol'].forEach(function (l) {
            map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
          });
          mapReady = true;
          var b = new mapboxgl.LngLatBounds();
          pts.forEach(function (x) { if (x.coord) b.extend(x.coord); });
          if (!b.isEmpty()) map.fitBounds(b, { padding: 40, maxZoom: 12, duration: 0 });
        });
      });
    });
  }

  function boot() {
    if (!document.getElementById('oi-map') && !document.getElementById('oi-filter-results')) return;
    fetch(API + '/communities').then(function (r) { return r.json(); }).then(function (d) {
      var comms = (d.communities || []).filter(function (c) { return c.active !== false; });
      var grid = document.getElementById('oi-filter-results');
      if (grid) grid.innerHTML = comms.length ? comms.map(cardHTML).join('') : '<div class="col-12 p-4 text-center text-gray">No communities found.</div>';
      var count = document.getElementById('oi-results-count'); if (count) count.textContent = comms.length;
      initMap(comms.map(function (c) { return { c: c, coord: coordOf(c) }; }));
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
