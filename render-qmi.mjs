// render-qmi.mjs — full QMI detail page from a normalized home + the chrome shell.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, num, statItem, ICON, descHtml, galleryHtml, subnavHtml, tourHtml, elevationHtml, idaproPlanHtml, energyHtml, communityBlurbHtml, mapSalesHtml, formSlotHtml, recommendedHtml, setHead, finalizePage } from './sections.mjs';
import { qmiPath, communityPath, floorplanPath } from './paths.mjs';

const GREEN_ARROW = '/static/esperanza_homes/images/green-arrow%EF%B9%96v=a02d15d.svg';

export function qmiContent(h) {
  const c = h.communityObj || {};
  const has = { tour: !!h.virtualTourUrl, plans: !!(h.planViewerUrl || h.planImage), elev: !!h.fpImage, comm: !!(c.description || c.image), sales: !!(c.lat && c.lng) };

  // --- Header (1:1 O'Neill; left-align relies on body.spec-detail, present in shell) ---
  const fpHref = floorplanPath(h.floorplanObj || { name: h.floorPlan });
  const commHref = communityPath(c.slug ? c : { name: h.community, city: h.city });
  const fpLink = h.floorPlan ? `<div class="d-block text-brown"><a href="${esc(fpHref)}" class="text-brown">${esc(h.floorPlan)} Floor Plan</a></div>` : '';
  const commLink = h.community ? `<div class="d-block"><a href="${esc(commHref)}" class="text-brown">${esc(h.community)}${h.city ? ` in ${esc(h.city)}, TX` : ''}</a></div>` : '';
  const avail = h.availability ? `<div class="status-banner gray mt-2 align-top" data-live="availability">${esc(h.availability)}</div>` : '';
  const promoB = h.promo ? `<div class="status-banner overlay-promo mt-2 align-top tan" data-live="promo">${esc(h.promo)}</div>` : '';
  const saving = h.promo ? `<p id="calculator-promo-saving" class="small mb-2">Savings Over 30 Years</p>` : '';
  const header = `<section class="header text-center bg-tan-white pb-2 py-lg-4"><div class="container"><div class="row align-items-center"><div class="col-12 col-md-9"><div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 me-auto d-none d-lg-block"></div><h1 class="bodoni text-gray fs-1 ls-sm">${esc(h.address)}</h1>${fpLink}${commLink}${avail}${promoB}</div><div class="col-12 col-md-3"><div><div class="overpass fs-7">PRICED AT</div><div class="overpass bold text-dark-green fs-4" data-live="price">${money(h.price)}</div></div>${saving}<div><a data-bs-toggle="modal" data-bs-target="#payment-calculator"><div class="btn btn-auto btn-learn">Calculate Monthly Payment<img class="ms-auto mb-1" src="${GREEN_ARROW}" aria-hidden="true" loading="lazy" width="16"></div></a></div></div></div></div></section>`;

  // --- Overview: description | stat-group + share + osc-callout; CTA row spans below ---
  const stats = [
    h.beds != null && statItem(ICON.bed, esc(h.beds) + ' Bed'),
    h.garage != null && statItem(ICON.garage, esc(h.garage) + ' Car Garage'),
    h.baths != null && statItem(ICON.bath, Number(h.baths).toFixed(1) + ' Bath'),
    h.stories != null && statItem(ICON.story, esc(h.stories) + (h.stories == 1 ? ' Story' : ' Stories')),
    h.totalSqft != null && statItem(ICON.total, num(h.totalSqft) + ' Total Sq. Ft.'),
    // O'Neill's overview reuses the plain sqft icon for the Living row too.
    h.livingSqft != null && statItem(ICON.total, num(h.livingSqft) + ' Living Sq. Ft.'),
    h.lot != null && statItem(ICON.lot, 'Lot #' + esc(h.lot)),
  ].filter(Boolean).join('');
  const subj = encodeURIComponent(h.address || ''), shareUrl = qmiPath(h);
  const share = `<div class="share-buttons mb-3"><ul><li class="h6 title-underline">Share</li><li><a href="mailto:?subject=${subj}&body=${esc(shareUrl)}" target="_blank"><i class="far fa-envelope text-brown me-2 fa-lg"></i></a></li><li><a target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${esc(shareUrl)}&src=sdkpreparse" class="fb-xfbml-parse-ignore"><i class="fab fa-facebook text-brown me-1 fa-lg"></i></a></li><li><a href="https://twitter.com/intent/tweet?text=${subj}&url=${esc(shareUrl)}" target="_blank"><i class="fab fa-twitter text-brown fa-lg"></i></a></li></ul></div>`;
  const osc = `<div class="my-3 my-lg-4"><div class="osc-callout py-3 px-2 px-lg-3 text-center"><p class="bodoni text-white fs-4 ls-sm lh-2 fw-bold">Learn More About<br>${esc(h.address)}</p><button class="btn mb-2" data-bs-toggle="modal" data-bs-target="#osc-form">Get Answers</button></div></div>`;
  const dLat = h.lat != null ? h.lat : c.lat, dLng = h.lng != null ? h.lng : c.lng;
  const ctas = [
    h.pdfUrl && `<a class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2 oi-brochure-download" href="${esc(h.pdfUrl)}" target="_blank">DOWNLOAD BROCHURE</a>`,
    `<a href="#request-a-tour" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2">SCHEDULE AN EXPLORATORY VISIT</a>`,
    `<a href="https://www.houseloan.com/" target="_blank" rel="noopener" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2">GET PREQUALIFIED</a>`,
    (dLat && dLng) && `<a href="https://maps.google.com/maps?q=${dLat},${dLng}" target="_blank" rel="noopener" class="btn btn-primary small-btn px-3 light-opacity mt-2 mt-lg-4 me-lg-2 oi-directions-click">GET DIRECTIONS</a>`,
  ].filter(Boolean).join('');
  const overview = `<section id="overview" class="pt-4 pt-lg-5 bg-tan-white reverse pagejump pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${descHtml(h.description)}</div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4 mt-md-2 mt-lg-3"><div class="row stat-group mt-4 py-2">${stats}</div>${share}${osc}</div></div><div class="row"><div class="col-12">${ctas}</div></div></div></section>`;

  const anchors = [['overview', 'Overview'], has.tour && ['virtualtour', 'Virtual Tour'], has.elev && ['elevations', 'Elevations'], has.plans && ['plans', 'Floor Plans'], ['photos', 'Photo Gallery'], has.comm && ['community', 'Community'], has.sales && ['sales', 'Contact']].filter(Boolean);

  return [
    header,
    galleryHtml(h.gallery, h.image, h.address),
    subnavHtml(anchors),
    overview,
    has.tour && tourHtml(h.virtualTourUrl, h),
    has.elev && elevationHtml(h.elevation, h.fpImage),
    has.plans && idaproPlanHtml(h.planImage, h.floorPlan, h.planViewerUrl),
    energyHtml({ newCost: h.newCost, oldCost: h.oldCost, hers: h.hersScore }),
    has.comm && communityBlurbHtml(c),
    has.sales && mapSalesHtml(c),
    recommendedHtml(),
    formSlotHtml('tour', { address: h.address, image: c.image }),
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
  const h = { id: 'recH', address: '5131 Carambola Ln', community: 'El Eden', city: 'Laredo', slug: '5131-carambola-ln', floorPlan: 'Presidio', floorplanObj: { name: 'Presidio', slug: 'presidio' }, price: 236990, beds: 3, baths: 2, garage: 2, stories: 2, lot: '334', hersScore: 47, livingSqft: 1106, totalSqft: 1471, description: 'Highlights:\n- Big yard', gallery: [{ url: '/1.jpg', alt: '' }], image: '/1.jpg', virtualTourUrl: 'https://my.matterport.com/show/?m=x', planViewerUrl: 'https://idapro.cloud/flr_pln/presidio', fpImage: '/fp.jpg', elevation: 'Presidio - Tuscan', pdfUrl: 'https://pdf/x', availability: 'Available Now', promo: '', communityObj: c };
  const out = qmiContent(h);
  for (const id of ['id="detail-gallery"', 'id="overview"', 'id="virtualtour"', 'id="plans"', 'id="community"', 'id="sales"', 'id="request-a-tour"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('data-live="price"') && out.includes('$236,990'), 'price');
  assert(out.includes('Lot #334'), 'lot number stat');
  assert(out.includes('2 Stories'), 'stories stat');
  assert(out.includes('Floor Plans') && out.includes('SCHEDULE AN EXPLORATORY VISIT'), 'subnav label + overview CTA');
  assert(out.includes('<ul>') && out.includes('Big yard'), 'desc bullets');
  assert(out.includes('matterport.com') && out.includes('idapro.cloud'), 'tour+plan');
  assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'no leftover markers/undefined');
  const page = renderQmi(h, '<head><title>x</title></head><body><!--CONTENT--></body>');
  assert(page.includes('hydrate-live.js') && page.includes('community-maps-live.js') && page.includes('__ESPERANZA_PAGE'), 'islands+config');
  console.log('render-qmi.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
