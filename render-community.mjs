// render-community.mjs — full community detail page.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { esc, money, galleryHtml, mapSalesHtml, formSlotHtml, qmiCardHtml, planCardHtml, bannerHtml, finalizePage } from './sections.mjs';
import { communityPath } from './paths.mjs';
import { slugify } from './data.mjs';

function communityHeader(c) {
  const citySlug = slugify(c.city);
  const priced = c.priceFrom > 0 && !c.comingSoon;
  const lines = [
    `<div class="d-block d-lg-inline-block">New Homes in <a href="/${citySlug}/" class="text-decoration-underline text-brown">${esc(c.city)}, TX</a></div>`,
  ];
  if (priced) {
    lines.push('<div class="d-none d-lg-inline-block mx-1">•</div>');
    lines.push(`<div class="d-block d-lg-inline-block">Starting at ${money(c.priceFrom)}</div>`);
  }
  if (c.address) lines.push(`<div>${esc(c.address)}</div>`);
  if (c.lat != null && c.lng != null) {
    lines.push(`<a href="https://maps.google.com/maps?q=${c.lat},${c.lng}" target="_blank" rel="noopener" class="btn btn-gray mt-2 oi-directions-click">GET DIRECTIONS</a>`);
  }
  return [
    '<section class="header text-center bg-tan-white pb-2 py-lg-4">',
    '<div class="green-bar-thick mt-2 mt-lg-0 mb-1 mb-lg-3 mx-auto d-none d-lg-block"></div>',
    `<h1 class="bodoni text-gray fs-1 ls-sm">${esc(c.name)}</h1>`,
    `<div class="overpass text-brown fs-6 ls-sm px-1">${lines.join('\n')}</div>`,
    '</section>',
  ].join('\n');
}

export function communityContent(c) {
  const gallery = [c.image, c.secondaryImage].filter(Boolean).map(u => ({ url: u, alt: c.name }));
  const homes = (c.homes || []).map(qmiCardHtml).join('');
  const plans = (c.plans || []).map(planCardHtml).join('');
  return [
    communityHeader(c),
    galleryHtml(gallery, c.image, c.name),
    `<section id="overview" class="pagejump pt-4 pt-lg-5 bg-tan-white reverse pb-4"><div class="container-lg pt-3"><div class="row mb-3"><div class="col-12 col-md-7">${c.description ? `<div class="wysiwyg">${c.description}</div>` : ''}</div><div class="col-12 col-md-5 col-lg-4 offset-lg-1 mt-4"><div class="stat-group border-gray py-2">${c.priceFrom ? `<div class="item detail col-12">Homes from <span class="text-dark-green">${money(c.priceFrom)}</span></div>` : ''}${c.beds ? `<div class="item detail col-12">${esc(c.beds)} Bedrooms</div>` : ''}${c.baths ? `<div class="item detail col-12">${esc(c.baths)} Bathrooms</div>` : ''}${c.sqft ? `<div class="item detail col-12">${esc(c.sqft)} Sq. Ft.</div>` : ''}</div>${c.amenities ? `<div class="mt-4"><h3 class="overpass bold fs-7">Community Amenities</h3><div id="amenities-list" class="wysiwyg">${c.amenities}</div></div>` : ''}</div></div></div></section>`,
    homes ? `<section id="specs" class="pagejump py-4 py-lg-5"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Quick Move-Ins</h2><div class="row oi-listings">${homes}</div></div></section>` : '',
    plans ? `<section id="plans" class="pagejump py-4 py-lg-5 bg-tan-white"><div class="container"><h2 class="bodoni text-gray fs-3 mb-4">Available Floor Plans</h2><div class="row oi-listings oi-listings-plan">${plans}</div></div></section>` : '',
    mapSalesHtml(c),
    formSlotHtml('tour', c.name),
  ].filter(Boolean).join('\n');
}

export function renderCommunity(c, shell) {
  const head = {
    title: `${c.city}, TX New Homes | ${c.name} from Esperanza Homes`,
    description: `New homes in ${c.name}, ${c.city}, TX${c.priceFrom ? ` from ${money(c.priceFrom)}` : ''}.`,
    canonical: communityPath(c), image: c.image, url: communityPath(c),
  };
  return finalizePage(shell, { content: communityContent(c), head, page: { type: 'community', id: c.id, communitySlug: c.slug || '' }, islands: ['detail-extras.js', 'community-maps-live.js'] });
}

function demo() {
  const c = { id: 'recC', name: 'El Eden', slug: 'el-eden', city: 'Laredo', lat: 27.43, lng: -99.45, priceFrom: 209990, beds: '3 - 5', baths: '2 - 4', sqft: '1,148 - 2,328', description: '<p>Great</p>', amenities: '<ul><li>Pool</li></ul>', image: '/c.jpg', secondaryImage: '/c2.jpg',
    homes: [{ id: 'h1', address: '1 A St', community: 'El Eden', city: 'Laredo', slug: '1-a-st', price: 236990, beds: 3, baths: 2, livingSqft: 1106, image: '/h.jpg', communityObj: null }],
    plans: [{ id: 'p1', name: 'Presidio', slug: 'presidio', collection: 'Haven', startingPrice: 219990, bedroomMin: 3, bedroomMax: 4, bathroomMin: 2, bathroomMax: 3, garage: 2, livingSqft: 1400, image: '/p.jpg' }] };
  const out = communityContent(c);
  for (const id of ['id="overview"', 'id="specs"', 'id="plans"', 'id="sales"', 'id="request-a-tour"']) assert(out.includes(id), 'has ' + id);
  assert(out.includes('Starting at $209,990') && out.includes('green-bar-thick') && out.includes('New Homes in') && out.includes('Pool') && out.includes('1 A St') && out.includes('Presidio'), 'content');
  assert(!out.includes('<!--CONTENT-->') && !/undefined/.test(out), 'clean');
  console.log('render-community.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
