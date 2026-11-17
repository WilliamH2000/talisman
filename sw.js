/* Talisman service worker */
const VERSION = 'v3';
const SHELL = `talisman-shell-${VERSION}`;
const TILES = 'talisman-tiles-v1';
const MAX_RUNTIME_TILES = 800;

const SHELL_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'data/places.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('talisman-shell-') && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Tiles come from a/b/c/d subdomains; store them under one key so any subdomain hits the cache.
const tileKey = url => url;
const isTile = url => new URL(url).hostname === 'tile.openstreetmap.org';

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  const pinned = await caches.open('talisman-tiles-pinned');
  if (keys.length > MAX_RUNTIME_TILES) {
    for (const k of keys.slice(0, keys.length - MAX_RUNTIME_TILES)) {
      if (!(await pinned.match(k))) await c.delete(k);
    }
  }
}

async function tileResponse(req) {
  const key = tileKey(req.url);
  const pinned = await caches.open('talisman-tiles-pinned');
  const hitPinned = await pinned.match(key);
  if (hitPinned) return hitPinned;
  const c = await caches.open(TILES);
  const hit = await c.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) { c.put(key, res.clone()); trimTiles(); }
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const hit = await c.match(req, { ignoreSearch: true });
    return hit || Response.error();
  }
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isTile(req.url)) { e.respondWith(tileResponse(req)); return; }
  if (url.origin === self.location.origin) {
    // HTML and data: fresh when online, cached when not
    if (req.mode === 'navigate' || /\.(json|js|css)$/.test(url.pathname)) {
      e.respondWith(networkFirst(req.mode === 'navigate' ? new Request('index.html') : req));
      return;
    }
    e.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

