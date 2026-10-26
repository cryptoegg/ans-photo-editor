// The installed app's helper (a service worker, registered by js/install.js): every request goes
// to the network first, so an update shows on the next open; a copy of each file is kept, so the
// app still opens without internet. Only this app's own files (and the CDN libraries it loads).
// (The same as the lyric video app's.)
const CACHE = "photo-editor-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  const library = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)$/.test(url.hostname);
  if (!ours && !library) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, ours ? { cache: "no-cache" } : undefined); // (ours: always checked with the server, so an update is never missed)
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const kept = await caches.match(req);
      if (kept) return kept;
      throw err;
    }
  })());
});
