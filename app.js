"use strict";

// ---------- Opslag ----------

const STORE_KEY = "unesco-tracker:v1";
const RADII = [10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000];

function loadState() {
  const empty = { statuses: {}, origin: null, radiusIndex: 4, tab: "nearby" };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast("Opslaan lukt niet in deze browser. Exporteer je lijsten als back-up.");
  }
}

function statusOf(id) {
  return state.statuses[id]?.status ?? null;
}

const today = () => new Date().toLocaleDateString("sv-SE"); // JJJJ-MM-DD in lokale tijd

function setStatus(id, status) {
  const entry = { status, updatedAt: new Date().toISOString() };
  if (status === "visited") entry.visitedOn = today();
  if (status) state.statuses[id] = entry;
  else delete state.statuses[id];
  saveState();
  requestPersistence();
}

// De dag van het bezoek: zelf ingevuld, anders de dag waarop je het markeerde.
const visitDate = (entry) => entry.visitedOn ?? entry.updatedAt.slice(0, 10);

function formatDate(isoDay, style = "long") {
  const [y, m, d] = isoDay.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return style === "stamp"
    ? `${String(d).padStart(2, "0")}·${String(m).padStart(2, "0")}·${y}`
    : date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

// Vraag de browser om onze opslag niet zomaar op te ruimen (lijsten, gidsen, kaart).
let persistenceAsked = false;
function requestPersistence() {
  if (persistenceAsked || !navigator.storage?.persist) return;
  persistenceAsked = true;
  navigator.storage.persist().catch(() => {});
}

// ---------- Hulpfuncties ----------

const $ = (sel) => document.querySelector(sel);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

const formatKm = (km) => (km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`);

function countriesLabel(countries) {
  const list = countries.split(",");
  return list.length > 2 ? `${list[0]} en ${list.length - 1} andere landen` : list.join(", ");
}

const CATEGORY_LABEL = { c: "Cultureel", n: "Natuur", m: "Gemengd" };
const CATEGORY_LONG = { c: "Cultureel erfgoed", n: "Natuurerfgoed", m: "Gemengd erfgoed" };
const REGION_LABEL = {
  en: "Europa en Noord-Amerika",
  ap: "Azië en Stille Oceaan",
  lc: "Latijns-Amerika en Caribisch gebied",
  af: "Afrika",
  ar: "Arabische staten",
};
const formatCount = (n) => n.toLocaleString("nl-NL");
const STATUS_LABEL = { visited: "Bezocht", want: "Wil ik heen" };

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// ---------- Kaart ----------

const map = L.map("map", { zoomControl: false, worldCopyJump: true }).setView([30, 10], 2);
L.control.zoom({ position: "topright" }).addTo(map);

// OpenStreetMap-standaardkaart. De kleuren tempert styles.css, zodat de pins opvallen.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const tiles = L.tileLayer(TILE_URL, {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
}).addTo(map);

// Laadt er na een poos nog steeds geen enkele tegel, zeg dat dan in plaats van een lege kaart.
let tilesLoaded = 0;
let tileErrors = 0;
tiles.on("tileload", () => tilesLoaded++);
tiles.on("tileerror", () => {
  if (++tileErrors === 6 && !tilesLoaded) {
    toast(navigator.onLine
      ? "De kaart van OpenStreetMap laadt niet. Herlaad de pagina of probeer het later opnieuw."
      : "Je bent offline. Je ziet alleen de kaart van gebieden die je eerder bekeek of klaarzette.");
  }
});

const cluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 45,
  iconCreateFunction: (c) => {
    const n = c.getChildCount();
    const size = n < 10 ? 30 : n < 100 ? 36 : 42;
    return L.divIcon({ html: `<span>${n}</span>`, className: "cluster", iconSize: [size, size] });
  },
}).addTo(map);

const originLayer = L.layerGroup().addTo(map);

function markerIcon(site) {
  const status = statusOf(site.id) ?? "none";
  return L.divIcon({
    className: `pin pin-${status}${site.danger ? " pin-danger" : ""}`,
    iconSize: [18, 18],
    html: `<span class="glyph glyph-${site.category}"></span>`,
  });
}

// ---------- Data ----------

let sites = [];
const markers = new Map();
let selectedId = null;
let pickingOnMap = false;

async function loadSites() {
  const res = await fetch("data/sites.json");
  const data = await res.json();
  $("#data-info").textContent = `${data.sites.length} locaties`;
  sites = data.sites.map(([id, name, countries, category, year, lat, lon, danger, region]) => ({
    id, name, countries, category, year, lat, lon, danger: !!danger, region,
  }));
  for (const site of sites) {
    const m = L.marker([site.lat, site.lon], { icon: markerIcon(site), title: site.name });
    m.on("click", () => openDetail(site.id, { pan: false }));
    markers.set(site.id, m);
  }
}

// ---------- Weergave ----------

function currentSites() {
  const q = $("#search").value.trim().toLowerCase();
  const matches = (s) => !q || s.name.toLowerCase().includes(q) || s.countries.toLowerCase().includes(q);

  if (state.tab === "nearby") {
    if (!state.origin) return [];
    const radius = RADII[state.radiusIndex];
    return sites
      .map((s) => ({ ...s, distance: distanceKm(state.origin.lat, state.origin.lon, s.lat, s.lon) }))
      .filter((s) => s.distance <= radius && matches(s))
      .sort((a, b) => a.distance - b.distance);
  }

  const withDistance = (s) =>
    state.origin ? { ...s, distance: distanceKm(state.origin.lat, state.origin.lon, s.lat, s.lon) } : s;

  if (state.tab === "all") return sites.filter(matches).map(withDistance);

  return sites
    .filter((s) => statusOf(s.id) === state.tab && matches(s))
    .map(withDistance)
    .sort((a, b) =>
      state.tab === "visited"
        ? visitDate(state.statuses[b.id]).localeCompare(visitDate(state.statuses[a.id])) ||
          state.statuses[b.id].updatedAt.localeCompare(state.statuses[a.id].updatedAt)
        : (a.distance ?? 0) - (b.distance ?? 0) || a.name.localeCompare(b.name));
}

function render() {
  const list = currentSites();

  // Kaart: toon precies wat de lijst toont.
  cluster.clearLayers();
  cluster.addLayers(list.map((s) => markers.get(s.id)));

  // Tabs en tellers
  for (const btn of document.querySelectorAll("[data-tab]")) {
    btn.setAttribute("aria-selected", btn.dataset.tab === state.tab);
  }
  const counts = { visited: 0, want: 0 };
  for (const { status } of Object.values(state.statuses)) counts[status]++;
  for (const el of document.querySelectorAll("[data-count]")) el.textContent = counts[el.dataset.count] || "";
  $("#tally-n").textContent = formatCount(counts.visited);
  $("#tally-of").textContent = `/ ${formatCount(sites.length)}`;
  $("#tally-fill").style.width = `${Math.max(counts.visited / sites.length * 100, counts.visited ? 1 : 0)}%`;

  // Bediening voor "In de buurt"
  const nearby = state.tab === "nearby";
  $("#nearby-controls").hidden = !nearby;
  $("#radius").value = state.radiusIndex;
  $("#radius-value").textContent = formatCount(RADII[state.radiusIndex]);
  $("#origin-label").textContent = state.origin ? state.origin.label : "…";
  $("#origin-hint").hidden = !!state.origin;
  renderOrigin(nearby);

  // Lijst
  const meta = $("#list-meta");
  if (nearby && !state.origin) meta.textContent = "";
  else if (!list.length) meta.textContent = emptyMessage();
  else if (state.tab === "visited") meta.textContent = "";
  else meta.textContent = `${formatCount(list.length)} ${list.length === 1 ? "locatie" : "locaties"}`;

  const shown = list.slice(0, 300);
  const stats = state.tab === "visited" && counts.visited ? statsBlock() : "";
  $("#site-list").innerHTML = stats + shown.map(listItem).join("") +
    (list.length > shown.length ? `<li class="more">Nog ${list.length - shown.length} locaties. Zoek of zoom om te verfijnen.</li>` : "");

  if (selectedId) renderDetail();
}

function emptyMessage() {
  if ($("#search").value.trim()) return "Niets gevonden voor deze zoekterm.";
  if (state.tab === "nearby") return "Geen locaties binnen deze straal. Maak de straal groter.";
  if (state.tab === "want") return "Nog niets op je verlanglijst. Open een locatie en tik op ‘Wil ik heen’.";
  if (state.tab === "visited") return "Nog niets bezocht. Open een locatie en tik op ‘Bezocht’.";
  return "Geen locaties.";
}

// ---------- Statistieken ----------

function statsBlock() {
  const visited = sites.filter((s) => statusOf(s.id) === "visited");
  const total = sites.length;
  const want = Object.values(state.statuses).filter((e) => e.status === "want").length;
  const pct = (visited.length / total) * 100;

  // Landen tellen we alleen via locaties in één land: bij een grensoverschrijdende
  // locatie weten we niet in welk land je was.
  const countries = new Set(visited.filter((s) => !s.countries.includes(",")).map((s) => s.countries));
  const thisYear = String(new Date().getFullYear());
  const thisYearCount = visited.filter((s) => visitDate(state.statuses[s.id]).startsWith(thisYear)).length;
  const danger = visited.filter((s) => s.danger).length;

  const bar = (n, of) => `<span class="bar"><span style="width:${n ? Math.max((n / of) * 100, 1.5) : 0}%"></span></span>`;
  const row = (label, n, of) => `<div class="stat-row">
      <span class="stat-label">${label}</span>${bar(n, of)}<span class="stat-n">${formatCount(n)}<span> / ${formatCount(of)}</span></span>
    </div>`;

  const byRegion = Object.keys(REGION_LABEL).map((code) => {
    const all = sites.filter((s) => s.region === code).length;
    const n = visited.filter((s) => s.region === code).length;
    return row(REGION_LABEL[code], n, all);
  }).join("");
  const byType = ["c", "n", "m"].map((c) => {
    const all = sites.filter((s) => s.category === c).length;
    const n = visited.filter((s) => s.category === c).length;
    return row(`${glyph(c, n ? "visited" : null)} ${CATEGORY_LABEL[c]}`, n, all);
  }).join("");

  const recent = [...visited]
    .sort((a, b) => visitDate(state.statuses[b.id]).localeCompare(visitDate(state.statuses[a.id])))
    .slice(0, 12);
  const stamps = recent.map((s, i) => `<button class="pass-stamp" data-open="${s.id}" style="--tilt:${[-9, 6, -4, 10, -12, 3][i % 6]}deg">
      <span class="pass-name">${escapeHtml(shortName(s.name))}</span>
      <span class="pass-date">${formatDate(visitDate(state.statuses[s.id]), "stamp")}</span>
    </button>`).join("");

  return `<li class="stats">
    <div class="stat-figures">
      <div><strong>${formatCount(visited.length)}</strong><span>bezocht</span></div>
      <div><strong>${formatCount(countries.size)}</strong><span>${countries.size === 1 ? "land" : "landen"}</span></div>
      <div><strong>${pct < 1 ? pct.toFixed(1).replace(".", ",") : Math.round(pct)}%</strong><span>van de lijst</span></div>
    </div>
    <h3 class="stat-head">Paspoort</h3>
    <div class="passport">${stamps}</div>
    <h3 class="stat-head">Per regio</h3>
    ${byRegion}
    <h3 class="stat-head">Per type</h3>
    ${byType}
    <p class="stat-foot">${formatCount(thisYearCount)} dit jaar · ${formatCount(danger)} bedreigd erfgoed · ${formatCount(want)} op je verlanglijst.
      Landen tellen mee via locaties die in één land liggen.</p>
    <h3 class="stat-head">Alle bezochte locaties</h3>
  </li>`;
}

// Korte naam voor een stempel: zonder toevoegingen tussen haakjes of na een komma.
function shortName(name) {
  const short = name.replace(/\s*\(.*?\)/g, "").split(/,| – | - /)[0].trim();
  return short.length > 34 ? `${short.slice(0, 32).trim()}…` : short;
}

function glyph(category, status) {
  return `<span class="glyph glyph-${category} is-${status ?? "none"}" aria-hidden="true"></span>`;
}

function listItem(s) {
  const status = statusOf(s.id);
  const dist = s.distance != null ? `<span class="dist">${formatKm(s.distance)}</span>` : "";
  const mark = status ? `<span class="state state-${status}">${STATUS_LABEL[status]}</span>` : "";
  return `<li><button class="site" data-id="${s.id}">
      ${glyph(s.category, status)}
      <span class="site-text">
        <span class="site-name">${escapeHtml(s.name)}</span>
        <span class="site-sub">${escapeHtml(countriesLabel(s.countries))} <span class="yr">${s.year}</span>${s.danger ? ` <em>Bedreigd</em>` : ""}</span>
      </span>
      <span class="site-aside">${dist}${mark}</span>
    </button></li>`;
}

function renderOrigin(nearby) {
  originLayer.clearLayers();
  if (!state.origin) return;
  const { lat, lon } = state.origin;
  L.circleMarker([lat, lon], { radius: 6, color: "#092328", weight: 4, fillColor: "#ffffff", fillOpacity: 1 })
    .addTo(originLayer);
  if (nearby) {
    L.circle([lat, lon], {
      radius: RADII[state.radiusIndex] * 1000,
      color: "#12544f", weight: 1.5, fillOpacity: 0.06, interactive: false,
    }).addTo(originLayer);
  }
}

// Hoeveel pixels van de kaart het onderblad op mobiel afdekt.
function sheetOverlap() {
  const sheet = $("#sheet");
  if (getComputedStyle(sheet).position !== "absolute") return 0;
  // Uitgaan van de eindhoogte, want het blad kan nog aan het animeren zijn.
  const h = $(".layout").clientHeight;
  return { peek: 112, half: h * 0.5, full: h - 24 }[sheet.dataset.state] ?? sheet.offsetHeight;
}

function fitToOrigin() {
  if (!state.origin) return;
  const circle = L.circle([state.origin.lat, state.origin.lon], { radius: RADII[state.radiusIndex] * 1000 });
  // De cirkel moet op de kaart staan om zijn grenzen te kunnen berekenen.
  circle.addTo(map);
  map.fitBounds(circle.getBounds(), { paddingTopLeft: [20, 20], paddingBottomRight: [20, sheetOverlap() + 20] });
  circle.remove();
}

// Centreer een punt in het zichtbare deel van de kaart, boven het onderblad.
function showOnMap(lat, lon, zoom) {
  const point = map.project([lat, lon], zoom).add([0, sheetOverlap() / 2]);
  map.setView(map.unproject(point, zoom), zoom);
}

// ---------- Detail ----------

function openDetail(id, { pan = true } = {}) {
  selectedId = id;
  const site = sites.find((s) => s.id === id);
  renderDetail();
  setSheet("half");
  if (pan) showOnMap(site.lat, site.lon, Math.max(map.getZoom(), 8));
}

function closeDetail() {
  selectedId = null;
  $("#detail").hidden = true;
  $("#sheet").classList.remove("has-detail");
}

function renderDetail() {
  const s = sites.find((x) => x.id === selectedId);
  const status = statusOf(s.id);
  const entry = state.statuses[s.id];
  const dist = state.origin ? distanceKm(state.origin.lat, state.origin.lon, s.lat, s.lon) : null;
  const day = entry ? (status === "visited" ? visitDate(entry) : entry.updatedAt.slice(0, 10)) : null;

  const el = $("#detail");
  el.innerHTML = `
    <button class="back" id="detail-back">← Terug naar de lijst</button>
    <header class="entry">
      <p class="eyebrow">${glyph(s.category, status)} Nº ${escapeHtml(s.id)} · ${CATEGORY_LONG[s.category]}</p>
      <h2>${escapeHtml(s.name)}</h2>
      <p class="detail-sub">${escapeHtml(s.countries.split(",").join(", "))}</p>
      ${status === "visited" ? `<div class="stamp" aria-hidden="true"><span>Bezocht</span><span class="stamp-date">${formatDate(day, "stamp")}</span></div>` : ""}
    </header>
    <dl class="facts">
      <div><dt>Ingeschreven</dt><dd>${s.year}</dd></div>
      ${dist != null ? `<div><dt>Afstand</dt><dd>${formatKm(dist)}</dd></div>` : ""}
      <div><dt>Coördinaten</dt><dd>${s.lat.toFixed(2)}, ${s.lon.toFixed(2)}</dd></div>
    </dl>
    ${s.danger ? `<p class="danger-note">Op de lijst van bedreigd werelderfgoed.</p>` : ""}
    <div class="status-buttons">
      <button class="status-btn" data-set="visited" aria-pressed="${status === "visited"}">Bezocht</button>
      <button class="status-btn" data-set="want" aria-pressed="${status === "want"}">Wil ik heen</button>
    </div>
    ${status === "visited"
      ? `<label class="visit-date">Bezocht op <input type="date" id="visit-date" value="${day}" max="${today()}"></label>`
      : status ? `<p class="since">Op je lijst sinds ${formatDate(day)}</p>` : ""}
    <section class="guide" id="guide" aria-live="polite"></section>
    <p class="links">
      <a href="https://whc.unesco.org/en/list/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Registerpagina op unesco.org ↗</a>
      <a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener">Route ↗</a>
    </p>`;
  el.hidden = false;
  $("#sheet").classList.add("has-detail");
  fillGuide(s);
}

// ---------- Reisgids (Wikivoyage) ----------

const guideHtml = new Map();

async function fillGuide(site) {
  const el = $("#guide");
  if (guideHtml.has(site.id)) {
    el.innerHTML = guideHtml.get(site.id);
    return;
  }
  el.innerHTML = `<p class="guide-status">Reisgids ophalen bij Wikivoyage…</p>`;
  let html;
  try {
    const { result } = await Guide.get(site);
    html = result ? guideCard(result) : `<p class="guide-status">Wikivoyage heeft geen artikel over deze plek of binnen 10 km.
      <a href="https://nl.wikivoyage.org/w/index.php?search=${encodeURIComponent(site.name)}" target="_blank" rel="noopener">Zelf zoeken ↗</a></p>`;
    guideHtml.set(site.id, html);
  } catch {
    html = navigator.onLine
      ? `<p class="guide-status">Wikivoyage is nu niet bereikbaar. Probeer het later opnieuw.</p>`
      : `<p class="guide-status">Je bent offline en deze reisgids is nog niet bewaard. Zet hem klaar via het menu als je weer online bent.</p>`;
  }
  if (selectedId === site.id) $("#guide").innerHTML = html;
}

function guideCard(g) {
  const where = g.kind === "match"
    ? "over deze plek"
    : `in de buurt${g.distanceKm != null ? `, ${formatKm(g.distanceKm)}` : ""}`;
  const [first, ...rest] = g.paragraphs;
  return `
    ${g.image ? `<img class="guide-img" src="${escapeHtml(g.image)}" alt="" crossorigin="anonymous" loading="lazy">` : ""}
    <p class="eyebrow">Reisgids · ${where}</p>
    <h3>${escapeHtml(g.title)}</h3>
    ${first ? `<p>${escapeHtml(first)}</p>` : ""}
    ${rest.length ? `<details><summary>Lees verder</summary>${rest.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</details>` : ""}
    <p class="guide-foot"><a href="${escapeHtml(g.url)}" target="_blank" rel="noopener">Hele artikel op Wikivoyage ${g.lang.toUpperCase()} ↗</a>
      <span>Tekst: Wikivoyage, <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.nl" target="_blank" rel="noopener">CC BY-SA 4.0</a></span></p>`;
}

// ---------- Vertrekpunt ----------

function setOrigin(lat, lon, label) {
  state.origin = { lat, lon, label };
  saveState();
  $("#place-results").hidden = true;
  if (state.tab !== "nearby") state.tab = "nearby";
  closeDetail();
  render();
  fitToOrigin();
}

function useGps() {
  if (!navigator.geolocation) return toast("Je browser ondersteunt geen locatiebepaling.");
  const btn = $("#gps-btn");
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      setOrigin(pos.coords.latitude, pos.coords.longitude, "je huidige locatie");
    },
    (err) => {
      btn.disabled = false;
      toast(err.code === err.PERMISSION_DENIED
        ? "Geen toestemming voor je locatie. Zoek een plaats of kies op de kaart."
        : "Je locatie bepalen lukte niet. Probeer het opnieuw.");
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 },
  );
}

