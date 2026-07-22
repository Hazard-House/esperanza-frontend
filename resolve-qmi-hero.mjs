// resolve-qmi-hero.mjs — QMI hero/card image selection shared by build + runtime islands.
// Mirrors esperanza-api PR #171: never surface a floor-plan schematic or D1 placeholder
// when a real exterior/construction photo exists in photo_gallery or harvested media.

export const PLACEHOLDER_HERO = /\/(hero|photo_\d+)\.jpe?g(?:\?|$)/i;

export function isFloorPlanHeroUrl(u) {
  return /\/floor_plans\//i.test(String(u || ''));
}

export function isPlaceholderHeroUrl(u) {
  return !u || PLACEHOLDER_HERO.test(String(u));
}

export function isBadHeroUrl(u) {
  return isPlaceholderHeroUrl(u) || isFloorPlanHeroUrl(u);
}

/** Pick the hero/card image for one QMI. `gallery` is [{url, alt}]. `qm` is harvested media. */
export function resolveQmiHero({ image, gallery = [] }, qm, fixHost = u => u) {
  const realGallery = gallery.filter(g => g && g.url && !isBadHeroUrl(g.url));
  if (realGallery.length) return fixHost(realGallery[0].url);
  if (image && !isBadHeroUrl(image)) return fixHost(image);

  if (qm) {
    const stem = u => String(u || '').split('/').pop()?.split('?')[0].replace(/\.[^.]+$/i, '').toLowerCase() || '';
    const heroIsDrawing = qm.hero && (qm.planImages || []).some(u => stem(u) === stem(qm.hero));
    if (qm.photos?.length) return fixHost(qm.photos[0]);
    if (qm.hero && !heroIsDrawing) return fixHost(qm.hero);
    if (qm.hero && isBadHeroUrl(image)) return fixHost(qm.hero);
  }
  return image ? fixHost(image) : image;
}

function demo() {
  const fix = u => u;
  const qm = { hero: 'https://x/ED916.jpg', photos: ['https://x/photo1.jpg'], planImages: ['https://x/ED916.jpg'], source: 'live' };
  const fromFp = resolveQmiHero({ image: 'https://img/floor_plans/recZ/PRESIDIO.jpg', gallery: [] }, qm, fix);
  if (fromFp !== 'https://x/photo1.jpg') throw new Error('expected harvested photo over floor plan');
  const fromGallery = resolveQmiHero({ image: 'https://img/floor_plans/x.jpg', gallery: [{ url: 'https://img/real.jpg' }] }, null, fix);
  if (fromGallery !== 'https://img/real.jpg') throw new Error('expected D1 gallery photo');
  const keepGood = resolveQmiHero({ image: 'https://img/good.jpg', gallery: [] }, qm, fix);
  if (keepGood !== 'https://img/good.jpg') throw new Error('expected good D1 image kept');
  console.log('resolve-qmi-hero.mjs demo() passed');
}

if (process.argv.includes('--check')) demo();
