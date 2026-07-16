#!/usr/bin/env node
// Re-hydrate community detail pages in public/ from the live API (no scrape needed).
// Updates both the scraped ID path (ship.txt) and the clean slug path per community.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData } from '../data.mjs';
import { communityPath } from '../paths.mjs';
import { classifyDetail } from '../build.mjs';
import { hydrateCommunity, hydrateCommunityStatus } from '../hydrate-scraped.mjs';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');

function shipList() {
  const manifest = join(ROOT, 'ship.txt');
  return readFileSync(manifest, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
}

async function main() {
  const d = await loadData();
  const bySlug = new Map(d.communities.map(c => [c.slug, c]));
  const paths = new Map(); // rel -> slug

  for (const rel of shipList()) {
    const det = classifyDetail(rel);
    if (det?.type !== 'community') continue;
    paths.set(rel, det.slug);
    const c = bySlug.get(det.slug);
    if (c) paths.set(communityPath(c).replace(/^\//, '') + 'index.html', det.slug);
  }

  let updated = 0;
  let skipped = 0;
  for (const [rel, slug] of paths) {
    const c = bySlug.get(slug);
    if (!c) { skipped++; continue; }
    const file = join(PUBLIC, rel);
    if (!existsSync(file)) { skipped++; continue; }
    const raw = readFileSync(file, 'utf8');
    let html = hydrateCommunityStatus(hydrateCommunity(raw, c, d), d);
    if (html !== raw) {
      writeFileSync(file, html);
      updated++;
      console.log(`updated ${rel}`);
    }
  }
  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${paths.size} community paths checked`);
}

main().catch(e => { console.error(e); process.exit(1); });
