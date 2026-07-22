// resolve-qmi-hero.mjs — QMI hero/card image selection shared by build + runtime islands.
// Source of truth: admin panel main image (D1 image_url), then photo_gallery lead,
// then harvested/live fallbacks when admin has only a floor-plan schematic or stub.

export const PLACEHOLDER_HERO = /\/(hero|photo_\d+)\.(jpe?g|png|webp|avif)(?:\?|$)/i;

export function isFloorPlanHeroUrl(u) {
  return /\/floor_plans\//i.test(String(u || ''));
}

export function isPlaceholderHeroUrl(u) {
  const s = String(u || '');
  if (!s) return true;
  // Admin uploads land at /qmi/rec…/photo_N.ext (or hero.jpg) — real main images, not stubs.
  if (/\/qmi\/rec[^/]+\//i.test(s)) return false;
  return PLACEHOLDER_HERO.test(s);
}

export function isBadHeroUrl(u) {
  return isPlaceholderHeroUrl(u) || isFloorPlanHeroUrl(u);
}

/** Pick the hero/card image for one QMI. `gallery` is [{url, alt}]. `qm` is harvested media. */
export function resolveQmiHero({ image, gallery = [] }, qm, fixHost = u => u) {
  // 1. Admin panel main image (image_url) when it is a real photo/render.
  if (image && !isBadHeroUrl(image)) return fixHost(image);

  // 2. Admin photo_gallery lead (panel sets main image = first gallery photo).
  const realGallery = (gallery || []).filter(g => g && g.url && !isBadHeroUrl(g.url));
  if (realGallery.length) return fixHost(realGallery[0].url);

  // 3. Harvested live mosaic / construction photos when admin still has a schematic only.
  if (qm?.hero) return fixHost(qm.hero);
  if (qm?.photos?.length) return fixHost(qm.photos[0]);

  return image ? fixHost(image) : image;
}

function demo() {
  const fix = u => u;
  const adminMain = 'https://img.hazardhouse.ai/qmi/recABC/photo_1.jpg';
  const fromAdmin = resolveQmiHero({ image: adminMain, gallery: [{ url: adminMain, alt: '' }] }, null, fix);
  if (fromAdmin !== adminMain) throw new Error('expected admin qmi/photo_1 as main image');

  const qm = { hero: 'https://x/ED916.jpg', photos: ['https://x/photo1.jpg'], source: 'live' };
  const adminWins = resolveQmiHero({ image: adminMain, gallery: [] }, qm, fix);
  if (adminWins !== adminMain) throw new Error('expected admin over live harvest');

  const fromFp = resolveQmiHero({ image: 'https://img/floor_plans/recZ/PRESIDIO.jpg', gallery: [] }, qm, fix);
  if (fromFp !== 'https://x/ED916.jpg') throw new Error('expected live hero when admin is floor plan');

  const fromGallery = resolveQmiHero(
    { image: 'https://img/floor_plans/x.jpg', gallery: [{ url: 'https://img/qmi/recZ/photo_2.jpg' }] },
    null, fix,
  );
  if (fromGallery !== 'https://img/qmi/recZ/photo_2.jpg') throw new Error('expected admin gallery lead');

  console.log('resolve-qmi-hero.mjs demo() passed');
}

if (process.argv.includes('--check')) demo();
