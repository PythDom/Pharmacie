/* Pharmacie — inventaire de la pharmacie familiale.
 * Données locales (localStorage) + synchronisation optionnelle vers un repo GitHub privé.
 * Base médicaments : SAM v2 (AFMPS/eHealth), voir scripts/build_db.py.
 */
"use strict";

const LS_DATA = "pharma.data.v1";
const LS_SETTINGS = "pharma.settings.v1";
const SYNC_HOST = "pythdom.github.io";         // la sync ne s'exécute jamais ailleurs (tests locaux sans risque)
const SYNC_PATH = "data/inventory.json";
const SYNC_DEBOUNCE_MS = 4000;
const MIN_SYNC_INTERVAL_MS = 15000;             // garde-fou contre toute boucle de sync
const DAY = 86400000;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast("Stockage local indisponible : " + e.message); }
}

/* ---------------------------------------------------------------- state */

// items / refill / learned : dictionnaires id -> enregistrement, chacun avec updatedAt (+ deleted pour les suppressions),
// ce qui permet de fusionner proprement les modifications de plusieurs appareils.
//
// Profils : un inventaire local par dépôt (clé LS_DATA:<dépôt>, "local" sans dépôt) et un jeton par dépôt.
// Changer de dépôt change donc d'inventaire : on ne peut jamais fusionner l'inventaire d'une personne dans le dépôt d'une autre.
const emptyData = () => ({ items: {}, refill: {}, learned: {} });
const repoKey = (repo) => String(repo || "").trim().toLowerCase();
const dataKey = (repo) => LS_DATA + ":" + (repoKey(repo) || "local");
function loadData(repo) {
  const d = lsGet(dataKey(repo), null) || emptyData();
  d.items ||= {}; d.refill ||= {}; d.learned ||= {};
  return d;
}

let settings = Object.assign({ repo: "", tokens: {}, soonDays: 60, theme: "" }, lsGet(LS_SETTINGS, {}));
settings.tokens ||= {};
(function migrateV1() {
  // v1 : un seul inventaire (LS_DATA) et un seul jeton (settings.token).
  if (settings.token) { settings.tokens[repoKey(settings.repo)] = settings.token; delete settings.token; lsSet(LS_SETTINGS, settings); }
  const legacy = lsGet(LS_DATA, null);
  if (legacy) {
    const target = settings.tokens[repoKey(settings.repo)] ? settings.repo : "";
    if (!lsGet(dataKey(target), null)) lsSet(dataKey(target), legacy);
    try { localStorage.removeItem(LS_DATA); } catch { /* ignoré */ }
  }
})();
let data = loadData(settings.repo);
const getToken = (repo = settings.repo) => settings.tokens[repoKey(repo)] || "";

let view = "inventory";
let invFilter = "all";
let scanMode = "add";

const live = (dict) => Object.values(dict).filter((r) => !r.deleted);

function commit() {
  lsSet(dataKey(settings.repo), data);
  scheduleSync();
  render();
}

/* ---------------------------------------------------------------- base médicaments */

const db = { meds: null, para: null, byGtin: new Map(), byCnk: new Map(), version: "", date: "" };

function indexRows(json, source) {
  const rows = json.rows.map((r) => ({
    gtin: r[0], cnk: r[1], name: r[2], pack: r[3], atc: r[4], leaflet: r[5], rx: !!r[6], active: !!r[7], substance: r[8] || "", source,
  }));
  for (const p of rows) {
    if (p.gtin && (!db.byGtin.has(p.gtin) || p.active)) db.byGtin.set(p.gtin, p);
    if (p.cnk && (!db.byCnk.has(p.cnk) || p.active)) db.byCnk.set(p.cnk, p);
    p.key = norm(p.name);
  }
  return rows;
}

let medsPromise = null, paraPromise = null;
function loadMeds() {
  medsPromise ||= fetch("data/meds.json").then((r) => r.json()).then((j) => {
    db.meds = indexRows(j, "SAM"); db.version = j.v; db.date = j.d;
    const info = `Base SAM v2 n° ${j.v} du ${fmtDate(j.d)} — ${db.meds.length.toLocaleString("fr-BE")} médicaments.`;
    $("#dbInfo").textContent = info; $("#dbInfo2").textContent = info;
    renderInventory(); // complète les cartes (résumé, notice) — affichage seul, ne modifie pas les données
  }).catch((e) => { medsPromise = null; $("#dbInfo").textContent = "Base médicaments indisponible hors ligne (" + e.message + ")."; });
  return medsPromise;
}
function loadPara() {
  paraPromise ||= fetch("data/para.json").then((r) => r.json()).then((j) => { db.para = indexRows(j, "SAM (parapharmacie)"); })
    .catch(() => { paraPromise = null; });
  return paraPromise;
}

function searchDb(q, limit = 25) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const list of [db.meds, db.para]) {
    if (!list) continue;
    for (const p of list) {
      if (words.every((w) => p.key.includes(w))) {
        out.push(p);
        if (out.length >= limit * 3) break;
      }
    }
  }
  // actifs d'abord, puis médicaments avant parapharmacie
  return out.sort((a, b) => (b.active - a.active) || (a.source.length - b.source.length)).slice(0, limit);
}

/** Infos d'affichage d'une boîte : celles enregistrées, complétées par la base (sans modifier l'inventaire). */
function productInfo(it) {
  const ref = (it.gtin && db.byGtin.get(it.gtin)) || (it.cnk && db.byCnk.get(it.cnk)) || {};
  const atc = it.atc || ref.atc || "";
  return { atc, use: atcSummary(atc), substance: it.substance || ref.substance || "", leaflet: it.leaflet || ref.leaflet || "" };
}

