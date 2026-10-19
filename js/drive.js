"use strict";
/* ============================================================
   Google-Anmeldung und Drive
   ============================================================ */
const G = {token:null, exp:0, client:null, cid:null};
(function(){ try{ const t=JSON.parse(sessionStorage.getItem(K+"tok")||"null"); if(t && t.exp>Date.now()){ G.token=t.token; G.exp=t.exp; } }catch(e){} })();
function hasToken(){ return !!G.token && Date.now() < G.exp; }
function gisReady(){ return !!(window.google && google.accounts && google.accounts.oauth2); }
let SYNC = {s:"off", msg:"Nicht angemeldet"};
function setSync(s, msg){ SYNC = {s, msg}; renderSync(); }
function renderSync(){
  // ab 1.4: Anzeige im Kopf (Handy) und in der Seitenleiste (PC)
  let s = SYNC.s, msg = SYNC.msg;
  if(!LOCAL.cid){ s="off"; msg="Google einrichten"; }
  else if(!hasToken() && s!=="busy"){ s="auth"; msg = pending() ? "Anmelden, Änderungen offen" : "Mit Google anmelden"; }
  document.querySelectorAll(".syncpill").forEach(el => {
    el.dataset.s = s; el.querySelector("span").textContent = msg;
    el.title = (LOCAL.email ? `Google: ${LOCAL.email}` : "Google Drive") + " · " + msg;
    el.setAttribute("aria-label", "Abgleich: " + msg);
  });
}
async function login(){
  if(!LOCAL.cid){ go("data"); toast("Bitte zuerst die Client-ID eintragen."); return; }
  if(!gisReady()){
    setSync("busy", "Anmeldung wird geladen …");
    try{ await waitFor(gisReady, 8000); }catch(e){ setSync("err", "Google-Anmeldung lädt nicht"); toast("Die Google-Anmeldung lädt nicht. Internet prüfen, in Brave die Shields für diese Seite ausschalten."); return; }
  }
  if(!G.client || G.cid !== LOCAL.cid){
    const cfg = {client_id:LOCAL.cid, scope:SCOPE, callback:onToken,
      error_callback: e => { setSync("err", "Anmeldung nicht abgeschlossen"); if(e && e.type==="popup_failed_to_open") toast("Das Anmeldefenster wurde blockiert. Pop-ups für diese Seite erlauben."); }};
    if(LOCAL.email) cfg.login_hint = LOCAL.email;
    G.client = google.accounts.oauth2.initTokenClient(cfg); G.cid = LOCAL.cid;
  }
  G.client.requestAccessToken({prompt:""});
}
async function onToken(r){
  if(!r || r.error){ setSync("err", "Anmeldung fehlgeschlagen"); toast("Anmeldung fehlgeschlagen: " + (r && (r.error_description || r.error) || "unbekannt")); return; }
  if(google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)){
    setSync("err", "Drive-Zugriff nicht erlaubt"); toast("Bitte bei der Anmeldung den Haken für Google Drive setzen."); return;
  }
  G.token = r.access_token; G.exp = Date.now() + ((Number(r.expires_in)||3600) - 120) * 1000;
  try{ sessionStorage.setItem(K+"tok", JSON.stringify({token:G.token, exp:G.exp})); }catch(e){}
  if(!LOCAL.email){ try{ const a = await (await api(`${DRIVE}/about?fields=user(emailAddress)`)).json(); LOCAL.email = a.user && a.user.emailAddress || ""; persistLocal(); }catch(e){} }
  await syncNow({first:true});
}
function logout(){
  if(G.token && gisReady()){ try{ google.accounts.oauth2.revoke(G.token, ()=>{}); }catch(e){} }
  G.token=null; G.exp=0; try{ sessionStorage.removeItem(K+"tok"); }catch(e){}
  setSync("auth","Abgemeldet");
}
class AuthErr extends Error{ constructor(){ super("Anmeldung abgelaufen"); this.auth=true; } }
async function api(url, opt={}){
  if(!hasToken()) throw new AuthErr();
  let r;
  try{ r = await fetch(url, Object.assign({}, opt, {headers: Object.assign({Authorization:"Bearer "+G.token}, opt.headers||{})})); }
  catch(e){ const n = new Error("Keine Verbindung"); n.net = true; throw n; }
  if(r.status===401){ G.token=null; try{ sessionStorage.removeItem(K+"tok"); }catch(e){} throw new AuthErr(); }
  if(!r.ok){ const t = await r.text(); const e = new Error(`Drive ${r.status}: ${t.slice(0,200)}`); e.status = r.status; throw e; }
  return r;
}
const qs = s => encodeURIComponent(s);
async function findFolder(name, parent){
  let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if(parent) q += ` and '${parent}' in parents`;
  const r = await (await api(`${DRIVE}/files?q=${qs(q)}&orderBy=createdTime&fields=files(id,name)&spaces=drive`)).json();
  return r.files && r.files[0] ? r.files[0].id : null;
}
async function createFolder(name, parent){
  const body = {name, mimeType:"application/vnd.google-apps.folder"}; if(parent) body.parents=[parent];
  return (await (await api(`${DRIVE}/files?fields=id`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)})).json()).id;
}
async function checkId(id){ try{ const f = await (await api(`${DRIVE}/files/${id}?fields=id,trashed`)).json(); return !f.trashed; }catch(e){ if(e.auth || e.net) throw e; return false; } }
async function ensureFolder(){
  if(LOCAL.ids.folder && await checkId(LOCAL.ids.folder)) return LOCAL.ids.folder;
  LOCAL.ids = {};
  LOCAL.ids.folder = await findFolder(FOLDER_NAME) || await createFolder(FOLDER_NAME);
  persistLocal(); return LOCAL.ids.folder;
}
async function ensureBackupFolder(folder){
  if(LOCAL.ids.backup && await checkId(LOCAL.ids.backup)) return LOCAL.ids.backup;
  LOCAL.ids.backup = await findFolder("Sicherungen", folder) || await createFolder("Sicherungen", folder);
  persistLocal(); return LOCAL.ids.backup;
}
async function findFile(name, parent){
  const q = `name='${name}' and '${parent}' in parents and trashed=false`;
  const r = await (await api(`${DRIVE}/files?q=${qs(q)}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)&spaces=drive`)).json();
  return r.files && r.files[0] || null;
}
async function readJSON(id){ return await (await api(`${DRIVE}/files/${id}?alt=media`)).json(); }
async function writeJSON(id, name, parent, obj){
  const body = JSON.stringify(obj);
  if(id){
    const r = await (await api(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body})).json();
    return r;
  }
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify({name, parents:[parent], mimeType:"application/json"})], {type:"application/json"}));
  fd.append("file", new Blob([body], {type:"application/json"}));
  return await (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {method:"POST", body:fd})).json();
}

