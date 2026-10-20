"use strict";
/* ============================================================
   Erfassen und Schnellnotiz (Lastenheft H3, H4) und Ablage Weg A (H7), ab Version 1.5.0
   - Foto: Modul und Art wählen, mehrere Fotos ergeben ein PDF (Bilder lange Kante ≤ 2.000 px, JPEG 0,8).
     Datei: unverändert mit eigener Endung. Name JJJJ-MM-TT_Mx_Art_NN.pdf. Ziel: Drive › Klausurtrainer › Eingang.
   - Schnellnotiz: alle Notizen eines Tages und Moduls fortlaufend in JJJJ-MM-TT_Mx_Notizen.md, Prüfungshinweise als „KR:“.
   - Ohne Netz oder ohne Anmeldung: Warteschlange im Browser (IndexedDB „studienbuch“), entfernt erst nach bestätigtem
     Hochladen. Fotos liegen schon vor dem Hochladen als Entwurf im Browser, damit nichts verloren geht.
   - Am PC: Übernahme aus Eingang nach <Studienordner>/00_Eingang, danach Drive-Datei nach Eingang/_übernommen.
     Nichts wird gelöscht oder überschrieben, bei gleichem Namen wird hochgezählt (_2, _3 …).
   - Die Lernlogik und der Lernstand werden hier nicht berührt.
   ============================================================ */