/* ---------------------------------------------------------------- codes-barres */

const GS = "\u001d";
const FIXED_AI = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };

/** Décode un contenu GS1 (DataMatrix des boîtes de médicaments) : 01 GTIN, 17 péremption, 10 lot, 21 n° de série. */
function parseGS1(raw) {
  let s = raw.replace(/^\](d2|C1|e0|Q3|d1)/, "");
  // Format lisible "(01)05412345678901(17)270131(10)AB12"
  if (s.startsWith("(")) {
    const out = {};
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]] = m[2];
    return out;
  }
  if (s[0] === GS) s = s.slice(1);
  const out = {};
  let i = 0;
  while (i < s.length) {
    if (s[i] === GS) { i++; continue; }
    const ai2 = s.slice(i, i + 2);
    if (FIXED_AI[ai2]) {
      out[ai2] = s.slice(i + 2, i + 2 + FIXED_AI[ai2]);
      i += 2 + FIXED_AI[ai2];
      continue;
    }
    // AI à longueur variable : 10, 21, 30, 9x (2 chiffres) ; 240, 241, 710-714 (3 chiffres)
    const aiLen = /^(24[01]|71[0-4])/.test(s.slice(i)) ? 3 : 2;
    const ai = s.slice(i, i + aiLen);
    let end = s.indexOf(GS, i + aiLen);
    if (end < 0) end = s.length;
    out[ai] = s.slice(i + aiLen, end);
    i = end;
  }
  return out;
}

/** AAMMJJ -> AAAA-MM-JJ (JJ=00 : dernier jour du mois). */
function gs1Date(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd || "")) return "";
  const y = 2000 + +yymmdd.slice(0, 2), m = +yymmdd.slice(2, 4);
  let d = +yymmdd.slice(4, 6);
  if (m < 1 || m > 12) return "";
  if (d === 0) d = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function gtinChecksumOk(code) {
  const digits = code.split("").map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Transforme un contenu scanné en { gtin, cnk, expiry, batch, serial, raw }. */
function interpretScan(raw) {
  const text = String(raw || "").trim();
  const res = { raw: text };
  const digits = text.replace(/\D/g, "");
  const looksGS1 = text.includes(GS) || /^\]/.test(text) || text.startsWith("(01)") || (/^01\d{14}(17|10|21)/.test(text));
  if (looksGS1) {
    const ai = parseGS1(text);
    if (ai["01"]) res.gtin = ai["01"];
    if (ai["17"]) res.expiry = gs1Date(ai["17"]);
    if (ai["10"]) res.batch = ai["10"];
    if (ai["21"]) res.serial = ai["21"];
    if (res.gtin) return res;
  }
  if (/^\d+$/.test(text) || /^cnk/i.test(text)) {
    if (digits.length === 7) { res.cnk = digits; return res; }
    if ([8, 12, 13, 14].includes(digits.length) && gtinChecksumOk(digits)) { res.gtin = digits.padStart(14, "0"); return res; }
    if (digits.length === 8) { res.cnk = digits.slice(0, 7); return res; } // CNK + chiffre de contrôle
  }
  if (digits.length >= 7 && digits.length <= 14) res.gtin = digits.padStart(14, "0");
  return res;
}

/** Cherche le produit : produits déjà appris, SAM (médicaments puis parapharmacie), puis Open*Facts. */
async function lookup(code) {
  await loadMeds();
  const keys = [code.gtin, code.cnk && "cnk:" + code.cnk].filter(Boolean);
  for (const k of keys) {
    const l = data.learned[k];
    if (l && !l.deleted) return { ...l.product, source: "mémorisé" };
  }
  if (code.gtin && db.byGtin.has(code.gtin)) return db.byGtin.get(code.gtin);
  if (code.cnk) {
    if (db.byCnk.has(code.cnk)) return db.byCnk.get(code.cnk);
    await loadPara();
    if (db.byCnk.has(code.cnk)) return db.byCnk.get(code.cnk);
  }
  if (code.gtin && navigator.onLine) {
    const ean = code.gtin.replace(/^0+(?=\d{8,13}$)/, "");
    for (const host of ["world.openproductsfacts.org", "world.openbeautyfacts.org", "world.openfoodfacts.org"]) {
      try {
        const r = await fetch(`https://${host}/api/v2/product/${ean}.json?fields=product_name,product_name_fr,brands,quantity`);
        if (!r.ok) continue;
        const j = await r.json();
        const p = j.product;
        const name = p && (p.product_name_fr || p.product_name);
        if (j.status === 1 && name) {
          return { gtin: code.gtin, name: [name, p.brands].filter(Boolean).join(" — "), pack: p.quantity || "", source: host.split(".")[1] };
        }
      } catch { /* hors ligne ou CORS : on continue */ }
    }
  }
  return null;
}

/* ---------------------------------------------------------------- scanner */

let detector = null, stream = null, scanTimer = null, lastScan = { text: "", at: 0 }, busy = false;

function getDetector() {
  if (detector) return detector;
  const api = window.BarcodeDetectionAPI;
  api.prepareZXingModule({
    overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? new URL("lib/" + path, location.href).href : prefix + path) },
  });
  detector = new api.BarcodeDetector({ formats: ["data_matrix", "ean_13", "ean_8", "upc_a", "code_128", "code_39", "qr_code"] });
  return detector;
}

