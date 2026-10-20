"use strict";
/* ============================================================
   Erfassen und Schnellnotiz (Lastenheft H3, H4) und Ablage Weg A (H7), ab Version 1.5.0
   - Foto: Modul und Art wählen, mehrere Fotos ergeben ein PDF (Bilder lange Kante ≤ 2.000 px, JPEG 0,8).
     Datei: unverändert mit eigener Endung. Name als Vorschlag JJJJ-MM-TT_Mx_Art_NN, frei änderbar (ab 1.6.0).
   - Ziel ab 1.6.0: ein von der App angelegter Ordner „00_Eingang“, den Julian einmal in Drive in den Studienordner
     (Studium_Cloudkopie) verschiebt. Die App behält das Recht auf ihren Ordner, egal wo er liegt (drive.file).
   - Schnellnotiz: alle Notizen eines Tages und Moduls fortlaufend in JJJJ-MM-TT_Mx_Notizen.md, Prüfungshinweise als „KR:“.
   - Ohne Netz oder ohne Anmeldung: Warteschlange im Browser (IndexedDB „studienbuch“), entfernt erst nach bestätigtem
     Hochladen. Fotos liegen schon vor dem Hochladen als Entwurf im Browser, damit nichts verloren geht.
   - Was 1.5.0 noch in Klausurtrainer/Eingang abgelegt hat, verschiebt die App in Drive in den neuen Ordner.
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
let ERF_O = null;   // geprüfter Zielordner, 10 Minuten gültig (spart Anfragen)
let ABLAGE = {bekannt: false, verschoben: false, umgezogen: 0};
const FOLDER_MIME = "application/vnd.google-apps.folder";
async function ordnerMeta(id){ try{ const f = await (await api(`${DRIVE}/files/${id}?fields=id,trashed,parents`)).json(); return f.trashed ? null : f; }catch(e){ if(e.auth || e.net) throw e; return null; } }
// Zielordner „00_Eingang“: gemerkte ID, sonst der von der App angelegte Ordner dieses Namens (bevorzugt der verschobene),
// sonst neu in Klausurtrainer anlegen. Die App sieht nur eigene Ordner, ein fremder „00_Eingang“ wird nie benutzt.
async function ordnerEingang(){
  if(ERF_O && Date.now() - ERF_O.t < 10 * 60e3 && LOCAL.ids.ablage === ERF_O.ziel) return ERF_O;
  const root = await ensureFolder();
  let id = LOCAL.ids.ablage, meta = id ? await ordnerMeta(id) : null;
  if(!meta){
    const kand = (await driveListe(`name='${ZIEL}' and mimeType='${FOLDER_MIME}' and trashed=false`, "id,name,parents,createdTime"))
      .sort((a, b) => (((a.parents || []).includes(root) ? 1 : 0) - ((b.parents || []).includes(root) ? 1 : 0)) || String(a.createdTime || "").localeCompare(String(b.createdTime || "")));
    if(kand.length){ id = kand[0].id; meta = kand[0]; }
    else{ id = await createFolder(ZIEL, root); meta = {id, parents: [root]}; }
    LOCAL.ids.ablage = id; persistLocal();
  }
  ERF_O = {ziel: id, verschoben: !(meta.parents || []).includes(root), t: Date.now()};
  ABLAGE.bekannt = true; ABLAGE.verschoben = ERF_O.verschoben;
  return ERF_O;
}
// Umzug aus der Ablage von 1.5.0 (Klausurtrainer/Eingang) in den neuen Zielordner, einmal je Sitzung
let ERF_UMZUG = false;
async function altEingangUmziehen(o){
  if(ERF_UMZUG || !LOCAL.ids.eingang) return; ERF_UMZUG = true;
  if(!(await ordnerMeta(LOCAL.ids.eingang))) return;
  const liste = (await driveListe(`'${LOCAL.ids.eingang}' in parents and trashed=false`, "id,name,mimeType")).filter(f => f.mimeType !== FOLDER_MIME);
  for(const f of liste){
    await api(`${DRIVE}/files/${f.id}?addParents=${o.ziel}&removeParents=${LOCAL.ids.eingang}&fields=id`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body: "{}"});
    erfLog({name: f.name, at: new Date().toISOString(), umgezogen: true}); ABLAGE.umgezogen++;
  }
  if(liste.length) toast(`${liste.length} ${liste.length === 1 ? "Datei" : "Dateien"} aus der bisherigen Ablage nach ${ZIEL} verschoben.`);
}
const qStr = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function driveListe(q, felder = "id,name,size"){
  let out = [], tok = "";
  do { const r = await (await api(`${DRIVE}/files?q=${qs(q)}&fields=nextPageToken,files(${felder})&pageSize=1000&spaces=drive${tok ? "&pageToken=" + qs(tok) : ""}`)).json(); out = out.concat(r.files || []); tok = r.nextPageToken || ""; } while(tok);
  return out;
}
// Nächste freie Nummer NN für Tag, Modul und Art: Zielordner und alle eigenen Dateien mit diesem Anfang
// (auch die, die die Modulchats schon weiter einsortiert haben)
async function naechsteNummer(prefix, o){
  const a = await driveListe(`'${o.ziel}' in parents and trashed=false`, "id,name");
  let b = []; try{ b = await driveListe(`name contains '${qStr(prefix)}' and trashed=false`, "id,name"); }catch(e){ if(e.auth || e.net) throw e; }
  let max = 0; const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\d{2,})(?:_\\d+)?\\.");
  a.concat(b).forEach(f => { const m = re.exec(f.name); if(m) max = Math.max(max, Number(m[1])); });
  return String(max + 1).padStart(2, "0");
}
// Selbst gewählter Name: bei gleichem Namen im Zielordner _2, _3 … anhängen (nichts überschreiben)
async function freierDriveName(name, o){
  const p = /^(.*?)(\.[^.]*)?$/.exec(name), stamm = p[1], ext = p[2] || "";
  const vorhanden = new Set((await driveListe(`name contains '${qStr(stamm)}' and '${o.ziel}' in parents and trashed=false`, "id,name")).map(f => f.name));
  for(let i = 1; i < 1000; i++){ const k = i === 1 ? name : `${stamm}_${i}${ext}`; if(!vorhanden.has(k)) return k; }
  throw new Error("Kein freier Dateiname für " + name);
}
// Eingabe des Nutzers bereinigen: keine Zeichen, die Windows oder Drive verbieten, Endung nicht doppelt
function nameSauber(s, ext){
  let n = String(s || "").normalize("NFC").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  if(ext) n = n.replace(new RegExp("\\." + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), "");
  return n.replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 150);
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
  const f = (await driveListe(`name='${name}' and '${o.ziel}' in parents and trashed=false`, "id,name"))[0];
  if(f){
    const alt = await (await api(`${DRIVE}/files/${f.id}?alt=media`)).text();
    if(alt.includes(zeile)) return name;   // schon angehängt (Antwort ging beim letzten Mal verloren): nicht doppelt
    const neu = alt + (alt.endsWith("\n") ? "" : "\n") + zeile;
    await api(`${UPLOAD}/files/${f.id}?uploadType=media&fields=id`, {method: "PATCH", headers: {"Content-Type": "text/markdown; charset=utf-8"}, body: neu});
    return name;
  }
  const kopf = `# Notizen ${it.modul} ${erfName(it.modul)}, ${fmtDate(it.datum)}\n\nQuelle: Schnellnotiz im Studienbuch. Zeilen mit „KR:“ sind Prüfungshinweise.\n\n`;
  await driveHochladen(name, new Blob([kopf + zeile], {type: "text/markdown"}), "text/markdown", o.ziel);
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
      await altEingangUmziehen(o);
      for(const it of liste){
        try{
          if(it.kind === "notiz"){ await notizAnhaengen(it, o); notizStatus(it.id, "drive"); }
          else{
            let name;
            if(it.name){
              // eigener Name; ein stehen gelassenes „_NN“ wird durch die nächste Nummer ersetzt
              let n = it.name;
              if(n.includes("_NN")){ const pre = n.slice(0, n.indexOf("_NN") + 1); n = n.replace("_NN", "_" + await naechsteNummer(pre, o)); }
              name = await freierDriveName(n + "." + it.ext, o);
            }else{
              const prefix = `${it.datum}_${it.modul}_${it.art}_`;
              name = prefix + await naechsteNummer(prefix, o) + "." + it.ext;
            }
            await driveHochladen(name, it.blob, it.mime, o.ziel);
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
  const lv = typeof kalLaeuft === "function" ? kalLaeuft() : null;
  if(neu && ERF_ENTWURF) ERF.modul = ERF_ENTWURF.modul;   // Entwurf vorhanden: beim Öffnen dessen Modul vorwählen
  else if(neu && lv && lv.m && erfModule().includes(lv.m)) ERF.modul = lv.m;   // sonst Modul der laufenden Vorlesung (H3)
  const m = erfModulStart(); ERF.modul = m;
  const hint = $("#capHint");
  if(hint){ hint.hidden = !lv; if(lv) hint.innerHTML = `<span class="capLive" aria-hidden="true"></span><span><strong>Vorlesung läuft</strong> · ${esc(lv.m || "")} ${esc(lv.m ? erfDoz(lv.m) : lv.t)} · V ${kalVZeit(lv)}</span>`; }
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
  box.innerHTML = `<ul class="qlist">${l.map(it => `<li><span>${it.kind === "notiz" ? `${it.datum}_${it.modul}_Notizen.md · ${esc(it.zeit)}` : `${it.name ? esc(it.name) : `${it.datum}_${it.modul}_${esc(it.art)}_NN`}.${esc(it.ext)}${it.seiten ? ` · ${it.seiten} S.` : ""}`}</span><span class="muted">${it.blob ? erfMB(it.blob.size) : ""}${it.meldung ? ` · <span class="warnText">${esc(it.meldung)}</span>` : ""}</span></li>`).join("") || "<li>Nichts offen.</li>"}</ul>
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
  const prefix = `${datum}_${m}_${e.art}_`, nr = ERF_NR[prefix] && Date.now() - ERF_NR[prefix].t < 60e3 ? ERF_NR[prefix] : null;
  const vorschlag = i => prefix + (nr ? String(Number(nr.n) + i).padStart(2, "0") : "NN");
  // Je Ergebnisdatei ein Namensfeld: zuerst das PDF aus den Fotos, dann jede Datei. Leer oder unverändert = Vorschlag.
  const felder = (n ? [{key: "pdf", ext: "pdf", wert: e.pdfName}] : []).concat(d.map((f, i) => ({key: "f" + i, ext: erfExt(f.name), wert: f.nameNeu})));
  const nameZeile = (fl, i) => `<label class="erfnf"><span class="sr">Dateiname ${i + 1}</span><input type="text" data-nf="${fl.key}" value="${esc(fl.wert || vorschlag(i))}" data-vor="${esc(vorschlag(i))}" autocomplete="off" spellcheck="false" enterkeyhint="done"><span class="erfext">.${esc(fl.ext)}</span></label>`;
  const zielText = ABLAGE.bekannt && !ABLAGE.verschoben ? "Drive › Klausurtrainer › 00_Eingang (einmal in den Studienordner verschieben, siehe Einstellungen)" : "Studium_Cloudkopie › 00_Eingang";
  main.innerHTML = `<div class="erf mx-${m}">
    <div class="erfhead"><button class="tback" id="erfBack" type="button" aria-label="Zurück">${ICON.back}</button><strong>${n ? "Fotos prüfen" : d.length === 1 ? "Datei prüfen" : "Dateien prüfen"}</strong><span>${m} · ${esc(erfDoz(m) || erfName(m))}</span></div>
    ${n ? `<section class="erfsec" aria-label="Seiten"><div class="tile-h"><span class="kicker">${n} ${n === 1 ? "Seite" : "Seiten"} · ein PDF</span><span class="small muted">${n > 1 ? "‹ schiebt nach vorn" : ""}</span></div>
      <div class="erfgrid">${e.seiten.map((s, i) => { const u = URL.createObjectURL(s.blob); ERF_URLS.push(u);
        return `<figure><img src="${u}" alt="Seite ${i + 1}"><figcaption>${i + 1}</figcaption>
          <button type="button" class="erfx" data-del="${i}" aria-label="Seite ${i + 1} entfernen">✕</button>${i ? `<button type="button" class="erfl" data-vor="${i}" aria-label="Seite ${i + 1} nach vorn">‹</button>` : ""}</figure>`; }).join("")}</div>
      <button type="button" class="erfadd" id="erfMehr"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Seite hinzufügen</button></section>` : ""}
    ${d.length ? `<section class="erfsec" aria-label="Dateien"><span class="kicker">${d.length} ${d.length === 1 ? "Datei" : "Dateien"} · unverändert</span><div class="erfdat">${d.map((f, i) => `<div><span>${esc(f.name)} <span class="muted small">(${erfMB(f.blob.size)})</span></span><button class="btn link" type="button" data-fdel="${i}">entfernen</button></div>`).join("")}</div></section>` : ""}
    <fieldset class="erfart"><legend class="kicker">Art</legend><div class="chips">${ARTEN.map(a => `<button type="button" class="chip" data-art="${a}" aria-pressed="${a === e.art}">${a}</button>`).join("")}</div></fieldset>
    <section class="erfname" aria-label="Ablage"><span class="kicker">${felder.length === 1 ? "Dateiname" : "Dateinamen"}</span>
      ${felder.map(nameZeile).join("")}
      <span class="small muted">${n ? `${n} ${n === 1 ? "Seite" : "Seiten"} · ` : ""}ca. ${erfMB(groesse)} · ${zielText}.${nr ? "" : " „NN“ ersetzt die App beim Hochladen durch die nächste Nummer."} Der Name ist frei änderbar.</span></section>
    <div class="erffoot"><button class="btn big" id="erfGo" type="button">${ICON_UP}Hochladen</button></div>
  </div>`;
  // Namensfelder: nur speichern, nicht neu zeichnen (Tastatur bleibt offen)
  let nfTimer = null;
  main.querySelectorAll("[data-nf]").forEach(inp => inp.oninput = () => {
    const k = inp.dataset.nf, eigen = inp.value === inp.dataset.vor ? undefined : inp.value;
    if(k === "pdf") e.pdfName = eigen; else e.dateien[Number(k.slice(1))].nameNeu = eigen;
    clearTimeout(nfTimer); nfTimer = setTimeout(() => entwurfSpeichern(e).catch(() => {}), 400);
  });
  const neu = async f => { try{ await entwurfSpeichern(Object.assign(e, f)); }catch(err){ toast("Speichern im Browser fehlgeschlagen: " + err.message); } await entwurfPruefen(); viewErf(); };
  $("#erfBack").onclick = () => { erfZurueck(); toast("Entwurf bleibt gespeichert. Über + Erfassen geht es weiter."); };
  main.querySelectorAll("[data-art]").forEach(b => b.onclick = () => neu({art: b.dataset.art}));
  main.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { e.seiten.splice(Number(b.dataset.del), 1); neu({}); });
  main.querySelectorAll("[data-vor]").forEach(b => b.onclick = () => { const i = Number(b.dataset.vor); [e.seiten[i - 1], e.seiten[i]] = [e.seiten[i], e.seiten[i - 1]]; neu({}); });
  main.querySelectorAll("[data-fdel]").forEach(b => b.onclick = () => { e.dateien.splice(Number(b.dataset.fdel), 1); neu({}); });
  main.querySelectorAll("[data-nf]").forEach(inp => inp.onkeydown = ev => { if(ev.key === "Enter"){ ev.preventDefault(); inp.blur(); } });
  const mehr = $("#erfMehr"); if(mehr) mehr.onclick = () => $("#camIn").click();
  $("#erfGo").onclick = async () => {
    const btn = $("#erfGo"); btn.disabled = true; btn.textContent = "Wird vorbereitet …";
    try{
      const items = [];
      // eigener Name nur, wenn er vom aktuellen Vorschlag abweicht (sonst vergibt die App die Nummer beim Hochladen neu)
      const eigen = (inp, ext) => { if(!inp) return null; const v = nameSauber(inp.value, ext); return v && v !== inp.dataset.vor ? v : null; };
      if(e.seiten.length){ const pdf = await pdfAusSeiten(e.seiten); items.push({kind: "datei", datum, modul: m, art: e.art, ext: "pdf", mime: "application/pdf", blob: pdf, seiten: e.seiten.length, name: eigen(main.querySelector('[data-nf="pdf"]'), "pdf")}); }
      d.forEach((f, i) => { const ext = erfExt(f.name); items.push({kind: "datei", datum, modul: m, art: e.art, ext, mime: f.mime, blob: f.blob, original: f.name, name: eigen(main.querySelector(`[data-nf="f${i}"]`), ext)}); });
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
  const lv = typeof kalLaeuft === "function" ? kalLaeuft(m) : null;   // laufende Vorlesung dieses Moduls (H4)
  main.innerHTML = `<div class="notiz mx-${m}">
    <div class="nhead">${MOTIF[m] || ""}<div class="nrow"><button class="tback" id="nBack" type="button" aria-label="Zurück">${ICON.back}</button><span class="nsub">${m} · ${esc(erfDoz(m) || erfName(m))}${lv ? ` · seit ${kalUhr(lv.s)}` : ""}</span>${lv ? `<span class="nvz">V ${kalVZeit(lv)}</span>` : ""}</div>
      <strong>${lv ? "Notizen dieser Vorlesung" : "Notizen heute"}</strong></div>
    <div class="nliste">${liste.length ? liste.map(n => `<article><div class="nmeta"><span>${esc(n.zeit)}</span>${n.v ? `<b>V ${esc(n.v)}</b>` : ""}<span class="nst" data-nid="${esc(n.id)}" data-s="${esc(n.s)}">${n.s === "drive" ? "in Drive" : "wartet"}</span>${n.kr ? `<span class="nkr">KR</span>` : ""}</div><p>${esc(n.text)}</p></article>`).join("")
      : `<p class="hint">Noch keine Notiz zu ${m} heute.</p>`}
      <span class="small muted">Gespeichert in <code>${key}_Notizen.md</code> · Drive › Klausurtrainer › Eingang</span></div>
    <div class="nfoot"><label for="nText" class="kicker">Neue Notiz · ${lv ? "V " + kalVZeit(lv) : uhrzeit()}</label>
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
    const lvj = typeof kalLaeuft === "function" ? kalLaeuft(m) : null, v = lvj ? kalVZeit(lvj) : "";
    const it = {kind: "notiz", datum: heute, modul: m, zeit, v, kr, text, id: erfId()};
    // Zuerst in die Liste im Browser, dann in die Warteschlange: so ist die Notiz sofort sichtbar und gesichert
    const NN = notizenAlle(); (NN[key] = NN[key] || []).push({id: it.id, zeit, v, kr, text, s: "wartet"});
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

/* ---------- Ablage pflegen: Zielordner prüfen, alte Ablage umziehen (ab 1.6.0 statt der Übernahme am PC) ---------- */
let ABL_LETZTE = 0, ABL_LAEUFT = false;
async function ablagePflege(sofort){
  if(!LOCAL.cid || !hasToken() || ABL_LAEUFT) return;
  if(!sofort && Date.now() - ABL_LETZTE < 10 * 60e3) return;
  ABL_LAEUFT = true; ABL_LETZTE = Date.now();
  try{ if(sofort) ERF_O = null; const o = await ordnerEingang(); await altEingangUmziehen(o); }
  catch(e){ if(e.status === 404) ERF_O = null; if(!e.auth && !e.net) console.error(e); }
  finally{ ABL_LAEUFT = false; erfAnzeigen(); }
}