const ARTEN = ["Whiteboard", "Folie", "Mitschrift", "Aufgabe", "Dokument"];
const ERF_MAX = 2000, ERF_JPEG = 0.8, ERF_MULTI = 5 * 1048576;
const EINGANG = "Eingang", UEBERN = "_übernommen", ZIEL = "00_Eingang";
// Prüfungshinweise wie in AGENTS.md (Abschnitt 8 der Arbeitsweise)
const KR_WORTE = /(^|[^\p{L}])(kr|klausur|klausurrelevant|prüfung|prüfungsrelevant|kommt dran|wichtig|merken)(?=$|[^\p{L}])|!/iu;
const ICON_UP = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 19h14"/></svg>`;
const ICON_PEN = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/></svg>`;

// Module zum Erfassen: Klausurmodule und Kurse ohne Klausur (M4 steht nur in KURSE)
function erfModule(){ return ["M1", "M2", "M3", "M4"].filter(m => MODULES[m] || KURSE[m]); }
function erfName(m){ return MODULES[m] ? MODULES[m].short : KURSE[m] ? KURSE[m].short : m; }
function erfDoz(m){ return MODULES[m] ? MODULES[m].doz : KURSE[m] ? KURSE[m].doz : ""; }
const erfMB = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + " KB" : num(b / 1048576) + " MB";
const erfExt = n => ((/\.([A-Za-z0-9]{1,8})$/.exec(n || "") || [, "bin"])[1]).toLowerCase();

/* ---------- Eigene Datenbank: Warteschlange und Entwurf (getrennt von „kt2“, dort keine Versionsänderung) ---------- */
function sbDb(){ return new Promise((res, rej) => { const r = indexedDB.open("studienbuch", 1);
  r.onupgradeneeded = () => { const db = r.result; if(!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", {keyPath: "id"}); if(!db.objectStoreNames.contains("entwurf")) db.createObjectStore("entwurf"); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("Datenbank blockiert")); }); }
async function sbTx(stores, mode, fn){
  const db = await sbDb();
  return new Promise((res, rej) => {
    let out, tx;
    try{ tx = db.transaction(stores, mode); }catch(e){ db.close(); return rej(e); }
    const r = fn(tx);
    if(r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => { db.close(); res(out); };
    tx.onerror = tx.onabort = () => { db.close(); rej(tx.error || new Error("Speichern im Browser fehlgeschlagen")); };
  });
}
const qAlle = () => sbTx("queue", "readonly", tx => tx.objectStore("queue").getAll()).then(a => (a || []).sort((x, y) => x.id.localeCompare(y.id)));
const qPut = it => sbTx("queue", "readwrite", tx => tx.objectStore("queue").put(it));
const qDel = id => sbTx("queue", "readwrite", tx => tx.objectStore("queue").delete(id));
const entwurfLaden = () => sbTx("entwurf", "readonly", tx => tx.objectStore("entwurf").get("aktuell"));
const entwurfSpeichern = e => sbTx("entwurf", "readwrite", tx => tx.objectStore("entwurf").put(e, "aktuell"));
// Erfassungen einreihen und Entwurf leeren in EINEM Vorgang: entweder beides oder nichts
const qAusEntwurf = items => sbTx(["queue", "entwurf"], "readwrite", tx => { const q = tx.objectStore("queue"); items.forEach(it => q.put(it)); tx.objectStore("entwurf").delete("aktuell"); });
let ERF_SEQ = 0;
function erfId(){ return Date.now().toString(36).padStart(9, "0") + String(ERF_SEQ++ % 1000).padStart(3, "0") + Math.random().toString(36).slice(2, 5).padEnd(3, "0"); }
let Q_ANZ = 0, ERF_ENTWURF = null;
async function qZaehlen(){ try{ Q_ANZ = (await qAlle()).length; }catch(e){ Q_ANZ = 0; } erfStatus(); return Q_ANZ; }
async function entwurfPruefen(){ try{ const e = await entwurfLaden(); ERF_ENTWURF = e && ((e.seiten || []).length || (e.dateien || []).length) ? {modul: e.modul, seiten: (e.seiten || []).length, dateien: (e.dateien || []).length} : null; }catch(err){ ERF_ENTWURF = null; } return ERF_ENTWURF; }
// Browser bitten, die Daten dieser Seite nicht bei Speichermangel zu räumen (Android)
let ERF_PERSIST = false;
function erfPersist(){ if(ERF_PERSIST) return; ERF_PERSIST = true; try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }catch(e){} }

/* ---------- Bilder verkleinern und PDF schreiben (ohne fremde Dienste) ---------- */
async function bildVerkleinern(file){
  const bmp = await createImageBitmap(file, {imageOrientation: "from-image"});
  const s = Math.min(1, ERF_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  if(bmp.close) bmp.close();
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", ERF_JPEG));
  if(!blob || !blob.size) throw new Error("Bild konnte nicht umgewandelt werden");
  return {blob, w: c.width, h: c.height};
}
// PDF 1.4 mit je einer JPEG-Seite (DCTDecode), lange Seite 842 pt (A4-Höhe)
async function pdfAusSeiten(seiten){
  const enc = new TextEncoder(), teile = [], offs = []; let len = 0;
  const add = x => { const b = typeof x === "string" ? enc.encode(x) : x; teile.push(b); len += b.length; };
  const obj = (id, ...body) => { offs[id] = len; add(`${id} 0 obj\n`); body.forEach(add); add("\nendobj\n"); };
  add("%PDF-1.4\n"); add(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const n = seiten.length, kids = seiten.map((_, i) => `${3 + 3 * i} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for(let i = 0; i < n; i++){
    const s = seiten[i], k = 842 / Math.max(s.w, s.h), pw = (s.w * k).toFixed(2), ph = (s.h * k).toFixed(2);
    const bytes = new Uint8Array(await s.blob.arrayBuffer()), inhalt = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(3 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${4 + 3 * i} 0 R >> >> /Contents ${5 + 3 * i} 0 R >>`);
    obj(4 + 3 * i, `<< /Type /XObject /Subtype /Image /Width ${s.w} /Height ${s.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`, bytes, "\nendstream");
    obj(5 + 3 * i, `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
  }
  const anz = 3 + 3 * n, xref = len;
  add(`xref\n0 ${anz}\n0000000000 65535 f \n`);
  for(let i = 1; i < anz; i++) add(String(offs[i]).padStart(10, "0") + " 00000 n \n");
  add(`trailer\n<< /Size ${anz} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(teile, {type: "application/pdf"});
}

/* ---------- Drive: Eingang, Hochladen, Notizen anhängen ---------- */
let ERF_O = null;   // geprüfte Ordner-IDs, 10 Minuten gültig (spart Anfragen)
async function ordnerEingang(){
  if(ERF_O && Date.now() - ERF_O.t < 10 * 60e3 && LOCAL.ids.eingang === ERF_O.eingang && LOCAL.ids.uebern === ERF_O.uebern) return ERF_O;
  const root = await ensureFolder();
  if(!(LOCAL.ids.eingang && await checkId(LOCAL.ids.eingang))){ LOCAL.ids.eingang = await findFolder(EINGANG, root) || await createFolder(EINGANG, root); delete LOCAL.ids.uebern; persistLocal(); }
  if(!(LOCAL.ids.uebern && await checkId(LOCAL.ids.uebern))){ LOCAL.ids.uebern = await findFolder(UEBERN, LOCAL.ids.eingang) || await createFolder(UEBERN, LOCAL.ids.eingang); persistLocal(); }
  ERF_O = {eingang: LOCAL.ids.eingang, uebern: LOCAL.ids.uebern, t: Date.now()};
  return ERF_O;
}
async function driveListe(q, felder = "id,name,size"){
  let out = [], tok = "";
  do { const r = await (await api(`${DRIVE}/files?q=${qs(q)}&fields=nextPageToken,files(${felder})&pageSize=1000&spaces=drive${tok ? "&pageToken=" + qs(tok) : ""}`)).json(); out = out.concat(r.files || []); tok = r.nextPageToken || ""; } while(tok);
  return out;
}
// Nächste freie Nummer NN für Tag, Modul und Art (sieht Eingang und _übernommen; ohne Namenssuche von Drive, die nur Wortanfänge findet)
async function naechsteNummer(prefix, o){
  const liste = await driveListe(`('${o.eingang}' in parents or '${o.uebern}' in parents) and trashed=false`, "id,name");
  let max = 0; const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d{2,})(?:_\\d+)?\\.");
  liste.forEach(f => { const m = re.exec(f.name); if(m) max = Math.max(max, Number(m[1])); });
  return String(max + 1).padStart(2, "0");
}
async function driveHochladen(name, blob, mime, parent){
  const meta = {name, parents: [parent], mimeType: mime};
  let res;
  if(blob.size <= ERF_MULTI){
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(meta)], {type: "application/json"}));
    fd.append("file", blob, name);
    res = await (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,name,size`, {method: "POST", body: fd})).json();
  }else{
    // Große Dateien (über 5 MB): fortsetzbares Hochladen, wie von Google vorgesehen
    const r = await api(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size`, {method: "POST",
      headers: {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(blob.size)}, body: JSON.stringify(meta)});
    const ziel = r.headers.get("Location"); if(!ziel) throw new Error("Drive hat keine Upload-Adresse geliefert");
    res = await (await api(ziel, {method: "PUT", headers: {"Content-Type": mime}, body: blob})).json();
  }
  if(!res || !res.id) throw new Error("Drive hat das Hochladen nicht bestätigt");
  if(res.size != null && Number(res.size) !== blob.size) throw new Error(`Drive meldet ${res.size} statt ${blob.size} Byte`);
  return res;
}
function notizZeile(n){ return `- ${n.zeit}${n.v ? ` · V ${n.v}` : ""} · ${n.kr ? "KR: " : ""}${String(n.text).trim().replace(/\r?\n/g, "\n  ")}\n`; }
async function notizAnhaengen(it, o){
  const name = `${it.datum}_${it.modul}_Notizen.md`, zeile = notizZeile(it);
  const f = (await driveListe(`name='${name}' and '${o.eingang}' in parents and trashed=false`, "id,name"))[0];
  if(f){
    const alt = await (await api(`${DRIVE}/files/${f.id}?alt=media`)).text();
    if(alt.includes(zeile)) return name;   // schon angehängt (Antwort ging beim letzten Mal verloren): nicht doppelt
    const neu = alt + (alt.endsWith("\n") ? "" : "\n") + zeile;
    await api(`${UPLOAD}/files/${f.id}?uploadType=media&fields=id`, {method: "PATCH", headers: {"Content-Type": "text/markdown; charset=utf-8"}, body: neu});
    return name;
  }
  const kopf = `# Notizen ${it.modul} ${erfName(it.modul)}, ${fmtDate(it.datum)}\n\nQuelle: Schnellnotiz im Studienbuch. Zeilen mit „KR:“ sind Prüfungshinweise.\n\n`;
  await driveHochladen(name, new Blob([kopf + zeile], {type: "text/markdown"}), "text/markdown", o.eingang);
  return name;
}

/* ---------- Warteschlange abarbeiten ---------- */
let Q_LAEUFT = false, Q_NOCHMAL = false, Q_FEHLER = "";
async function qAbarbeiten(){
  if(Q_LAEUFT){ Q_NOCHMAL = true; return; }
  if(!LOCAL.cid || !hasToken()){ await qZaehlen(); erfAnzeigen(); return; }
  Q_LAEUFT = true; Q_FEHLER = ""; let n = 0, nDatei = 0;
  try{
    const liste = await qAlle();
    if(liste.length){
      const o = await ordnerEingang();
      for(const it of liste){
        try{
          if(it.kind === "notiz"){ await notizAnhaengen(it, o); notizStatus(it.id, "drive"); }
          else{
            const prefix = `${it.datum}_${it.modul}_${it.art}_`;
            const name = prefix + await naechsteNummer(prefix, o) + "." + it.ext;
            await driveHochladen(name, it.blob, it.mime, o.eingang);
            erfLog({name, at: new Date().toISOString(), seiten: it.seiten || 0, groesse: it.blob.size, original: it.original || ""});
            nDatei++;
          }
          await qDel(it.id);          // erst nach bestätigtem Hochladen entfernen (H3)
          n++;
        }catch(e){
          if(e.auth || e.net) throw e;
          // Fehler bei einer einzelnen Erfassung: sie bleibt in der Warteschlange, die übrigen laufen weiter
          if(e.status === 404) ERF_O = null;
          it.fehler = (it.fehler || 0) + 1; it.meldung = String(e.message || e).slice(0, 200);
          try{ await qPut(it); }catch(_){}
          Q_FEHLER = "Fehler beim Hochladen"; console.error(e);
        }
        await qZaehlen();
      }
    }
    // In der Schnellnotiz zeigt die Liste „in Drive“, dort keine zusätzliche Meldung je Notiz
    if(n && (nDatei || VIEW !== "notiz")) toast(n === 1 ? "Erfassung in Drive gespeichert." : `${n} Erfassungen in Drive gespeichert.`);
  }catch(e){
    if(e.status === 404) ERF_O = null;
    Q_FEHLER = e.auth ? "Anmeldung nötig" : e.net ? "ohne Netz" : (e.message || "Fehler");
    if(!e.auth && !e.net) console.error(e);
  }finally{
    Q_LAEUFT = false; await qZaehlen(); erfAnzeigen();
    if(Q_NOCHMAL){ Q_NOCHMAL = false; setTimeout(qAbarbeiten, 300); }
  }
}
async function qEinreihen(it){
  it.id = it.id || erfId();
  await qPut(it); erfPersist(); await qZaehlen();
  qAbarbeiten();
  return it.id;
}
function erfLog(e){ const l = lsGet("ablage", []); l.unshift(e); lsSet("ablage", l.slice(0, 50)); }

/* ---------- Anzeige aktualisieren, ohne laufende Eingaben zu stören ---------- */
let ERF_SIG = "";
function erfAnzeigen(){
  erfStatus();
  if(VIEW === "notiz") notizStatusMalen();
  else if(VIEW === "heute" && erfHinweise() !== ERF_SIG) softRender();
}

/* ---------- Erfassen-Fenster (Auswahl): Modul, Foto, Datei, Notiz ---------- */
let ERF = {modul: null, kr: false, entwurf: ""}, ERF_RET = null;
function erfModulStart(){ const m = ERF.modul || UI.erfModul || modOrder()[0] || "M1"; return erfModule().includes(m) ? m : "M1"; }
function erfStatus(){
  const el = $("#capQueue"); if(!el) return;
  el.hidden = !Q_ANZ;
  el.querySelector("span").textContent = `${Q_ANZ} ${Q_ANZ === 1 ? "Erfassung wartet" : "Erfassungen warten"} auf ${!LOCAL.cid ? "Google-Einrichtung" : !hasToken() ? "Anmeldung" : Q_FEHLER === "ohne Netz" ? "Netz" : "Hochladen"}${Q_FEHLER && Q_FEHLER !== "ohne Netz" ? ` (${Q_FEHLER})` : ""}`;
  const en = $("#capEntwurf");
  if(en){ en.hidden = !ERF_ENTWURF; if(ERF_ENTWURF) en.querySelector("span").textContent = `Entwurf ${ERF_ENTWURF.modul}: ${erfEntwurfText(ERF_ENTWURF)}, noch nicht hochgeladen`; }
}
function erfEntwurfText(e){ return [e.seiten ? `${e.seiten} ${e.seiten === 1 ? "Foto" : "Fotos"}` : "", e.dateien ? `${e.dateien} ${e.dateien === 1 ? "Datei" : "Dateien"}` : ""].filter(Boolean).join(", "); }
async function erfSheetMalen(neu){
  await entwurfPruefen();
  if(neu && ERF_ENTWURF) ERF.modul = ERF_ENTWURF.modul;   // Entwurf vorhanden: beim Öffnen dessen Modul vorwählen
  const m = erfModulStart(); ERF.modul = m;
  $("#capMods").innerHTML = erfModule().map(x => `<button type="button" class="capMod mx-${x}" data-cm="${x}" aria-pressed="${x === m}" aria-label="${x} ${esc(erfName(x))}">${x}</button>`).join("");
  $("#capMods").querySelectorAll("[data-cm]").forEach(b => b.onclick = () => { ERF.modul = b.dataset.cm; UI.erfModul = ERF.modul; saveUI(); erfSheetMalen(false); });
  $("#capInfo").innerHTML = `${esc(erfName(m))}${erfDoz(m) ? " · " + esc(erfDoz(m)) : ""}${!LOCAL.cid ? ` · <span class="warnText">Google Drive ist noch nicht eingerichtet, Erfassungen bleiben vorerst in diesem Browser.</span>` : ""}`;
  $("#capList").hidden = true;
  erfStatus();
}
// Rücksprung merken: nur wenn wir nicht schon in „erf“ oder „notiz“ sind (sonst bleibt der ursprüngliche Ausgangspunkt)
function erfZiel(v){ if(!["erf", "notiz"].includes(VIEW)) ERF_RET = VIEW; else if(!ERF_RET) ERF_RET = "heute"; VIEW = v; }
function erfZurueck(){ const r = ERF_RET || "heute"; ERF_RET = null; if(r === "train") go("train", {keep: true}); else go(r); }
async function erfDateienWaehlen(liste, quelle){
  const files = [...(liste || [])]; if(!files.length) return;
  let e;
  try{
    e = (await entwurfLaden()) || null;
  }catch(err){ toast("Speichern im Browser nicht möglich: " + err.message); return; }
  const m = erfModulStart();
  if(!e) e = {modul: m, art: quelle === "foto" ? "Whiteboard" : "Dokument", datum: todayStr(), seiten: [], dateien: []};
  e.modul = m; e.seiten = e.seiten || []; e.dateien = e.dateien || []; e.datum = e.datum || todayStr();
  let fehl = 0;
  for(const f of files){
    if(quelle === "foto" && /^image\//.test(f.type)){
      try{ e.seiten.push(await bildVerkleinern(f)); }
      catch(err){ fehl++; e.dateien.push({blob: f, name: f.name, mime: f.type || "application/octet-stream"}); }   // nicht lesbar: unverändert behalten
    }else e.dateien.push({blob: f, name: f.name || "Datei", mime: f.type || "application/octet-stream"});
  }
  try{ await entwurfSpeichern(e); erfPersist(); }   // sofort sichern, bevor etwas anderes passiert
  catch(err){ toast("Speichern im Browser fehlgeschlagen: " + err.message); return; }
  if(fehl) toast(`${fehl} ${fehl === 1 ? "Bild ließ" : "Bilder ließen"} sich nicht umwandeln und ${fehl === 1 ? "wird" : "werden"} unverändert hochgeladen.`);
  ERF_ENTWURF = {modul: e.modul, seiten: e.seiten.length, dateien: e.dateien.length};
  closeSheet(); erfZiel("erf"); render(); window.scrollTo(0, 0);
}
function erfEntwurfOeffnen(){ closeSheet(); erfZiel("erf"); render(); window.scrollTo(0, 0); }
function erfNotizOeffnen(){ closeSheet(); erfZiel("notiz"); render(); window.scrollTo(0, 0); }
async function erfListeZeigen(){
  const box = $("#capList"); if(!box) return;
  if(!box.hidden){ box.hidden = true; return; }
  let l = []; try{ l = await qAlle(); }catch(e){}
  box.innerHTML = `<ul class="qlist">${l.map(it => `<li><span>${it.kind === "notiz" ? `${it.datum}_${it.modul}_Notizen.md · ${esc(it.zeit)}` : `${it.datum}_${it.modul}_${esc(it.art)}_NN.${esc(it.ext)}${it.seiten ? ` · ${it.seiten} S.` : ""}`}</span><span class="muted">${it.blob ? erfMB(it.blob.size) : ""}${it.meldung ? ` · <span class="warnText">${esc(it.meldung)}</span>` : ""}</span></li>`).join("") || "<li>Nichts offen.</li>"}</ul>
    <div class="row">${!LOCAL.cid ? `<button class="btn small" type="button" data-capgo="data">Google einrichten</button>` : !hasToken() ? `<button class="btn small" type="button" id="capLogin">Mit Google anmelden</button>` : `<button class="btn small" type="button" id="capRetry">Jetzt hochladen</button>`}</div>
    <p class="hint" style="margin:6px 0 0">Bleibt im Browser, bis Drive das Hochladen bestätigt hat. Nichts wird gelöscht.</p>`;
  box.hidden = false;
  const r = $("#capRetry"); if(r) r.onclick = () => { qAbarbeiten(); box.hidden = true; toast("Wird hochgeladen …"); };
  const li = $("#capLogin"); if(li) li.onclick = () => { closeSheet(); login(); };
  box.querySelectorAll("[data-capgo]").forEach(b => b.onclick = () => go(b.dataset.capgo));
}

/* ---------- Ansicht „Prüfen und hochladen“ ---------- */
let ERF_URLS = [], ERF_TOK = 0, ERF_NR = {}, ERF_NR_LAEUFT = {};
async function viewErf(){
  const tok = ++ERF_TOK;
  document.body.classList.add("focus");
  let e = null; try{ e = await entwurfLaden(); }catch(err){}
  if(tok !== ERF_TOK || VIEW !== "erf") return;
  ERF_URLS.forEach(u => URL.revokeObjectURL(u)); ERF_URLS = [];
  if(!e || (!(e.seiten || []).length && !(e.dateien || []).length)){
    ERF_ENTWURF = null;
    main.innerHTML = `<div class="card"><p>Nichts zum Hochladen.</p><button class="btn" id="erfZur" type="button">Zurück</button></div>`; $("#erfZur").onclick = erfZurueck; return;
  }
  const m = e.modul, n = e.seiten.length, d = e.dateien || [], datum = e.datum || todayStr();
  const groesse = e.seiten.reduce((a, s) => a + s.blob.size, 0) + d.reduce((a, f) => a + f.blob.size, 0);
  const namen = [n ? "pdf" : null, ...d.map(f => erfExt(f.name))].filter(Boolean);
  const prefix = `${datum}_${m}_${e.art}_`, nr = ERF_NR[prefix] && Date.now() - ERF_NR[prefix].t < 60e3 ? ERF_NR[prefix] : null;
  const nameZeile = (x, i) => `<code>${esc(prefix)}${nr ? String(Number(nr.n) + i).padStart(2, "0") : "NN"}.${esc(x)}</code>`;
  main.innerHTML = `<div class="erf mx-${m}">
    <div class="erfhead"><button class="tback" id="erfBack" type="button" aria-label="Zurück">${ICON.back}</button><strong>${n ? "Fotos prüfen" : d.length === 1 ? "Datei prüfen" : "Dateien prüfen"}</strong><span>${m} · ${esc(erfDoz(m) || erfName(m))}</span></div>
    ${n ? `<section class="erfsec" aria-label="Seiten"><div class="tile-h"><span class="kicker">${n} ${n === 1 ? "Seite" : "Seiten"} · ein PDF</span><span class="small muted">${n > 1 ? "‹ schiebt nach vorn" : ""}</span></div>
      <div class="erfgrid">${e.seiten.map((s, i) => { const u = URL.createObjectURL(s.blob); ERF_URLS.push(u);
        return `<figure><img src="${u}" alt="Seite ${i + 1}"><figcaption>${i + 1}</figcaption>
          <button type="button" class="erfx" data-del="${i}" aria-label="Seite ${i + 1} entfernen">✕</button>${i ? `<button type="button" class="erfl" data-vor="${i}" aria-label="Seite ${i + 1} nach vorn">‹</button>` : ""}</figure>`; }).join("")}</div>
      <button type="button" class="erfadd" id="erfMehr"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Seite hinzufügen</button></section>` : ""}
    ${d.length ? `<section class="erfsec" aria-label="Dateien"><span class="kicker">${d.length} ${d.length === 1 ? "Datei" : "Dateien"} · unverändert</span><div class="erfdat">${d.map((f, i) => `<div><span>${esc(f.name)} <span class="muted small">(${erfMB(f.blob.size)})</span></span><button class="btn link" type="button" data-fdel="${i}">entfernen</button></div>`).join("")}</div></section>` : ""}
    <fieldset class="erfart"><legend class="kicker">Art</legend><div class="chips">${ARTEN.map(a => `<button type="button" class="chip" data-art="${a}" aria-pressed="${a === e.art}">${a}</button>`).join("")}</div></fieldset>
    <section class="erfname" aria-label="Ablage"><span class="kicker">Dateiname</span>
      ${namen.map(nameZeile).join("")}
      <span class="small muted">${n ? `${n} ${n === 1 ? "Seite" : "Seiten"} · ` : ""}ca. ${erfMB(groesse)} · Drive › Klausurtrainer › Eingang${DEVICE === "PC" ? ", von dort nach 00_Eingang" : ", am PC weiter nach 00_Eingang"}.${nr ? "" : " Die Nummer NN vergibt die App beim Hochladen."}</span></section>
    <div class="erffoot"><button class="btn big" id="erfGo" type="button">${ICON_UP}Hochladen</button></div>
  </div>`;
  const neu = async f => { try{ await entwurfSpeichern(Object.assign(e, f)); }catch(err){ toast("Speichern im Browser fehlgeschlagen: " + err.message); } await entwurfPruefen(); viewErf(); };
  $("#erfBack").onclick = () => { erfZurueck(); toast("Entwurf bleibt gespeichert. Über + Erfassen geht es weiter."); };
  main.querySelectorAll("[data-art]").forEach(b => b.onclick = () => neu({art: b.dataset.art}));
  main.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { e.seiten.splice(Number(b.dataset.del), 1); neu({}); });
  main.querySelectorAll("[data-vor]").forEach(b => b.onclick = () => { const i = Number(b.dataset.vor); [e.seiten[i - 1], e.seiten[i]] = [e.seiten[i], e.seiten[i - 1]]; neu({}); });
  main.querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => { e.dateien.splice(Number(b.dataset.fdel), 1); neu({}); });
  const mehr = $("#erfMehr"); if(mehr) mehr.onclick = () => $("#camIn").click();
  $("#erfGo").onclick = async () => {
    const btn = $("#erfGo"); btn.disabled = true; btn.textContent = "Wird vorbereitet …";
    try{
      const items = [];
      if(e.seiten.length){ const pdf = await pdfAusSeiten(e.seiten); items.push({kind: "datei", datum, modul: m, art: e.art, ext: "pdf", mime: "application/pdf", blob: pdf, seiten: e.seiten.length}); }
      for(const f of d) items.push({kind: "datei", datum, modul: m, art: e.art, ext: erfExt(f.name), mime: f.mime, blob: f.blob, original: f.name});
      items.forEach(it => it.id = erfId());
      await qAusEntwurf(items);            // einreihen und Entwurf leeren in einem Schritt
      ERF_ENTWURF = null; erfPersist(); await qZaehlen();
      toast(!LOCAL.cid ? "Gespeichert. Wird hochgeladen, sobald Google eingerichtet ist." : hasToken() ? "Wird hochgeladen …" : "Gespeichert. Wird hochgeladen, sobald du angemeldet und online bist.");
      qAbarbeiten();
      erfZurueck();
    }catch(err){ btn.disabled = false; btn.innerHTML = ICON_UP + "Hochladen"; toast("Nicht gespeichert: " + err.message); }
  };
  // Nummer vorab ermitteln, damit der Name vollständig angezeigt wird (nur mit Anmeldung, höchstens einmal je Minute)
  if(!nr && !ERF_NR_LAEUFT[prefix] && hasToken() && LOCAL.cid){
    ERF_NR_LAEUFT[prefix] = true;
    ordnerEingang().then(o => naechsteNummer(prefix, o)).then(x => { ERF_NR[prefix] = {n: x, t: Date.now()}; if(VIEW === "erf" && tok === ERF_TOK) viewErf(); })
      .catch(() => {}).finally(() => { ERF_NR_LAEUFT[prefix] = false; });
  }
}