async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    toast("Caméra inaccessible : " + e.message);
    return;
  }
  const video = $("#video");
  video.srcObject = stream;
  await video.play().catch(() => {});
  $("#btnCamera").textContent = "Arrêter la caméra";
  const det = getDetector();
  const tick = async () => {
    if (!stream) return;
    if (!busy && video.readyState >= 2) {
      try {
        const codes = await det.detect(video);
        if (codes.length) onScanned(pickBest(codes).rawValue);
      } catch { /* image pas encore prête */ }
    }
    scanTimer = setTimeout(tick, 200);
  };
  tick();
}

function stopCamera() {
  clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("#video").srcObject = null;
  $("#btnCamera").textContent = "Démarrer la caméra";
}

// Le DataMatrix contient la péremption : on le préfère à un code-barres linéaire vu en même temps.
function pickBest(codes) {
  return codes.find((c) => c.format === "data_matrix") || codes[0];
}

async function scanPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    const codes = await getDetector().detect(bmp);
    if (!codes.length) return toast("Aucun code trouvé sur la photo.");
    onScanned(pickBest(codes).rawValue, true);
  } catch (e) { toast("Lecture impossible : " + e.message); }
}

async function onScanned(text, force = false) {
  const t = Date.now();
  if (!force && text === lastScan.text && t - lastScan.at < 4000) return;
  lastScan = { text, at: t };
  busy = true;
  $("#scanner").classList.add("flash");
  navigator.vibrate?.(60);
  setTimeout(() => $("#scanner").classList.remove("flash"), 400);
  try {
    const code = interpretScan(text);
    if (!code.gtin && !code.cnk) { toast("Code non reconnu : " + text.replace(/\u001d/g, "␝")); return; }
    if (scanMode === "empty") await emptyByScan(code);
    else await addFromScan(code);
  } finally {
    busy = false;
  }
}

function productKey(p) {
  return p.gtin ? "gtin:" + p.gtin : p.cnk ? "cnk:" + p.cnk : "name:" + norm(p.name);
}

async function addFromScan(code) {
  if (code.serial && live(data.items).some((it) => (it.serials || []).includes(code.serial))) {
    toast("Cette boîte (même n° de série) est déjà dans l'inventaire.");
    return;
  }
  const product = await lookup(code);
  openItemDialog(null, { code, product });
}