/* ---------- Abgleich (Lastenheft G3, G4) ---------- */
function stateObj(){ return {app:"Klausurtrainer", typ:"lernstand", version:2, geaendert:new Date().toISOString(), geraet:DEVICE, prog:PROG, transfer:TRANS, sims:SIMS, settings:SET, zeit:lsGet("zeit", {})}; }
function mergeIn(remote){
  let lc=false, rw=false;
  const rp = remote.prog || {};
  for(const id in rp){ const a=PROG[id], b=rp[id]; if(!a || (b.upd||0) > (a.upd||0)){ PROG[id]=b; lc=true; } else if((a.upd||0) > (b.upd||0)) rw=true; }
  for(const id in PROG) if(!(id in rp)) rw=true;
  const rt = remote.transfer || {};
  for(const m in rt){ const a=TRANS[m], b=rt[m]; if(!a || (b.upd||0) > (a.upd||0)){ TRANS[m]=b; lc=true; } else if((a.upd||0) > (b.upd||0)) rw=true; }
  for(const m in TRANS) if(!(m in rt)) rw=true;
  const rs = remote.sims || [], ids = new Set(SIMS.map(s=>s.id));
  for(const s of rs) if(!ids.has(s.id)){ SIMS.push(s); lc=true; }
  const rids = new Set(rs.map(s=>s.id)); if(SIMS.some(s=>!rids.has(s.id))) rw=true;
  if(lc) SIMS.sort((a,b)=> (a.d||"").localeCompare(b.d||""));
  const rset = remote.settings;
  if(rset && (rset.upd||0) > (SET.upd||0)){ SET = Object.assign({statuses:["A","B"], exams:{}}, rset); lc=true; }
  else if(!rset || (SET.upd||0) > (rset.upd||0)) rw=true;
  // Lernzeit (ab 1.4.1): je Tag und Gerät, es gilt der größere Wert. Ältere Stände ohne „zeit“ verlieren nichts.
  const rz = remote.zeit || {}, lz = lsGet("zeit", {}); let zc = false;
  for(const d in rz) for(const g in (rz[d] || {})){ const v = Number(rz[d][g]) || 0; if(!lz[d]) lz[d] = {}; if(v > (Number(lz[d][g]) || 0)){ lz[d][g] = v; zc = true; } }
  for(const d in lz) for(const g in lz[d]) if((Number(lz[d][g]) || 0) > (Number((rz[d] || {})[g]) || 0)) rw = true;
  if(zc) lsSet("zeit", lz);
  return {lc, rw};
}
let SYNCING=false, SYNC_AGAIN=null, SYNC_TIMER=null;
function scheduleSync(ms=2500, opts={}){ clearTimeout(SYNC_TIMER); SYNC_TIMER = setTimeout(()=>syncNow(opts), ms); }
async function syncNow(opts={}){
  if(!LOCAL.cid){ renderSync(); return; }
  if(!hasToken()){ renderSync(); return; }
  if(SYNCING){ SYNC_AGAIN = Object.assign(SYNC_AGAIN||{}, opts); return; }
  SYNCING = true; setSync("busy", "Abgleich …");
  const c0 = LOCAL.chg; let lc = false;
  try{
    const folder = await ensureFolder();
    let id = LOCAL.ids.lernstand || null, remote = null;
    if(id){ try{ remote = await readJSON(id); }catch(e){ if(e.auth || e.net) throw e; id = null; } }
    if(!id){ const f = await findFile("lernstand.json", folder); if(f){ id = f.id; remote = await readJSON(id); } }
    let res = {lc:false, rw:true};
    if(remote && remote.app==="Klausurtrainer") res = mergeIn(remote);
    lc = res.lc;
    if(lc) persist();
    if(res.rw || !remote){ const w = await writeJSON(id, "lernstand.json", folder, stateObj()); id = w.id || id; }
    LOCAL.ids.lernstand = id; LOCAL.synced = Math.max(LOCAL.synced, c0); LOCAL.lastSync = new Date().toISOString(); persistLocal();
    const gotPkg = await pullPackage(folder);
    if(opts.unit && Date.now() - (LOCAL.lastBackup||0) > 10*60e3) await backup(folder);
    setSync("ok", "Abgeglichen " + new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}));
    if(SET.autoUnlock && autoUnlock()) softRender();
    if(lc || gotPkg || opts.first) softRender();
    if(opts.first || opts.dircheck) autoContentCheck(false);
  }catch(e){
    if(e.auth){ setSync("auth", "Anmeldung abgelaufen"); }
    else if(e.net){ setSync("off", "Offline, Abgleich später"); }
    else { setSync("err", "Abgleich fehlgeschlagen"); console.error(e); toast("Abgleich fehlgeschlagen: " + e.message); }
  }finally{
    SYNCING = false;
    if(SYNC_AGAIN){ const o = SYNC_AGAIN; SYNC_AGAIN = null; scheduleSync(800, o); }
    else if(LOCAL.chg > c0 && hasToken() && SYNC.s==="ok") scheduleSync(1500);
  }
}
async function pullPackage(folder){
  const f = await findFile("inhalte.json", folder);
  if(!f) return false;
  LOCAL.ids.inhalte = f.id;
  if(PKG && LOCAL.pkgDriveTime === f.modifiedTime){ persistLocal(); return false; }
  setSync("busy", "Neue Inhalte werden geladen …");
  const pkg = await readJSON(f.id);
  LOCAL.pkgDriveTime = f.modifiedTime; persistLocal();
  if(!pkg || pkg.app!=="Klausurtrainer" || pkg.typ!=="inhalte") return false;
  if(PKG && (pkg.erstellt||"") <= (PKG.erstellt||"")) return false;
  await idbSet("pkg", pkg);
  applyPackage(pkg, true);
  const nu = autoUnlock();
  toast(`Neue Inhalte vom ${fmtDT(pkg.erstellt)} geladen: ${ITEMS.length} Fragen${nu?`, ${nu} neu in Fach 1`:""}.`);
  return true;
}
async function backup(folder){
  const sub = await ensureBackupFolder(folder);
  const d = new Date(), p = n => String(n).padStart(2,"0");
  const name = `lernstand_${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}_${DEVICE}.json`;
  await writeJSON(null, name, sub, stateObj());
  LOCAL.lastBackup = Date.now(); persistLocal();
  const q = `'${sub}' in parents and trashed=false`;
  const list = (await (await api(`${DRIVE}/files?q=${qs(q)}&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=100`)).json()).files || [];
  for(const f of list.slice(10)){
    await api(`${DRIVE}/files/${f.id}`, {method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({trashed:true})});
  }
}
async function listBackups(){
  const folder = await ensureFolder(); const sub = await ensureBackupFolder(folder);
  const q = `'${sub}' in parents and trashed=false`;
  return (await (await api(`${DRIVE}/files?q=${qs(q)}&orderBy=createdTime desc&fields=files(id,name,createdTime)&pageSize=20`)).json()).files || [];
}

