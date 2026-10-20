"use strict";
/* ============================================================
   Kalender (Lastenheft H5), ab Version 1.6.0
   - Quelle nur Google Kalender: Abo „FOM“ und eigener Kalender „Studium“. Die App liest nur
     (Rechte calendar.calendarlist.readonly und calendar.events.readonly). Die WebCal-Adresse sieht die App nie.
   - Ansichten: Liste der nächsten 14 Tage (Design A „Agenda“) und Woche als Zeitleiste je Tag (Design C).
     Am PC beides nebeneinander.
   - Zuordnung zu Modulen über den Titel, Anzeige in der Modulfarbe, einzelne Kurse ausblendbar (je Gerät).
   - Klausurtermine aus dem FOM-Kalender: Anzeige „bestätigt“; weicht der FOM-Termin ab, übernimmt ihn die App
     nur auf Knopfdruck (daran hängt die Lernplanung).
   - Zwischenspeicher im Browser (kt2.kal) für die Anzeige ohne Netz. Lernlogik und Lernstand werden nicht berührt.
   ============================================================ */
const CAL_API = "https://www.googleapis.com/calendar/v3";
const CAL_SCOPES = "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly";
const KAL_MOD = [["M1", /grundlagen\s+der\s+sozialen\s+arbeit/i], ["M2", /sozialsystem|sozialpolitik/i], ["M3", /lebensphasen/i], ["M4", /beziehungsgestaltung/i]];
const KAL_KLAUSUR = /klausur|prüfung/i;
let KAL = Object.assign({wahl: null, cals: [], ev: [], at: null, von: null, bis: null, zustand: "aus", meldung: ""}, lsGet("kal", {}));
function kalSpeichern(){ lsSet("kal", KAL); }
if(!UI.kalAus || typeof UI.kalAus !== "object") UI.kalAus = {};
if(!UI.kalZu || typeof UI.kalZu !== "object") UI.kalZu = {};