async function emptyByScan(code) {
  const product = await lookup(code);
  const candidates = live(data.items).filter((it) =>
    (code.serial && (it.serials || []).includes(code.serial)) ||
    (code.gtin && it.gtin === code.gtin) || (code.cnk && it.cnk === code.cnk) ||
    (product && product.cnk && it.cnk === product.cnk));
  if (!candidates.length) { toast("Ce produit n'est pas dans l'inventaire."); return; }
  // priorité : même n° de série, puis même péremption, puis la plus proche péremption
  candidates.sort((a, b) =>
    ((b.serials || []).includes(code.serial) - (a.serials || []).includes(code.serial)) ||
    ((b.expiry === code.expiry) - (a.expiry === code.expiry)) ||
    String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")));
  await markEmpty(candidates[0].id, code.serial);
}

/* ---------------------------------------------------------------- actions inventaire */

async function markEmpty(id, serial) {
  const it = data.items[id];
  if (!it) return;
  if ((it.qty || 1) > 1) {
    it.qty -= 1;
    if (serial) it.serials = (it.serials || []).filter((s) => s !== serial);
    it.updatedAt = now();
    commit();
    toast(`${it.name} : une boîte en moins (reste ${it.qty}).`);
    return;
  }
  const choice = await confirmDialog("Plus de stock", `« ${it.name} » est vide et sera retiré de l'inventaire. L'ajouter à la liste de refill ?`,
    [["cancel", "Annuler"], ["remove", "Retirer seulement"], ["refill", "Retirer + refill", "primary"]]);
  if (choice === "cancel" || !choice) return;
  it.deleted = true; it.updatedAt = now();
  if (choice === "refill") addRefill(it);
  commit();
  toast(choice === "refill" ? "Retiré et ajouté au refill." : "Retiré de l'inventaire.");
}

function addRefill(p, reason = "") {
  const key = productKey(p);
  const existing = live(data.refill).find((r) => r.key === key);
  if (existing) return existing;
  const r = { id: uid(), key, name: p.name, pack: p.pack || "", gtin: p.gtin || "", cnk: p.cnk || "", reason, createdAt: now(), updatedAt: now() };
  data.refill[r.id] = r;
  return r;
}

const refillFor = (it) => live(data.refill).find((r) => r.key === productKey(it));

/** Boîtes bientôt périmées / périmées à proposer pour le refill (une par produit, la plus proche). */
function expirySuggestions() {
  const items = live(data.items);
  const byKey = new Map();
  for (const it of items) {
    const st = expiryStatus(it.expiry);
    if (st.cls !== "soon" && st.cls !== "expired") continue;
    if (it.expiryDismissed === it.expiry || refillFor(it)) continue;
    const key = productKey(it);
    // Une autre boîte du même produit encore bonne : pas besoin de racheter.
    if (items.some((x) => productKey(x) === key && expiryStatus(x.expiry).cls === "ok")) continue;
    if (!byKey.has(key) || st.days < byKey.get(key).st.days) byKey.set(key, { it, st });
  }
  return [...byKey.values()].sort((a, b) => a.st.days - b.st.days);
}

/** « Niveau bas » : la boîte reste dans l'inventaire mais le produit part au refill. */
function toggleLow(id) {
  const it = data.items[id];
  if (!it) return;
  it.low = !it.low;
  it.updatedAt = now();
  if (it.low) {
    addRefill(it, "low");
    toast("Niveau bas : ajouté au refill.");
  } else {
    // On ne retire du refill que l'entrée créée par « niveau bas », et seulement si aucune autre boîte du produit n'est basse.
    const r = refillFor(it);
    const otherLow = live(data.items).some((x) => x.id !== it.id && x.low && productKey(x) === productKey(it));
    if (r && r.reason === "low" && !otherLow) { r.deleted = true; r.updatedAt = now(); toast("Niveau OK : retiré du refill."); }
    else toast("Niveau OK.");
  }
  commit();
}

function expiryStatus(expiry) {
  if (!expiry) return { cls: "", label: "Sans date", days: Infinity };
  const days = Math.floor((new Date(expiry + "T23:59:59") - Date.now()) / DAY);
  if (days < 0) return { cls: "expired", label: "Périmé", days };
  if (days <= settings.soonDays) return { cls: "soon", label: days === 0 ? "Périme aujourd'hui" : `${days} j`, days };
  return { cls: "ok", label: fmtMonth(expiry), days };
}

function fmtDate(iso) { return iso ? new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-BE") : ""; }
function fmtMonth(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("fr-BE", { month: "short", year: "numeric" }); }

/* ---------------------------------------------------------------- dialogue boîte */

let editing = null; // { id?, product, code }

function openItemDialog(id, ctx = {}) {
  const it = id ? data.items[id] : null;
  const p = ctx.product || {};
  const code = ctx.code || {};
  editing = { id, product: it ? { gtin: it.gtin, cnk: it.cnk, name: it.name, pack: it.pack, atc: it.atc, leaflet: it.leaflet, rx: it.rx, substance: it.substance } : { ...p, gtin: p.gtin || code.gtin || "", cnk: p.cnk || code.cnk || "" }, code };
  $("#itemTitle").textContent = it ? "Modifier" : p.name ? "Ajouter une boîte" : "Produit inconnu — nommez-le";
  $("#fName").value = it ? it.name : [p.name].filter(Boolean).join("");
  $("#fExpiry").value = it ? it.expiry || "" : code.expiry || "";
  $("#fQty").value = it ? it.qty || 1 : 1;
  $("#fBatch").value = it ? it.batch || "" : code.batch || "";
  $("#fLocation").value = it ? it.location || "" : lastLocation();
  $("#fNote").value = it ? it.note || "" : "";
  $("#btnItemDelete").hidden = !it;
  $("#nameSuggest").innerHTML = "";
  renderSource();
  $("#locations").innerHTML = [...new Set(live(data.items).map((x) => x.location).filter(Boolean))].map((l) => `<option value="${esc(l)}">`).join("");
  $("#dlgItem").showModal();
  if (!p.name && !it) setTimeout(() => $("#fName").focus(), 50);
}

function lastLocation() {
  const all = live(data.items).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return all[0]?.location || "";
}

function renderSource() {
  const p = editing.product;
  const parts = [];
  if (p.source) parts.push("Source : " + p.source);
  if (p.cnk) parts.push("CNK " + p.cnk);
  if (p.gtin) parts.push("GTIN " + p.gtin);
  if (p.pack) parts.push(p.pack);
  if (p.atc) parts.push([atcSummary(p.atc), p.substance, "ATC " + p.atc].filter(Boolean).join(" — "));
  if (p.rx) parts.push("sur prescription");
  $("#fSource").hidden = !parts.length;
  $("#fSource").textContent = parts.join(" · ");
}

function saveItemFromDialog() {
  const name = $("#fName").value.trim();
  if (!name) return false;
  const p = editing.product;
  const code = editing.code || {};
  const fields = {
    name, gtin: p.gtin || "", cnk: p.cnk || "", pack: p.pack || "", atc: p.atc || "", leaflet: p.leaflet || "", rx: !!p.rx, substance: p.substance || "",
    expiry: $("#fExpiry").value, qty: Math.max(1, +$("#fQty").value || 1), batch: $("#fBatch").value.trim(),
    location: $("#fLocation").value.trim(), note: $("#fNote").value.trim(),
  };
  // Code scanné inconnu de la base : on mémorise l'association code -> produit pour les prochains scans.
  if (!editing.id && (code.gtin || code.cnk) && (!p.source || p.source === "mémorisé" || p.name !== name)) {
    const k = code.gtin || "cnk:" + code.cnk;
    data.learned[k] = { id: k, product: { gtin: p.gtin, cnk: p.cnk, name, pack: p.pack || "", atc: p.atc || "", leaflet: p.leaflet || "", rx: !!p.rx, substance: p.substance || "" }, updatedAt: now() };
  }
  if (editing.id) {
    Object.assign(data.items[editing.id], fields, { updatedAt: now() });
  } else {
    const same = live(data.items).find((x) => productKey(x) === productKey(fields) && x.name === fields.name && (x.expiry || "") === fields.expiry && (x.location || "") === fields.location);
    if (same) {
      same.qty = (same.qty || 1) + fields.qty;
      same.low = false; // réapprovisionné
      if (code.serial) same.serials = [...(same.serials || []), code.serial];
      same.updatedAt = now();
      toast(`${same.name} : ${same.qty} boîtes.`);
    } else {
      const it = { id: uid(), ...fields, serials: code.serial ? [code.serial] : [], createdAt: now(), updatedAt: now() };
      data.items[it.id] = it;
      toast("Ajouté : " + it.name);
    }
    // Racheté : on le retire de la liste de refill.
    const inRefill = live(data.refill).find((r) => r.key === productKey(fields));
    if (inRefill) { inRefill.deleted = true; inRefill.updatedAt = now(); toast("Ajouté et retiré de la liste de refill."); }
  }
  commit();
  return true;
}

/* ---------------------------------------------------------------- rendu */

function render() {
  renderInventory();
  renderRefill();
}

function renderInventory() {
  const q = norm($("#invSearch").value);
  const all = live(data.items).map((it) => ({ it, st: expiryStatus(it.expiry) }));
  const counts = { all: all.length, low: all.filter((x) => x.it.low).length, soon: all.filter((x) => x.st.cls === "soon").length, expired: all.filter((x) => x.st.cls === "expired").length };
  for (const k in counts) $("#n-" + k).textContent = counts[k] ? " " + counts[k] : "";
  const list = all
    .filter((x) => invFilter === "all" || (invFilter === "low" ? x.it.low : x.st.cls === invFilter))
    .filter((x) => !q || norm([x.it.name, x.it.location, x.it.note, x.it.cnk].join(" ")).includes(q))
    .sort((a, b) => invFilter === "all" || invFilter === "low" ? a.it.name.localeCompare(b.it.name, "fr") : a.st.days - b.st.days);
  if (!list.length) {
    $("#invList").innerHTML = `<div class="empty">${all.length ? "Aucun résultat." : "Inventaire vide.<br>Scannez une boîte pour commencer."}</div>`;
    return;
  }
  $("#invList").innerHTML = list.map(({ it, st }) => {
    const info = productInfo(it);
    return `
    <div class="card item" data-id="${esc(it.id)}">
      <div>
        <div class="name">${esc(it.name)}${(it.qty || 1) > 1 ? ` <span class="badge">×${it.qty}</span>` : ""}${it.low ? ` <span class="badge low">Niveau bas${refillFor(it) ? " · au refill" : ""}</span>` : ""}</div>
        ${info.use || info.substance ? `<div class="use">${esc(info.use || "")}${info.use && info.substance ? " · " : ""}${info.substance ? `<span class="sub">${esc(info.substance)}</span>` : ""}</div>` : ""}
        <div class="meta">${[it.expiry && "Pér. " + fmtDate(it.expiry), it.location, it.batch && "lot " + it.batch, it.note].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
      <span class="badge ${st.cls}">${esc(st.label)}</span>
      <div class="actions">
        ${info.leaflet ? `<a class="btn small leaflet" href="${esc(info.leaflet)}" target="_blank" rel="noopener">📄 Notice</a>` : ""}
        <button class="btn small" data-act="empty">${(it.qty || 1) > 1 ? "−1 boîte vide" : "Vide"}</button>
        <button class="btn small${it.low ? " on" : ""}" data-act="low" aria-pressed="${!!it.low}">${it.low ? "Niveau OK" : "Niveau bas"}</button>
        <button class="btn small" data-act="edit">Modifier</button>
      </div>
    </div>`;
  }).join("");
}

function renderRefill() {
  const list = live(data.refill).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const c = $("#refillCount");
  c.hidden = !list.length; c.textContent = list.length;
  renderExpirySuggestions();
  if (!list.length) { $("#refillList").innerHTML = `<div class="empty">Rien à racheter.</div>`; return; }
  $("#refillList").innerHTML = list.map((r) => `
    <div class="card item" data-id="${esc(r.id)}">
      <div>
        <div class="name">${esc(r.name)}</div>
        <div class="meta">${[r.reason === "low" && "Niveau bas (encore en stock)", r.reason === "expiry" && r.expiry && "Périme le " + fmtDate(r.expiry), r.pack, r.cnk && "CNK " + r.cnk].filter(Boolean).map(esc).join(" · ")}</div>
      </div>
      <button class="btn small primary" data-act="bought">Acheté ✓</button>
    </div>`).join("");
}

function renderExpirySuggestions() {
  const sugg = expirySuggestions();
  $("#expiryTitle").hidden = !sugg.length;
  $("#expiryList").innerHTML = sugg.map(({ it, st }) => `
    <div class="card item" data-id="${esc(it.id)}">
      <div>
        <div class="name">${esc(it.name)}</div>
        <div class="meta">${esc(st.cls === "expired" ? "Périmé depuis le " + fmtDate(it.expiry) : `Périme le ${fmtDate(it.expiry)} (dans ${st.days} j)`)}</div>
      </div>
      <span class="badge ${st.cls}">${esc(st.label)}</span>
      <div class="actions">
        <button class="btn small primary" data-act="add">Ajouter au refill</button>
        <button class="btn small" data-act="dismiss">Ignorer</button>
      </div>
    </div>`).join("");
}

function renderSuggest(box, results, onPick) {
  box.innerHTML = results.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name)}<br><small>${esc([p.pack, p.cnk && "CNK " + p.cnk, !p.active && "plus commercialisé", p.source !== "SAM" && p.source].filter(Boolean).join(" · "))}</small></button>`).join("");
  box.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) { onPick(results[+b.dataset.i]); box.innerHTML = ""; }
  };
}

function setView(v) {
  view = v;
  for (const s of $$(".view")) s.hidden = s.id !== "view-" + v;
  for (const b of $$("#tabs button")) {
    if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  $("#title").textContent = { inventory: "Pharmacie", scan: "Scanner", refill: "Refill", settings: "Réglages" }[v];
  if (v === "scan") { loadMeds(); startCamera(); } else stopCamera();
  if (v === "settings") renderSettings();
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function confirmDialog(title, text, buttons) {
  return new Promise((resolve) => {
    const d = $("#dlgConfirm");
    $("#cfTitle").textContent = title;
    $("#cfText").textContent = text;
    $("#cfActions").innerHTML = buttons.map(([v, label, cls]) => `<button class="btn ${cls || ""}" data-v="${v}">${esc(label)}</button>`).join("");
    // Résolution directe au clic (l'événement "close" n'est pas fiable partout) ; "close" reste le repli pour Échap.
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    $("#cfActions").onclick = (e) => { const b = e.target.closest("button"); if (b) { d.close(b.dataset.v); finish(b.dataset.v); } };
    d.onclose = () => finish(d.returnValue || "cancel");
    d.returnValue = "";
    d.showModal();
  });
}

/* ---------------------------------------------------------------- synchronisation GitHub */

let syncTimer = null, lastSyncAt = 0, syncing = false, dirty = false;

function syncEnabled() { return location.hostname === SYNC_HOST && !!settings.repo && !!getToken(); }

function setSyncState(state, label) {
  const el = $("#syncState");
  el.dataset.state = state; el.textContent = label;
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  dirty = true;
  if (!syncEnabled()) { setSyncState("off", "local"); return; }
  setSyncState("pending", "à synchroniser");
  clearTimeout(syncTimer);
  const wait = Math.max(delay, lastSyncAt + MIN_SYNC_INTERVAL_MS - Date.now());
  syncTimer = setTimeout(() => sync(), wait);
}

function mergeDict(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, rb] of Object.entries(b)) {
    const ra = out[id];
    if (!ra || String(rb.updatedAt) > String(ra.updatedAt)) out[id] = rb;
  }
  return out;
}

function b64decodeUtf8(b64) { return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0))); }
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gh(target, method, body) {
  const r = await fetch(`https://api.github.com/repos/${target.repo}/contents/${SYNC_PATH}`, {
    method,
    headers: { Authorization: "Bearer " + target.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return r;
}

/** Récupère la version distante, fusionne enregistrement par enregistrement (le plus récent gagne), puis pousse. */
async function sync(manual = false) {
  if (!syncEnabled()) {
    if (manual) toast(location.hostname !== SYNC_HOST ? "Synchronisation désactivée hors de " + SYNC_HOST + "." : "Configurez le dépôt et le jeton.");
    return;
  }
  if (syncing || !navigator.onLine) return;
  if (Date.now() - lastSyncAt < MIN_SYNC_INTERVAL_MS) { scheduleSync(0); return; }
  syncing = true; lastSyncAt = Date.now();
  setSyncState("pending", "synchro…");
  // Le profil est figé au début : si l'utilisateur change de profil pendant la synchro, le résultat ne touche pas le nouveau.
  const target = { repo: settings.repo, token: getToken(), key: repoKey(settings.repo) };
  const stillActive = () => repoKey(settings.repo) === target.key;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const local = JSON.parse(JSON.stringify(data)); // instantané : les modifications se font en place pendant la synchro
      const get = await gh(target, "GET");
      let remote = { items: {}, refill: {}, learned: {} }, sha;
      if (get.ok) { const j = await get.json(); sha = j.sha; remote = JSON.parse(b64decodeUtf8(j.content)); }
      else if (get.status !== 404) throw new Error("GitHub " + get.status);
      const merged = {
        items: mergeDict(remote.items, local.items),
        refill: mergeDict(remote.refill, local.refill),
        learned: mergeDict(remote.learned, local.learned),
      };
      const changedLocally = JSON.stringify(merged) !== JSON.stringify({ items: local.items, refill: local.refill, learned: local.learned });
      const needPush = JSON.stringify(merged) !== JSON.stringify({ items: remote.items || {}, refill: remote.refill || {}, learned: remote.learned || {} });
      if (needPush) {
        const put = await gh(target, "PUT", { message: "Mise à jour depuis " + deviceName(), content: b64encodeUtf8(JSON.stringify(merged, null, 1)), ...(sha ? { sha } : {}) });
        if (put.status === 409 || put.status === 422) continue; // modifié entre-temps : on recommence
        if (!put.ok) throw new Error("GitHub " + put.status);
      }
      if (!stillActive()) { lsSet(dataKey(target.repo), merged); return; }
      // Conserve les modifications faites pendant la synchro : elles partiront à la suivante.
      const after = { items: mergeDict(merged.items, data.items), refill: mergeDict(merged.refill, data.refill), learned: mergeDict(merged.learned, data.learned) };
      const editedDuringSync = JSON.stringify(after) !== JSON.stringify(merged);
      data = after;
      lsSet(dataKey(target.repo), data);
      dirty = editedDuringSync;
      setSyncState("ok", "synchronisé");
      $("#syncInfo").textContent = "Dernière synchro : " + new Date().toLocaleString("fr-BE");
      if (changedLocally) render(); // render() est pur : il ne modifie jamais data et ne relance pas de synchro
      if (editedDuringSync) setTimeout(() => scheduleSync(), 0); // après la remise à zéro de "syncing"
      return;
    }
    throw new Error("conflits répétés");
  } catch (e) {
    if (!stillActive()) return;
    setSyncState("error", "erreur sync");
    $("#syncInfo").textContent = "Erreur : " + e.message;
    if (manual) toast("Synchro impossible : " + e.message);
  } finally {
    syncing = false;
    // Profil changé pendant la synchro : celle du nouveau profil a été ignorée, on la lance maintenant.
    if (!stillActive() && syncEnabled()) setTimeout(() => { lastSyncAt = 0; sync(); }, 0);
  }
}