/* ---------- Schnellnotiz (H4) ---------- */
function notizenAlle(){ return lsGet("notizen", {}); }
function notizStatus(id, s){ const N = notizenAlle(); let ch = false; for(const k in N) N[k].forEach(n => { if(n.id === id && n.s !== s){ n.s = s; ch = true; } }); if(ch) lsSet("notizen", N); }
function notizStatusMalen(){ const N = notizenAlle(); main.querySelectorAll("[data-nid]").forEach(el => { for(const k in N){ const n = N[k].find(x => x.id === el.dataset.nid); if(n){ el.textContent = n.s === "drive" ? "in Drive" : "wartet"; el.dataset.s = n.s; } } }); }
const uhrzeit = () => new Date().toLocaleTimeString("de-DE", {hour: "2-digit", minute: "2-digit"});
function viewNotiz(){
  document.body.classList.add("focus");
  const m = erfModulStart(), heute = todayStr(), key = `${heute}_${m}`, liste = notizenAlle()[key] || [];
  main.innerHTML = `<div class="notiz mx-${m}">
    <div class="nhead">${MOTIF[m] || ""}<div class="nrow"><button class="tback" id="nBack" type="button" aria-label="Zurück">${ICON.back}</button><span class="nsub">${m} · ${esc(erfDoz(m) || erfName(m))}</span></div>
      <strong>Notizen heute</strong></div>
    <div class="nliste">${liste.length ? liste.map(n => `<article><div class="nmeta"><span>${esc(n.zeit)}</span>${n.v ? `<b>V ${esc(n.v)}</b>` : ""}<span class="nst" data-nid="${esc(n.id)}" data-s="${esc(n.s)}">${n.s === "drive" ? "in Drive" : "wartet"}</span>${n.kr ? `<span class="nkr">KR</span>` : ""}</div><p>${esc(n.text)}</p></article>`).join("")
      : `<p class="hint">Noch keine Notiz zu ${m} heute.</p>`}
      <span class="small muted">Gespeichert in <code>${key}_Notizen.md</code> · Drive › Klausurtrainer › Eingang</span></div>
    <div class="nfoot"><label for="nText" class="kicker">Neue Notiz · ${uhrzeit()}</label>
      <textarea id="nText" rows="3" placeholder="Was hat der Dozent gesagt?">${esc(ERF.entwurf || "")}</textarea>
      <div class="nbtn"><button type="button" class="nkrbtn" id="nKr" aria-pressed="${!!ERF.kr}" title="Prüfungshinweis">KR</button><button type="button" class="btn" id="nSave">Speichern</button></div>
      <span class="tiny muted">KR gilt auch automatisch bei „Klausur“, „Prüfung“, „kommt dran“, „wichtig“, „merken“ oder „!“.</span></div>
  </div>`;
  notizStatusMalen();
  const ta = $("#nText"); ta.oninput = () => { ERF.entwurf = ta.value; };
  ta.onkeydown = ev => { if(ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)){ ev.preventDefault(); $("#nSave").click(); } };
  $("#nKr").onclick = () => { ERF.kr = !ERF.kr; $("#nKr").setAttribute("aria-pressed", ERF.kr); };
  $("#nBack").onclick = erfZurueck;
  $("#nSave").onclick = async () => {
    const text = ta.value.trim(); if(!text){ ta.focus(); return; }
    const btn = $("#nSave"); if(btn.disabled) return; btn.disabled = true;
    const zeit = uhrzeit(), kr = !!ERF.kr || KR_WORTE.test(text);
    const it = {kind: "notiz", datum: heute, modul: m, zeit, v: "", kr, text, id: erfId()};
    // Zuerst in die Liste im Browser, dann in die Warteschlange: so ist die Notiz sofort sichtbar und gesichert
    const NN = notizenAlle(); (NN[key] = NN[key] || []).push({id: it.id, zeit, v: "", kr, text, s: "wartet"});
    const grenze = numDay(dayNum(heute) - 30); for(const k in NN) if(k.slice(0, 10) < grenze) delete NN[k];   // Liste: 30 Tage (die Notizen selbst liegen in Drive)
    lsSet("notizen", NN);
    try{ await qEinreihen(it); }
    catch(err){ btn.disabled = false; toast("Notiz nicht gesichert: " + err.message + ". Text bleibt im Feld."); const N2 = notizenAlle(); N2[key] = (N2[key] || []).filter(x => x.id !== it.id); lsSet("notizen", N2); return; }
    ERF.entwurf = ""; ERF.kr = false;
    viewNotiz(); $("#nText").focus({preventScroll: true});
    const l = main.querySelector(".nliste article:last-of-type"); if(l) l.scrollIntoView({block: "nearest"});
  };
  if(DEVICE === "PC") ta.focus({preventScroll: true});
}

