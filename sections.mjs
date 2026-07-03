// sections.mjs — shared HTML section builders for the detail-page renderers.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
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
  lot: STAT + 'lot%EF%B9%96v=7c7a6d9.svg',
};

export function statItem(icon, txt) {
  return `<div class="item detail pb-4 col-12 col-lg-6"><img class="me-2" src="${icon}" aria-hidden="true" loading="lazy" width="24">${txt}</div>`;
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
  const alt = esc(address || '');
  // 1:1 with O'Neill: hero (col-lg-8) + a side column (col-lg-4) of up to two
  // sixteen-nine thumbs in h-50 rows; the LAST thumb carries the .photo-overlay
  // ("Photo Gallery" + white-bar + View N Photos). Overlay lives inside a
  // position-relative cell so it never escapes to cover the page.
  const heroCol = imgs.length > 1 ? 'col-12 col-lg-8' : 'col-12';
  const hero = `<div class="${heroCol} d-flex align-items-stretch p-0 pe-lg-2-5"><div class="oi-aspect three-two"><img src="${esc(imgs[0].url)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div></div>`;
  let side = '';
  if (imgs.length > 1) {
    const thumbs = imgs.slice(1, 3);
    const rows = thumbs.map((g, i) => {
      const last = i === thumbs.length - 1;
      const overlay = last
        ? `<div class="photo-overlay d-flex"><div class="m-auto text-center"><div class="bodoni ls-sm fs-2 lh-2 text-white">Photo Gallery</div><div class="white-bar mt-2 mx-auto"></div><a class="open-gallery btn btn-green small-btn mt-5" data-fancybox-trigger="photos">View ${imgs.length} Photos</a></div></div>`
        : '';
      const cell = last ? 'col px-0 position-relative d-flex align-items-stretch' : 'col px-0 d-flex align-items-stretch';
      return `<div class="row h-50${i > 0 ? ' pt-lg-1' : ''}"><div class="${cell}">${overlay}<div class="oi-aspect sixteen-nine"><img src="${esc(g.url)}" class="oi-aspect-img" loading="eager" alt="${alt}"></div></div></div>`;
    }).join('');
    side = `<div class="col-md-6 col-lg-4 ps-lg-1 d-none d-lg-block">${rows}</div>`;
  }
  const hidden = `<div class="d-none">` + imgs.map(g => `<img src="${esc(g.url)}" loading="lazy" data-fancybox="photos" data-caption="" data-oi-event-name="oi-image-click" alt="${esc(g.alt || alt)}">`).join('') + `</div>`;
  // O'Neill's legacy trigger: the overlay CTA clicks the first hidden fancybox thumb.
  const script = (imgs.length > 1) ? `<script>$('.open-gallery').click(function(){$('.fancybox-thumb:eq(0)').click();});</script>` : '';
  return `<div id="detail-gallery" class="container-fluid p-0"><div class="row m-0">${hero}${side}</div></div>${hidden}${script}`;
}

// Real theme section-heading pattern (verified against a live QMI detail page's
// #virtualtour/#elevations/#plans/#sales/#request-a-tour/recommended sections) —
// NOT the fabricated `<h2 class="... fs-3 text-center mb-4">` used before.
export function sectionHeading(title, barClass = 'green-bar-light my-2 my-lg-3') {
  return `<div class="text-gray bodoni ls-sm fs-2 ps-0">${esc(title)}</div><div class="${barClass}"></div>`;
}

