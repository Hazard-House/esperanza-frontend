/* Live Quick-Move-In listings + Mapbox map for /new-homes/available/.
 * Replaces O'Neill's frozen oilib cards with data fetched at runtime from our
 * public API, rendered into the scrape's own markup so the design is unchanged.
 * Config is injected by build.mjs as window.__ESPERANZA. */
(function () {
  'use strict';
  var CFG = window.__ESPERANZA || {};
  var API = CFG.API_BASE, TOKEN = CFG.MAPBOX_TOKEN, STYLE = CFG.MAPBOX_STYLE;
  var STAT = '/static/esperanza_homes/images/stats/';
  var ICON = {
    bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
    bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
    story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
    living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
    total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  };

  var un = function (v) { return Array.isArray(v) ? v[0] : v; };
  var fixHost = function (u) {
    return u ? u.replace(/^https:\/\/pub-9c9bfee574a54b62b2623e361b3ad305\.r2\.dev/, 'https://img.hazardhouse.ai') : u;
  };
  var money = function (n) { return '$' + Number(n || 0).toLocaleString('en-US'); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function normalizeHome(h) {
    var f = h.fields || h;
    var lat = f.latitude != null ? f.latitude : f.geo_latitude;
    var lng = f.longitude != null ? f.longitude : f.geo_longitude;
    return {
      id: h.id,
      price: f.Price,
      beds: f.bedroom_count,
      baths: f.bathroom_count,
      stories: f.stories_count,
      livingSqft: f.living_square_footage,
      totalSqft: f.total_square_footage,
      community: f.Community,
      communityId: un(f['Community (Link)']),
      collection: un(f['FP: Collection']),
      city: f.City,
      address: f.address,
      image: fixHost(f.image_url),
      floorPlan: f['Floor Plan'],
      availability: f.availability_text,
      availableNow: f['Available Now'],
      moveInDate: f['Move-In Date'],
      promo: f.promo_text,
      pdfUrl: f['Dynamic PDF'],
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
    };
  }

  function cardHTML(h) {
    var url = h.pdfUrl || '#';
    var img = h.image || '';
    var banners = '';
    if (h.promo) banners += '<div class="banner overlay-promo green">' + esc(h.promo) + '</div>';
    if (h.availability) banners += '<div class="banner gray"' + (h.promo ? ' style="top:2.5rem"' : '') + '>' + esc(h.availability) + '</div>';
    function stat(icon, txt) {
      return '<div class="item col-12 d-flex align-items-center mb-1"><img class="me-2" src="' + icon + '" aria-hidden="true" width="18">' + txt + '</div>';
    }
    var stats = '';
    if (h.beds != null) stats += stat(ICON.bed, esc(h.beds) + ' Bedrooms');
    if (h.baths != null) stats += stat(ICON.bath, esc(h.baths) + ' Bathrooms');
    if (h.stories != null) stats += stat(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories'));
    if (h.livingSqft != null) stats += stat(ICON.living, Number(h.livingSqft).toLocaleString() + ' <span class="overpass bold ms-1">Living</span>&nbsp;Sq. Ft.');
    if (h.totalSqft != null) stats += stat(ICON.total, Number(h.totalSqft).toLocaleString() + ' <span class="overpass bold ms-1">Total</span>&nbsp;Sq. Ft.');
    var collLine = h.collection ? '<div class="text-brown fs-9">' + esc(h.collection) + (/collection/i.test(h.collection) ? '' : ' Collection') + '</div>' : '';

    return '' +
      '<div class="col-12 col-md-6 col-lg-12 mb-3 px-2">' +
      '<div class="card spec-card spec-card-detail oi-map-item mb-0 border border-gray p-2" data-listing-id="' + esc(h.id) + '" data-latitude="' + (h.lat || '') + '" data-longitude="' + (h.lng || '') + '">' +
      '<div class="row m-0">' +
      '<div class="col-12 col-xl-7 px-0 pe-xl-3 d-flex align-content-stretch flex-wrap">' +
      '<div class="oi-aspect sixteen-nine three-two-xxl">' + banners +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener">' +
      (img ? '<img src="' + esc(img) + '" loading="lazy" class="oi-aspect-img" alt="' + esc(h.address) + '">' : '') +
      '</a>' +
      '<div class="hover-button d-none d-lg-flex"><div class="m-auto">' +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener"><div class="btn card-button d-block my-3">VIEW HOME</div></a>' +
      '</div></div>' +
      '</div>' +
      '<div class="row community-row m-0 p-2 w-100 d-none d-xl-flex">' +
      '<div class="col text-center text-lg-start py-1"><div class="text-brown overpass bold fs-9 text-decoration-underline">COMMUNITY</div><div class="text-gray fs-9">' + esc(h.community) + '</div></div>' +
      '<div class="col text-center text-lg-start py-1 border-start"><div class="row"><div class="col-auto mx-auto"><div class="text-brown overpass bold fs-9 text-decoration-underline">FLOOR PLAN</div><div class="text-gray fs-9">' + esc(h.floorPlan) + '</div>' + collLine + '</div></div></div>' +
      '</div>' +
      '</div>' +
      '<div class="col-12 col-xl px-0 px-xl-1"><div class="card-body d-flex flex-column lh-2 h-100 px-xl-0 py-xl-1">' +
      '<div class="row"><a href="' + esc(url) + '" target="_blank" rel="noopener"><div class="card-title lh-1 mb-1 d-flex justify-content-between align-items-center">' + esc(h.address) + '</div></a>' +
      '<div class="card-location text-green mb-2">' + esc(h.city) + ', TX</div></div>' +
      '<div class="row h-100">' +
      '<div class="col-6 col-xl-12 d-flex align-content-xl-around flex-wrap"><div class="w-100"><div class="spec-price lh-1 mt-2 mb-3">' + money(h.price) + '</div></div></div>' +
      '<div class="col-auto col-xl-12 stat-group mt-xl-2 stat-flex d-flex flex-column mx-auto">' + stats + '</div>' +
      '</div></div></div>' +
      '</div></div></div>';
  }

  // ---- filtering (O'Neill value-prefix grammar: =exact  %min-max  @>=N) ----
  function activeFilters() {
    var groups = {};
    document.querySelectorAll('.oi-filter-change').forEach(function (el) {
      var name = el.name; if (!name) return;
      var checkbox = el.type === 'checkbox';
      if (checkbox && !el.checked) return;
      var v = el.value; if (v === '' || v == null) return;
      (groups[name] = groups[name] || []).push(v);
    });
    return groups;
  }

  function matchOne(h, name, raw) {
    var op = raw[0], val = raw.slice(1);
    if (op === '%') { var mm = val.split('-'), lo = +mm[0], hi = +mm[1]; }
    switch (name) {
      case 'community': return h.community === val;
      case 'city': return h.city === val;
      case 'collection': return h.collection && val.toLowerCase().indexOf(h.collection.toLowerCase()) !== -1;
      case 'price': return h.price >= lo && h.price <= hi;
      case 'sqft': return h.livingSqft >= lo && h.livingSqft <= hi;
      case 'bedrooms': return h.beds >= +val;
      case 'bathrooms': return h.baths >= +val;
      case 'availability':
        if (val === 'now') return !!h.availableNow;
        if (!h.moveInDate) return false;
        var d = new Date(h.moveInDate); return (d.getMonth() + 1) + '-' + d.getFullYear() === val;
      default: return true; // home_type / open_house / self_tour: no API data -> ignore
    }
  }

  function applyFilters(homes) {
    var groups = activeFilters();
    var out = homes.filter(function (h) {
      return Object.keys(groups).every(function (name) {
        if (name === 'sort') return true;
        return groups[name].some(function (raw) { return matchOne(h, name, raw); });
      });
    });
    var sort = (groups.sort || [])[0];
    if (sort === 'price') out.sort(function (a, b) { return (a.price || 0) - (b.price || 0); });
    else if (sort === 'square_footage') out.sort(function (a, b) { return (a.livingSqft || 0) - (b.livingSqft || 0); });
    return out;
  }

  // ---- map ----
  // Matches the live O'Neill "Esperanza-Common" QMI map 1:1: same style + token
  // (so the map_pin sprite resolves), same cluster paint, same oi-infowindow popup
  // (styled by the bundled theme CSS). Layer ids/source name mirror the live map.
  var map, mapReady = false;
  function toGeoJSON(homes) {
    return {
      type: 'FeatureCollection',
      features: homes.filter(function (h) { return h.lat && h.lng; }).map(function (h) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] }, properties: { id: h.id, address: h.address || '', community: h.community || '', city: h.city || '', price: money(h.price), img: h.image || '', url: h.pdfUrl || '#' } };
      }),
    };
  }

  // Live popup markup — .oi-infowindow + .oi-aspect.two-one + card-title/location/price.
  // Uses the bundled theme classes so it renders identically to the legacy site.
  function popupHTML(p) {
    return '<div class="oi-infowindow overflow-hidden">' +
      '<a href="' + p.url + '" target="_blank" rel="noopener">' +
      (p.img ? '<div class="oi-aspect two-one rounded-top"><img src="' + p.img + '" loading="lazy" class="oi-aspect-img rounded-top" alt="' + p.address + '"></div>' : '') +
      '<div class="row my-2 g-0">' +
      '<div class="col px-2 my-auto">' +
      '<div class="card-title">' + (p.address || p.community) + '</div>' +
      '<div class="card-location">' + p.city + ', TX</div>' +
      '</div>' +
      (p.price ? '<div class="col-auto px-2 my-auto"><div class="price-title">From</div><div class="price mt-1">' + p.price + '</div></div>' : '') +
      '</div></a></div>';
  }

  function initMap(homes) {
    if (typeof mapboxgl === 'undefined') return;
    var el = document.getElementById('oi-map');
    if (el) el.innerHTML = ''; // drop the stale canvas the scrape baked into #oi-map
    mapboxgl.accessToken = TOKEN;
    map = new mapboxgl.Map({ container: 'oi-map', style: STYLE, center: [-98.23, 26.19], zoom: 8, minZoom: 3, maxZoom: 16.5 });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.on('load', function () {
      map.addSource('places', { type: 'geojson', data: toGeoJSON(homes), cluster: true, clusterMaxZoom: 14 }); // clusterRadius default 50 (matches live)
      // Cluster bubble: brand green, fixed r20, 1px white stroke (live values).
      map.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['>', 'point_count', 0], paint: { 'circle-color': ['step', ['get', 'point_count'], '#295135', 5, '#295135', 15, '#295135'], 'circle-radius': ['step', ['get', 'point_count'], 20, 5, 20, 15, 20], 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
      map.addLayer({ id: 'cluster-counts', type: 'symbol', source: 'places', filter: ['>', 'point_count', 0], layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'], 'text-size': 12 }, paint: { 'text-color': '#fff' } });
      // Individual home: the green map_pin sprite from the Esperanza-Common style, anchored at its tip.
      map.addLayer({ id: 'places-symbol', type: 'symbol', source: 'places', filter: ['==', 'point_count', 0], layout: { 'icon-allow-overlap': true, 'icon-image': 'map_pin', 'icon-anchor': 'bottom' } });
      map.on('click', 'clusters', function (e) {
        var f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        map.getSource('places').getClusterExpansionZoom(f[0].properties.cluster_id, function (err, z) { if (!err) map.easeTo({ center: f[0].geometry.coordinates, zoom: z }); });
      });
      map.on('click', 'places-symbol', function (e) {
        var p = e.features[0].properties, c = e.features[0].geometry.coordinates.slice();
        new mapboxgl.Popup({ offset: [0, -52] }).setLngLat(c).setHTML(popupHTML(p)).addTo(map); // ponytail: offset clears the ~60px pin; tune if sprite size changes
      });
      ['clusters', 'places-symbol'].forEach(function (l) {
        map.on('mouseenter', l, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', l, function () { map.getCanvas().style.cursor = ''; });
      });
      mapReady = true;
      fitTo(homes);
    });
  }
  function fitTo(homes) {
    var pts = homes.filter(function (h) { return h.lat && h.lng; });
    if (!mapReady || !pts.length) return;
    var b = new mapboxgl.LngLatBounds();
    pts.forEach(function (h) { b.extend([h.lng, h.lat]); });
    map.fitBounds(b, { padding: 40, maxZoom: 13, duration: 400 });
  }
  function updateMap(homes) {
    if (!mapReady) return;
    map.getSource('places').setData(toGeoJSON(homes));
    fitTo(homes);
  }

  // ---- boot ----
  function render(all) {
    var grid = document.getElementById('oi-filter-results');
    function refresh() {
      var homes = applyFilters(all);
      if (grid) grid.innerHTML = homes.length ? homes.map(cardHTML).join('') : '<div class="col-12 p-4 text-center text-gray">No homes match these filters.</div>';
      var c = document.getElementById('oi-results-count'); if (c) c.textContent = homes.length;
      updateMap(homes);
    }
    document.querySelectorAll('.oi-filter-change').forEach(function (el) { el.addEventListener('change', refresh); });
    refresh();
    initMap(all);
  }

  function boot() {
    var grid = document.getElementById('oi-filter-results');
    if (grid) grid.innerHTML = '<div class="col-12 p-4 text-center text-gray">Loading available homes…</div>';
    Promise.all([
      fetch(API + '/qmi').then(function (r) { return r.json(); }),
      fetch(API + '/communities').then(function (r) { return r.json(); }).catch(function () { return { communities: [] }; }),
    ]).then(function (res) {
      var homes = (res[0].homes || []).map(normalizeHome);
      // community centroid fallback for homes with no coords
      var cc = {};
      (res[1].communities || []).forEach(function (c) { if (c.coordinates) { var p = c.coordinates.split(','); cc[c.id] = [Number(p[0]), Number(p[1])]; } });
      homes.forEach(function (h) { if ((!h.lat || !h.lng) && cc[h.communityId]) { h.lat = cc[h.communityId][0]; h.lng = cc[h.communityId][1]; } });
      render(homes);
    }).catch(function (e) {
      if (grid) grid.innerHTML = '<div class="col-12 p-4 text-center text-danger">Could not load listings: ' + esc(e.message) + '</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