function deviceName() { return /android/i.test(navigator.userAgent) ? "Android" : /iphone|ipad/i.test(navigator.userAgent) ? "iOS" : "ordinateur"; }

/* ---------------------------------------------------------------- réglages */

function applyTheme() {
  if (settings.theme) document.documentElement.dataset.theme = settings.theme;
  else delete document.documentElement.dataset.theme;
}

function knownProfiles() {
  const repos = new Set(Object.keys(settings.tokens).filter(Boolean));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(LS_DATA + ":") && k !== dataKey("")) repos.add(k.slice(LS_DATA.length + 1));
    }
  } catch { /* stockage indisponible */ }
  if (settings.repo) repos.add(repoKey(settings.repo));
  return [...repos].sort();
}

function renderProfileName() {
  const multi = knownProfiles().length > 1 || (settings.repo && live(loadData("").items).length > 0);
  $("#profileName").hidden = !multi;
  const short = (r) => r.split("/").pop();
  const ambiguous = knownProfiles().filter((r) => short(r) === short(repoKey(settings.repo))).length > 1;
  $("#profileName").textContent = !settings.repo ? "local" : ambiguous ? settings.repo : short(settings.repo);
  $("#profileName").title = "Profil actif : " + (settings.repo || "local, sans synchronisation");
}

