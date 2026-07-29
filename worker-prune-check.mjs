import assert from 'node:assert/strict';
globalThis.HTMLRewriter = class { on() { return this; } transform(response) { return response; } };
const { default: worker } = await import('./worker.js');
const manifest = { redirects: {
  '/new-homes/tx/laredo/el-eden/republished/': '/new-homes/tx/laredo/el-eden/',
  '/new-homes/tx/laredo/el-eden/drafted/': '/new-homes/tx/laredo/el-eden/',
} };
const assets = { async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/stale-qmi-redirects.json') return Response.json(manifest);
  if (path === '/new-homes/available/home/') return new Response('<html>live shell</html>', { headers: { 'content-type': 'text/html' } });
  if (path === '/404.html') return new Response('<html>not found</html>', { headers: { 'content-type': 'text/html' } });
  return new Response('missing', { status: 404 });
} };
let published = true;
const env = { ASSETS: assets, API: { fetch: async () => Response.json({ homes: published ? [{ slug: 'republished' }] : [] }) } };
const republished = await worker.fetch(new Request('https://example.test/new-homes/tx/laredo/el-eden/republished/'), env);
assert.equal(republished.status, 200, 'republished missing page reaches live shell');
published = false;
const drafted = await worker.fetch(new Request('https://example.test/new-homes/tx/laredo/el-eden/drafted/'), env);
assert.equal(drafted.status, 301, 'confirmed unpublished missing page redirects');
assert.equal(new URL(drafted.headers.get('location')).pathname, '/new-homes/tx/laredo/el-eden/');
console.log('worker-prune-check.mjs passed');