/* ---------- Übernahme am PC (H7): Eingang → Studienordner/00_Eingang ---------- */
let UEB = {zustand: "aus", warten: 0, letzte: 0, laeuft: false, hinweis: "", ordner: "", h: null};
async function uebHandle(){ try{ UEB.h = await idbGet("dir") || null; }catch(e){ UEB.h = null; } UEB.ordner = UEB.h ? UEB.h.name : ""; return UEB.h; }
async function uebernahme(interaktiv){
  if(DEVICE !== "PC" || !LOCAL.cid || !hasToken() || UEB.laeuft) return;
  if(!interaktiv && Date.now() - UEB.letzte < 60e3) return;
  UEB.laeuft = true; UEB.letzte = Date.now();
  let n = 0, fehl = 0;
  try{
    const o = await ordnerEingang();
    const liste = (await driveListe(`'${o.eingang}' in parents and trashed=false`, "id,name,size,mimeType"))
      .filter(f => !/^application\/vnd\.google-apps\./.test(f.mimeType || "")).sort((a, b) => a.name.localeCompare(b.name));
    UEB.warten = liste.length;
    if(!liste.length){ UEB.zustand = "leer"; return; }
    if(!window.showDirectoryPicker){ UEB.zustand = "kein-zugriff"; return; }
    const h = await uebHandle();
    if(!h){ UEB.zustand = "kein-ordner"; return; }
    let perm = await h.queryPermission({mode: "readwrite"});
    if(perm !== "granted" && interaktiv) perm = await h.requestPermission({mode: "readwrite"});
    if(perm !== "granted"){ UEB.zustand = "freigabe"; return; }
    let ziel;
    try{ ziel = await h.getDirectoryHandle(ZIEL); }   // nie anlegen: fehlt 00_Eingang, ist vermutlich der falsche Ordner gewählt
    catch(e){ if(e && (e.name === "NotFoundError" || e.name === "TypeMismatchError")){ UEB.zustand = "kein-eingang"; return; } throw e; }
    for(const f of liste){
      try{
        const blob = await (await api(`${DRIVE}/files/${f.id}?alt=media`)).blob();
        if(f.size != null && Number(f.size) !== blob.size) throw new Error(`${f.name}: unvollständig geladen`);
        const name = await freierName(ziel, f.name);
        const fh = await ziel.getFileHandle(name, {create: true});
        const w = await fh.createWritable(); await w.write(blob); await w.close();
        const pruef = await fh.getFile();
        if(pruef.size !== blob.size) throw new Error(`${name}: Größe stimmt nicht (${pruef.size} statt ${blob.size})`);
        // erst nach erfolgreichem Schreiben in Drive verschieben, nichts löschen
        await api(`${DRIVE}/files/${f.id}?addParents=${o.uebern}&removeParents=${o.eingang}&fields=id`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: "{}"});
        erfLog({name, at: new Date().toISOString(), uebernommen: true, groesse: blob.size, drive: f.name});
        n++; UEB.warten--;
      }catch(e){
        if(e.auth || e.net) throw e;
        fehl++; UEB.hinweis = e.message || String(e); console.error(e);
      }
    }
    UEB.zustand = fehl ? "fehler" : "ok";
    if(n) toast(`${n} ${n === 1 ? "Datei" : "Dateien"} nach ${ZIEL} übernommen.`);
  }catch(e){
    if(e.status === 404) ERF_O = null;
    UEB.zustand = e.auth ? "anmelden" : e.net ? "offline" : "fehler"; UEB.hinweis = e.message || "";
    if(!e.auth && !e.net) console.error(e);
  }finally{
    UEB.laeuft = false; erfAnzeigen();
  }
}
async function freierName(ordner, name){
  const p = /^(.*?)(\.[^.]*)?$/.exec(name), stamm = p[1], ext = p[2] || "";
  for(let i = 1; i < 1000; i++){
    const kand = i === 1 ? name : `${stamm}_${i}${ext}`;
    try{ await ordner.getFileHandle(kand); }
    catch(e){ if(e && e.name === "NotFoundError") return kand; if(e && e.name === "TypeMismatchError") continue; throw e; }
  }
  throw new Error("Kein freier Dateiname für " + name);
}
// Klick im Hinweis: Freigabe sofort anfragen (Brave verlangt dafür einen frischen Klick), dann übernehmen
async function uebFreigeben(){
  const h = UEB.h || await uebHandle();
  if(!h){ go("data"); return; }
  try{ if(await h.requestPermission({mode: "readwrite"}) !== "granted"){ toast("Ohne Schreibrecht bleiben die Dateien sicher in Drive."); UEB.zustand = "freigabe"; erfAnzeigen(); return; } }
  catch(e){ toast("Freigabe nicht möglich: " + e.message); return; }
  uebernahme(true);
}

