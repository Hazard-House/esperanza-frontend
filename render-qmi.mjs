// render-qmi.mjs — full QMI detail page from a normalized home + the chrome shell.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, num, statItem, ICON, descHtml, bannerHtml, galleryHtml, subnavHtml, tourHtml, elevationHtml, idaproPlanHtml, communityBlurbHtml, mapSalesHtml, formSlotHtml, recommendedHtml, setHead, finalizePage } from './sections.mjs';
import { qmiPath } from './paths.mjs';

export function qmiContent(h) {
  const c = h.communityObj || {};
  const has = { tour: !!h.virtualTourUrl, plans: !!h.planViewerUrl, elev: !!h.fpImage, comm: !!(c.description || c.image), sales: !!(c.lat && c.lng) };
  const stats = [
    h.beds != null && statItem(ICON.bed, esc(h.beds) + ' Bed'),
    h.garage != null && statItem(ICON.garage, esc(h.garage) + ' Car Garage'),
    h.baths != null && statItem(ICON.bath, Number(h.baths).toFixed(1) + ' Bath'),
    h.stories != null && statItem(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories')),
    h.totalSqft != null && statItem(ICON.total, num(h.totalSqft) + ' Total Sq. Ft.'),
    h.livingSqft != null && statItem(ICON.living, num(h.livingSqft) + ' Living Sq. Ft.'),
    h.lot != null && statItem(ICON.lot || ICON.pin || ICON.total, 'Lot #' + esc(h.lot)),
    h.hersScore != null && statItem(ICON.hers || ICON.total, 'HERS Score ' + esc(h.hersScore)),
  ].filter(Boolean).join('');
  const ctas = [
    h.pdfUrl && `<a href="${esc(h.pdfUrl)}" target="_blank" rel="noopener" class="btn btn-green oi-brochure-download me-2 mb-2">Download Brochure</a>`,
    `<a href="#request-a-tour" class="btn btn-green me-2 mb-2">Schedule a Tour</a>`,
    `<a href="https://www.houseloan.com/" target="_blank" rel="noopener" class="btn btn-auto btn-learn me-2 mb-2">Get Prequalified</a>`,
    (c.lat && c.lng) && `<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-auto btn-learn mb-2 oi-directions-click">Get Directions</a>`,
  ].filter(Boolean).join('');
  const anchors = [['overview', 'Overview'], has.tour && ['virtualtour', 'Virtual Tour'], has.elev && ['elevations', 'Elevations'], has.plans && ['plans', 'Floor Plan'], ['photos', 'Photo Gallery'], has.comm && ['community', 'Community'], has.sales && ['sales', 'Sales & Map']].filter(Boolean);

  return [
    `<section class="header pagejump text-center bg-tan-white pb-2 py-lg-4"><div class="container"><div class="row align-items-center"><div class="col-12 col-md-9"><div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 me-auto d-none d-lg-block"></div><h1 class="bodoni text-gray fs-1 ls-sm">${esc(h.address)}</h1>${h.floorPlan ? `<div class="d-block text-brown">${esc(h.floorPlan)} Floor Plan</div>` : ''}<div class="d-block text-brown">${esc(h.community)}${h.city ? ` in ${esc(h.city)}, TX` : ''}</div>${bannerHtml(h.availability, h.promo)}</div><div class="col-12 col-md-3"><div class="overpass fs-7">PRICED AT</div><div class="overpass bold text-dark-green fs-4" data-live="price">${money(h.price)}</div><a data-bs-toggle="modal" data-bs-target="#payment-calculator" href="#" class="d-block fs-9 text-brown mt-1">Calculate Monthly Payment</a></div></div></div></section>`,
    galleryHtml(h.gallery, h.image, h.address),
    subnavHtml(anchors),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${descHtml(h.description)}<div class="row mt-4"><div class="col-12">${ctas}</div></div></div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4 mt-md-2 mt-lg-3"><div class="row stat-group border-gray mt-4 py-2">${stats}</div><div class="my-3 my-lg-4"><div class="osc-callout py-3 px-2 px-lg-3 text-center"><p class="bodoni text-white fs-4 ls-sm lh-2 fw-bold">Learn More About<br>${esc(h.address)}</p><button class="btn mb-2" data-bs-toggle="modal" data-bs-target="#osc-form">Get Answers</button></div></div></div></div></div></section>`,
    has.tour && tourHtml(h.virtualTourUrl),
    has.elev && elevationHtml(h.elevation, h.fpImage),
    has.plans && idaproPlanHtml(h.planViewerUrl, null, h.floorPlan),
    has.comm && communityBlurbHtml(c),
    has.sales && mapSalesHtml(c),
    recommendedHtml(),
    formSlotHtml('tour', h.address),
  ].filter(Boolean).join('\n');
}

export function renderQmi(h, shell) {
  const head = {
    title: `${h.address}, ${h.city || 'TX'} | Esperanza Homes`,
    description: `${h.floorPlan || ''} home for sale in ${h.community}, ${h.city}, TX — ${money(h.price)}.`.trim(),
    canonical: qmiPath(h), image: (h.gallery[0] && h.gallery[0].url) || h.image, url: qmiPath(h),
  };
  return finalizePage(shell, { content: qmiContent(h), head, page: { type: 'qmi', id: h.id, communitySlug: (h.communityObj && h.communityObj.slug) || '' }, islands: ['hydrate-live.js', 'detail-extras.js', 'community-maps-live.js'] });
}

function demo() {
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, description: '<p>Nice</p>', image: '/c.jpg', officePhone: '956-395-1516', officeHours: 'Mon-Sat 9-6' };
  const h = { id: 'recH', address: '5131 Carambola Ln', community: 'El Eden', city: 'Laredo', slug: '5131-carambola-ln', price: 236990, beds: 3, baths: 2, garage: 2, stories: 2, lot: '334', hersScore: 47, livingSqft: 1106, totalSqft: 1471, description: 'Highlights:\n- Big yard', gallery: [{ url: '/1.jpg', alt: '' }], image: '/1.jpg', virtualTourUrl: 'https://my.matterport.com/show/?m=x', planViewerUrl: 'https://idapro.cloud/flr_pln/presidio', fpImage: '/fp.jpg', elevation: 'Presidio - Tuscan', pdfUrl: 'https://pdf/x', availability: 'Available Now', promo: '', communityObj: c };
  const out = qmiContent(h);
  for (const id of ['id="detail-gallery"', 'id="overview"', 'id="virtualtour"', 'id="plans"', 'id="community"', 'id="sales"', 'id="request-a-tour"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('data-live="price"') && out.includes('$236,990'), 'price');
  assert(out.includes('Lot #334'), 'lot number stat');
  assert(out.includes('2 Stories'), 'stories stat');
  assert(out.includes('HERS Score 47'), 'HERS score stat');
  assert(out.includes('<ul>') && out.includes('Big yard'), 'desc bullets');
  assert(out.includes('matterport.com') && out.includes('idapro.cloud'), 'tour+plan');
  assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'no leftover markers/undefined');
  const page = renderQmi(h, '<head><title>x</title></head><body><!--CONTENT--></body>');
  assert(page.includes('hydrate-live.js') && page.includes('community-maps-live.js') && page.includes('__ESPERANZA_PAGE'), 'islands+config');
  console.log('render-qmi.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