/** Active un autre dépôt (= autre inventaire). Sans dépôt auparavant, propose d'importer l'inventaire local. */
async function switchProfile(repo, token) {
  repo = repo.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("Dépôt invalide : format propriétaire/nom."); return; }
  const same = repoKey(repo) === repoKey(settings.repo);
  if (repo) settings.tokens[repoKey(repo)] = token;
  if (same) {
    settings.repo = repo;
    lsSet(LS_SETTINGS, settings);
    toast("Réglages enregistrés.");
    lastSyncAt = 0; sync(true);
    return;
  }
  let next = loadData(repo);
  const localCount = !settings.repo ? live(data.items).length + live(data.refill).length : 0;
  if (repo && localCount) {
    const c = await confirmDialog("Inventaire local", `Cet appareil contient ${localCount} élément(s) qui ne sont liés à aucun dépôt. Les importer dans « ${repo} » ?`,
      [["cancel", "Annuler"], ["keep", "Non, les garder à part"], ["import", "Importer", "primary"]]);
    if (c === "cancel" || !c) return;
    if (c === "import") {
      next = { items: mergeDict(next.items, data.items), refill: mergeDict(next.refill, data.refill), learned: mergeDict(next.learned, data.learned) };
      try { localStorage.removeItem(dataKey("")); } catch { /* ignoré */ }
    }
  }
  clearTimeout(syncTimer); dirty = false; lastSyncAt = 0;
  settings.repo = repo;
  lsSet(LS_SETTINGS, settings);
  data = next;
  lsSet(dataKey(repo), data);
  render(); renderSettings(); renderProfileName();
  toast(repo ? "Profil actif : " + repo : "Profil local (sans synchronisation).");
  if (syncEnabled()) sync(true); else setSyncState("off", "local");
}

