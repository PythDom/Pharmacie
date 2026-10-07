// Service worker : app utilisable hors ligne.
// - coquille de l'app + lib de scan : cache d'abord (changer VERSION pour publier une mise à jour)
// - base médicaments (data/*.json) : réseau d'abord, repli sur le cache
const VERSION = "pharmacie-v3";
const SHELL = [
  "./", "index.html", "atc.js", "app.js", "manifest.webmanifest",
  "lib/barcode-ponyfill.min.js", "lib/zxing_reader.wasm",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png",
  "data/meds.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API GitHub, Open*Facts : réseau direct
  if (url.pathname.includes("/data/")) {
    e.respondWith(
      fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
