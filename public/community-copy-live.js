/* community-copy-live.js — refresh the editable WYSIWYG copy live from D1 so admin
 * edits show immediately without a rebuild/deploy. Covers two page types (detected
 * from the URL, since neither reliably bakes __ESPERANZA_PAGE):
 *   community /new-homes/tx/{city}/{slug}/ (4 parts) — #overview .wysiwyg (description)
 *                                                    + #amenities-list (amenities)
 *   city     /{slug}/ (1 part, matched against /cities) — .city-page-wysiwyg (hero copy)
 * Prices/QMI cards/maps are owned by other islands. No-ops on QMI (5 parts) /
 * floor-plan pages. Node-testable helpers via --check. */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// D1 copy is inconsistent: rich-text (TipTap) edits save HTML; legacy values are
// plain text with "- "/"* " bullet lines. Normalize both to HTML so either renders
// as intended. asList forces a <ul> (amenities); otherwise auto-detect bullets,
// else paragraphs.
function copyToHtml(raw, asList) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s; // already HTML
  var lines = s.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) return '';
  var allBullets = lines.every(function (l) { return /^[-*]\s+/.test(l); });
  if (asList || allBullets) {
    return '<ul>' + lines.map(function (l) { return '<li>' + esc(l.replace(/^[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
  }
  return lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('');
}
// City hero copy is a single flowing block (no <p> wrapper) with the city name bolded
// by the page template. Preserve that: HTML passes through; plain text is escaped,
// newlines -> <br>, and the first occurrence of the city name is re-bolded.
function cityCopyHtml(raw, cityName) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.charAt(0) === '<') return s; // already HTML
  var html = esc(s).replace(/\r?\n/g, '<br>');
  if (cityName) {
    var cn = esc(cityName);
    html = html.replace(cn, '<span style="font-weight: 700;">' + cn + '</span>');
  }
  return html;
}

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) {
    var assert = function (c, m) { if (!c) throw new Error(m); };
    assert(copyToHtml('- Pool\n- Gym', true) === '<ul><li>Pool</li><li>Gym</li></ul>', 'markdown list');
    assert(copyToHtml('<ul><li>Pool</li></ul>', true) === '<ul><li>Pool</li></ul>', 'html passthrough');
    assert(copyToHtml('Line one.\nLine two.') === '<p>Line one.</p><p>Line two.</p>', 'prose -> paragraphs');
    assert(copyToHtml('- A\n- B') === '<ul><li>A</li><li>B</li></ul>', 'auto-detect bullets');
    assert(copyToHtml('  ') === '', 'blank -> empty');
    assert(copyToHtml('a & b < c') === '<p>a &amp; b &lt; c</p>', 'escapes plain text');
    assert(cityCopyHtml('Welcome to Brownsville, TX', 'Brownsville') === 'Welcome to <span style="font-weight: 700;">Brownsville</span>, TX', 'city bolds name');
    assert(cityCopyHtml('<p>rich</p>', 'X') === '<p>rich</p>', 'city html passthrough');
    assert(cityCopyHtml('  ', 'X') === '', 'city blank -> empty');
    console.log('community-copy-live.js demo() passed');
  }
} else {
  (function () {
    'use strict';
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    // Live O'Neill pages embed promo/grand-opening graphics after overview body copy.
    // D1 description is text-only — re-append known graphics after the API refresh.
    var OVERVIEW_GRAPHICS = {
      'villas-las-lagunas': '<p><img src="//img.hazardhouse.ai/cdn-cgi/image/format=auto,quality=82,width=1920/assets-media/153/2025/7/11/Villas_Las_Lagunas_Community_Grand_Opening.jpg" style="width: 750px;"></p>',
    };
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');

    // Community page: /new-homes/tx/{city}/{slug}/ (exactly 4 parts). QMI detail is 5,
    // floor plans live under /floorplans/. URL-based so it works even on the older
    // community pages that never got __ESPERANZA_PAGE baked.
    if (parts[0] === 'new-homes' && parts[1] === 'tx' && parts.length === 4) {
      var slug = parts[3];
      fetchT(API + '/communities').then(function (r) { return r.json(); }).then(function (res) {
        var raw = (res.communities || []).filter(function (c) { return (c.fields || c).slug === slug; })[0];
        if (!raw) return;
        var f = raw.fields || raw;
        // Description = first .wysiwyg in #overview (amenities is a separate
        // #amenities-list .wysiwyg). Only overwrite when D1 has a value.
        var desc = document.querySelector('#overview .wysiwyg:not(#amenities-list)');
        if (desc && f.description != null && String(f.description).trim()) {
          var html = copyToHtml(f.description, false);
          if (OVERVIEW_GRAPHICS[slug]) html += OVERVIEW_GRAPHICS[slug];
          desc.innerHTML = html;
        }
        var am = document.getElementById('amenities-list');
        if (am && f.amenities != null && String(f.amenities).trim()) am.innerHTML = copyToHtml(f.amenities, true);
      }).catch(function () {});
      return;
    }

    // City page: /{slug}/ (single root segment). Confirm it's a city by matching the
    // slug against /cities (root also holds /contact/, /our-story/, etc. — those miss).
    if (parts.length === 1 && parts[0]) {
      var citySlug = parts[0];
      var el = document.querySelector('.city-page-wysiwyg');
      if (!el) return; // not a city landing page
      fetchT(API + '/cities').then(function (r) { return r.json(); }).then(function (res) {
        var c = (res.cities || []).filter(function (x) { return x.slug === citySlug; })[0];
        if (!c) return;
        if (c.heroDescription != null && String(c.heroDescription).trim()) el.innerHTML = cityCopyHtml(c.heroDescription, c.name);
      }).catch(function () {});
    }
  })();
}