async function searchPlace(query) {
  const results = $("#place-results");
  results.hidden = false;
  results.innerHTML = `<li class="muted">Zoeken…</li>`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=nl&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const places = await res.json();
    if (!places.length) {
      results.innerHTML = `<li class="muted">Geen plaats gevonden.</li>`;
      return;
    }
    results.innerHTML = places.map((p) => `<li><button data-lat="${p.lat}" data-lon="${p.lon}"
      data-label="${escapeHtml(p.display_name.split(",").slice(0, 2).join(","))}">${escapeHtml(p.display_name)}</button></li>`).join("");
  } catch {
    results.innerHTML = `<li class="muted">Zoeken lukt nu niet. Ben je online?</li>`;
  }
}

function startPicking() {
  pickingOnMap = true;
  document.body.classList.add("picking");
  setSheet("peek");
  toast("Tik op de kaart om je vertrekpunt te kiezen.");
}

map.on("click", (e) => {
  if (!pickingOnMap) return;
  pickingOnMap = false;
  document.body.classList.remove("picking");
  setOrigin(e.latlng.lat, e.latlng.lng, `gekozen punt (${e.latlng.lat.toFixed(2)}, ${e.latlng.lng.toFixed(2)})`);
  setSheet("half");
});

// ---------- Onderblad (mobiel) ----------

