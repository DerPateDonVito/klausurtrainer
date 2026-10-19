"use strict";
/* ============================================================
   Rahmen (ab 1.4): Bereiche, Navigation, Hell/Dunkel, render()
   Lastenheft H1: Leiste unten (Handy) bzw. Seitenleiste (PC) mit Heute · Kalender · [+] · Lernen · Statistik
   ============================================================ */
// Ansicht → Bereich. Die Ansichten von 1.3 (home bis data) bleiben unverändert; „home“ ist die Übersicht in „Lernen“.
const AREA = {heute:"heute", kalender:"kalender", home:"lernen", train:"lernen", errors:"lernen", sim:"lernen",
  transfer:"lernen", catalog:"lernen", stats:"statistik", data:"einstellungen"};
const VIEWS = {heute:viewHeute, kalender:viewKalender, home:viewHome, train:viewTrain, errors:viewErrors, sim:viewSim,
  transfer:viewTransfer, catalog:viewCatalog, stats:viewStatistik, data:viewEinstellungen};

function go(v, opts){
  zeitTakt();
  if(v==="home" && ORIGIN) v = ORIGIN;   // Training von „Heute“ oder „Statistik“ aus gestartet: dorthin zurück
  if(v!=="train") ORIGIN = null;
  if(!VIEWS[v]) v = "heute";
  VIEW=v; KEYH=null; if(v==="train" && !(opts && opts.keep)) SESSION=null; render(opts); window.scrollTo(0,0);
}
function render(opts){
  if(!VIEWS[VIEW]) VIEW = "heute";
  const area = AREA[VIEW];
  document.querySelectorAll("[data-area]").forEach(b => b.setAttribute("aria-current", b.dataset.area===area ? "page" : "false"));
  const sub = $("#subnav"); sub.hidden = area!=="lernen";
  sub.querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-current", b.dataset.v===VIEW ? "page" : "false"));
  closeSheet();
  stopClock(); KEYH = null; document.body.classList.remove("focus");
  document.body.dataset.area = area;
  VIEWS[VIEW](opts||{});
  renderSync();
}
// Nach einem Abgleich nur neu zeichnen, wenn gerade nichts eingegeben wird (wie 1.3, ergänzt um Heute und Kalender)
function softRender(){ if(["heute","kalender","home","catalog","stats","errors","data"].includes(VIEW)) render(); else if(VIEW==="sim" && !SIMRUN) render(); else if(VIEW==="train" && !SESSION) render(); }

// Navigation: Leiste unten, Seitenleiste, Unterreiter, Zahnrad
document.addEventListener("click", e => {
  const b = e.target.closest("[data-v]");
  if(b && b.closest(".tabbar,.side,.hdr,.subnav")){ ORIGIN = null; go(b.dataset.v); return; }
  if(e.target.closest("[data-cap]")){ openSheet(); return; }
});
$("#sheetClose").onclick = closeSheet;
$("#sheet").addEventListener("click", e => { if(e.target.id==="sheet") closeSheet(); });
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("#sheet").hidden){ e.preventDefault(); closeSheet(); } });

// Abgleich und Hell/Dunkel (Kopf am Handy, Seitenleiste am PC)
document.querySelectorAll(".syncpill").forEach(p => p.onclick = () => { if(!LOCAL.cid) return go("data"); if(!hasToken()) return login(); syncNow({unit:true}); });
document.querySelectorAll(".themeBtn").forEach(b => b.onclick = () => { LOCAL.theme = document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark"; persistLocal(); applyTheme(); });
function applyTheme(){
  const t = LOCAL.theme || document.documentElement.getAttribute("data-theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll(".themeBtn").forEach(b => {
    b.querySelector("i").innerHTML = t==="dark" ? ICON.sun : ICON.moon; b.querySelector("span").textContent = t==="dark" ? "Hell" : "Dunkel";
    b.setAttribute("aria-label", t==="dark" ? "Auf hell umschalten" : "Auf dunkel umschalten"); b.title = b.getAttribute("aria-label");
  });
  const tc = document.querySelector('meta[name="theme-color"]'); if(tc) tc.content = t==="dark" ? "#0A1424" : "#13294B";
}
function renderDate(){ const h = $("#hdate"); if(h) h.textContent = dateShort(); document.querySelectorAll("[data-ver]").forEach(v => v.textContent = "Version " + VERSION.replace(/ \(.*/, "")); }

/* ============================================================
   Start
   ============================================================ */
applyTheme(); renderDate();
document.addEventListener("visibilitychange", () => { if(document.visibilityState==="hidden" && pending() && hasToken()) syncNow({unit:true}); else if(document.visibilityState==="visible" && hasToken()) scheduleSync(300, {dircheck:true}); });
document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible"){ renderDate(); if(VIEW==="heute") softRender(); } });
window.addEventListener("online", () => { if(hasToken()) scheduleSync(300); });
setInterval(() => { if(document.visibilityState==="visible" && hasToken() && !SESSION && !SIMRUN) syncNow(); }, 5*60e3);
if(location.protocol.startsWith("http") && "serviceWorker" in navigator){ navigator.serviceWorker.register("sw.js").catch(()=>{}); }
(async () => {
  const pkg = await idbGet("pkg");
  if(pkg){ applyPackage(pkg, pkg.erstellt !== LOCAL.pkgErstellt); }
  autoUnlock();
  if(DEVICE==="PC" && window.showDirectoryPicker){ const h = await idbGet("dir"); if(h){ try{ DIR_STATE = (await h.queryPermission({mode:"read"}))==="granted" ? "ok" : "ask"; }catch(e){ DIR_STATE="ask"; } } }
  render();
  if(hasToken()) syncNow({first:true}); else renderSync();
})();
window.KT = {buildItems, rate, mergeIn, get items(){return ITEMS;}, get prog(){return PROG;}, get local(){return LOCAL;}, syncNow, applyPackage};
