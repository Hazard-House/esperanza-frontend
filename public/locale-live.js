/* locale-live.js — apply Spanish UI copy when the visitor prefers es (Accept-Language,
 * cookie, or ?lang=). Translates shared chrome (nav, footer, forms, CTAs) from
 * /locales/es.json; community names and long-form body copy stay as published. */
(function () {
  'use strict';
  var COOKIE = 'esperanza_lang';

  function prefersSpanish() {
    var forced = window.__ESPERANZA_LOCALE;
    if (forced === 'es' || forced === 'en') return forced === 'es';
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'es') return true;
    if (q === 'en') return false;
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]+)'));
    if (m && m[1] === 'es') return true;
    if (m && m[1] === 'en') return false;
    var langs = [navigator.language].concat(navigator.languages || []);
    return langs.some(function (l) {
      l = String(l || '').toLowerCase();
      return l === 'es' || l.indexOf('es-') === 0;
    });
  }

  function setLang(lang) {
    document.cookie = COOKIE + '=' + lang + ';path=/;max-age=31536000;SameSite=Lax';
    var u = new URL(location.href);
    u.searchParams.set('lang', lang);
    location.assign(u.toString());
  }

  function injectSwitcher(active) {
    if (document.getElementById('locale-switcher')) return;
    var host = document.querySelector('.tooltip-espanol') || document.querySelector('.nav-wrapper .row.align-items-center');
    if (!host || !host.parentNode) return;
    var wrap = document.createElement('div');
    wrap.id = 'locale-switcher';
    wrap.className = 'locale-switcher ms-3 small';
    wrap.innerHTML =
      '<button type="button" class="btn btn-link btn-sm p-0 text-decoration-none locale-btn' +
      (active === 'en' ? ' fw-bold text-dark-green' : ' text-muted') +
      '" data-lang="en" aria-label="English">EN</button>' +
      '<span class="mx-1 text-muted" aria-hidden="true">|</span>' +
      '<button type="button" class="btn btn-link btn-sm p-0 text-decoration-none locale-btn' +
      (active === 'es' ? ' fw-bold text-dark-green' : ' text-muted') +
      '" data-lang="es" aria-label="Español">ES</button>';
    host.parentNode.insertBefore(wrap, host.nextSibling);
    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-lang]');
      if (!btn) return;
      setLang(btn.getAttribute('data-lang'));
    });
  }

  function applyMap(map) {
    var keys = Object.keys(map).filter(function (k) { return k && map[k]; });
    keys.sort(function (a, b) { return b.length - a.length; });

    function translateString(s) {
      if (!s) return s;
      var trimmed = s.trim();
      if (map[trimmed]) return s.replace(trimmed, map[trimmed]);
      return s;
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p || p.closest('script,style,noscript,code,pre')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      var next = translateString(node.textContent);
      if (next !== node.textContent) node.textContent = next;
    });

    ['placeholder', 'aria-label', 'title', 'data-bs-original-title', 'data-placeholder'].forEach(function (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (el) {
        var v = el.getAttribute(attr);
        var next = translateString(v || '');
        if (next !== v) el.setAttribute(attr, next);
      });
    });

    if (document.title) {
      var t = translateString(document.title);
      if (t !== document.title) document.title = t;
    }
  }

  var active = prefersSpanish() ? 'es' : 'en';
  document.documentElement.lang = active;
  injectSwitcher(active);
  if (active !== 'es') return;

  fetch('/locales/es.json', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(applyMap)
    .catch(function () {});
})();
