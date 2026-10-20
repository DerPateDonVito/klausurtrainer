"use strict";
/* ============================================================
   Studienbuch: Startseite „Heute“, Kalender (Platzhalter), Erfassen-Fenster, Einstellungen
   Lastenheft H1, H2, H9. Erfassen selbst (H3, H4, H7) steht ab 1.5.0 in erfassen.js. Die Lernlogik wird hier nur gelesen.
   ============================================================ */

// Kurse ohne Klausur: nur für Kalender, Erfassen und Modulseiten, nie im Bereich Lernen (Lastenheft H0).
// Bewusst NICHT in MODULES: daran hängen Einlesen, Freischaltung und alle Lernansichten.
const KURSE = {
  M4:{name:"Professionelle Beziehungsgestaltung", short:"Beziehungsgestaltung", doz:"Finkbeiner", pruefung:"Essay"}
};

// Darstellung je Gerät (nicht im Lernstand, nicht abgeglichen): kt2.ui
let UI = Object.assign({tiles:{}}, lsGet("ui", {}));
if(!UI.tiles || typeof UI.tiles!=="object") UI.tiles = {};
function saveUI(){ lsSet("ui", UI); }

// Von wo ein Training gestartet wurde: „Beenden“ führt dorthin zurück
let ORIGIN = null;
function startLernen(modul){ ORIGIN = "heute"; SESSION = null; VIEW = "train"; render({modul}); window.scrollTo(0,0); }