export function subnavHtml(anchors) {
  if (!anchors.length) return '';
  const items = anchors.map((a, i) => ({ href: `#${a[0]}`, label: esc(a[1]), photos: a[0] === 'photos', active: i === 0 }));
  // Mobile "Go To..." dropdown: real anchors only (O'Neill omits Photo Gallery here).
  const dropdown = items.filter(it => !it.photos)
    .map(it => `<li><a href="${it.href}" class="dropdown-item">${it.label}</a></li>`).join('');
  // Desktop row: every item; photos = fancybox trigger w/o href/on-scroll.
  const desktop = items.map(it => it.photos
    ? `<a class="col" data-fancybox-trigger="photos" role="button">${it.label}</a>`
    : `<a href="${it.href}" class="col on-scroll${it.active ? ' active' : ''}">${it.label}</a>`).join('');
  return `<div class="subnav"><div class="dropdown d-block d-lg-none"><button class="btn btn-primary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">Go To...</button><ul class="dropdown-menu">${dropdown}</ul></div><div id="desktop-menu" class="row subnav text-center d-none d-lg-flex">${desktop}</div></div>`;
}

export function tourHtml(url, home = {}) {
  if (!url) return '';
  const mid = (String(url).match(/[?&]m=([^&]+)/) || [])[1] || '';
  const fid = 'oi' + (mid ? mid.replace(/[^\w-]/g, '') : 'tour');
  const title = home.address ? `${home.address}${home.city ? `, ${home.city}, TX` : ''} Virtual Tour` : 'Virtual Tour';
  return `<section id="virtualtour" class="py-lg-5 pagejump"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Virtual Tour')}</div></div><div class="row mt-3"><div class="col-12 mb-3"><div class="oi-aspect oi-matterport one-one four-three-md sixteen-nine-lg" id="${fid}-container"><div class="oi-aspect-spacer"></div><iframe id="${fid}" class="oi-video-iframe embed-responsive-item oi-fit-fill" src="${esc(url)}" width="640" height="338" loading="lazy" title="${esc(title)}" allow="autoplay;fullscreen;" frameborder="0" allowfullscreen></iframe></div></div></div></div></section>`;
}

export function elevationHtml(label, image) {
  if (!image) return '';
  return `<section id="elevations" class="py-lg-5 pagejump"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Elevations')}</div></div><div class="row oi-listings mt-3"><div class="col-12 col-md-6 mb-4"><a href="${esc(image)}" data-fancybox="elevations" data-caption="${esc(label || '')}" data-oi-event-name="oi-image-click"><div class="oi-aspect sixteen-nine">${label ? `<div class="banner dark-green">${esc(label)}</div>` : ''}<img src="${esc(image)}" class="oi-aspect-img" loading="lazy" alt="${esc(label || 'elevation')}"></div></a></div></div></div></section>`;
}

// planImage = the `{planCode}_FP.png` plan-DRAWING url (R1 backfill; see notes).
// When present -> O'Neill's exact jQuery-iviewer inline viewer (1:1). Until it's
// backfilled, fall back to a clean CTA to the interactive plan (idapro renders blank
// embedded off-domain, so no iframe). name = plan name; viewerUrl = idapro URL.
export function idaproPlanHtml(planImage, name, viewerUrl) {
  const heading = sectionHeading('Floor Plan');
  if (planImage) {
    const src = esc(planImage);
    return `<div class="bg-tan-white"><section id="plans" class="py-lg-5 pagejump floor-plan"><div class="container-lg map-list-section position-relative"><div class="row mb-4"><div class="col">${heading}</div></div><div class="row m-0 d-flex align-items-stretch viewer-wrap"><div class="col-12 col-md-9 p-0"><div class="oi-aspect one-one"><div id="viewer" class="viewer iviewer_cursor" style="overflow: hidden;"></div><div class="viewer-controls interactive-controls"><a id="in" class="iviewer_zoom_in iviewer-control"><i class="far fa-plus text-gray fs-6"></i></a><a id="out" class="iviewer_zoom_out iviewer-control"><i class="far fa-minus text-gray fs-6"></i></a><a id="fit" class="iviewer_zoom_fit iviewer-control"><i class="fal fa-sync text-brown fs-6"></i></a></div></div></div><div class="col-12 col-md-3 align-self-stretch bg-tan-100 p-0"><span class="p-3 text-center"><p class="fs-5 text-gray overpass regular mb-0">${esc(name || '')}</p></span><ul class="plan-list"><li class="plan-img fs-8 overpass regular text-uppercase ls-sm plan-img-1 active">Floorplan 1<img src="${src}" loading="lazy" class="d-none" alt="${esc(name || '')} Floor Plans"></li></ul></div></div></div></section><script>$(document).ready(function(){var load_first=$('.plan-img-1 img').attr('src');var iv1=$('#viewer').iviewer({src:load_first,ui_disabled:true,update_on_resize:true,mousewheel:false});$('#in').click(function(){iv1.iviewer('zoom_by',1);});$('#out').click(function(){iv1.iviewer('zoom_by',-1);});$('#fit').click(function(){iv1.iviewer('fit');});$('.iviewer-control').click(function(){iv1.iviewer('info','zoom');});$('.plan-img').click(function(){$('.plan-img').removeClass('active');var plan_img=$('img',this).attr('src');iv1.iviewer('loadImage',plan_img);$(this).addClass('active');return false;});});</script></div>`;
  }
  if (viewerUrl) {
    return `<div class="bg-tan-white"><section id="plans" class="py-lg-5 pagejump floor-plan"><div class="container-lg map-list-section position-relative"><div class="row mb-4"><div class="col">${heading}</div></div><div class="bg-tan-100 border-15 text-center p-4 p-lg-6"><div class="fs-4 bodoni ls-sm text-gray mb-3">${esc(name || 'Floor Plan')}</div><a href="${esc(viewerUrl)}" target="_blank" rel="noopener" class="btn btn-green">View Interactive Floor Plan</a></div></div></section></div>`;
  }
  return '';
}

