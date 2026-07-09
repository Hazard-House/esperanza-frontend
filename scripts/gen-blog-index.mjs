#!/usr/bin/env node
// gen-blog-index.mjs — scans the shipped blog post pages and writes
// public/blog-index.json {href,title,image,date,excerpt}[] for the client-side
// blog search island (live's /blog/?search= is served by Homefiniti server-side;
// the static mirror filters this index instead).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BLOG = 'public/blog';
const posts = [];
for (const d of readdirSync(BLOG, { withFileTypes: true })) {
  if (!d.isDirectory() || /^(category|page-\d+|\d{4})$/.test(d.name)) continue;
  const f = join(BLOG, d.name, 'index.html');
  if (!existsSync(f)) continue;
  const h = readFileSync(f, 'utf8');
  const meta = (name) => { const m = h.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`)); return m ? m[1] : ''; };
  const title = (h.match(/<title>([\s\S]*?)(?:\s*\|\s*Esperanza[^<]*)?<\/title>/) || [])[1] || d.name;
  // post pages carry the date as plain text near the title (no entry-date class)
  const date = (h.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/) || [''])[0];
  posts.push({ href: `/blog/${d.name}/`, title: title.trim(), image: meta('og:image'), date: date.trim(), excerpt: meta('description').slice(0, 140) });
}
posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
writeFileSync('public/blog-index.json', JSON.stringify(posts));
console.log('blog-index.json:', posts.length, 'posts');
