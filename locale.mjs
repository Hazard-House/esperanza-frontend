// locale.mjs — English-only HTML patching for worker + dev server.
// Spanish i18n (/es/, locale-live.js, es.json) is disabled until rebuilt.
export const LOCALE_COOKIE = 'esperanza_lang';
export const ES_PREFIX = '/es';

export function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isEsPath(pathname) {
  return pathname === '/es' || pathname.startsWith('/es/');
}

/** Strip leading /es from a pathname (legacy Spanish URLs). */
export function stripEsPrefix(pathname) {
  if (pathname === '/es') return '/';
  if (pathname.startsWith('/es/')) return pathname.slice(3) || '/';
  return pathname;
}

/** @deprecated Spanish URLs removed; kept for redirect helpers. */
export function toEsPath(pathname) {
  return stripEsPrefix(pathname);
}

/** Always English (Spanish auto-detect disabled). */
export function resolveLocale() {
  return 'en';
}

const LOCALE_LIVE_RE = /\n?<script[^>]*src=["']\/locale-live\.js["'][^>]*>\s*<\/script>\s*/gi;
const LOCALE_BOOT_RE = /<script>window\.__ESPERANZA_LOCALE=[^<]*<\/script>\s*/gi;

/** Force English document language; strip disabled locale-live bootstrap. */
export function patchHtmlLocale(html) {
  if (!html || !/<html/i.test(html)) return html;
  html = html.replace(/(<html[^>]*\blang=)(["'])([^"']*)\2/i, '$1$2en$2');
  html = html.replace(LOCALE_BOOT_RE, '');
  html = html.replace(LOCALE_LIVE_RE, '\n');
  return html;
}

export function localeCookieHeader(lang) {
  return `${LOCALE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