/* ---------- Hinweise für „Heute“ ---------- */
function erfHinweise(){
  let h = "";
  if(ERF_ENTWURF) h += `<div class="note">Entwurf ${ERF_ENTWURF.modul} mit ${erfEntwurfText(ERF_ENTWURF)} ist noch nicht hochgeladen. <a href="#" id="entwurfGo">Fortsetzen</a></div>`;
  if(Q_ANZ) h += `<div class="note">${Q_ANZ} ${Q_ANZ === 1 ? "Erfassung wartet" : "Erfassungen warten"} auf Hochladen${!LOCAL.cid ? ". <a href=\"#\" data-go=\"data\">Google einrichten</a>" : !hasToken() ? ". <a href=\"#\" data-login>Mit Google anmelden</a>" : Q_FEHLER ? ` (${esc(Q_FEHLER)}). <a href="#" id="qNochmal">Erneut versuchen</a>` : "."}</div>`;
  if(ABLAGE.bekannt && !ABLAGE.verschoben) h += `<div class="note">Einmal einrichten: Die App hat in Drive › Klausurtrainer den Ordner ${ZIEL} angelegt. In Drive in den Ordner Studium_Cloudkopie verschieben, dann landen alle Erfassungen direkt dort. <a href="#" data-go="data">Anleitung</a></div>`;
  return h;
}
function erfHinweiseVerdrahten(){
  ERF_SIG = erfHinweise();
  const q = $("#qNochmal"); if(q) q.onclick = ev => { ev.preventDefault(); qAbarbeiten(); };
  const en = $("#entwurfGo"); if(en) en.onclick = ev => { ev.preventDefault(); erfEntwurfOeffnen(); };
}

