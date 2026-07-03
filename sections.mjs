// sections.mjs — shared HTML section builders for the detail-page renderers.
import { qmiPath, communityPath, floorplanPath } from './paths.mjs';
import { API_BASE, MAPBOX_TOKEN, STYLE_HOME, STYLE_COMMON_URL, disableOilib } from './rewrite.mjs';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = n => '$' + Number(n || 0).toLocaleString('en-US');
export const num = n => Number(n || 0).toLocaleString('en-US');

const STAT = '/static/esperanza_homes/images/stats/';
// Values verified in available-live.js; `garage` filled from Task 7 Step 1.
export const ICON = {
  bed: STAT + 'bedroom%EF%B9%96v=7516482.svg',
  bath: STAT + 'bathroom%EF%B9%96v=f390d85.svg',
  story: STAT + 'stairs%EF%B9%96v=348b88c.svg',
  living: STAT + 'livingsqft%EF%B9%96v=fc46974.svg',
  total: STAT + 'sqft%EF%B9%96v=64b8d65.svg',
  garage: STAT + 'garage%EF%B9%96v=f234cc0.svg',
};

export function statItem(icon, txt) {
  return `<div class="item detail pb-4 col-12 col-lg-6"><img class="me-2" src="${icon}" aria-hidden="true" width="24">${txt}</div>`;
}