/* ---------- Hinweise für „Heute“ ---------- */
function erfHinweise(){
  let h = "";
  if(ERF_ENTWURF) h += `<div class="note">Entwurf ${ERF_ENTWURF.modul} mit ${erfEntwurfText(ERF_ENTWURF)} ist noch nicht hochgeladen. <a href="#" id="entwurfGo">Fortsetzen</a></div>`;
  if(Q_ANZ) h += `<div class="note">${Q_ANZ} ${Q_ANZ === 1 ? "Erfassung wartet" : "Erfassungen warten"} auf Hochladen${!LOCAL.cid ? ". <a href=\"#\" data-go=\"data\">Google einrichten</a>" : !hasToken() ? ". <a href=\"#\" data-login>Mit Google anmelden</a>" : Q_FEHLER ? ` (${esc(Q_FEHLER)}). <a href="#" id="qNochmal">Erneut versuchen</a>` : "."}</div>`;
  if(DEVICE === "PC" && UEB.warten > 0){
    const w = `${UEB.warten} ${UEB.warten === 1 ? "Datei wartet" : "Dateien warten"} in Drive › Klausurtrainer › Eingang.`;
    if(UEB.zustand === "freigabe") h += `<div class="note">${w} <a href="#" id="uebGo">Nach ${ZIEL} übernehmen</a> (Brave fragt einmal nach dem Schreibrecht für ${esc(UEB.ordner || "den Studienordner")})</div>`;
    else if(UEB.zustand === "kein-ordner") h += `<div class="note">${w} Für die Übernahme nach ${ZIEL} einmal unter <a href="#" data-go="data">Einstellungen</a> „Inhalte nach Drive“ ausführen und den Studienordner wählen.</div>`;
    else if(UEB.zustand === "kein-eingang") h += `<div class="warn">${w} Im gewählten Ordner ${esc(UEB.ordner)} fehlt der Unterordner ${ZIEL}. Unter <a href="#" data-go="data">Einstellungen</a> „Inhalte nach Drive“ ausführen und den Studienordner selbst wählen. Die Dateien bleiben sicher in Drive.</div>`;
    else if(UEB.zustand === "kein-zugriff") h += `<div class="note">${w} Sie liegen am PC auch unter Meine Ablage\\Klausurtrainer\\Eingang. Damit die App sie selbst nach ${ZIEL} legt, in Brave unter brave://flags „File System Access API“ einschalten und Brave neu starten.</div>`;
    else if(UEB.zustand === "fehler") h += `<div class="warn">Übernahme nach ${ZIEL} unterbrochen: ${esc(UEB.hinweis)}. Die Dateien bleiben in Drive. <a href="#" id="uebGo">Erneut versuchen</a></div>`;
  }
  return h;
}
function erfHinweiseVerdrahten(){
  ERF_SIG = erfHinweise();
  const u = $("#uebGo"); if(u) u.onclick = ev => { ev.preventDefault(); uebFreigeben(); };
  const q = $("#qNochmal"); if(q) q.onclick = ev => { ev.preventDefault(); qAbarbeiten(); };
  const en = $("#entwurfGo"); if(en) en.onclick = ev => { ev.preventDefault(); erfEntwurfOeffnen(); };
}

