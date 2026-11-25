const CACHE = 'simba-pro-v7';
const ASSETS = ['./', './index.html', './css/style.css', './js/config.js', './js/app.js', './manifest.json?v=3', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './favicon-32.png', './favicon.ico', './logo-96.png', './logo-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => { }))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))));
  self.clients.claim();
});
const FONT = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Font Google: cache dulu + perbarui di latar → muat ulang instan dan tetap tampil saat offline
  if (FONT.test(u.hostname)) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => {
      const net = fetch(e.request).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (u.origin !== location.origin) return;   // GAS: selalu ke jaringan
  // config.js diambil jaringan dulu agar perubahan GAS_URL langsung berlaku; sisanya cache dulu + perbarui di latar
  if (u.pathname.endsWith('/js/config.js')) { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); return; }
  e.respondWith(caches.match(e.request, { ignoreSearch: false }).then(hit => {
    const net = fetch(e.request).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    return hit || net;
  }));
});