/* ---------- Zeit ---------- */
const pad2 = n => String(n).padStart(2, "0");
const TAGK = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"], TAGL = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONL = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function kalDatum(x){ if(x instanceof Date) return x; if(/^\d{4}-\d{2}-\d{2}$/.test(x)){ const [y, m, d] = x.split("-").map(Number); return new Date(y, m - 1, d); } return new Date(x); }
function tagKey(d){ d = kalDatum(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function plusTage(d, n){ const x = new Date(kalDatum(d)); x.setDate(x.getDate() + n); return x; }
function kalUhr(x){ const d = kalDatum(x); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function montag(d){ const x = new Date(kalDatum(d)); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function kalVZeit(ev){ const min = Math.max(0, Math.floor((Date.now() - kalDatum(ev.s)) / 60e3)); return `${Math.floor(min / 60)}:${pad2(min % 60)}`; }
function kalDauer(min){ return min >= 60 ? `${Math.floor(min / 60)} h ${pad2(min % 60)} min` : `${min} min`; }
function kalRelTag(d){ const n = Math.round((kalDatum(tagKey(d)) - kalDatum(tagKey(new Date()))) / 864e5); return n === 0 ? "heute" : n === 1 ? "morgen" : n < 0 ? (n === -1 ? "gestern" : `vor ${-n} Tagen`) : `in ${n} Tagen`; }

/* ---------- Zuordnung ---------- */
function kalCal(id){ return (KAL.cals || []).find(c => c.id === id) || {id, name: ""}; }
function kalEigen(ev){ return !/fom/i.test(kalCal(ev.c).name); }   // alles außer dem FOM-Abo zählt als eigener Termin
function kalModul(ev){
  const z = UI.kalZu[ev.t]; if(z) return z === "-" ? "" : z;
  for(const [m, re] of KAL_MOD) if(re.test(ev.t)) return m;
  return "";
}
function kalSchluessel(ev){ return kalModul(ev) || ev.t; }
function kalSichtbar(ev){ return !UI.kalAus[kalSchluessel(ev)]; }
function kalName(ev){ const m = ev.m; return m && MODULES[m] ? MODULES[m].name : m && KURSE[m] ? KURSE[m].name : ev.t; }
function kalDoz(m){ return m && MODULES[m] ? MODULES[m].doz : m && KURSE[m] ? KURSE[m].doz : ""; }
function kalOrt(ev){ const o = (ev.o || "").trim(); return !o ? "" : /^https?:\/\//i.test(o) ? "online" : o.length > 40 ? o.slice(0, 38) + " …" : o; }
// angereicherte, sichtbare Termine, die sich mit [von, bis) überschneiden
function kalTermine(von, bis){
  const a = kalDatum(von), b = kalDatum(bis);
  return (KAL.ev || []).map(e => Object.assign({}, e, {m: kalModul(e), eigen: kalEigen(e)}))
    .filter(e => kalSichtbar(e) && kalDatum(e.s) < b && kalDatum(e.e) > a)
    .sort((x, y) => kalDatum(x.s) - kalDatum(y.s) || (x.g ? -1 : 0));
}
function kalAktiv(){ return !!KAL.at; }
function kalLaeuft(m){ const now = new Date(); return kalTermine(plusTage(now, -1), plusTage(now, 1)).find(e => !e.g && kalDatum(e.s) <= now && kalDatum(e.e) > now && (!m || e.m === m)) || null; }
function kalNaechste(nach){ const now = nach ? kalDatum(nach.e) : new Date(); return kalTermine(now, plusTage(now, 14)).find(e => !e.g && kalDatum(e.s) >= now) || null; }
function kalKlausur(m){
  const t = kalTermine(plusTage(new Date(), -1), plusTage(new Date(), 400)).filter(e => !e.eigen && e.m === m && KAL_KLAUSUR.test(e.t));
  return t.length ? tagKey(t[0].s) : null;
}
function kalKlausurStatus(m){ const k = kalKlausur(m); return !k ? "vorläufig" : k === examOf(m) ? "bestätigt" : "abweichend"; }

/* ---------- Laden ---------- */
let KAL_LAEUFT = false;
async function kalLaden(force){
  if(!LOCAL.cid || !hasToken() || KAL_LAEUFT) return;
  if(!force && KAL.at && Date.now() - new Date(KAL.at) < 15 * 60e3 && KAL.zustand === "ok") return;
  KAL_LAEUFT = true; if(!KAL.at) kalAnzeigen();
  try{
    const cl = await (await api(`${CAL_API}/users/me/calendarList?maxResults=250&fields=items(id,summary,summaryOverride,primary)`)).json();
    KAL.cals = (cl.items || []).map(c => ({id: c.id, name: (c.summaryOverride || c.summary || c.id).trim(), primary: !!c.primary}));
    if(!KAL.wahl || typeof KAL.wahl !== "object") KAL.wahl = {};
    // Vorbelegung: Kalender „FOM“ und „Studium“ (neue Kalender sonst aus)
    KAL.cals.forEach(c => { if(!(c.id in KAL.wahl)) KAL.wahl[c.id] = /^(fom|studium)\b/i.test(c.name) || (/\bfom\b/i.test(c.name) && !c.primary); });
    const von = plusTage(montag(new Date()), -7), bis = plusTage(von, 7 + 7 + 200);   // Vorwoche bis gut ein Semester voraus
    const ev = [];
    for(const c of KAL.cals.filter(c => KAL.wahl[c.id])){
      let tok = "";
      do{
        const r = await (await api(`${CAL_API}/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${qs(von.toISOString())}&timeMax=${qs(bis.toISOString())}&fields=nextPageToken,items(id,summary,start,end,location,status)${tok ? "&pageToken=" + qs(tok) : ""}`)).json();
        (r.items || []).filter(x => x.status !== "cancelled" && x.start && x.end).forEach(x => ev.push({id: x.id, c: c.id, t: String(x.summary || "(ohne Titel)").trim(), s: x.start.dateTime || x.start.date, e: x.end.dateTime || x.end.date, g: !x.start.dateTime, o: x.location || ""}));
        tok = r.nextPageToken || "";
      }while(tok);
    }
    KAL.ev = ev; KAL.at = new Date().toISOString(); KAL.von = tagKey(von); KAL.bis = tagKey(bis);
    KAL.zustand = KAL.cals.some(c => KAL.wahl[c.id]) ? "ok" : "keine"; KAL.meldung = "";
  }catch(e){
    const t = String(e.message || "");
    KAL.zustand = e.auth ? "anmelden" : e.net ? "offline" : e.status === 403 && /insufficient|scope/i.test(t) ? "recht"
      : e.status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|disabled/i.test(t) ? "api" : "fehler";
    KAL.meldung = t.replace(/^Drive /, "Kalender ").slice(0, 200);
    if(KAL.zustand === "fehler") console.error(e);
  }finally{
    KAL_LAEUFT = false; kalSpeichern(); kalAnzeigen();
  }
}
let KAL_SIG = "";
function kalAnzeigen(){
  if(["kalender", "data"].includes(VIEW)) softRender();
  else if(VIEW === "heute"){ const s = tileNaechste(); if(s !== KAL_SIG) softRender(); }
}
function kalFreigeben(){ KAL.zustand = "aus"; kalSpeichern(); login(); }   // fragt die zusätzlichen Kalenderrechte an
let KAL_GESTARTET = false;
function kalStart(){
  if(KAL_GESTARTET) return; KAL_GESTARTET = true;
  kalLaden(false);
  setInterval(() => { if(document.visibilityState === "visible" && hasToken()) kalLaden(false); }, 15 * 60e3);
  setInterval(() => { if(document.visibilityState === "visible" && kalAktiv() && ["heute", "kalender"].includes(VIEW)) kalAnzeigen(); }, 60e3);   // V-Zeit und „läuft“ aktuell halten
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && hasToken()) kalLaden(false); });
}

/* ---------- Bausteine ---------- */
function kalKlasse(e){ return e.m ? `mx-${e.m}` : e.eigen ? "mx-E" : "mx-X"; }
function kalBand(e, gross){
  const ort = kalOrt(e);
  if(e.g) return `<div class="kganz ${kalKlasse(e)}${e.eigen ? " eigen" : ""}"><span>ganztägig</span><strong>${esc(e.m ? kalName(e) : e.t)}</strong></div>`;
  const sub = e.m ? [e.m, kalDoz(e.m), ort].filter(Boolean).join(" · ") : [e.eigen ? kalCal(e.c).name || "eigener Termin" : "FOM", ort].filter(Boolean).join(" · ");
  return `<div class="kband ${kalKlasse(e)}${e.eigen ? " eigen" : ""}${gross ? " gross" : ""}">
    <span class="kzeit"><strong>${kalUhr(e.s)}</strong>${kalUhr(e.e)}</span>
    <span class="ktext"><strong>${esc(e.m ? kalName(e) : e.t)}</strong><span>${esc(sub)}</span></span></div>`;
}
function kalListe(tage){
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const out = []; let frei = [];
  const freiZu = () => { if(!frei.length) return; const a = frei[0], b = frei[frei.length - 1];
    out.push(`<div class="kfrei">${a === b ? `${TAGK[a.getDay()]} ${a.getDate()}.` : frei.length === 2 ? `${TAGK[a.getDay()]} ${a.getDate()}. und ${TAGK[b.getDay()]} ${b.getDate()}.` : `${TAGK[a.getDay()]} ${a.getDate()}. bis ${TAGK[b.getDay()]} ${b.getDate()}.`} · keine Termine</div>`); frei = []; };
  for(let i = 0; i < tage; i++){
    const d = plusTage(heute, i), t = kalTermine(d, plusTage(d, 1));
    if(!t.length){ frei.push(d); continue; }
    freiZu();
    out.push(`<div class="ktag"><strong>${TAGL[d.getDay()]}, ${d.getDate()}. ${MONL[d.getMonth()]}</strong><span>${kalRelTag(d)}</span></div>`);
    t.forEach(e => out.push(kalBand(e, false)));
  }
  freiZu();
  return out.join("");
}
let KAL_WOCHE = 0, KAL_SEL = null;
function kalWoche(){
  const mo = plusTage(montag(new Date()), KAL_WOCHE * 7), tage = [...Array(7)].map((_, i) => plusTage(mo, i));
  const alle = kalTermine(mo, plusTage(mo, 7)).filter(e => !e.g);
  // Zeitachse 08 bis 16 Uhr, bei früheren oder späteren Terminen erweitert
  let h0 = 8, h1 = 16;
  alle.forEach(e => { const s = kalDatum(e.s), z = kalDatum(e.e); if(tagKey(s) === tagKey(z) || z - s < 864e5){ h0 = Math.min(h0, s.getHours()); h1 = Math.max(h1, z.getHours() + (z.getMinutes() ? 1 : 0)); } });
  h1 = Math.min(24, Math.max(h1, h0 + 2));
  const pos = d => Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60) - h0) / (h1 - h0) * 100));
  const ticks = []; for(let h = h0; h <= h1; h += 2) ticks.push(h);
  const heute = tagKey(new Date());
  const zeilen = tage.map(d => {
    const k = tagKey(d), t = kalTermine(d, plusTage(d, 1)), ganz = t.filter(e => e.g), zeit = t.filter(e => !e.g);
    const bars = zeit.map(e => { const s = kalDatum(e.s) < d ? d : kalDatum(e.s), z = kalDatum(e.e) > plusTage(d, 1) ? plusTage(d, 1) : kalDatum(e.e);
      const l = pos(s), w = Math.max(4, (z >= plusTage(d, 1) ? 100 : pos(z)) - l);
      return `<button type="button" class="kbar ${kalKlasse(e)}${e.eigen ? " eigen" : ""}" style="left:${l.toFixed(1)}%;width:${w.toFixed(1)}%" data-ke="${esc(e.id)}" aria-pressed="${KAL_SEL === e.id}" title="${esc(kalUhr(e.s) + "–" + kalUhr(e.e) + " " + (e.m ? kalName(e) : e.t))}">${e.m ? esc(e.m) + (kalDoz(e.m) ? `<span class="kdoz"> · ${esc(kalDoz(e.m))}</span>` : "") : esc(e.t)}</button>`; }).join("");
    const gz = ganz.map(e => `<button type="button" class="kbar kgz ${kalKlasse(e)}${e.eigen ? " eigen" : ""}" data-ke="${esc(e.id)}" aria-pressed="${KAL_SEL === e.id}">${esc(e.m ? e.m : e.t)}</button>`).join("");
    return `<div class="kwz${k === heute ? " ist-heute" : ""}"><span class="kwt">${TAGK[d.getDay()]} ${d.getDate()}.${zeit.length && ganz.length ? `<em>+ ${ganz.length} ganztägig</em>` : ""}</span><div class="kwb${zeit.length || ganz.length ? "" : " leer"}">${bars}${gz && !zeit.length ? gz : ""}</div></div>`;
  }).join("");
  const so = tage[6], kw = isoWeek(mo);
  const titel = mo.getMonth() === so.getMonth() ? `${mo.getDate()}. bis ${so.getDate()}. ${MONL[so.getMonth()]}` : `${mo.getDate()}. ${MONL[mo.getMonth()]} bis ${so.getDate()}. ${MONL[so.getMonth()]}`;
  const sel = KAL_SEL ? kalTermine(plusTage(mo, -1), plusTage(mo, 8)).find(e => e.id === KAL_SEL) : null;
  const geladen = !KAL.bis || tagKey(mo) <= KAL.bis;
  return `<div class="kwnav"><button type="button" class="kwbtn" data-kw="-1" aria-label="Vorige Woche">${ICON.back}</button>
      <div><strong>${titel}</strong><span>Woche ${kw}${KAL_WOCHE === 0 ? " · diese Woche" : KAL_WOCHE === 1 ? " · nächste Woche" : ""}</span></div>
      <button type="button" class="kwbtn" data-kw="1" aria-label="Nächste Woche"><svg class="ico" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></div>
    <div class="kwbox"><div class="kwz kwachse"><span class="kwt"></span><div class="kwa">${ticks.map(h => `<span style="left:${((h - h0) / (h1 - h0) * 100).toFixed(1)}%">${pad2(h)}</span>`).join("")}</div></div>${zeilen}</div>
    ${geladen ? "" : `<p class="hint">Diese Woche liegt außerhalb des geladenen Zeitraums.</p>`}
    ${sel ? `<div class="kdet ${kalKlasse(sel)}"><strong>${esc(sel.m ? kalName(sel) : sel.t)}</strong><span>${TAGL[kalDatum(sel.s).getDay()]}, ${fmtDate(tagKey(sel.s))}${sel.g ? " · ganztägig" : ` · ${kalUhr(sel.s)} bis ${kalUhr(sel.e)}`}</span><span>${esc([sel.m ? kalDoz(sel.m) : "", kalOrt(sel), kalCal(sel.c).name].filter(Boolean).join(" · "))}</span></div>` : ""}
    ${kalLegende()}`;
}
function kalLegende(){
  const it = (cls, l) => `<span><i class="${cls}"></i>${l}</span>`;
  return `<div class="kleg">${erfModule().map(m => it("mx-" + m, m)).join("")}${it("mx-E eigen", "eigener Termin")}</div>`;
}
function kalHinweis(){
  if(!LOCAL.cid) return "";
  if(!hasToken()) return kalAktiv() ? `<div class="note">Nicht angemeldet. Angezeigt wird der Stand vom ${fmtDT(KAL.at)}.</div>` : "";
  switch(KAL.zustand){
    case "recht": return `<div class="note">Für den Kalender braucht die App einmal dein Okay zum Lesen der Termine. <a href="#" data-kalok>Kalender freigeben</a> (Google fragt nach „Termine ansehen“ und „Liste der Kalender ansehen“)</div>`;
    case "api": return `<div class="warn">Die Google Calendar API ist im Projekt „Klausurtrainer“ noch nicht eingeschaltet: console.cloud.google.com › APIs und Dienste › Bibliothek › „Google Calendar API“ › Aktivieren. Danach <a href="#" data-kalneu>neu laden</a>.</div>`;
    case "keine": return `<div class="note">Kein Kalender „FOM“ oder „Studium“ gefunden. In Google Kalender das FOM-Abo „FOM“ nennen und einen Kalender „Studium“ anlegen, oder unter <a href="#" data-go="data">Einstellungen</a> die Kalender wählen.</div>`;
    case "fehler": return `<div class="warn">Kalender nicht geladen: ${esc(KAL.meldung)}. <a href="#" data-kalneu>Erneut versuchen</a></div>`;
    case "offline": return kalAktiv() ? `<div class="note">Ohne Netz. Stand vom ${fmtDT(KAL.at)}.</div>` : `<div class="note">Ohne Netz, der Kalender wird geladen, sobald du online bist.</div>`;
    default: return !kalAktiv() ? `<div class="note">${KAL_LAEUFT ? "Kalender wird geladen …" : `Kalender noch nicht geladen. <a href="#" data-kalneu>Jetzt laden</a>`}</div>` : "";
  }
}
function kalVerdrahten(root = main){
  root.querySelectorAll("[data-kalok]").forEach(a => a.onclick = ev => { ev.preventDefault(); kalFreigeben(); });
  root.querySelectorAll("[data-kalneu]").forEach(a => a.onclick = ev => { ev.preventDefault(); kalLaden(true); });
  root.querySelectorAll("[data-kn]").forEach(b => b.onclick = () => { ERF.modul = b.dataset.kn; erfNotizOeffnen(); });
  root.querySelectorAll("[data-kf]").forEach(b => b.onclick = () => { ERF.modul = b.dataset.kf; $("#camIn").click(); });
}

