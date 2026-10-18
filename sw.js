// Service worker: maakt de app installeerbaar en bruikbaar zonder verbinding.
//
// - De app zelf: eerst het netwerk (zodat updates direct doorkomen), anders de cache.
// - Kaarttegels en Wikivoyage-afbeeldingen: eerst de cache, en alles wat je bekijkt
//   wordt bewaard. Zo werkt de kaart offline voor gebieden die je al zag of klaarzette.
// - Wikivoyage-teksten bewaart guide.js zelf, in de cache werelderfgoed-gids.
//
// Verhoog VERSION bij elke wijziging aan de bestanden in SHELL.

const VERSION = "v4";
const SHELL_CACHE = `werelderfgoed-shell-${VERSION}`;
const TILE_CACHE = "werelderfgoed-tegels";
const IMAGE_CACHE = "werelderfgoed-beelden";
const MAX_TILES = 6000;
const MAX_IMAGES = 600;

const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "guide.js",
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
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

// Ruim alleen oude versies van de app op; tegels, beelden en reisgidsen blijven staan.
self.addEventListener("activate", (event) => {
  const isOldShell = (k) => k !== SHELL_CACHE && (k.startsWith("werelderfgoed-shell-") || /^werelderfgoed-v\d+$/.test(k));
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(isOldShell).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (url.hostname.endsWith(".basemaps.cartocdn.com")) {
    // Alle subdomeinen (a-d) delen één cache-sleutel.
    url.hostname = "a.basemaps.cartocdn.com";
    event.respondWith(cacheFirst(req, url.href, TILE_CACHE, MAX_TILES));
  } else if (url.hostname === "upload.wikimedia.org") {
    event.respondWith(cacheFirst(req, url.href, IMAGE_CACHE, MAX_IMAGES));
  }
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req, { ignoreSearch: true });
    return cached ?? Response.error();
  }
}

async function cacheFirst(req, key, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(key, res.clone());
      trim(cache, max);
    }
    return res;
  } catch {
    return Response.error();
  }
}

// Houd de cache onder de limiet door de oudste items weg te gooien.
let trimming = false;
async function trim(cache, max) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
  } finally {
    trimming = false;
  }
}