/** Supprime de cet appareil le jeton et l'inventaire local du profil actif (les données restent sur GitHub). */
async function forgetProfile() {
  const name = settings.repo || "local";
  const c = await confirmDialog("Oublier ce profil ?", `Le jeton et l'inventaire de « ${name} » seront effacés de cet appareil. Les données synchronisées restent dans le dépôt GitHub.`,
    [["no", "Annuler"], ["yes", "Oublier", "danger"]]);
  if (c !== "yes") return;
  clearTimeout(syncTimer); dirty = false;
  delete settings.tokens[repoKey(settings.repo)];
  try { localStorage.removeItem(dataKey(settings.repo)); } catch { /* ignoré */ }
  settings.repo = "";
  lsSet(LS_SETTINGS, settings);
  data = loadData("");
  render(); renderSettings(); renderProfileName();
  setSyncState("off", "local");
  toast("Profil oublié sur cet appareil.");
}

function renderSettings() {
  $("#setRepo").value = settings.repo;
  $("#setToken").value = getToken();
  $("#profiles").innerHTML = knownProfiles().map((r) => `<option value="${esc(r)}">`).join("");
  $("#setSoon").value = settings.soonDays;
  $("#setTheme").value = settings.theme;
  if (location.hostname !== SYNC_HOST) $("#syncInfo").textContent = "Synchronisation inactive ici (uniquement sur " + SYNC_HOST + ").";
}

/* ---------------------------------------------------------------- événements */