/* ---------- Ansicht Kalender ---------- */
// 1.6.1: Passt „M4 · Finkbeiner“ nicht in den Balken der Woche (schmales Handy, kurzer Termin), steht nur „M4“ da.
// Der volle Name steht im Tooltip und nach Antippen in der Zeile darunter.
function kalBalkenPassen(){
  main.querySelectorAll(".kbar .kdoz").forEach(s => { s.hidden = false; const b = s.parentElement; if(b.scrollWidth > b.clientWidth + 1) s.hidden = true; });
}
window.addEventListener("resize", () => { if(typeof VIEW !== "undefined" && VIEW === "kalender") kalBalkenPassen(); });
function viewKalender(){
  const ans = UI.kalAnsicht === "woche" ? "woche" : "liste";
  const stand = KAL.at ? ` · Stand ${new Date(KAL.at).toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit"})}` : "";
  main.innerHTML = `${syncBanner()}<div class="kal">
    <header class="khead"><div class="krow"><h1>Kalender</h1>
      <div class="kseg" role="group" aria-label="Ansicht"><button type="button" data-ka="liste" aria-pressed="${ans === "liste"}">Liste</button><button type="button" data-ka="woche" aria-pressed="${ans === "woche"}">Woche</button></div></div>
      <span class="ksub">Nächste 14 Tage · aus Google Kalender, nur lesen${stand}</span></header>
    ${kalHinweis()}
    ${kalAktiv() ? `<div class="kcols" data-ansicht="${ans}">
      <section class="kliste" aria-label="Nächste 14 Tage"><span class="kicker kpc">Nächste 14 Tage</span>${kalListe(14)}</section>
      <section class="kwoche" aria-label="Woche">${kalWoche()}</section></div>` : ""}
    <h2>Klausurtermine</h2>
    <div class="kkl">${modOrder().map(m => { const d = daysTo(examOf(m)), k = kalKlausur(m), st = kalKlausurStatus(m);
      return `<div class="kkr"><span class="kkn"><span class="dot" style="--mc:${MODULES[m].color}"></span> ${m} ${esc(MODULES[m].short)}</span><span class="kkd mono">${fmtDate(examOf(m))}</span>
        <span class="kkm">${d >= 0 ? `${d} ${d === 1 ? "Tag" : "Tage"}` : "vorbei"} · ${st === "bestätigt" ? "bestätigt (FOM)" : st === "abweichend" ? `FOM nennt ${fmtDate(k)} <button class="btn link" type="button" data-kx="${m}" data-kd="${k}">übernehmen</button>` : "vorläufig"}</span></div>`; }).join("")}
      <div class="kkr"><span class="kkn"><span class="dot" style="--mc:var(--m4)"></span> M4 ${esc(KURSE.M4.short)}</span><span class="kkd">Essay</span><span class="kkm">Abgabe laut Studienbuch</span></div></div>`;
  wireBanner(); kalVerdrahten(); kalBalkenPassen();
  main.querySelectorAll("[data-ka]").forEach(b => b.onclick = () => { UI.kalAnsicht = b.dataset.ka; saveUI(); viewKalender(); });
  main.querySelectorAll("[data-kw]").forEach(b => b.onclick = () => { KAL_WOCHE += Number(b.dataset.kw); KAL_SEL = null; viewKalender(); });
  main.querySelectorAll("[data-ke]").forEach(b => b.onclick = () => { KAL_SEL = KAL_SEL === b.dataset.ke ? null : b.dataset.ke; viewKalender(); });
  main.querySelectorAll("[data-kx]").forEach(b => b.onclick = () => { SET.exams[b.dataset.kx] = b.dataset.kd; SET.upd = Date.now(); changed(); toast(`Klausurtermin ${b.dataset.kx} auf ${fmtDate(b.dataset.kd)} gesetzt.`); viewKalender(); });
  kalLaden(false);
}