const SHEET_STATES = ["peek", "half", "full"];
function setSheet(s) {
  const sheet = $("#sheet");
  sheet.dataset.state = s;
  // Leaflet moet weten dat de zichtbare kaart van formaat veranderd is.
  setTimeout(() => map.invalidateSize(), 250);
}

$("#sheet-handle").addEventListener("click", () => {
  const cur = $("#sheet").dataset.state || "half";
  setSheet(SHEET_STATES[(SHEET_STATES.indexOf(cur) + 1) % SHEET_STATES.length]);
});

// ---------- Back-up ----------

function exportBackup() {
  const payload = {
    app: "unesco-tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    statuses: state.statuses,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `werelderfgoed-backup-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $("#menu-status").textContent = "Back-up gedownload.";
}

async function importBackup(file) {
  const status = $("#menu-status");
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "unesco-tracker" || typeof data.statuses !== "object") throw new Error("formaat");
    const incoming = Object.entries(data.statuses)
      .filter(([, v]) => v && (v.status === "visited" || v.status === "want") && typeof v.updatedAt === "string");
    if (!confirm(`${incoming.length} locaties importeren? Bij dubbele locaties wint de meest recente wijziging.`)) return;
    for (const [id, entry] of incoming) {
      const current = state.statuses[id];
      if (!current || entry.updatedAt > current.updatedAt) state.statuses[id] = entry;
    }
    saveState();
    refreshMarkers();
    render();
    status.textContent = `${incoming.length} locaties geïmporteerd.`;
  } catch {
    status.textContent = "Dit bestand is geen geldige back-up.";
  }
}

