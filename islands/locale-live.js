/* locale-live.js — full-site Spanish when the visitor prefers es (Accept-Language,
 * cookie, or ?lang=). Loads /locales/es.json and replaces matching text nodes,
 * attributes, and titles; re-applies when live islands inject content. */
(function () {
  'use strict';
  var COOKIE = 'esperanza_lang';
  var map = null;
  var applying = false;
  var observer = null;
  var debounceTimer = null;

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

  function translateString(s, dict, keys) {
    if (!s || !dict) return s;
    var trimmed = s.trim();
    if (dict[trimmed]) {
      var lead = s.match(/^\s*/)[0];
      var trail = s.match(/\s*$/)[0];
      return lead + dict[trimmed] + trail;
    }
    var out = s;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.length < 3 || !dict[k] || out.indexOf(k) === -1) continue;
      out = out.split(k).join(dict[k]);
    }
    return out;
  }

  function applyMap(dict) {
    if (!dict || applying) return;
    applying = true;
    if (observer) observer.disconnect();
    map = dict;
    window.__ESPERANZA_I18N = dict;
    var keys = Object.keys(dict).filter(function (k) { return k && dict[k]; });
    keys.sort(function (a, b) { return b.length - a.length; });

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p || p.closest('script,style,noscript,code,pre,.locale-switcher')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      if (node.__esOrig == null) node.__esOrig = node.textContent;
      var next = translateString(node.__esOrig, dict, keys);
      if (next !== node.textContent) node.textContent = next;
    });

    ['placeholder', 'aria-label', 'title', 'alt', 'data-bs-original-title', 'data-placeholder', 'value'].forEach(function (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (el) {
        if (attr === 'value' && (el.tagName !== 'INPUT' || el.type !== 'button')) return;
        var origKey = '__esOrig_' + attr;
        if (el[origKey] == null) el[origKey] = el.getAttribute(attr) || '';
        var next = translateString(el[origKey], dict, keys);
        if (next !== el.getAttribute(attr)) el.setAttribute(attr, next);
      });
    });

    if (document.__esTitleOrig == null) document.__esTitleOrig = document.title;
    var t = translateString(document.__esTitleOrig, dict, keys);
    if (t !== document.title) document.title = t;
    applying = false;
    if (document.body) watchDom();
  }

  function scheduleApply() {
    if (!map || !prefersSpanish()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { applyMap(map); }, 80);
  }

  function watchDom() {
    if (!document.body) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.__applyEsperanzaLocale = function () { scheduleApply(); };

  var active = prefersSpanish() ? 'es' : 'en';
  document.documentElement.lang = active;
  injectSwitcher(active);
  if (active !== 'es') return;

  fetch('/locales/es.json', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (dict) {
      applyMap(dict);
      watchDom();
    })
    .catch(function () {});

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchDom);
  } else {
    watchDom();
  }
})();