/* ---------- Kachel „Als Nächstes“ auf Heute (H2, Design A) ---------- */
function tileNaechste(){
  if(!kalAktiv()) return "";
  const lv = kalLaeuft(), nx = lv || kalNaechste();
  if(!nx) return `<section class="tile" aria-label="Als Nächstes"><span class="kicker">Als Nächstes</span><div class="card" style="margin:0"><p class="small muted" style="margin:0">Keine Termine in den nächsten 14 Tagen.</p></div></section>`;
  const m = nx.m, s = kalDatum(nx.s), z = kalDatum(nx.e), ort = kalOrt(nx);
  const danach = kalNaechste(nx), dn = danach ? `danach ${tagKey(danach.s) === tagKey(nx.s) ? "" : TAGK[kalDatum(danach.s).getDay()] + " "}${kalUhr(danach.s)} · ${esc(danach.m ? danach.m + (kalDoz(danach.m) ? " " + kalDoz(danach.m) : "") : danach.t)}` : "";
  const kopf = lv ? `<div class="nxrow"><span>${TAGK[s.getDay()]} ${pad2(s.getDate())}.${pad2(s.getMonth() + 1)}. · ${kalUhr(s)} bis ${kalUhr(z)}</span><strong class="nxv">V ${kalVZeit(nx)}</strong></div>`
    : `<div class="nxrow"><span>${TAGK[s.getDay()]} ${pad2(s.getDate())}.${pad2(s.getMonth() + 1)}. · ${kalUhr(s)}</span><span>${tagKey(s) === tagKey(new Date()) ? `in ${kalDauer(Math.max(1, Math.round((s - Date.now()) / 60e3)))}` : kalRelTag(s)}</span></div>`;
  const rest = lv ? Math.max(0, Math.round((z - Date.now()) / 60e3)) : 0, pct = lv ? Math.round((Date.now() - s) / (z - s) * 100) : 0;
  const html = `<section class="tile" aria-label="${lv ? "Laufende Vorlesung" : "Nächster Termin"}">
    <span class="kicker">${lv ? "Jetzt · Vorlesung läuft" : "Als Nächstes"}</span>
    <div class="nx ${kalKlasse(nx)}${nx.eigen && !m ? " eigen" : ""}">${m ? MOTIF[m] || "" : ""}
      ${kopf}
      <strong class="nxt">${esc(m ? kalName(nx) : nx.t)}</strong>
      <span class="nxs">${esc([m ? kalDoz(m) : (nx.eigen ? kalCal(nx.c).name : ""), ort].filter(Boolean).join(" · "))}${lv ? ` · noch ${kalDauer(rest)}` : ""}</span>
      ${lv ? `<div class="nxp" role="progressbar" aria-label="Verlauf" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        ${m ? `<div class="nxb"><button type="button" class="btn" data-kn="${m}">Notiz</button><button type="button" class="btn ghost" data-kf="${m}">Foto</button></div>` : ""}` : ""}
    </div>
    <div class="nxd"><span>${dn}</span><a href="#" data-go="kalender">Kalender</a></div>
  </section>`;
  return html;
}
function kalHeuteHinweis(){ return hasToken() && ["recht", "api"].includes(KAL.zustand) ? kalHinweis() : ""; }