/* ---------- Einstellungen: Abschnitt „Erfassen und Ablage“ ---------- */
async function erfEinstellungen(sec){
  const log = lsGet("ablage", []).slice(0, 5);
  let perm = "";
  if(DEVICE === "PC" && window.showDirectoryPicker){ const h = await uebHandle(); if(h){ try{ perm = await h.queryPermission({mode: "readwrite"}); }catch(e){ perm = "prompt"; } } }
  if(VIEW !== "data") return;
  sec.innerHTML = `<h2>Erfassen und Ablage</h2>
    <div class="card">
      <p>${Q_ANZ ? `${Q_ANZ} ${Q_ANZ === 1 ? "Erfassung wartet" : "Erfassungen warten"} auf Hochladen.` : "Keine Erfassung wartet."}${ERF_ENTWURF ? ` Entwurf ${ERF_ENTWURF.modul}: ${erfEntwurfText(ERF_ENTWURF)}.` : ""}</p>
      ${Q_ANZ && hasToken() ? `<button class="btn small" type="button" id="eqGo">Jetzt hochladen</button>` : ""}
      ${log.length ? `<table class="t" style="margin-top:8px">${log.map(x => `<tr><td class="small" style="white-space:nowrap">${fmtDT(x.at)}</td><td class="small">${esc(x.name)}${x.uebernommen ? ` → ${ZIEL}` : ""}</td></tr>`).join("")}</table>` : ""}
      ${DEVICE === "PC" ? `<p class="hint" style="margin-top:10px">Übernahme nach ${ZIEL}: ${!window.showDirectoryPicker ? "in Brave unter brave://flags „File System Access API“ einschalten." : !UEB.h ? "zuerst „Inhalte nach Drive“ ausführen und den Studienordner wählen." : perm === "granted" ? `automatisch nach ${esc(UEB.ordner)}\\${ZIEL}.` : `Schreibrecht für ${esc(UEB.ordner)} fehlt noch.`}</p>
        ${window.showDirectoryPicker && UEB.h && perm !== "granted" ? `<button class="btn small ghost" type="button" id="eqPerm">Schreibrecht erteilen</button>` : ""}` : ""}
      <p class="hint" style="margin-top:10px">Ziel ist Drive › Klausurtrainer › Eingang. Die App sieht dort nur Dateien, die sie selbst angelegt hat. Von Hand dort abgelegte Dateien übernimmt sie nicht.</p>
    </div>`;
  const g = $("#eqGo"); if(g) g.onclick = () => { qAbarbeiten(); toast("Wird hochgeladen …"); };
  const p = $("#eqPerm"); if(p) p.onclick = async () => { await uebFreigeben(); if(VIEW === "data") render(); };
}

