/* Talisman service worker */
const VERSION = 'v9';
const SHELL = `talisman-shell-${VERSION}`;
const MAP = 'talisman-map-v2';
const MAX_MAP_ITEMS = 2500;

const SHELL_FILES = [
  './', 'index.html', 'styles.css?v=9', 'app.js?v=9', 'manifest.webmanifest',
  'data/cities.json', 'data/paris.json', 'data/london.json', 'data/rome.json', 'data/lisbon.json', 'data/copenhagen.json', 'data/milan.json', 'data/vienna.json', 'data/barcelona.json', 'data/berlin.json', 'data/amsterdam.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/mark.svg', 'icons/favicon.png',
  'vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/maplibre-gl.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('talisman-') && k !== SHELL && k !== MAP).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

let trimming = false;
async function trimMap() {
  if (trimming) return; trimming = true;
  try {
    const c = await caches.open(MAP); const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_MAP_ITEMS))) await c.delete(k);
  } finally { trimming = false; }
}
// Map tiles, fonts and sprites: cache first (they're immutable per URL), fill as you browse
async function mapAsset(req) {
  const c = await caches.open(MAP);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimMap(); }
    return res;
  } catch { return new Response('', { status: 504 }); }
}
// Style JSON: fresh when online, cached when not
async function mapStyle(req) {
  const c = await caches.open(MAP);
  try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
  catch { return (await c.match(req)) || Response.error(); }
}
async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || Response.error();
  }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith(url.pathname.startsWith('/styles/') || !/\.\w+$/.test(url.pathname) ? mapStyle(req) : mapAsset(req));
    return;
  }
  if (/(^|\.)wikimedia\.org$/.test(url.hostname) && (url.pathname.includes('Special:FilePath') || url.hostname !== 'commons.wikimedia.org')) {
    e.respondWith(mapAsset(req)); return;
  }
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') { e.respondWith(networkFirst(new Request('index.html'))); return; }
    if (/\.(json|js|css)$/.test(url.pathname) && !url.pathname.includes('/vendor/')) { e.respondWith(networkFirst(req)); return; }
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) e.respondWith(staleWhileRevalidate(req));
});
