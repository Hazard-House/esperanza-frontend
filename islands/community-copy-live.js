/* community-copy-live.js — refresh the editable WYSIWYG copy (description +
 * amenities) on scraped community pages, live from D1, so admin edits show
 * immediately without waiting for a rebuild/deploy. Prices/QMI cards/maps are
 * owned by other islands; this only touches the two copy blocks:
 *   description -> #overview .wysiwyg (first, not the amenities list)
 *   amenities   -> #amenities-list
 * Runs only on community pages (guarded); no-ops on QMI/floor-plan detail pages
 * that also carry #overview. Node-testable math-free helpers via --check. */
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

if (typeof window === 'undefined') {
  if (process.argv.includes('--check')) {
    var assert = function (c, m) { if (!c) throw new Error(m); };
    assert(copyToHtml('- Pool\n- Gym', true) === '<ul><li>Pool</li><li>Gym</li></ul>', 'markdown list');
    assert(copyToHtml('<ul><li>Pool</li></ul>', true) === '<ul><li>Pool</li></ul>', 'html passthrough');
    assert(copyToHtml('Line one.\nLine two.') === '<p>Line one.</p><p>Line two.</p>', 'prose -> paragraphs');
    assert(copyToHtml('- A\n- B') === '<ul><li>A</li><li>B</li></ul>', 'auto-detect bullets');
    assert(copyToHtml('  ') === '', 'blank -> empty');
    assert(copyToHtml('a & b < c') === '<p>a &amp; b &lt; c</p>', 'escapes plain text');
    console.log('community-copy-live.js demo() passed');
  }
} else {
  (function () {
    'use strict';
    // Identify a community page from the URL: /new-homes/tx/{city}/{slug}/ is exactly
    // 4 path parts. QMI detail is 5, floor plans live under /floorplans/. This works
    // even on the few older community pages that never got __ESPERANZA_PAGE baked.
    var parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts[0] !== 'new-homes' || parts[1] !== 'tx' || parts.length !== 4) return;
    var slug = parts[3];
    var CFG = window.__ESPERANZA || {}, API = CFG.API_BASE || '/api/public';
    var fetchT = function (u, ms) { return fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms || 10000) } : {}); };
    fetchT(API + '/communities').then(function (r) { return r.json(); }).then(function (res) {
      var raw = (res.communities || []).filter(function (c) {
        var f = c.fields || c;
        return f.slug === slug;
      })[0];
      if (!raw) return;
      var f = raw.fields || raw;
      // Description: the first .wysiwyg in #overview (the amenities list is a
      // separate #amenities-list .wysiwyg). Only overwrite when D1 has a value.
      var desc = document.querySelector('#overview .wysiwyg:not(#amenities-list)');
      if (desc && f.description != null && String(f.description).trim()) {
        desc.innerHTML = copyToHtml(f.description, false);
      }
      var am = document.getElementById('amenities-list');
      if (am && f.amenities != null && String(f.amenities).trim()) {
        am.innerHTML = copyToHtml(f.amenities, true);
      }
    }).catch(function () {});
  })();
}
