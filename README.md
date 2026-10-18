# Werelderfgoed

Een web-app (PWA) met alle UNESCO-werelderfgoedlocaties. Je houdt bij welke je hebt
bezocht, waar je nog heen wilt en wat er in de buurt ligt.

## Functies

- **Kaart** met alle 1.273 locaties, gegroepeerd per gebied. De kleur van een pin
  toont je status: groen is bezocht, oranje is "wil ik heen", grijs is nog niets.
  Een rode rand betekent dat de locatie op de lijst van bedreigd erfgoed staat.
- **In de buurt**: vanaf je GPS-locatie, een plaats die je zoekt of een punt dat je
  op de kaart tikt, binnen een straal van 10 tot 1.000 km, gesorteerd op afstand.
- **Wil ik heen** en **Bezocht**: je eigen lijsten, met de datum van markeren.
- **Alle**: de volledige lijst, doorzoekbaar op naam of land.
- **Back-up**: via het menu exporteer je je lijsten als JSON-bestand en importeer je
  ze op een ander apparaat. Bij dubbele locaties wint de meest recente wijziging.

De kaart toont steeds precies wat de lijst toont.

## Opslag

Alles staat in de `localStorage` van je browser. Er is geen account en geen server.
Wis je de sitegegevens van je browser, dan ben je je lijsten kwijt. Maak dus af en toe
een back-up.

## Lokaal draaien

Het is een statische site zonder build-stap. Elke webserver werkt:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

GPS werkt alleen via `https://` of `localhost`.

## Publiceren

Zet de map op een willekeurige statische host, bijvoorbeeld GitHub Pages
(Settings → Pages → branch kiezen, map `/`). Daarna kun je de app op je telefoon
via "Zet op beginscherm" installeren.

## Structuur

| Pad | Inhoud |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | De app |
| `data/sites.json` | Compacte lijst van alle locaties |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installeerbaar en offline bruikbaar |
| `vendor/` | Leaflet 1.9.4 en Leaflet.markercluster 1.5.3 |
| `scripts/build-data.mjs` | Maakt `data/sites.json` uit een GeoJSON-bron |

## Data bijwerken

De locaties komen uit een snapshot van de UNESCO-werelderfgoedlijst (augustus 2026,
inclusief de inschrijvingen van 2026), via het npm-pakket
`@worldwideview/wwv-plugin-unesco-sites` (Elastic License 2.0). Nieuwe versie ophalen:

```bash
npm pack @worldwideview/wwv-plugin-unesco-sites
tar xzf worldwideview-wwv-plugin-unesco-sites-*.tgz
node scripts/build-data.mjs package/data/data.json
```

Je opgeslagen statussen gebruiken het officiële UNESCO-id, dus die blijven geldig.

## Externe diensten

- Kaarttegels: © OpenStreetMap-bijdragers, © CARTO
- Plaatsen zoeken: Nominatim (OpenStreetMap), alleen bij het indrukken van "Zoek"
