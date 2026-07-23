// locale.mjs — shared Accept-Language / cookie / ?lang= resolution for worker + dev server.
// Display parity: www.esperanzahomes.com keeps English chrome (only "Hablamos Español"
// is Spanish). We persist locale preference via cookie but do not translate the UI yet.
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

/** Keep <html lang="en"> like the live site; record preference for cookie only. */
export function patchHtmlLocale(html, _locale) {
  if (!html || !/<html/i.test(html)) return html;
  html = html.replace(/(<html[^>]*\blang=)(["'])([^"']*)\2/i, `$1$2en$2`);
  return html;
}

export function localeCookieHeader(lang) {
  return `${LOCALE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
