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

function setStatus(id, status) {
  if (status) state.statuses[id] = { status, updatedAt: new Date().toISOString() };
  else delete state.statuses[id];
  saveState();
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

const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png`, {
  maxZoom: 19,
  subdomains: "abcd",
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

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
  sites = data.sites.map(([id, name, countries, category, year, lat, lon, danger]) => ({
    id, name, countries, category, year, lat, lon, danger: !!danger,
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
        ? state.statuses[b.id].updatedAt.localeCompare(state.statuses[a.id].updatedAt)
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
  else meta.textContent = `${formatCount(list.length)} ${list.length === 1 ? "locatie" : "locaties"}`;

  const shown = list.slice(0, 300);
  $("#site-list").innerHTML = shown.map(listItem).join("") +
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
  const date = entry ? new Date(entry.updatedAt) : null;
  const since = date ? date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
  const stampDate = date ? date.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" }).replaceAll("-", "·") : "";

  const el = $("#detail");
  el.innerHTML = `
    <button class="back" id="detail-back">← Terug naar de lijst</button>
    <header class="entry">
      <p class="eyebrow">${glyph(s.category, status)} Nº ${escapeHtml(s.id)} · ${CATEGORY_LONG[s.category]}</p>
      <h2>${escapeHtml(s.name)}</h2>
      <p class="detail-sub">${escapeHtml(s.countries.split(",").join(", "))}</p>
      ${status === "visited" ? `<div class="stamp" aria-hidden="true"><span>Bezocht</span><span class="stamp-date">${stampDate}</span></div>` : ""}
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
    ${status ? `<p class="since">${STATUS_LABEL[status]} sinds ${since}</p>` : ""}
    <p class="links">
      <a href="https://whc.unesco.org/en/list/${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Registerpagina op unesco.org ↗</a>
      <a href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}" target="_blank" rel="noopener">Route ↗</a>
    </p>`;
  el.hidden = false;
  $("#sheet").classList.add("has-detail");
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
  if (btn) openDetail(btn.dataset.id);
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
  $("#menu").showModal();
});
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