export function communityBlurbHtml(c) {
  if (!(c && (c.description || c.image))) return '';
  // 1:1 with O'Neill: a real responsive <img class="oi-aspect-img"> inside a sized
  // .oi-aspect + a .gray-gradient overlay + .photo-block-info (theme CSS positions the
  // text over the image). The previous inline background-image collapsed to no height.
  const img = c.image
    ? `<div class="oi-aspect three-four four-three-md sixteen-nine-lg"><img src="${esc(c.image)}" sizes="(min-width: 1400px) 3840px, 100vw" loading="lazy" class="oi-aspect-img" alt="${esc(c.name || '')}"></div>`
    : '';
  const desc = c.description ? `<div class="mt-4 text-white fs-7 lh-lg">${c.description}</div>` : '';
  return `<section id="community" class="bg-photo-block position-relative pagejump"><div class="container-fluid"><div class="row"><div class="col p-0"><div class="gray-gradient"></div>${img}<div class="photo-block-info"><div class="container"><div class="col-12 col-md-10 col-xl-7"><div class="bodoni ls-sm fs-2 text-white">About the Community</div>${desc}<a href="${communityPath(c)}" class="btn btn-white btn-auto mt-4 d-inline-block me-md-2">Learn More About ${esc(c.name)}</a></div></div></div></div></div></div></section>`;
}

export function mapSalesHtml(c) {
  if (!(c && c.lat && c.lng)) return '';
  const zip = c.zip || c.postalCode || c.postal_code || '';
  const phoneDigits = c.officePhone ? String(c.officePhone).replace(/[^0-9+]/g, '') : '';
  const tel = c.officePhone
    ? `<div class="my-3 overpass bold fs-7"><a class="oi-click-to-call" href="tel:${esc(phoneDigits)}"><i class="fas fa-phone-alt"></i> ${esc(c.officePhone)}</a></div>`
    : '';
  const hours = c.officeHours
    ? `<div>HOURS:</div><div class="lh-base mt-1">${esc(c.officeHours)}</div>`
    : '';
  const addr = c.address
    ? `<address>${esc(c.address)}<br>${esc(c.city)}, TX${zip ? ' ' + esc(zip) : ''}</address>`
    : '';
  // ponytail: id="map" (not O'Neill's "oi-map") so community-maps-live.js binds it.
  return `<section id="sales" class="py-5 py-lg-7 bg-tan-white reverse pagejump px-3 px-md-0">`
    + `<div class="container bg-white shadow border-15"><div class="row">`
    + `<div class="col-12 col-md-6 col-lg-7 px-0">`
    + `<div id="map" class="gmap h-100 border-15-left" data-oi-map-autoload="single" data-marker-icon-wh="40,50" data-marker-icon-id="map_pin" data-zoom="8" data-zoom-control-position="top-left" data-latitude="${c.lat}" data-longitude="${c.lng}" data-vendor="mapbox"></div>`
    + `</div>`
    + `<div class="col px-md-5 px-lg-6 py-2 py-md-4 py-lg-5 mx-auto">`
    + sectionHeading('Sales Office', 'brown-bar short my-3')
    + `<div class="py-3 text-uppercase fs-8 overpass">`
    + addr + tel + hours
    + `<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-gray mt-3 mt-lg-5 oi-directions-click">GET DIRECTIONS</a>`
    + `</div></div></div></div></section>`;
}

