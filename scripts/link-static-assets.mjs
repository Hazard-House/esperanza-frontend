// Create clean-name symlinks for HTTrack "name﹖v=hash.ext" theme files so any static
// server (Caddy, python -m http.server, Cursor preview) can serve name.ext?v=hash.
import { readdirSync, lstatSync, symlinkSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'public', 'static');
const RX = /^(.+)﹖v=([A-Za-z0-9]+)\.(\w+)$/;

function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let linked = 0;
let skipped = 0;
for (const file of walk(ROOT)) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const m = base.match(RX);
  if (!m) continue;
  const clean = join(file.slice(0, file.lastIndexOf('/')), `${m[1]}.${m[3]}`);
  if (existsSync(clean)) { skipped++; continue; }
  symlinkSync(base, clean);
  linked++;
}
console.log(`link-static-assets: ${linked} symlinks created, ${skipped} already present`);