// ---------- Offline ----------

function updateOnline() {
  $("#offline-badge").hidden = navigator.onLine;
}

async function updateStorageInfo() {
  const el = $("#storage-info");
  try {
    const { usage } = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    el.textContent = `In gebruik op dit apparaat: ${(usage / 1024 / 1024).toFixed(1).replace(".", ",")} MB` +
      (persisted ? ". De browser ruimt dit niet zomaar op." : ".");
  } catch {
    el.textContent = "";
  }
}

async function prepareOffline() {
  const status = $("#offline-status");
  const btn = $("#offline-btn");
  if (!navigator.onLine) {
    status.textContent = "Je bent offline. Klaarzetten kan alleen met verbinding.";
    return;
  }
  const targets = sites.filter((s) => statusOf(s.id) === "want");
  if (!targets.length) {
    status.textContent = "Je verlanglijst is nog leeg. Markeer eerst plekken met ‘Wil ik heen’.";
    return;
  }
  btn.disabled = true;
  requestPersistence();

  let guides = 0;
  for (const [i, site] of targets.entries()) {
    status.textContent = `Reisgidsen ophalen: ${i + 1} van ${targets.length}…`;
    try {
      await Guide.get(site);
      guides++;
    } catch { /* telt niet mee */ }
  }

  const urls = [...new Set(targets.flatMap((s) => OfflineMap.tilesAround(s.lat, s.lon, TILE_URL)))];
  const { failed } = await OfflineMap.fetchAll(urls, (done, total) => {
    status.textContent = `Kaart opslaan: ${done} van ${total} tegels…`;
  });

  btn.disabled = false;
  status.textContent = `Klaar: ${guides} van ${targets.length} reisgidsen en de kaart rond elke plek staan op dit apparaat.` +
    (failed ? ` ${failed} kaarttegels lukten niet; probeer het later nog eens.` : "");
  updateStorageInfo();
}

