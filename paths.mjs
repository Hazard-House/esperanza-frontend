// paths.mjs — canonical detail-page URLs, derived entirely from our data.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { slugify } from './data.mjs';

const citySlug = h => slugify((h.communityObj && h.communityObj.city) || h.city || '');
const commSlug = h => (h.communityObj && h.communityObj.slug) || slugify(h.community || '');

export function qmiPath(h) {
  return `/new-homes/tx/${citySlug(h)}/${commSlug(h)}/${slugify(h.slug || h.address)}/`;
}
export function communityPath(c) {
  return `/new-homes/tx/${slugify(c.city)}/${c.slug || slugify(c.name)}/`;
}
export function floorplanPath(fp) {
  return `/floorplans/${fp.slug || slugify(fp.name)}/`;
}
export function linksMap(qmis, communities) {
  const qmi = {}, community = {};
  for (const h of qmis) qmi[`${slugify(h.community)}/${h.slug || ''}`] = qmiPath(h);
  for (const c of communities) community[slugify(c.name)] = communityPath(c);
  return { qmi, community };
}

function demo() {
  const c = { name: 'El Eden', slug: 'el-eden', city: 'Laredo' };
  const h = { community: 'El Eden', slug: '5131-carambola-ln', city: 'Laredo', communityObj: c };
  assert(qmiPath(h) === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', qmiPath(h));
  assert(communityPath(c) === '/new-homes/tx/laredo/el-eden/', communityPath(c));
  const m = linksMap([h], [c]);
  assert(m.qmi['el-eden/5131-carambola-ln'] === '/new-homes/tx/laredo/el-eden/5131-carambola-ln/', 'qmi link');
  assert(m.community['el-eden'] === '/new-homes/tx/laredo/el-eden/', 'community link');
  assert(floorplanPath({ slug: 'agave' }) === '/floorplans/agave/', 'fp path');
  console.log('paths.mjs demo() passed');
}
if (process.argv.includes('--check') && process.argv[1] === fileURLToPath(import.meta.url)) demo();