function bind() {
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) setView(b.dataset.view); });

  $("#invSearch").addEventListener("input", renderInventory);
  $("#invFilters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    invFilter = b.dataset.filter;
    for (const c of $$("#invFilters .chip")) c.setAttribute("aria-pressed", c === b);
    renderInventory();
  });
  $("#invList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest("[data-id]").dataset.id;
    const it = data.items[id];
    if (b.dataset.act === "empty") markEmpty(id);
    if (b.dataset.act === "edit") openItemDialog(id);
    if (b.dataset.act === "low") toggleLow(id);
  });

  $("#scanMode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]"); if (!b) return;
    scanMode = b.dataset.mode;
    for (const x of $$("#scanMode button")) x.setAttribute("aria-pressed", x === b);
    $("#scanHint").textContent = scanMode === "add" ? "Visez le code DataMatrix ou le code-barres" : "Scannez la boîte vide à retirer";
  });
  $("#btnCamera").addEventListener("click", () => (stream ? stopCamera() : startCamera()));
  $("#photoInput").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) scanPhoto(f); e.target.value = ""; });
  $("#btnManual").addEventListener("click", () => { loadMeds(); loadPara(); openItemDialog(null, {}); });
  const submitCode = () => { const v = $("#codeInput").value.trim(); if (v) { $("#codeInput").value = ""; onScanned(v, true); } };
  $("#btnCode").addEventListener("click", submitCode);
  $("#codeInput").addEventListener("keydown", (e) => e.key === "Enter" && submitCode());

  // Recherche dans la base depuis le champ "Médicament"
  let sTimer;
  $("#fName").addEventListener("input", () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(async () => {
      const q = $("#fName").value;
      if (q.trim().length < 3) { $("#nameSuggest").innerHTML = ""; return; }
      await loadMeds(); loadPara();
      renderSuggest($("#nameSuggest"), searchDb(q, 20), (p) => {
        // Garde le code scanné (utile pour mémoriser l'association) mais prend les infos du produit choisi.
        editing.product = { ...p, gtin: p.gtin || editing.code?.gtin || "", cnk: p.cnk || editing.code?.cnk || "", source: p.source };
        $("#fName").value = p.name;
        renderSource();
      });
    }, 200);
  });
  $("#itemForm").addEventListener("submit", (e) => { e.preventDefault(); if (saveItemFromDialog()) $("#dlgItem").close(); });
  $("#btnItemCancel").addEventListener("click", () => $("#dlgItem").close());
  $("#btnItemDelete").addEventListener("click", async () => {
    const it = data.items[editing.id];
    const c = await confirmDialog("Supprimer ?", `Supprimer « ${it.name} » de l'inventaire ?`, [["no", "Annuler"], ["yes", "Supprimer", "danger"]]);
    if (c !== "yes") return;
    it.deleted = true; it.updatedAt = now();
    $("#dlgItem").close();
    commit();
  });

  // Refill
  let rTimer;
  $("#refillAdd").addEventListener("input", () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(async () => {
      const q = $("#refillAdd").value;
      if (q.trim().length < 3) { $("#refillSuggest").innerHTML = ""; return; }
      await loadMeds(); loadPara();
      renderSuggest($("#refillSuggest"), searchDb(q, 12), (p) => { addRefill(p); $("#refillAdd").value = ""; commit(); });
    }, 200);
  });
  const addFreeRefill = () => { const v = $("#refillAdd").value.trim(); if (v) { addRefill({ name: v }); $("#refillAdd").value = ""; $("#refillSuggest").innerHTML = ""; commit(); } };
  $("#btnRefillAdd").addEventListener("click", addFreeRefill);
  $("#refillAdd").addEventListener("keydown", (e) => e.key === "Enter" && addFreeRefill());
  $("#refillList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act=bought]"); if (!b) return;
    const r = data.refill[b.closest("[data-id]").dataset.id];
    r.deleted = true; r.updatedAt = now();
    commit();
    toast("Pensez à scanner la nouvelle boîte pour l'ajouter à l'inventaire.");
  });
  $("#expiryList").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const it = data.items[b.closest("[data-id]").dataset.id];
    if (b.dataset.act === "add") {
      const r = addRefill(it, "expiry");
      if (r.reason === "expiry") r.expiry = it.expiry;
      toast("Ajouté au refill : " + it.name);
    } else {
      // Ignoré pour cette date-là : si la date change, la suggestion pourra revenir.
      it.expiryDismissed = it.expiry;
      it.updatedAt = now();
    }
    commit();
  });
  $("#btnShareRefill").addEventListener("click", async () => {
    const txt = "À racheter :\n" + live(data.refill).map((r) => "• " + r.name + (r.cnk ? ` (CNK ${r.cnk})` : "")).join("\n");
    try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast("Liste copiée."); } } catch { /* annulé */ }
  });

  // Réglages
  $("#btnSaveSync").addEventListener("click", () => switchProfile($("#setRepo").value, $("#setToken").value.trim()));
  // Choisir un profil connu remplit son jeton.
  $("#setRepo").addEventListener("change", () => { $("#setToken").value = getToken($("#setRepo").value); });
  $("#btnForget").addEventListener("click", forgetProfile);
  $("#btnSyncNow").addEventListener("click", () => { lastSyncAt = 0; sync(true); });
  $("#setSoon").addEventListener("change", (e) => { settings.soonDays = Math.max(1, +e.target.value || 60); lsSet(LS_SETTINGS, settings); render(); });
  $("#setTheme").addEventListener("change", (e) => { settings.theme = e.target.value; lsSet(LS_SETTINGS, settings); applyTheme(); });
  $("#btnExport").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `pharmacie-${(settings.repo.split("/").pop() || "local").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });
  $("#importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      data = { items: mergeDict(data.items, j.items), refill: mergeDict(data.refill, j.refill), learned: mergeDict(data.learned, j.learned) };
      commit(); toast("Import fusionné.");
    } catch (err) { toast("Fichier invalide : " + err.message); }
  });

  window.addEventListener("online", () => dirty && scheduleSync(0));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
    else if (view === "scan") startCamera();
    else if (syncEnabled() && Date.now() - lastSyncAt > MIN_SYNC_INTERVAL_MS) sync(); // récupère les changements d'un autre appareil
  });
}

/* ---------------------------------------------------------------- démarrage */

applyTheme();
bind();
renderProfileName();
render();
setView("inventory");
loadMeds();
if (syncEnabled()) { setSyncState("pending", "synchro…"); sync(); } else setSyncState("off", "local");
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