function refreshMarkers() {
  for (const s of sites) markers.get(s.id).setIcon(markerIcon(s));
}

// ---------- Events ----------

document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  state.tab = btn.dataset.tab;
  saveState();
  closeDetail();
  render();
  if (state.tab === "nearby") fitToOrigin();
});

$("#site-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".site");
  if (btn) return openDetail(btn.dataset.id);
  const stamp = e.target.closest("[data-open]");
  if (stamp) openDetail(stamp.dataset.open);
});

$("#progress").addEventListener("click", () => {
  state.tab = "visited";
  saveState();
  closeDetail();
  render();
  setSheet("full");
});

$("#detail").addEventListener("change", (e) => {
  if (e.target.id !== "visit-date" || !e.target.value) return;
  state.statuses[selectedId].visitedOn = e.target.value;
  saveState();
  render();
});

$("#detail").addEventListener("click", (e) => {
  if (e.target.closest("#detail-back")) return closeDetail();
  const btn = e.target.closest("[data-set]");
  if (!btn) return;
  const id = selectedId;
  const next = statusOf(id) === btn.dataset.set ? null : btn.dataset.set;
  setStatus(id, next);
  markers.get(id).setIcon(markerIcon(sites.find((s) => s.id === id)));
  render();
});

let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { closeDetail(); render(); }, 150);
});

$("#radius").addEventListener("input", (e) => {
  state.radiusIndex = Number(e.target.value);
  saveState();
  render();
});
$("#radius").addEventListener("change", fitToOrigin);

$("#gps-btn").addEventListener("click", useGps);
$("#pick-btn").addEventListener("click", startPicking);
$("#place-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#place-input").value.trim();
  if (q) searchPlace(q);
});
$("#place-results").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-lat]");
  if (btn) setOrigin(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.label);
});

$("#menu-btn").addEventListener("click", () => {
  $("#menu-status").textContent = "";
  updateStorageInfo();
  $("#menu").showModal();
});
$("#offline-btn").addEventListener("click", prepareOffline);
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();
$("#export-btn").addEventListener("click", exportBackup);
$("#import-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) importBackup(file);
  e.target.value = "";
});

// ---------- Start ----------

loadSites()
  .then(() => {
    setSheet("half");
    render();
    if (state.tab === "nearby" && state.origin) fitToOrigin();
  })
  .catch(() => toast("De locaties konden niet geladen worden."));

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
