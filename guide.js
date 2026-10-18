"use strict";

// Reisinformatie uit Wikivoyage, met een eigen cache zodat alles wat je eens
// opende (of klaarzette) ook offline beschikbaar is.
//
// Per locatie zoeken we eerst in de Nederlandse Wikivoyage, daarna in de Engelse:
//   1. een artikel waarvan de naam past bij de locatie en dat binnen 30 km ligt;
//   2. anders het dichtstbijzijnde artikel binnen 10 km (meestal de stad of regio).
// Ook "niets gevonden" wordt bewaard, zodat we niet steeds opnieuw zoeken.

const Guide = (() => {
  const CACHE = "werelderfgoed-gids";
  const LANGS = ["nl", "en"];
  const MATCH_KM = 30;
  const memory = new Map();

  const cacheKey = (id) => new URL(`./__gids/${encodeURIComponent(id)}`, location.href).href;

  function km(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }

  function apiUrl(lang, params) {
    const q = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      redirects: "1",
      prop: "extracts|pageimages|coordinates|info",
      exintro: "1",
      explaintext: "1",
      exlimit: "max",
      piprop: "thumbnail",
      pithumbsize: "640",
      colimit: "max",
      inprop: "url",
      ...params,
    });
    return `https://${lang}.wikivoyage.org/w/api.php?${q}`;
  }

  async function query(lang, params) {
    const res = await fetch(apiUrl(lang, params));
    if (!res.ok) throw new Error(`Wikivoyage ${res.status}`);
    const data = await res.json();
    return data.query?.pages ?? [];
  }

  // "Mill Network at Kinderdijk-Elshout (…)" -> "Mill Network at Kinderdijk-Elshout"
  const searchName = (name) => name.replace(/\s*\(.*?\)\s*/g, " ").split(/ [–-] |, /)[0].trim();

  function toResult(lang, page, site, kind) {
    const c = page.coordinates?.[0];
    const paragraphs = (page.extract ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean);
    return {
      lang,
      title: page.title,
      url: page.fullurl ?? `https://${lang}.wikivoyage.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`,
      paragraphs: paragraphs.slice(0, 4),
      image: page.thumbnail?.source ?? null,
      distanceKm: c ? km(site.lat, site.lon, c.lat, c.lon) : null,
      kind,
    };
  }

  async function lookupIn(lang, site) {
    const [found, near] = await Promise.all([
      query(lang, { generator: "search", gsrsearch: searchName(site.name), gsrlimit: "5", gsrnamespace: "0" }),
      query(lang, { generator: "geosearch", ggscoord: `${site.lat}|${site.lon}`, ggsradius: "10000", ggslimit: "10" }),
    ]);
    const usable = (p) => p.extract && p.extract.trim().length > 40 && p.coordinates?.length;
    const dist = (p) => km(site.lat, site.lon, p.coordinates[0].lat, p.coordinates[0].lon);

    const match = found.filter(usable).filter((p) => dist(p) <= MATCH_KM).sort((a, b) => dist(a) - dist(b))[0];
    if (match) return toResult(lang, match, site, "match");

    const nearest = near.filter(usable).sort((a, b) => dist(a) - dist(b))[0];
    if (nearest) return toResult(lang, nearest, site, "nearby");
    return null;
  }

  async function fromCache(id) {
    try {
      const cache = await caches.open(CACHE);
      const res = await cache.match(cacheKey(id));
      return res ? res.json() : undefined;
    } catch {
      return undefined;
    }
  }

  async function toCache(id, entry) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey(id), new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }));
    } catch {
      // Geen cache beschikbaar (bijv. privévenster): de gids werkt dan alleen online.
    }
  }

  // Haal de afbeelding één keer op, zodat de service worker hem bewaart.
  async function warmImage(url) {
    if (!url) return;
    try { await fetch(url, { mode: "cors" }); } catch { /* offline of geblokkeerd */ }
  }

  // Geeft { result, savedAt } terug, of gooit een fout als we offline zijn en
  // de locatie nog niet bewaard is.
  async function get(site) {
    if (memory.has(site.id)) return memory.get(site.id);
    const promise = (async () => {
      const cached = await fromCache(site.id);
      if (cached) return cached;
      let result = null;
      for (const lang of LANGS) {
        result = await lookupIn(lang, site);
        if (result) break;
      }
      const entry = { result, savedAt: new Date().toISOString() };
      await toCache(site.id, entry);
      await warmImage(result?.image);
      return entry;
    })();
    memory.set(site.id, promise);
    promise.catch(() => memory.delete(site.id));
    return promise;
  }

  async function has(id) {
    return (await fromCache(id)) !== undefined;
  }

  return { get, has };
})();

// Kaarttegels rond een punt alvast ophalen, zodat de service worker ze bewaart.
const OfflineMap = (() => {
  function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return [x, y];
  }

  // Overzicht (zoom 5-9, één tegel) en de directe omgeving (zoom 10-13, 3x3 tegels).
  function tilesAround(lat, lon, template) {
    const urls = [];
    for (let z = 5; z <= 13; z++) {
      const [cx, cy] = tileXY(lat, lon, z);
      const span = z >= 10 ? 1 : 0;
      for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
          const max = 2 ** z;
          const x = (cx + dx + max) % max;
          const y = cy + dy;
          if (y < 0 || y >= max) continue;
          urls.push(template.replace("{z}", z).replace("{x}", x).replace("{y}", y));
        }
      }
    }
    return urls;
  }

  async function fetchAll(urls, onProgress, concurrency = 6) {
    let done = 0;
    let failed = 0;
    const queue = [...urls];
    async function worker() {
      while (queue.length) {
        const url = queue.shift();
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) failed++;
        } catch {
          failed++;
        }
        onProgress(++done, urls.length);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { done, failed };
  }

  return { tilesAround, fetchAll };
})();
