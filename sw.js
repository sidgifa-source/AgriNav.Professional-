/* ═══════════════════════════════════════════════════════════════
   AgriNav Pro v9.4 — Service Worker
   استراتيجية: Cache-First للثوابت + Network-First للتنقل + Cache-First للبلاطات
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v9.4.0-2024-01';
const STATIC_CACHE  = `agrinav-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `agrinav-runtime-${CACHE_VERSION}`;
const TILE_CACHE    = `agrinav-tiles-${CACHE_VERSION}`;

/* الملفات التي تُخزَّن مسبقاً (App Shell) — تستخدم CDN */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './offline-manager.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.css',
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.umd.min.js',
  'https://cdn.jsdelivr.net/npm/leaflet-geometryutil@0.10.3/src/leaflet.geometryutil.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/dist/NoSleep.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
];

/* نطاقات بلاطات الخرائط */
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'server.arcgisonline.com',
  'tile.opentopomap.org'
];

let _abortCache = false;

/* ═══════════════════════ INSTALL ═══════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    console.log('[SW] Installing...', CACHE_VERSION);
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload', mode: url.startsWith('http') ? 'cors' : 'same-origin' });
        if (res.ok) await cache.put(url, res);
        else console.warn(`[SW] Skip (${res.status}): ${url}`);
      } catch (e) { console.warn(`[SW] Failed: ${url}`, e.message); }
    }));
  })());
});

/* ═══════════════════════ ACTIVATE ═══════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    console.log('[SW] Activating...', CACHE_VERSION);
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('agrinav-') && ![STATIC_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(k))
        .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
    );
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_READY', version: CACHE_VERSION }));
  })());
});

/* ═══════════════════════ FETCH ═══════════════════════ */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (!url.protocol.startsWith('http')) return;

  /* 1. بلاطات الخريطة */
  if (TILE_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(handleTile(req));
    return;
  }

  /* 2. طلبات التنقل (HTML) */
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(handleNavigation(req));
    return;
  }

  /* 3. الثوابت (JS, CSS, fonts, icons) */
  event.respondWith(handleStatic(req));
});

/* ─── مُعالج الثوابت: Cache-First ─── */
async function handleStatic(req) {
  try {
    const cached = await caches.match(req);
    if (cached) return cached;
    const runtime = await caches.match(req, { cacheName: RUNTIME_CACHE });
    if (runtime) return runtime;
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

/* ─── مُعالج التنقل: Network-First مع Fallback ─── */
async function handleNavigation(req) {
  try {
    const networkRes = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(rej, 4000))
    ]);
    if (networkRes && networkRes.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, networkRes.clone()).catch(() => {});
      return networkRes;
    }
    throw new Error('Network failed');
  } catch (err) {
    const index = await caches.match('./index.html');
    if (index) return index;
    const offline = await caches.match('./offline.html');
    if (offline) return offline;
    return new Response(
      '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="UTF-8"><h1>أنت غير متصل</h1></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* ─── مُعالج البلاطات: Cache-First ─── */
async function handleTile(req) {
  const cached = await caches.match(req, { cacheName: TILE_CACHE });
  if (cached) return cached;
  try {
    const res = await fetch(req, { mode: 'no-cors' });
    if (res.ok || res.type === 'opaque') {
      const cache = await caches.open(TILE_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    return transparentTile();
  }
}

/* بلاطة شفافة 1×1 PNG */
let _transparentTileCache = null;
function transparentTile() {
  if (_transparentTileCache) return _transparentTileCache.clone();
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  _transparentTileCache = new Response(bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }
  });
  return _transparentTileCache.clone();
}

/* ═══════════════════════ MESSAGES ═══════════════════════ */
self.addEventListener('message', event => {
  const data = event.data || {};
  const { type, payload } = data;

  if (type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (type === 'CACHE_TILES') { event.waitUntil(cacheTiles(payload, event.source)); return; }
  if (type === 'ABORT_CACHE_TILES') { _abortCache = true; return; }
  if (type === 'GET_CACHE_INFO') {
    event.waitUntil(getCacheInfo().then(info => reply(event, { type: 'CACHE_INFO', payload: info })));
    return;
  }
  if (type === 'CLEAR_TILES') {
    event.waitUntil(caches.delete(TILE_CACHE).then(() => reply(event, { type: 'TILES_CLEARED' })));
    return;
  }
});

function reply(event, msg) {
  const source = event.source;
  if (source && source.postMessage) source.postMessage(msg);
  else self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage(msg)));
}

/* ═══════════════════════ CACHE TILES ═══════════════════════ */
async function cacheTiles(payload, source) {
  if (!payload || !Array.isArray(payload.urls)) {
    reply({ source }, { type: 'TILE_ERROR', payload: { message: 'No URLs' } });
    return;
  }

  _abortCache = false;
  const total = payload.urls.length;
  const cache = await caches.open(TILE_CACHE);
  let done = 0, failed = 0, skipped = 0;
  const startTime = Date.now();
  let lastReport = 0;
  const BATCH = 6;

  for (let i = 0; i < payload.urls.length; i += BATCH) {
    if (_abortCache) {
      reply({ source }, { type: 'TILE_ABORTED', payload: { done, failed, skipped, total, aborted: true } });
      return;
    }
    const batch = payload.urls.slice(i, i + BATCH);
    await Promise.all(batch.map(async url => {
      try {
        const exists = await cache.match(url);
        if (exists) { skipped++; done++; return; }
        const res = await fetch(url, { mode: 'no-cors' });
        if (res.ok || res.type === 'opaque') {
          await cache.put(url, res.clone());
          done++;
        } else { failed++; }
      } catch (err) { failed++; }
    }));

    const now = Date.now();
    if (now - lastReport > 500) {
      lastReport = now;
      const elapsed = (now - startTime) / 1000;
      const rate = done / elapsed;
      const eta = rate > 0 ? Math.ceil((total - done) / rate) : 0;
      reply({ source }, { type: 'TILE_PROGRESS', payload: { done, failed, skipped, total, eta, rate: rate.toFixed(1) } });
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  reply({ source }, { type: 'TILE_COMPLETE', payload: { done, failed, skipped, total, elapsed: elapsed.toFixed(1) } });
}

/* ═══════════════════════ CACHE INFO ═══════════════════════ */
async function getCacheInfo() {
  try {
    const tileCache = await caches.open(TILE_CACHE);
    const keys = await tileCache.keys();
    const count = keys.length;

    let sampleSize = 0, sampleCount = 0;
    const sampleStep = Math.max(1, Math.floor(count / 100));
    for (let i = 0; i < count; i += sampleStep) {
      try {
        const res = await tileCache.match(keys[i]);
        if (res) {
          const blob = await res.clone().blob();
          sampleSize += blob.size;
          sampleCount++;
        }
      } catch (e) {}
    }
    const avgSize = sampleCount > 0 ? sampleSize / sampleCount : 20000;
    const totalSize = avgSize * count;

    const staticCache = await caches.open(STATIC_CACHE);
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    const staticKeys = await staticCache.keys();
    const runtimeKeys = await runtimeCache.keys();

    return {
      tilesCount: count,
      tilesSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      staticCount: staticKeys.length,
      runtimeCount: runtimeKeys.length,
      version: CACHE_VERSION
    };
  } catch (e) {
    return { tilesCount: 0, tilesSizeMB: '0', version: CACHE_VERSION, error: e.message };
  }
}