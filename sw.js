// Service worker: maakt de app installeerbaar en bruikbaar zonder verbinding.
// Kaarttegels en plaatszoeken komen van externe diensten en worden niet gecachet.
// Verhoog VERSION bij elke wijziging aan de bestanden hieronder.

const VERSION = "v3";
const CACHE = `werelderfgoed-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "data/sites.json",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/markercluster/leaflet.markercluster.js",
  "vendor/markercluster/MarkerCluster.css",
  "vendor/fonts/fonts.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Eigen bestanden: eerst het netwerk (zodat updates direct doorkomen), anders de cache.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