/* ---------- Einstellungen: Abschnitt „Erfassen und Ablage“ ---------- */
async function erfEinstellungen(sec){
  const log = lsGet("ablage", []).slice(0, 5);
  const zustand = !LOCAL.cid ? "Google ist noch nicht eingerichtet." : !hasToken() ? "Zum Prüfen mit Google anmelden." : !ABLAGE.bekannt ? "Wird geprüft …"
    : ABLAGE.verschoben ? `Erfassungen landen direkt in Studium_Cloudkopie › ${ZIEL}.` : `Der Ordner ${ZIEL} liegt noch in Drive › Klausurtrainer.`;
  sec.innerHTML = `<h2>Erfassen und Ablage</h2>
    <div class="card">
      <p><strong>${esc(zustand)}</strong></p>
      ${ABLAGE.bekannt && !ABLAGE.verschoben ? `<ol class="small" style="margin:0 0 10px;padding-left:20px">
        <li>drive.google.com öffnen, Meine Ablage › Studium_Cloudkopie: den bisherigen Ordner ${ZIEL} umbenennen in „${ZIEL}_alt“.</li>
        <li>Meine Ablage › Klausurtrainer: den Ordner ${ZIEL} mit Rechtsklick › Verschieben nach Studium_Cloudkopie verschieben.</li>
        <li>Den Inhalt von „${ZIEL}_alt“ (zum Beispiel _info.txt) in den neuen ${ZIEL} verschieben. Den leeren alten Ordner in den Papierkorb legen.</li>
        <li>Hier „Ablage prüfen“ drücken.</li></ol>
        <p class="hint" style="margin:0 0 10px">Warum so: Die App darf nur Ordner beschreiben, die sie selbst angelegt hat. Dieses Recht behält sie auch nach dem Verschieben. Ein zusätzliches Google-Recht ist nicht nötig.</p>` : ""}
      ${hasToken() && LOCAL.cid ? `<button class="btn small ghost" type="button" id="ablPruef">Ablage prüfen</button>` : ""}
      <p style="margin-top:12px">${Q_ANZ ? `${Q_ANZ} ${Q_ANZ === 1 ? "Erfassung wartet" : "Erfassungen warten"} auf Hochladen.` : "Keine Erfassung wartet."}${ERF_ENTWURF ? ` Entwurf ${ERF_ENTWURF.modul}: ${erfEntwurfText(ERF_ENTWURF)}.` : ""}</p>
      ${Q_ANZ && hasToken() ? `<button class="btn small" type="button" id="eqGo">Jetzt hochladen</button>` : ""}
      ${log.length ? `<table class="t" style="margin-top:8px">${log.map(x => `<tr><td class="small" style="white-space:nowrap">${fmtDT(x.at)}</td><td class="small">${esc(x.name)}${x.umgezogen ? ` (nach ${ZIEL} verschoben)` : x.uebernommen ? " (am PC übernommen)" : ""}</td></tr>`).join("")}</table>` : ""}
      <p class="hint" style="margin-top:10px">Die App sieht in ${ZIEL} nur Dateien, die sie selbst hochgeladen hat. Was die Modulchats dort ablegen oder wegsortieren, bleibt davon unberührt.</p>
    </div>`;
  const g = $("#eqGo"); if(g) g.onclick = () => { qAbarbeiten(); toast("Wird hochgeladen …"); };
  const p = $("#ablPruef"); if(p) p.onclick = async () => { p.disabled = true; await ablagePflege(true); if(VIEW === "data") render(); toast(ABLAGE.verschoben ? `Eingerichtet: Erfassungen landen in Studium_Cloudkopie › ${ZIEL}.` : `${ZIEL} liegt noch in Klausurtrainer.`); };
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
function erfAnstossen(){ return qAbarbeiten().then(() => ablagePflege(false)); }
let ERF_GESTARTET = false;
async function erfStart(){
  if(ERF_GESTARTET) return; ERF_GESTARTET = true;
  await qZaehlen(); await entwurfPruefen();
  if(VIEW === "heute") softRender();
  setInterval(() => { if(document.visibilityState === "visible" && hasToken() && Q_ANZ) qAbarbeiten(); }, 60e3);
  window.addEventListener("online", () => { if(hasToken()) erfAnstossen(); });
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && hasToken()) erfAnstossen(); });
  if(hasToken()) erfAnstossen();
}
