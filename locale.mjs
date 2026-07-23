// locale.mjs — shared Accept-Language / cookie / ?lang= resolution for worker + dev server.
export const LOCALE_COOKIE = 'esperanza_lang';

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

/** Prefer explicit ?lang= → cookie → Accept-Language (any es-*). Default en. */
export function resolveLocale({ url, cookieHeader, acceptLanguage }) {
  const q = url?.searchParams?.get('lang');
  if (q === 'es' || q === 'en') return q;
  const cookie = parseCookie(cookieHeader)[LOCALE_COOKIE];
  if (cookie === 'es' || cookie === 'en') return cookie;
  const al = String(acceptLanguage || '');
  for (const tag of al.split(',')) {
    const code = tag.trim().split(';')[0].trim().toLowerCase();
    if (code === 'es' || code.startsWith('es-')) return 'es';
  }
  return 'en';
}

/** Set <html lang>, persist cookie hint, inject locale island bootstrap. */
export function patchHtmlLocale(html, lang) {
  if (!html || !/<html/i.test(html)) return html;
  html = html.replace(/(<html[^>]*\blang=)(["'])([^"']*)\2/i, `$1$2${lang}$2`);
  if (!html.includes('__ESPERANZA_LOCALE')) {
    const boot = `<script>window.__ESPERANZA_LOCALE=${JSON.stringify(lang)};</script>`;
    html = html.replace(/<head([^>]*)>/i, `<head$1>\n${boot}`);
  }
  if (!html.includes('locale-live.js')) {
    const tag = '\n<script src="/locale-live.js" defer></script>\n';
    const i = html.lastIndexOf('</body>');
    html = i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
  }
  return html;
}

export function localeCookieHeader(lang) {
  return `${LOCALE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