export function formSlotHtml(kind, ctx) {
  // ctx = address string (legacy) or {address, image}. The .hs-form-slot contents are
  // an INERT visual placeholder matching O'Neill's field grid 1:1; the HubSpot task
  // replaces the inner form later. Field ids/classes are load-bearing (O'Neill's form
  // CSS is scoped to #detailpagescheduletourform).
  const c = (ctx && typeof ctx === 'object') ? ctx : { address: ctx };
  const address = c.address || '';
  const introImg = esc(c.introImage || c.image || '');
  const sideImg = esc(c.image || '');
  const sideAlt = esc(address || 'New Home');
  const form = `<form id="detailpagescheduletourform" class="oi-form detailpagescheduletourform" novalidate onsubmit="return false">
    <div class="row g-3">
        <div class="form-group charfield textinput first_name required"><label for="dpst__first_name">First Name</label><input type="text" name="first_name" placeholder="First Name*" class="form-control first_name required" id="dpst__first_name" aria-label="First Name"><span class="form-group-message"></span></div>
        <div class="form-group charfield textinput last_name required"><label for="dpst__last_name">Last Name</label><input type="text" name="last_name" placeholder="Last Name*" class="form-control last_name required" id="dpst__last_name" aria-label="Last Name"><span class="form-group-message"></span></div>
        <div class="form-group oiemailfield textinput email required"><label for="dpst__email">Email</label><input type="text" name="email" placeholder="Email*" class="form-control email required" id="dpst__email" aria-label="Email"><span class="form-group-message"></span></div>
        <div class="form-group choicefield select country_code required"><label for="dpst__country_code">Country Code</label><select name="country_code" class="form-control custom-select country_code required" id="dpst__country_code" aria-label="Country Code"><option value="+1">US</option><option value="+52">MX</option></select><span class="form-group-message"></span></div>
        <div class="form-group charfield textinput primary_phone"><label for="dpst__primary_phone">Primary Phone</label><input type="text" name="primary_phone" placeholder="Phone*" class="form-control primary_phone" id="dpst__primary_phone" aria-label="Primary Phone"><span class="form-group-message"></span></div>
        <div class="form-group datefield dateinput preferred_date required"><label for="dpst__preferred_date">Date*</label><input type="date" name="preferred_date" class="form-control preferred_date required" id="dpst__preferred_date" aria-label="Date*"><span class="form-group-message"></span></div>
        <div class="form-group timefield timeinput preferred_time required"><label for="dpst__preferred_time">Time*</label><input type="time" name="preferred_time" class="form-control preferred_time required" id="dpst__preferred_time" aria-label="Time*"><span class="form-group-message"></span></div>
        <div class="form-group custom-control form-checkbox booleanfield checkboxinput opt_in "><input type="checkbox" name="opt_in" class="form-check-input opt_in" id="dpst__opt_in" checked><label for="dpst__opt_in" class="custom-control-label"> &nbsp; Opt-in to receive text messages</label><span class="form-group-message"></span></div>
        <div class="form-row opt-in-text"><p>I agree to receive communications by text message regarding informational (appointment details, account notifications, marketing, etc. ) from Esperanza Homes.</p><p>You may opt out by replying STOP or ask for more information by replying HELP. Message frequency varies. Message and data rates may apply.</p><p>You may review our <a href="/privacy-policy/">Privacy Policy</a> to learn how your data is used.</p></div>
    </div>
    <div class="row g-3"><div class="form-group"><button type="submit" class="btn btn-primary mt-4 xsmall-btn overpass">Submit</button></div></div>
</form>`;
  return `<section id="request-a-tour" class="pagejump"><div class="container-fluid bg-green-100"><div class="row"><div class="col-12 col-md-11 col-lg-6 col-xl-5 m-auto py-4 py-xl-6"><div class="row"><div class="col">${sectionHeading('Schedule An Exploratory Visit', 'green-bar-light my-3')}<div class="row my-3 mt-lg-4">${introImg ? `<div class="col-5 col-md-3"><div class="oi-aspect one-one"><img src="${introImg}" loading="lazy" class="oi-aspect-img rounded-2" alt="Schedule an Exploratory Visit"></div></div>` : ''}<div class="col${introImg ? '-7 col-lg-9' : ''} wysiwyg my-auto">Please fill out this quick and easy form and let us know what date and time works best for you.</div></div></div></div><div class="hs-form-slot" data-form="${esc(kind)}" data-context="${esc(address)}">${form}</div></div>${sideImg ? `<div class="col-lg-5 pe-0 position-relative d-none d-lg-block"><div class="oi-aspect two-three-lg seven-eight-xl h-100"><div class="gray-overlay dark"></div><img src="${sideImg}" loading="lazy" class="oi-aspect-img" alt="${sideAlt}"></div></div>` : ''}</div></div></section>`;
}

