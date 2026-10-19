"use strict";
/* ============================================================
   Zustand
   ============================================================ */
let PROG  = lsGet("prog", {});      // Lernstand je Frage-ID: {f, due, hist:[{d,g,s}], lapses, unl, upd}
let TRANS = lsGet("trans", {});     // Transfer-Ausarbeitungen je Modul
let SIMS  = lsGet("sims", []);      // Ergebnisse der Klausursimulationen
let SET   = Object.assign({statuses:["A","B"], exams:{}, autoUnlock:true, upd:0}, lsGet("set", {}));
let LOCAL = Object.assign({theme:null, cid:"", email:"", ids:{}, chg:0, synced:0, lastSync:null, lastBackup:0, pkgDriveTime:null, pkgErstellt:null}, lsGet("local", {}));
let DIFF  = lsGet("diff", null);
let PKG = null, ITEMS = [], BUILD = {warnings:[], cards:0, meta:0, files:[]};

// Client-ID: aus dem Einrichtungslink (#cid=…) oder vom Drive-Test übernehmen
(function(){
  const m = /[#&]cid=([^&]+)/.exec(location.hash);
  if(m){ LOCAL.cid = decodeURIComponent(m[1]).trim(); history.replaceState(null, "", location.pathname + location.search); }
  if(!LOCAL.cid){ try{ LOCAL.cid = (localStorage.getItem("kt-drive-cid")||"").trim(); }catch(e){} }
  lsSet("local", LOCAL);
})();

function persist(){ lsSet("prog",PROG); lsSet("trans",TRANS); lsSet("sims",SIMS); lsSet("set",SET); lsSet("local",LOCAL); }
function persistLocal(){ lsSet("local", LOCAL); }
function changed(opts={}){ LOCAL.chg++; persist(); renderSync(); scheduleSync(opts.unit ? 400 : 2500, opts); }
function pending(){ return LOCAL.chg > LOCAL.synced; }
function examOf(m){ return (SET.exams && SET.exams[m]) || MODULES[m].exam; }
function moduleOfId(id){ const m=/^(M\d)/.exec(id||""); return m ? m[1] : ""; }
function splitKern(s){ return (s||"").split("|").map(x=>x.trim()).filter(Boolean); }
function modOrder(){ return Object.keys(MODULES).sort((a,b)=>examOf(a).localeCompare(examOf(b))); }

/* ============================================================
   Fragen aus dem Inhaltspaket bauen
   ============================================================ */
function buildItems(cardFiles, metaFiles){
  const report = {cards:0, meta:0, warnings:[]};
  const cards = new Map();
  for(const cf of cardFiles){
    const p = parseCSV(cf.text);
    p.bad.forEach(b => report.warnings.push(`${cf.path}: Zeile ${b.line} hat ${b.cols} statt ${b.expected} Spalten`));
    if(p.rows.length && !("frage" in p.rows[0])){ report.warnings.push(`${cf.path}: Spalte frage fehlt, Datei übersprungen`); continue; }
    for(const r of p.rows){ if(!r.id) continue; if(cards.has(r.id)) report.warnings.push(`Karten-ID doppelt: ${r.id}`); cards.set(r.id, r); report.cards++; }
  }
  const metas = new Map();
  for(const mf of metaFiles){
    const p = parseCSV(mf.text);
    p.bad.forEach(b => report.warnings.push(`${mf.path}: Zeile ${b.line} hat ${b.cols} statt ${b.expected} Spalten`));
    for(const r of p.rows){ if(!r.id) continue; if(metas.has(r.id)) report.warnings.push(`Prüfungsebene: ID doppelt ${r.id}`); metas.set(r.id, r); report.meta++; }
  }
  const items = [];
  const mk = (id, c, m) => {
    c = c || {}; m = m || {};
    const status = (m.status || "?").toUpperCase();
    const it = {
      id, modul: (c.modul || moduleOfId(id)).toUpperCase(),
      thema: m.thema || c.thema || "", frage: m.frage || c.frage || "",
      antwort: m.antwort || c.antwort || "", mind: m.mindestantwort || "",
      kern: splitKern(m.kernelemente), fehler: m.typische_fehler || "",
      bild: m.bild || "", status: STATUS[status] ? status : "?",
      punkte: m.punkte ? Number(String(m.punkte).replace(",", ".")) || null : null,
      form: m.aufgabenform || c.typ || "", quelle: c.quelle || "", hinweis: c.dozentenhinweis || "",
      beleg: m.beleg || "", gueltig: (m.gueltig || "aktiv").toLowerCase(), karte: !!c.id
    };
    it.offen = !(it.antwort || it.mind);
    return it;
  };
  for(const [id,c] of cards) items.push(mk(id, c, metas.get(id)));
  for(const [id,m] of metas){
    if(cards.has(id)) continue;
    if(/^M\d-\d+$/.test(id)) report.warnings.push(`Prüfungsebene verweist auf Karte ${id}, die in karten.csv fehlt`);
    if(!m.frage){ report.warnings.push(`Prüfungsebene ${id}: weder Karte noch Frage vorhanden`); continue; }
    items.push(mk(id, null, m));
  }
  const known = items.filter(i=>MODULES[i.modul]);
  if(known.length < items.length) report.warnings.push(`${items.length-known.length} Frage(n) ohne Modul M1 bis M3 übersprungen`);
  known.sort((a,b)=> a.modul.localeCompare(b.modul) || a.id.localeCompare(b.id, "de", {numeric:true}));
  const unrated = known.filter(i=>i.status==="?").length;
  if(unrated) report.warnings.push(`${unrated} Karte(n) ohne Eintrag in der Prüfungsebene (Stufe unbewertet)`);
  return {items:known, report};
}
function itemHash(i){ return hashStr([i.frage,i.antwort,i.mind,i.kern.join("|"),i.fehler,i.status,i.gueltig,i.punkte].join("\u0001")); }

function applyPackage(pkg, isNew){
  const files = pkg.dateien || [];
  const cardFiles = files.filter(d => /(^|\/)karten\.csv$/i.test(d.path));
  const metaFiles = files.filter(d => /pruefung_M\d+\.csv$/i.test(d.path));
  const {items, report} = buildItems(cardFiles, metaFiles);
  // Merkhilfen (Pruefung/merkhilfen_Mx.csv): einfach erklärt + Eselsbrücke, nur Lernhilfe
  const mk = new Map();
  for(const f of files.filter(d => /merkhilfen_M\d+\.csv$/i.test(d.path))){
    const pr = parseCSV(f.text);
    pr.bad.forEach(b => report.warnings.push(`${f.path}: Zeile ${b.line} hat ${b.cols} statt ${b.expected} Spalten`));
    for(const r of pr.rows){ if(!r.id || (r.gueltig||"aktiv").toLowerCase().startsWith("überholt")) continue; mk.set(r.id, r); }
  }
  let mkCount = 0;
  for(const it of items){ const r = mk.get(it.id); if(r){ it.einfach = r.einfach || ""; it.merk = r.merkhilfe || ""; mkCount++; } }
  for(const id of mk.keys()) if(!items.some(i=>i.id===id)) report.warnings.push(`Merkhilfe zu ${id}, die Frage fehlt`);
  report.merk = mkCount;
  if(isNew){
    const prev = lsGet("hashes", null), now = {};
    items.forEach(i => now[i.id] = itemHash(i));
    if(prev){
      const neu = items.filter(i => !(i.id in prev)).map(i=>i.id);
      const geaendert = items.filter(i => (i.id in prev) && prev[i.id]!==now[i.id]).map(i=>i.id);
      if(neu.length || geaendert.length){ DIFF = {at:pkg.erstellt, neu, geaendert, gesehen:false}; lsSet("diff", DIFF); }
    }
    lsSet("hashes", now);
    LOCAL.pkgErstellt = pkg.erstellt; persistLocal();
  }
  PKG = pkg; ITEMS = items;
  BUILD = {warnings:report.warnings.concat(pkg.hinweise||[]), cards:report.cards, meta:report.meta, merk:report.merk||0, files:files.map(f=>f.path)};
}

/* ============================================================
   Lernlogik (Lastenheft B)
   ============================================================ */
function prog(id){ return PROG[id] || null; }
function trainable(it){ return !it.offen && it.status!=="X" && it.gueltig!=="überholt" && it.gueltig!=="ueberholt"; }
function inScope(it){ return trainable(it) && SET.statuses.includes(it.status); }
function isDue(it){ const p=prog(it.id); return !!(p && p.due && dayNum(p.due) <= dayNum(todayStr())); }
function fachOf(it){ const p=prog(it.id); return p ? p.f : 0; }
function lastGrade(p){ return p && p.hist && p.hist.length ? p.hist.at(-1).g : null; }
function newAvail(m){
  const rank={A:0,B:1,C:2,"?":3};
  return ITEMS.filter(i => i.modul===m && inScope(i) && !prog(i.id))
    .sort((a,b)=> rank[a.status]-rank[b.status] || a.id.localeCompare(b.id,"de",{numeric:true}));
}
function unlockedToday(m){ const t=todayStr(); return ITEMS.filter(i=>i.modul===m && prog(i.id) && prog(i.id).unl===t).length; }
function recommendation(m){
  const avail = newAvail(m).length; if(!avail) return 0;
  const room = daysTo(examOf(m)) - 2 - CYCLE;
  const perDay = room > 0 ? Math.ceil(avail / room) : avail;
  return Math.max(0, Math.min(avail, perDay - unlockedToday(m)));
}
// Lastenheft B2 (geändert 14.10.2026): alle neuen trainierbaren Karten automatisch in Fach 1
function autoUnlock(){
  if(!SET.autoUnlock || !ITEMS.length) return 0;
  let n = 0; for(const m of Object.keys(MODULES)) n += unlock(m, 9999);
  return n;
}
function unlock(m, n){
  const t = todayStr(), now = Date.now();
  const list = newAvail(m).slice(0, n);
  list.forEach(i => { PROG[i.id] = {f:1, due:t, hist:[], lapses:0, unl:t, upd:1}; });
  if(list.length) changed(); return list.length;
}
// Bewertung: g = "r" richtig, "t" teilweise, "f" falsch. Nur fällige Karten wechseln das Fach (Zusatzübung zählt nur in der Statistik).
function rate(it, g){
  const t = dayNum(todayStr());
  let p = PROG[it.id];
  if(!p){ p = {f:1, due:todayStr(), hist:[], lapses:0, unl:todayStr()}; }
  p = Object.assign({hist:[], lapses:0}, p);
  const scheduled = !p.hist.length || !p.due || dayNum(p.due) <= t;
  if(scheduled){
    if(g==="r") p.f = Math.min(6, p.f+1);
    else if(g==="f"){ p.f = Math.max(1, p.f-1); p.lapses++; }
    let due = t + IVL[p.f];
    const ex = dayNum(examOf(it.modul)) - 2;      // letzte Abfrage spätestens 2 Tage vor der Klausur
    if(ex > t && due > ex) due = ex;
    p.due = numDay(due);
  }
  p.hist = p.hist.concat({d:todayStr(), g, s:scheduled?1:0}).slice(-40);
  p.upd = Date.now();
  PROG[it.id] = p;
  changed();
  return scheduled;
}
function suggestGrade(checked, total){ if(!total) return null; if(checked===total) return "r"; if(checked*2 >= total) return "t"; return "f"; }