/* ---------- Einstellungen: Abschnitt „Kalender“ ---------- */
function kalEinstellungen(sec){
  const kurse = new Map();
  (KAL.ev || []).forEach(e => { const m = kalModul(e), k = m || e.t; if(!kurse.has(k)) kurse.set(k, {k, m, t: e.t, n: 0, eigen: kalEigen(e)}); kurse.get(k).n++; });
  const liste = [...kurse.values()].sort((a, b) => (a.m || "Z" + a.t).localeCompare(b.m || "Z" + b.t));
  const sw = () => `<span class="ksw" aria-hidden="true"><i></i></span>`;
  sec.innerHTML = `<h2>Kalender</h2>
    <div class="card">
      <p>${!LOCAL.cid ? "Google ist noch nicht eingerichtet." : !hasToken() ? "Zum Laden mit Google anmelden." : KAL.zustand === "ok" ? `Verbunden mit Google Kalender, nur lesen. Stand ${fmtDT(KAL.at)}.` : KAL.zustand === "recht" ? "Der Kalender ist noch nicht freigegeben." : KAL.zustand === "api" ? "Die Google Calendar API ist im Projekt noch nicht eingeschaltet." : KAL.zustand === "keine" ? "Kein Kalender ausgewählt." : KAL.zustand === "fehler" ? "Fehler: " + esc(KAL.meldung) : "Noch nicht geladen."}</p>
      <div class="row">${hasToken() ? `<button class="btn small ghost" type="button" data-kalneu>Neu laden</button>` : ""}${LOCAL.cid && ["recht", "aus", "anmelden"].includes(KAL.zustand) ? `<button class="btn small" type="button" data-kalok>Kalender freigeben</button>` : ""}</div>
      <p class="hint" style="margin-top:10px">Quellen: das Abo „FOM“ (Adresse aus dem Online-Campus, nur in Google gespeichert) und dein Kalender „Studium“ für Fristen und Lerntage. Die App liest nur und ändert nichts.</p>
      ${(KAL.cals || []).length ? `<h3 style="margin-top:14px">Angezeigte Kalender</h3><div class="klist">${KAL.cals.map(c => `<button type="button" role="switch" class="kswr" data-kc="${esc(c.id)}" aria-checked="${!!(KAL.wahl || {})[c.id]}"><span class="ktxt"><span>${esc(c.name)}</span><span class="small muted">${/fom/i.test(c.name) ? "Vorlesungen und Klausuren" : c.primary ? "dein Hauptkalender" : "eigene Termine"}</span></span>${sw()}</button>`).join("")}</div>` : ""}
      ${liste.length ? `<h3 style="margin-top:14px">Kurse anzeigen</h3><div class="klist">${liste.map(k => `<div class="kswr ${k.m ? "mx-" + k.m : k.eigen ? "mx-E" : "mx-X"}"><span class="kswatch" aria-hidden="true"></span><span class="ktxt"><span>${esc(k.m ? `${k.m} ${MODULES[k.m] ? MODULES[k.m].name : KURSE[k.m] ? KURSE[k.m].name : ""}` : k.t)}</span><span class="small muted">${k.n} ${k.n === 1 ? "Termin" : "Termine"}${k.m ? "" : k.eigen ? " · eigener Termin" : " · ohne Modulzuordnung"}</span>
          ${k.m && !UI.kalZu[k.t] ? "" : `<select data-kzu="${esc(k.t)}" aria-label="Modul für ${esc(k.t)}"><option value="">automatisch</option><option value="-"${UI.kalZu[k.t] === "-" ? " selected" : ""}>kein Modul</option>${erfModule().map(m => `<option value="${m}"${UI.kalZu[k.t] === m ? " selected" : ""}>${m}</option>`).join("")}</select>`}</span>
          <button type="button" role="switch" class="kswb" data-kk="${esc(k.k)}" aria-checked="${!UI.kalAus[k.k]}" aria-label="${esc(k.m || k.t)} anzeigen">${sw()}</button></div>`).join("")}</div>
        <p class="hint">Zuordnung über den Titel im Kalender. Ein- und Ausblenden gilt nur für dieses Gerät (${DEVICE}).</p>` : ""}
    </div>`;
  kalVerdrahten(sec);
  sec.querySelectorAll("[data-kc]").forEach(b => b.onclick = () => { KAL.wahl = KAL.wahl || {}; KAL.wahl[b.dataset.kc] = !KAL.wahl[b.dataset.kc]; kalSpeichern(); b.setAttribute("aria-checked", KAL.wahl[b.dataset.kc]); kalLaden(true); });
  sec.querySelectorAll("[data-kk]").forEach(b => b.onclick = () => { const k = b.dataset.kk; if(UI.kalAus[k]) delete UI.kalAus[k]; else UI.kalAus[k] = true; saveUI(); b.setAttribute("aria-checked", !UI.kalAus[k]); });
  sec.querySelectorAll("[data-kzu]").forEach(s => s.onchange = () => { const t = s.dataset.kzu; if(s.value) UI.kalZu[t] = s.value; else delete UI.kalZu[t]; saveUI(); render(); });
}