export function recommendedHtml() {
  return `<section class="py-4 py-lg-5"><div class="container-lg"><div class="row"><div class="col">${sectionHeading('Recommended For You')}</div></div><div class="recommended-content row oi-listings g-2 mt-3" id="recommended"></div></div></section>`;
}

// #energy_cost — Energy Cost Comparison / HERS. Requires per-home MONTHLY energy $
// (newCost = Esperanza, oldCost = pre-owned); self-hides until both are present (R1
// backfill). jQuery-UI slider scales by 1/12/120/360 months; bars are decorative CSS.
export function energyHtml({ newCost, oldCost, hers } = {}) {
  const toNum = v => (v == null || v === '') ? NaN : Number(v);
  const nc = toNum(newCost), oc = toNum(oldCost);
  if (!Number.isFinite(nc) || !Number.isFinite(oc)) return '';
  const saving = (oc - nc).toFixed(2);
  const hersCell = (hers == null || hers === '') ? '' : esc(hers);
  return `<section id="energy_cost" class="py-4 pt-lg-6 pb-lg-5"><div class="container-lg"><div class="row"><div class="col"><div class="text-gray bodoni ls-sm fs-2 ps-0">Energy Cost Comparison</div><div class="green-bar-light my-2 my-lg-3"></div></div></div><div class="row mt-3 mt-lg-5 mx-0"><div class="col-12 col-lg-8"><div class="row"><div class="col-lg-6 col-md-6 col-sm-12 text-center mt-auto"><div class="height-one d-flex"><div class="ecp-num-results m-auto">$<span id="annualnew">${nc.toFixed(2)}</span></div></div><div class="d-block my-3 text-uppercase fs-9 text-dark-brown ls-sm overpass bold">Estimated Esperanza Cost</div><hr class="white m-0"></div><div class="col-lg-6 col-md-6 col-sm-12 text-center mt-auto"><div class="height-two d-flex"><div class="ecp-num-results m-auto">$<span id="annualold">${oc.toFixed(2)}</span></div></div><span class="d-block my-3 text-uppercase fs-9 text-dark-brown ls-sm overpass bold">Estimated Pre-Owned Cost</span><hr class="white m-0"></div></div><div class="row mt-4"><div class="number-slider"><div id="numslider" class="sld"></div><div class="numslider-label text-left d-flex justify-content-between fs-9 ls-sm text-uppercase overpass bold mt-3 text-dark-green"><div>1 Month</div><div>1 Year</div><div>10 Year</div><div>30 Year</div></div></div></div></div><div class="col-12 col-lg-3 offset-lg-1 text-center d-flex"><div class="bg-white border-15 p-4 w-100 mt-auto mb-4 d-flex"><div class="m-auto"><div class="text-uppercase overpass bold text-gray fs-8 ls-sm"><span id="time-period">Monthly</span> Cost Savings</div><div class="fs-5 overpass bold text-green mt-1 ls-sm">$<span id="annualsaving">${saving}</span></div><hr class="brown my-3"><h3 class="text-bold text-secondary"><div class="text-uppercase overpass bold text-gray fs-8 ls-sm">HERS SCORE</div><div class="fs-5 overpass bold text-green mt-1 ls-sm">${hersCell}</div></h3></div></div></div></div></div><script>$(document).ready(function(){var newCost=${nc},oldCost=${oc};var tOld=$('#annualold'),tNew=$('#annualnew'),tSave=$('#annualsaving');tSave.text((oldCost-newCost).toFixed(2));$.fn.digits=function(){return this.each(function(){$(this).text($(this).text().replace(/(\\d)(?=(\\d\\d\\d)+(?!\\d))/g,"$1,"));});};var amts=[0,1,2,3,4,5,6,7,8,9,12,11,12,13,14,15,16,17,18,120,20,21,22,23,24,25,26,27,360];$('#numslider').slider({min:1,max:28,step:9,value:1,change:s,slide:s});function s(){var month=amts[$('#numslider').slider("value")],tp=$('#time-period');var aOld=(month*oldCost).toFixed(2),aNew=(month*newCost).toFixed(2);tOld.text(aOld).digits();tNew.text(aNew).digits();tSave.text((aOld-aNew).toFixed(2)).digits();tp.text(month==1?'Monthly':month==12?'Annual':month==120?'10 Years':month==360?'30 Years':'Monthly');}});</script></section>`;
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
  assert(esc('a<b>&"') === 'a&lt;b&gt;&amp;&quot;', 'esc');
  assert(money(236990) === '$236,990', 'money');
  const g = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  assert(g.includes('id="detail-gallery"') && g.includes('data-fancybox="photos"') && g.includes('View 2 Photos'), 'gallery');
  const d = descHtml('Highlights:\n- Big yard\n- New roof');
  assert(d.includes('<ul>') && d.includes('<li>Big yard</li>'), 'desc bullets -> ul');
  const head = setHead('<head><title>x</title><link rel="canonical" href="y"></head>', { title: 'T', canonical: '/c/', url: '/c/', description: 'D' });
  assert(head.includes('<title>T</title>') && head.includes('href="/c/"'), 'setHead');
  const page = finalizePage('<head></head><body><!--CONTENT--></body>', { content: '<p>hi</p>', head: { title: 'T', canonical: '/c/', url: '/c/' }, page: { type: 'qmi', id: 'rec1' }, islands: ['detail-extras.js'] });
  assert(page.includes('<p>hi</p>') && page.includes('__ESPERANZA_PAGE') && page.includes('detail-extras.js'), 'finalizePage');

  // Fabricated heading pattern must never reappear; real theme pattern must be used
  // in all six section builders (verified against a live QMI detail page).
  const noFakeH2 = s => !/class="[^"]*fs-3 text-center[^"]*"/.test(s);

  const tour = tourHtml('https://my.matterport.com/show/?m=x');
  assert(noFakeH2(tour) && tour.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Virtual Tour</div>') && tour.includes('green-bar-light my-2 my-lg-3'), 'tourHtml heading');

  const elev = elevationHtml('Farmhouse', '/e.jpg');
  assert(noFakeH2(elev) && elev.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Elevations</div>'), 'elevationHtml heading');

  const plan = idaproPlanHtml('/fp.png', 'Marigold');
  assert(noFakeH2(plan) && plan.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Floor Plan</div>') && plan.includes('id="viewer"') && plan.includes('viewer-wrap') && plan.includes('plan-list'), 'idaproPlanHtml iviewer');

  const rec = recommendedHtml();
  assert(noFakeH2(rec) && rec.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Recommended For You</div>'), 'recommendedHtml heading');

  const sales = mapSalesHtml({ lat: 1, lng: 2, address: '1 Main St', city: 'Brownsville', officePhone: '956-000-0000' });
  assert(noFakeH2(sales) && sales.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Sales Office</div>') && sales.includes('brown-bar short my-3') && sales.includes('btn btn-gray') && sales.includes('oi-directions-click') && !sales.includes('btn btn-green'), 'mapSalesHtml Sales Office + brown-bar + btn-gray');

  const form = formSlotHtml('qmi', 'ctx1');
  assert(noFakeH2(form) && form.includes('<div class="text-gray bodoni ls-sm fs-2 ps-0">Schedule An Exploratory Visit</div>') && form.includes('green-bar-light my-3'), 'formSlotHtml Schedule An Exploratory Visit');

  const gallery = galleryHtml([{ url: '/a.jpg', alt: 'A' }, { url: '/b.jpg', alt: 'B' }], null, 'Home');
  assert(gallery.includes('btn btn-green small-btn mt-5') && !gallery.includes('card-button'), 'galleryHtml CTA class');
  // fidelity: real O'Neill mosaic — hero + side col with h-50 rows, overlay ("Photo Gallery") on last thumb
  assert(gallery.includes('col-md-6 col-lg-4') && gallery.includes('photo-overlay d-flex') && gallery.includes('Photo Gallery') && gallery.includes('h-50'), 'galleryHtml mosaic structure');
  const planUrl = idaproPlanHtml(null, 'Presidio', 'https://idapro.cloud/flr_pln/x');
  assert(planUrl.includes('id="plans"') && planUrl.includes('View Interactive Floor Plan') && planUrl.includes('href="https://idapro.cloud/flr_pln/x"') && !planUrl.includes('name="modelframe"'), 'idaproPlanHtml CTA fallback');
  const en = energyHtml({ newCost: 116.67, oldCost: 207.17, hers: 44 });
  assert(en.includes('id="energy_cost"') && en.includes('id="annualnew"') && en.includes('116.67') && en.includes('id="numslider"'), 'energyHtml renders with data');
  assert(energyHtml({}) === '' && energyHtml({ newCost: 100 }) === '', 'energyHtml self-hides without both costs');
  const comm = communityBlurbHtml({ name: 'El Eden', slug: 'el-eden', city: 'Laredo', image: '/c.jpg', description: '<p>x</p>' });
  assert(comm.includes('gray-gradient') && comm.includes('oi-aspect-img') && comm.includes('About the Community') && comm.includes('photo-block-info') && !comm.includes('background-image'), 'communityBlurbHtml real-img structure');

  // subnav: mobile "Go To..." dropdown + desktop row with `on-scroll` links (active on first item)
  const nav = subnavHtml([['overview', 'Overview'], ['photos', 'Photo Gallery'], ['sales', 'Contact']]);
  assert(nav.includes('Go To...') && nav.includes('dropdown-menu') && nav.includes('d-block d-lg-none'), 'subnav mobile dropdown');
  assert(nav.includes('id="desktop-menu"') && nav.includes('class="row subnav text-center d-none d-lg-flex"'), 'subnav desktop row classes');
  assert(nav.includes('class="col on-scroll active"') && nav.includes('class="col on-scroll">Contact</a>'), 'subnav on-scroll + active');
  assert(!nav.includes('bg-white border-bottom sticky-top') && !nav.includes('col-auto'), 'subnav no fabricated classes');

  console.log('sections.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
