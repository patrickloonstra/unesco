// Zet een GeoJSON-snapshot van de UNESCO-werelderfgoedlijst om naar het
// compacte formaat dat de app laadt (data/sites.json).
//
// Gebruik:
//   npm pack @worldwideview/wwv-plugin-unesco-sites && tar xzf *.tgz
//   node scripts/build-data.mjs package/data/data.json
//
// Elke locatie wordt een array:
//   [id, naam, landen, categorie, jaar, lat, lon, bedreigd]
// waarbij categorie "c" (cultureel), "n" (natuur) of "m" (gemengd) is.

import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Gebruik: node scripts/build-data.mjs <pad-naar-geojson>");
  process.exit(1);
}

const CATEGORY = { cultural: "c", natural: "n", mixed: "m" };
const round = (n) => Math.round(n * 1e5) / 1e5;

const geo = JSON.parse(readFileSync(input, "utf8"));
const sites = geo.features
  .map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    return [
      String(p.id),
      p.name.trim(),
      p.country,
      CATEGORY[p.category] ?? "c",
      p.year,
      round(lat),
      round(lon),
      p.danger ? 1 : 0,
    ];
  })
  .filter((s) => Number.isFinite(s[5]) && Number.isFinite(s[6]))
  .sort((a, b) => a[1].localeCompare(b[1]));

const ids = new Set(sites.map((s) => s[0]));
if (ids.size !== sites.length) throw new Error("Dubbele id's in de bron");

const out = {
  source: "UNESCO World Heritage List (snapshot via @worldwideview/wwv-plugin-unesco-sites)",
  generated: new Date().toISOString().slice(0, 10),
  fields: ["id", "name", "countries", "category", "year", "lat", "lon", "danger"],
  sites,
};
writeFileSync(new URL("../data/sites.json", import.meta.url), JSON.stringify(out));
console.log(`${sites.length} locaties geschreven naar data/sites.json`);