/* ---------- Bedienelemente im Fenster und Start ---------- */
$("#capFoto").onclick = () => $("#camIn").click();
$("#capDatei").onclick = () => $("#fileIn").click();
$("#capNotiz").onclick = erfNotizOeffnen;
$("#capEntwurfGo").onclick = ev => { ev.preventDefault(); erfEntwurfOeffnen(); };
$("#capQueueGo").onclick = ev => { ev.preventDefault(); erfListeZeigen(); };
$("#camIn").addEventListener("change", ev => { const l = [...ev.target.files]; ev.target.value = ""; erfDateienWaehlen(l, "foto"); });
$("#fileIn").addEventListener("change", ev => { const l = [...ev.target.files]; ev.target.value = ""; erfDateienWaehlen(l, "datei"); });

// Anstoßen: beim Start, nach Anmeldung, bei Netz, beim Zurückkehren ins Fenster, minütlich
function erfAnstossen(){ return qAbarbeiten().then(() => uebernahme(false)); }
let ERF_GESTARTET = false;
async function erfStart(){
  if(ERF_GESTARTET) return; ERF_GESTARTET = true;
  await qZaehlen(); await entwurfPruefen();
  if(DEVICE === "PC") await uebHandle();
  if(VIEW === "heute") softRender();
  setInterval(() => { if(document.visibilityState === "visible" && hasToken() && (Q_ANZ || DEVICE === "PC")) erfAnstossen(); }, 60e3);
  window.addEventListener("online", () => { if(hasToken()) erfAnstossen(); });
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && hasToken()) erfAnstossen(); });
  if(hasToken()) erfAnstossen();
}