export function descHtml(raw) {
  if (!raw) return '';
  if (/<\w+[\s>]/.test(raw)) return `<div class="wysiwyg pt-2 pt-lg-4">${raw}</div>`;
  let out = '', inList = false;
  for (const ln of String(raw).split(/\r?\n/)) {
    const t = ln.trim();
    if (/^[-•]\s+/.test(t)) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${esc(t.replace(/^[-•]\s+/, ''))}</li>`; }
    else { if (inList) { out += '</ul>'; inList = false; } if (t) out += `<p>${esc(t)}</p>`; }
  }
  if (inList) out += '</ul>';
  return `<div class="wysiwyg pt-2 pt-lg-4">${out}</div>`;
}

export function bannerHtml(availability, promo) {
  let s = '';
  if (promo) s += `<div class="status-banner overlay-promo mt-2 align-top tan" data-live="promo">${esc(promo)}</div>`;
  if (availability) s += `<div class="status-banner gray mt-2 align-top" data-live="availability">${esc(availability)}</div>`;
  return s;
}

export function galleryHtml(gallery, fallback, address) {
  const imgs = (gallery && gallery.length) ? gallery : (fallback ? [{ url: fallback, alt: address }] : []);
  if (!imgs.length) return '';
  const alt = esc(address || ''), hero = imgs[0];
  const heroCol = imgs.length > 1 ? 'col-12 col-lg-8' : 'col-12';
  const mosaic = `<div class="${heroCol} d-flex align-items-stretch p-0 pe-lg-2-5"><div class="oi-aspect three-two"><img src="${esc(hero.url)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div>`
    + `<div class="photo-overlay"><a href="#" class="open-gallery btn card-button" data-fancybox-trigger="photos">View ${imgs.length} Photos</a></div></div>`;
  const side = imgs.length > 1 ? `<div class="col-12 col-lg-4 d-none d-lg-flex flex-column p-0">`
    + imgs.slice(1, 3).map(g => `<div class="oi-aspect sixteen-nine mb-2"><img src="${esc(g.url)}" class="oi-aspect-img" loading="lazy" alt="${alt}"></div>`).join('')
    + `</div>` : '';
  const hidden = `<div class="d-none">` + imgs.map(g => `<a href="${esc(g.url)}" data-fancybox="photos" data-caption="${esc(g.alt || '')}"><img src="${esc(g.url)}" alt="${esc(g.alt || alt)}"></a>`).join('') + `</div>`;
  return `<div id="detail-gallery" class="container-fluid p-0"><div class="row m-0">${mosaic}${side}</div>${hidden}</div>`;
}

export function subnavHtml(anchors) {
  if (!anchors.length) return '';
  const links = anchors.map(a => a[0] === 'photos'
    ? `<a class="col-auto text-center py-2 px-3" href="#" data-fancybox-trigger="photos">${esc(a[1])}</a>`
    : `<a class="col-auto text-center py-2 px-3" href="#${a[0]}">${esc(a[1])}</a>`).join('');
  return `<div class="subnav bg-white border-bottom sticky-top"><div class="container"><div id="desktop-menu" class="row subnav justify-content-center">${links}</div></div></div>`;
}

export function tourHtml(url) {
  if (!url) return '';
  return `<section id="virtualtour" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Virtual Tour</h2><div class="oi-aspect sixteen-nine oi-matterport"><iframe class="oi-video-iframe" src="${esc(url)}" frameborder="0" allowfullscreen allow="xr-spatial-tracking" style="width:100%;height:100%"></iframe></div></div></section>`;
}

export function elevationHtml(label, image) {
  if (!image) return '';
  return `<section id="elevations" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Elevations</h2><div class="row oi-listings justify-content-center"><div class="col-12 col-md-6"><a data-fancybox="elevations" data-caption="${esc(label || '')}" href="${esc(image)}"><div class="oi-aspect three-two">${label ? `<div class="banner dark-green">${esc(label)}</div>` : ''}<img src="${esc(image)}" class="oi-aspect-img" alt="${esc(label || 'elevation')}"></div></a></div></div></div></section>`;
}

export function idaproPlanHtml(url, image, name, desc) {
  const body = url
    ? `<div class="text-center mb-3"><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Launch Interactive Floor Plan</a></div><iframe src="${esc(url)}" name="modelframe" frameborder="0" style="width:100%;height:600px"></iframe>`
    : (image ? `<div class="oi-aspect three-two"><img src="${esc(image)}" class="oi-aspect-img" alt="${esc(name || '')} floor plan"></div>` : '');
  if (!body) return '';
  return `<section id="plans" class="pagejump floor-plan py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Floor Plan</h2>${body}${desc ? `<div class="wysiwyg mt-4">${esc(desc)}</div>` : ''}</div></section>`;
}

export function communityBlurbHtml(c) {
  if (!(c && (c.description || c.image))) return '';
  const bg = c.image ? ` style="background-image:url(${esc(c.image)})"` : '';
  return `<section id="community" class="pagejump bg-photo-block"${bg}><div class="container"><div class="photo-block-info"><h2 class="bodoni text-white fs-2">About the Community</h2>${c.description ? `<div class="mt-4 text-white fs-7 lh-lg wysiwyg">${c.description}</div>` : ''}<a class="btn btn-white mt-3" href="${communityPath(c)}">Learn More About ${esc(c.name)}</a></div></div></section>`;
}

export function mapSalesHtml(c) {
  if (!(c && c.lat && c.lng)) return '';
  const tel = c.officePhone ? `<a class="oi-click-to-call d-block text-green" href="tel:${esc(String(c.officePhone).replace(/[^0-9+]/g, ''))}">${esc(c.officePhone)}</a>` : '';
  const hours = c.officeHours ? `<div class="fs-9 text-gray mt-1">${esc(c.officeHours)}</div>` : '';
  return `<section id="sales" class="pagejump py-4 py-lg-5"><div class="container"><div class="row"><div class="col-12 col-lg-7 mb-3"><div id="map" style="height:420px" data-latitude="${c.lat}" data-longitude="${c.lng}" data-zoom="13" data-vendor="mapbox"></div></div><div class="col-12 col-lg-5"><h2 class="bodoni text-gray fs-3">Visit Us</h2>${c.address ? `<address class="mt-3">${esc(c.address)}<br>${esc(c.city)}, TX</address>` : ''}${tel}${hours}<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-green mt-3 oi-directions-click">Get Directions</a></div></div></div></section>`;
}

export function formSlotHtml(kind, ctx) {
  return `<section id="request-a-tour" class="pagejump py-4 py-lg-5"><div class="container"><div class="row justify-content-center"><div class="col-12 col-lg-8 text-center"><h2 class="bodoni text-gray fs-3 mb-3">Request a Tour</h2><div class="hs-form-slot" data-form="${esc(kind)}" data-context="${esc(ctx || '')}"><p class="text-gray">Contact us or <a href="#offcanvas-contact" data-bs-toggle="offcanvas">request information</a>.</p></div></div></div></div></section>`;
}

export function recommendedHtml() {
  return `<section class="py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 text-center mb-4">Recommended For You</h2><div class="recommended-content row oi-listings" id="recommended"></div></div></section>`;
}

function banners(availability, promo) {
  let s = '';
  if (promo) s += `<div class="banner overlay-promo green">${esc(promo)}</div>`;
  if (availability) s += `<div class="banner gray"${promo ? ' style="top:2.5rem"' : ''}>${esc(availability)}</div>`;
  return s;
}

export function qmiCardHtml(h) {
  const url = qmiPath(h);
  const specs = [h.beds != null ? esc(h.beds) + ' bd' : '', h.baths != null ? Number(h.baths).toFixed(1) + ' ba' : '', h.livingSqft != null ? num(h.livingSqft) + ' sq ft' : ''].filter(Boolean).join(' · ');
  return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card spec-card spec-card-detail border border-gray p-2">${h.image ? `<a href="${esc(url)}"><div class="oi-aspect sixteen-nine">${banners(h.availability, h.promo)}<img src="${esc(h.image)}" class="oi-aspect-img" loading="lazy" alt="${esc(h.address)}"></div></a>` : ''}<div class="card-body"><a href="${esc(url)}"><div class="card-title lh-1 mt-2">${esc(h.address)}</div></a><div class="card-location text-green mb-2">${esc(h.city)}, TX</div><div class="spec-price">${money(h.price)}</div><div class="fs-9 text-gray mt-1">${specs}</div></div></div></div>`;
}

export function planCardHtml(fp) {
  const url = floorplanPath(fp);
  const beds = fp.bedroomMin === fp.bedroomMax ? fp.bedroomMin : `${fp.bedroomMin}-${fp.bedroomMax}`;
  const baths = fp.bathroomMin === fp.bathroomMax ? fp.bathroomMin : `${fp.bathroomMin}-${fp.bathroomMax}`;
  const specs = [`${beds} bd`, `${baths} ba`, fp.garage ? `${fp.garage} gar` : '', fp.livingSqft ? num(fp.livingSqft) + ' sq ft' : ''].filter(Boolean).join(' · ');
  return `<div class="col-12 col-md-6 col-lg-4 mb-3"><div class="card plan-card border border-gray p-2">${fp.image ? `<a href="${esc(url)}"><div class="oi-aspect three-two"><img src="${esc(fp.image)}" class="oi-aspect-img" loading="lazy" alt="${esc(fp.name)}"></div></a>` : ''}<div class="card-body"><a href="${esc(url)}"><div class="card-title mt-2"><span class="fs-4">${esc(fp.name)}</span></div></a>${fp.collection ? `<div class="text-brown fs-9">${esc(fp.collection)} Collection</div>` : ''}${fp.startingPrice ? `<div class="price-title">From</div><div class="price">${money(fp.startingPrice)}</div>` : ''}<div class="fs-9 text-gray mt-1">${specs}</div><a href="${esc(url)}" class="btn btn-green mt-2 d-inline-block">View Details</a></div></div></div>`;
}

export function setHead(html, m) {
  const rep = (re, val) => { if (re.test(html)) html = html.replace(re, val); };
  rep(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`);
  rep(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(m.description || '')}">`);
  rep(/<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${esc(m.canonical || '')}">`);
  rep(/<meta property="og:title"[^>]*>/i, `<meta property="og:title" content="${esc(m.title)}">`);
  rep(/<meta property="og:description"[^>]*>/i, `<meta property="og:description" content="${esc(m.description || '')}">`);
  rep(/<meta property="og:url"[^>]*>/i, `<meta property="og:url" content="${esc(m.url || '')}">`);
  if (m.image) {
    rep(/<meta property="og:image"[^>]*>/i, `<meta property="og:image" content="${esc(m.image)}">`);
    rep(/<meta name="twitter:image"[^>]*>/i, `<meta name="twitter:image" content="${esc(m.image)}">`);
  }
  return html;
}

export function finalizePage(shell, { content, head, page, islands }) {
  let html = setHead(shell, head);
  html = html.replace('<!--CONTENT-->', content);
  html = disableOilib(html);
  const cfg = { API_BASE, MAPBOX_TOKEN, MAPBOX_STYLE: STYLE_COMMON_URL, MAPBOX_STYLE_HOME: STYLE_HOME, MAPBOX_STYLE_COMMON: STYLE_COMMON_URL };
  const scripts = `\n<script>window.__ESPERANZA=${JSON.stringify(cfg)};window.__ESPERANZA_PAGE=${JSON.stringify(page)};</script>\n`
    + islands.map(f => `<script src="/${f}" defer></script>`).join('\n') + '\n';
  const i = html.lastIndexOf('</body>');
  return i === -1 ? html + scripts : html.slice(0, i) + scripts + html.slice(i);
}

function demo() {
  console.assert(esc('a<b>&"') === 'a&lt;b&gt;&amp;&quot;', 'esc');
  console.assert(money(236990) === '$236,990', 'money');
  const g = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  console.assert(g.includes('id="detail-gallery"') && g.includes('data-fancybox="photos"') && g.includes('View 2 Photos'), 'gallery');
  const d = descHtml('Highlights:\n- Big yard\n- New roof');
  console.assert(d.includes('<ul>') && d.includes('<li>Big yard</li>'), 'desc bullets -> ul');
  const head = setHead('<head><title>x</title><link rel="canonical" href="y"></head>', { title: 'T', canonical: '/c/', url: '/c/', description: 'D' });
  console.assert(head.includes('<title>T</title>') && head.includes('href="/c/"'), 'setHead');
  const page = finalizePage('<head></head><body><!--CONTENT--></body>', { content: '<p>hi</p>', head: { title: 'T', canonical: '/c/', url: '/c/' }, page: { type: 'qmi', id: 'rec1' }, islands: ['detail-extras.js'] });
  console.assert(page.includes('<p>hi</p>') && page.includes('__ESPERANZA_PAGE') && page.includes('detail-extras.js'), 'finalizePage');
  console.log('sections.mjs demo() passed');
}
if (process.argv.includes('--check')) demo();