/* ---------- Datum ---------- */
function isoWeek(d){
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
function dateLong(){ const d = new Date(); return d.toLocaleDateString("de-DE", {weekday:"long", day:"numeric", month:"long"}) + " · Woche " + isoWeek(d); }
function dateShort(){ return new Date().toLocaleDateString("de-DE", {weekday:"short", day:"numeric", month:"long"}).replace(/^(\p{L}+)\./u, "$1"); }

/* ---------- Kacheln (Lastenheft H2): erweiterbar, jede ein- und ausblendbar ---------- */
// col: a = linke Spalte am PC, b = rechte Spalte. ready:false = folgt mit einem späteren Paket.
const TILES = [
  {id:"naechste",  label:"Als Nächstes (nächste Vorlesung)", col:"a", ready:false, folgt:"folgt mit dem Kalender"},
  {id:"faellig",   label:"Heute fällig",                     col:"a", ready:true,  render:tileFaellig},
  {id:"countdown", label:"Bis zur Klausur",                  col:"b", ready:true,  render:tileCountdown}
];
function tileOn(t){ return t.ready && UI.tiles[t.id] !== false; }

const CHEV = `<svg class="ico chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

function dueByModule(){ return modOrder().map(m => { const s = moduleStats(m); return {m, n:s.due.length, fresh:s.fresh.length}; }); }

function tileFaellig(){
  const rows = dueByModule(), total = rows.reduce((n,r)=>n+r.n, 0), fresh = rows.reduce((n,r)=>n+r.fresh, 0);
  return `<section class="tile" aria-label="Fällige Karten">
    <div class="tile-h"><span class="kicker">Heute fällig</span><span class="tile-n mono">${total} ${total===1?"Karte":"Karten"}</span></div>
    <div class="tlist">${rows.map(r => `<button type="button" class="trow mx-${r.m}" data-hm="${r.m}" ${r.n?"":"disabled"}>
        <span class="sw" aria-hidden="true"></span><span class="tl">${r.m} ${esc(MODULES[r.m].short)}</span><strong class="mono">${r.n}</strong>${CHEV}</button>`).join("")}</div>
    <button type="button" class="btn big" id="hAll" ${total?"":"disabled"}>${total?`Alle ${total} lernen ${ICON.arrow}`:"Heute ist nichts fällig"}</button>
    ${!SET.autoUnlock && fresh ? `<p class="hint" style="margin:2px 4px 0">${fresh} neue ${fresh===1?"Karte wartet":"Karten warten"} auf Freischaltung. <a href="#" data-go="home">Unter Lernen freischalten</a></p>` : ""}
  </section>`;
}

function tileCountdown(){
  return `<section class="tile" aria-label="Bis zur Klausur">
    <span class="kicker">Bis zur Klausur</span>
    <div class="cd">${modOrder().map(m => { const d = daysTo(examOf(m));
      return `<div class="cdb mx-${m}" title="Vorläufiger Termin, bis der FOM-Kalender ihn bestätigt. Ändern unter Einstellungen.">
        <span>${m} · ${fmtDate(examOf(m)).slice(0,6)}</span><strong class="mono">${d>=0?d:"–"}</strong><span>${d>=0?(d===1?"Tag":"Tage"):"vorbei"} · vorläufig</span></div>`; }).join("")}</div>
  </section>`;
}

function heuteHinweise(){
  let h = syncBanner();
  if(DIR_STATE==="ask") h += `<div class="note">Studienordner auf neue Inhalte prüfen: <a href="#" id="dirCheck">Jetzt prüfen</a> (Brave fragt nach der Freigabe, „Bei jedem Besuch erlauben“ wählen, falls angeboten)</div>`;
  else if(DEVICE==="PC" && hasToken() && window.showDirectoryPicker && DIR_STATE==="none" && PKG) h += `<div class="note">Damit die App neue Inhalte selbst findet: einmal unter Einstellungen „Inhalte nach Drive“ ausführen und den Studienordner wählen.</div>`;
  if(DIFF && !DIFF.gesehen) h += `<div class="note">Neue Inhalte vom ${fmtDT(DIFF.at)}: ${DIFF.neu.length} neue, ${DIFF.geaendert.length} geänderte Fragen. <a href="#" data-go="stats">Anzeigen</a></div>`;
  h += erfHinweise();   // ab 1.5.0: Warteschlange, Entwurf, Übernahme am PC
  return h;
}

function viewHeute(){
  if(!ITEMS.length) return needsContent();
  const total = dueByModule().reduce((n,r)=>n+r.n, 0);
  const on = TILES.filter(tileOn);
  const col = c => on.filter(t => t.col===c).map(t => t.render()).join("");
  const pkgAge = PKG ? Math.floor((Date.now()-new Date(PKG.erstellt))/864e5) : null;
  main.innerHTML = `<div class="heute">
    ${heuteHinweise()}
    <header class="hhead"><span class="kicker">${esc(dateLong())}</span>
      <h1>${total ? `Heute ${total===1?"ist":"sind"} <em>${total} ${total===1?"Karte":"Karten"}</em> fällig.` : "Heute ist nichts fällig."}</h1></header>
    ${on.length ? `<div class="hcols"><div class="hcol">${col("a")}</div><div class="hcol">${col("b")}</div></div>`
      : `<div class="card"><p>Alle Kacheln sind ausgeblendet.</p><a href="#" data-go="data">Unter Einstellungen einblenden</a></div>`}
    <p class="hint hfoot">Inhalte vom ${PKG?fmtDT(PKG.erstellt):"–"}${pkgAge>7?` (${pkgAge} Tage alt)`:""} · ${ITEMS.filter(trainable).length} Fragen</p>
  </div>`;
  wireBanner(); erfHinweiseVerdrahten();
  const dc = $("#dirCheck"); if(dc) dc.onclick = e => { e.preventDefault(); autoContentCheck(true); };
  main.querySelectorAll("[data-hm]").forEach(b => b.onclick = () => startLernen(b.dataset.hm));
  const all = $("#hAll"); if(all) all.onclick = () => startLernen("ALL");
}

/* ---------- Kalender (Lastenheft H5): folgt mit Paket 4 ---------- */
function viewKalender(){
  main.innerHTML = `${syncBanner()}<h1>Kalender</h1>
    <div class="card"><p>Der Kalender folgt mit dem Ausbauschritt Kalender: Vorlesungen aus dem Abo „FOM“ und eigene Fristen aus dem Kalender „Studium“, nur lesend, als Liste der nächsten 14 Tage und als Woche.</p>
      <p class="hint" style="margin:0">Bis dahin gelten die vorläufigen Klausurtermine unten. Ändern unter <a href="#" data-go="data">Einstellungen</a>.</p></div>
    <h2>Klausurtermine (vorläufig)</h2>
    <table class="t">${modOrder().map(m => { const d = daysTo(examOf(m));
      return `<tr><td style="white-space:nowrap"><span class="dot" style="--mc:${MODULES[m].color}"></span> ${m} ${esc(MODULES[m].short)}</td><td class="mono" style="white-space:nowrap">${fmtDate(examOf(m))}</td><td class="mono" style="white-space:nowrap">${d>=0?`${d} ${d===1?"Tag":"Tage"}`:"vorbei"}</td></tr>`; }).join("")}
      <tr><td style="white-space:nowrap"><span class="dot" style="--mc:var(--m4)"></span> M4 ${esc(KURSE.M4.short)}</td><td colspan="2" class="muted">Essay, Abgabe laut Studienbuch</td></tr></table>`;
  wireBanner();
}

/* ---------- Erfassen (Lastenheft H3, H4): Fenster von unten, Inhalt und Funktionen in erfassen.js ---------- */
let SHEET_FOCUS = null;
function openSheet(){
  const s = $("#sheet"); if(!s.hidden) return;
  SHEET_FOCUS = document.activeElement; erfSheetMalen(true); s.hidden = false; document.body.classList.add("sheet-open");
  $("#sheetClose").focus();
}
function closeSheet(){
  const s = $("#sheet"); if(!s || s.hidden) return;
  s.hidden = true; document.body.classList.remove("sheet-open");
  if(SHEET_FOCUS && SHEET_FOCUS.focus) SHEET_FOCUS.focus({preventScroll:true});
}

/* ---------- Einstellungen: bisherige Ansicht „Daten“ plus Startseite ---------- */
function viewEinstellungen(opts){
  viewData(opts);
  const sec = document.createElement("section");
  sec.innerHTML = `<h2>Startseite „Heute“</h2>
    <p class="hint">Welche Kacheln auf „Heute“ erscheinen. Gilt nur für dieses Gerät (${DEVICE}).</p>
    <div class="chips">${TILES.map(t => `<button class="chip" type="button" data-tile="${t.id}" aria-pressed="${tileOn(t)}" ${t.ready?"":"disabled"}>${esc(t.label)}${t.ready?"":` (${esc(t.folgt)})`}</button>`).join("")}</div>`;
  const ver = main.lastElementChild;   // Versionszeile bleibt ganz unten
  main.insertBefore(sec, ver);
  const erf = document.createElement("section"); main.insertBefore(erf, sec); erfEinstellungen(erf);   // ab 1.5.0
  sec.querySelectorAll("[data-tile]").forEach(b => b.onclick = () => {
    const id = b.dataset.tile; UI.tiles[id] = !tileOn(TILES.find(t=>t.id===id)); saveUI();
    b.setAttribute("aria-pressed", UI.tiles[id]);
  });
}
