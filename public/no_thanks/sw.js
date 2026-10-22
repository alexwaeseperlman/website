// No Thanks! service worker: the page opens offline after the first visit (practice against bots works offline;
// online rooms need the network and are never cached)
const CACHE = 'nothanks-v7';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './bot-policy.txt', './bot-net.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'cdn.jsdelivr.net'){
    e.respondWith(caches.open(CACHE).then(async c => { const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net; }));
    return;
  }
  if (u.origin !== location.origin) return;
  // ignore ?room=... so an invite link opens offline too
  // the page itself skips the browser's HTTP cache (GitHub Pages caches it for 10 minutes), so an update shows on the next open
  const req = e.request.mode === 'navigate' ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(req.then(r => { if (r.ok && !u.search){ const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(h => h || caches.match('./index.html'))));
});