/* ---------- Inhalte nach Drive (nur am PC, Lastenheft G7) ---------- */
async function shrinkImage(blob){
  try{
    const bmp = await createImageBitmap(blob);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width*s); c.height = Math.round(bmp.height*s);
    const x = c.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0,0,c.width,c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    let url = c.toDataURL("image/webp", 0.85);
    if(!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", 0.85);
    return url;
  }catch(e){ return null; }
}
async function collectFromHandle(root){
  const files = [];
  for await (const [name, h] of root.entries()){
    if(h.kind!=="directory" || !/^0[1-9]_/.test(name)) continue;
    try{ const f = await (await h.getFileHandle("karten.csv")).getFile(); files.push({path:`${name}/karten.csv`, text:await f.text()}); }catch(e){}
    try{
      const pd = await h.getDirectoryHandle("Pruefung");
      for await (const [fn, fh] of pd.entries()) if(fh.kind==="file" && /^(pruefung|merkhilfen)_M\d+\.csv$/i.test(fn)) files.push({path:`${name}/Pruefung/${fn}`, text:await (await fh.getFile()).text()});
    }catch(e){}
  }
  const getBlob = async path => { try{ const parts = path.split("/"); let h = root; for(const p of parts.slice(0,-1)) h = await h.getDirectoryHandle(p); return await (await h.getFileHandle(parts.at(-1))).getFile(); }catch(e){ return null; } };
  return {files, getBlob, rootName: root.name};
}
async function collectFromList(list){
  const map = new Map(); let rootName = "";
  for(const f of list){ const parts = (f.webkitRelativePath || f.name).split("/"); rootName = parts[0]; map.set(parts.slice(1).join("/"), f); }
  const files = [];
  for(const [rel, f] of map){
    if(/^0[1-9]_[^/]+\/karten\.csv$/.test(rel) || /^0[1-9]_[^/]+\/Pruefung\/(pruefung|merkhilfen)_M\d+\.csv$/i.test(rel)) files.push({path:rel, text:await f.text()});
  }
  return {files, getBlob: async p => map.get(p) || null, rootName};
}
async function buildAndUpload(src){
  const {files, getBlob, rootName} = src;
  if(!files.length){ toast("Keine karten.csv und keine Prüfungsdateien gefunden. Bitte den Ordner Studium bzw. Studium_Cloudkopie selbst wählen."); return; }
  setSync("busy", "Inhalte werden gepackt …");
  const {items} = buildItems(files.filter(f=>/karten\.csv$/i.test(f.path)), files.filter(f=>/pruefung_M\d+\.csv$/i.test(f.path)));
  const bilder = {}, hinweise = [];
  for(const it of items){
    if(!it.bild || bilder[it.bild]) continue;
    const blob = await getBlob(it.bild);
    if(!blob){ hinweise.push(`Bild nicht gefunden: ${it.bild}`); continue; }
    const url = await shrinkImage(blob);
    if(url) bilder[it.bild] = url; else hinweise.push(`Bild nicht lesbar: ${it.bild}`);
  }
  const pkg = {app:"Klausurtrainer", typ:"inhalte", version:1, erstellt:new Date().toISOString(), geraet:DEVICE, quelle:rootName, dateien:files, bilder, hinweise};
  try{
    const folder = await ensureFolder();
    let id = LOCAL.ids.inhalte && await checkId(LOCAL.ids.inhalte) ? LOCAL.ids.inhalte : null;
    if(!id){ const f = await findFile("inhalte.json", folder); id = f ? f.id : null; }
    setSync("busy", "Inhalte werden hochgeladen …");
    const w = await writeJSON(id, "inhalte.json", folder, pkg);
    LOCAL.ids.inhalte = w.id || id; LOCAL.pkgDriveTime = w.modifiedTime || null; persistLocal();
    await idbSet("pkg", pkg);
    applyPackage(pkg, true);
    LOCAL.contentFp = src.fp || contentFp(files); persistLocal();
    const nu = autoUnlock();
    if(nu) toast(`${nu} neue Karten in Fach 1.`);
    setSync("ok", "Inhalte in Drive " + new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}));
    if(!src.quiet) toast(`${ITEMS.length} Fragen und ${Object.keys(bilder).length} Bilder nach Drive gelegt.`);
    render();
  }catch(e){
    if(e.auth) setSync("auth","Anmeldung abgelaufen"); else if(e.net) setSync("off","Offline"); else setSync("err","Hochladen fehlgeschlagen");
    toast("Inhalte nicht hochgeladen: " + e.message);
  }
}
function contentFp(files){ return hashStr(files.map(f=>f.path+"\u0001"+f.text).sort().join("\u0002")); }
// Am PC: gemerkten Studienordner prüfen und bei Änderungen das Inhaltspaket selbst erneuern (Lastenheft G7, geändert 14.10.2026)
let DIR_STATE = "none", LAST_DIR_CHECK = 0;
async function autoContentCheck(interactive){
  if(DEVICE!=="PC" || !window.showDirectoryPicker || !hasToken()) return;
  if(!interactive && Date.now() - LAST_DIR_CHECK < 90e3) return;
  const h = await idbGet("dir"); if(!h){ DIR_STATE = "none"; return; }
  LAST_DIR_CHECK = Date.now();
  try{
    let perm = await h.queryPermission({mode:"read"});
    if(perm!=="granted" && interactive) perm = await h.requestPermission({mode:"read"});
    if(perm!=="granted"){ if(DIR_STATE!=="ask"){ DIR_STATE = "ask"; softRender(); } return; }
    DIR_STATE = "ok";
    const src = await collectFromHandle(h);
    src.fp = contentFp(src.files);
    if(src.fp === LOCAL.contentFp){ if(interactive){ toast("Keine neuen Inhalte im Studienordner."); softRender(); } return; }
    src.quiet = !interactive;
    await buildAndUpload(src);
    if(!interactive) toast("Neue Inhalte aus dem Studienordner übernommen und nach Drive gelegt.");
  }catch(e){ DIR_STATE = "ask"; }
}
async function pushContent(){
  if(!hasToken()){ toast("Bitte zuerst mit Google anmelden."); return login(); }
  if(window.showDirectoryPicker){
    try{ const h = await window.showDirectoryPicker({id:"studium", mode:"read"}); await idbSet("dir", h); DIR_STATE = "ok"; const src = await collectFromHandle(h); src.fp = contentFp(src.files); return buildAndUpload(src); }
    catch(e){ if(e && e.name==="AbortError") return; }
  }
  $("#dirInput").click();
}
$("#dirInput").addEventListener("change", async ev => { const list=[...ev.target.files]; ev.target.value=""; if(list.length){ const src = await collectFromList(list); src.fp = contentFp(src.files); buildAndUpload(src); } });

