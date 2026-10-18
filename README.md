# Werelderfgoed

Een web-app (PWA) met alle UNESCO-werelderfgoedlocaties. Je houdt bij welke je hebt
bezocht, waar je nog heen wilt en wat er in de buurt ligt.

## Functies

- **Kaart** met alle 1.273 locaties, gegroepeerd per gebied. De vorm van een pin volgt
  het werelderfgoedembleem: een vierkant is cultureel erfgoed, een cirkel natuur, een
  vierkant in een cirkel gemengd. De vulling is je status: hol is nog niet geweest,
  saliegroen is "wil ik heen", groen is bezocht. Een rode rand betekent bedreigd erfgoed.
- **In de buurt**: vanaf je GPS-locatie, een plaats die je zoekt of een punt dat je
  op de kaart tikt, binnen een straal van 10 tot 1.000 km, gesorteerd op afstand.
- **Wil ik heen** en **Bezocht**: je eigen lijsten. Bij een bezoek leg je de datum
  vast; die staat op een stempel.
- **Statistieken** bovenaan de tab Bezocht (of tik op de teller rechtsboven): aantal,
  landen, aandeel van de lijst, een paspoort met je laatste stempels, en de verdeling
  per UNESCO-regio en per type. Landen tellen mee via locaties die in één land liggen.
- **Reisgids uit Wikivoyage** bij elke locatie: eerst het Nederlandstalige artikel
  over de plek, anders het dichtstbijzijnde artikel binnen 10 km, en daarna hetzelfde
  in het Engels. Er staat altijd bij of het over de plek zelf gaat of over een bestemming
  in de buurt.
- **Alle**: de volledige lijst, doorzoekbaar op naam of land.
- **Back-up**: via het menu exporteer je je lijsten als JSON-bestand en importeer je
  ze op een ander apparaat. Bij dubbele locaties wint de meest recente wijziging.

De kaart toont steeds precies wat de lijst toont.

## Offline

Alles wat je opent, blijft op je apparaat: de app, de lijst, reisgidsen, foto's en de
kaarttegels die je bekeek. Via het menu zet je je hele verlanglijst vooraf klaar: per
locatie de reisgids en de kaart van de omgeving (zoom 5 tot en met 13). Zonder
verbinding zie je rechtsboven op de kaart "Offline".

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

Zet de map op een willekeurige statische host, bijvoorbeeld GitHub Pages:
Settings → Pages → Source "Deploy from a branch" → branch kiezen, map `/ (root)`.
De site staat dan op `https://patrickloonstra.github.io/unesco/`. Daarna kun je de
app op je telefoon via "Zet op beginscherm" installeren.

Let op: GitHub Pages op een privé-repo vraagt een betaald GitHub-abonnement, en de
gepubliceerde site is altijd openbaar. Je lijsten blijven wel privé, want die staan
alleen in je eigen browser.

## Structuur

| Pad | Inhoud |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | De app |
| `guide.js` | Wikivoyage-reisgids met eigen cache, en kaarttegels klaarzetten |
| `data/sites.json` | Compacte lijst van alle locaties |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installeerbaar en offline bruikbaar |
| `vendor/` | Leaflet 1.9.4, Leaflet.markercluster 1.5.3 en de lettertypen Gloock, Schibsted Grotesk en IBM Plex Mono (OFL, via Fontsource) |
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

- Kaart: OpenStreetMap (© OpenStreetMap-bijdragers). Gebruik de offline-knop met mate:
  de tegelservers van OpenStreetMap zijn bedoeld voor normaal kijken, niet voor massaal
  downloaden.
- Plaatsen zoeken: Nominatim (OpenStreetMap), alleen bij het indrukken van "Zoek"
- Reisgidsen: Wikivoyage (tekst onder CC BY-SA 4.0), foto's via Wikimedia Commons
