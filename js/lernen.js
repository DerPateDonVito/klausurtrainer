"use strict";
/* ============================================================
   Ansichten
   ============================================================ */
let VIEW = "heute";   // ab 1.4 startet die App auf „Heute“
const main = $("#main");
// Navigation, Bereiche, Hell/Dunkel, go() und render() liegen ab 1.4 in js/app.js
let CLOCK = null;
function stopClock(){ if(CLOCK){ clearInterval(CLOCK); CLOCK=null; } }
function stBadge(s){ return `<span class="st ${s==="?"?"q":s}" title="${esc(STATUS[s].long)}">${s}</span>`; }
function needsContent(){
  main.innerHTML = `<h1>Noch keine Fragen geladen</h1>
    <div class="card">
      ${!LOCAL.cid ? `<p>Zuerst die Verbindung zu Google Drive einrichten.</p><button class="btn" id="toData">Einrichten</button>` :
        !hasToken() ? `<p>Mit Google anmelden. Danach lädt die App die Inhalte aus deinem Drive (Ordner ${FOLDER_NAME}).</p><button class="btn" id="lg">Mit Google anmelden</button>` :
        `<p>In deinem Drive liegt noch kein Inhaltspaket.</p><p class="hint">Am PC: „Inhalte nach Drive“ wählen und den Studienordner (Studium bzw. Studium_Cloudkopie) auswählen. Gelesen werden nur karten.csv, Pruefung/pruefung_Mx.csv und die dort genannten Bilder. Fragt der Browser nach „Hochladen“: Die Dateien gehen nur in dein eigenes Drive.</p>
         <button class="btn" id="push" ${DEVICE==="PC"?"":"disabled"}>Inhalte nach Drive</button> ${DEVICE==="PC"?"":`<p class="hint" style="margin-top:8px">Das geht nur am PC.</p>`}`}
    </div>`;
  const a=$("#toData"); if(a) a.onclick=()=>go("data");
  const l=$("#lg"); if(l) l.onclick=login;
  const p=$("#push"); if(p) p.onclick=pushContent;
}
function syncBanner(){
  if(!STORAGE_OK) return `<div class="warn">Dieser Browser speichert nichts. Ohne Speicherung ist kein Üben möglich. Brave: Shields für diese Seite prüfen, keinen privaten Modus nutzen.</div>`;
  if(!LOCAL.cid) return `<div class="warn">Google Drive ist noch nicht eingerichtet. Dein Lernstand liegt nur in diesem Browser. <a href="#" data-go="data">Einrichten</a></div>`;
  if(!hasToken()) return `<div class="note">Nicht angemeldet${pending()?", Änderungen warten auf den Abgleich":""}. <a href="#" data-login>Mit Google anmelden</a></div>`;
  return "";
}
function wireBanner(root=main){ root.querySelectorAll("[data-login]").forEach(a=>a.onclick=e=>{e.preventDefault(); login();}); root.querySelectorAll("[data-go]").forEach(a=>a.onclick=e=>{e.preventDefault(); go(a.dataset.go);}); }

/* ---------- Übersicht ---------- */
function moduleStats(m){
  const all = ITEMS.filter(i=>i.modul===m);
  const scope = all.filter(inScope);
  const unl = scope.filter(i=>prog(i.id));
  const fach = [0,0,0,0,0,0]; unl.forEach(i => fach[Math.min(6,Math.max(1,prog(i.id).f))-1]++);
  return {all, scope, unl, fach, due: unl.filter(isDue),
    gaps: all.filter(i=>["A","B"].includes(i.status) && i.offen && i.gueltig!=="überholt"),
    fresh: newAvail(m), errors: unl.filter(i=>lastGrade(prog(i.id))==="f")};
}
function viewHome(){
  if(!ITEMS.length) return needsContent();
  const order = modOrder();
  const allDue = order.reduce((n,m)=>n+moduleStats(m).due.length, 0);
  let html = syncBanner();
  if(DIR_STATE==="ask") html += `<div class="note">Studienordner auf neue Inhalte prüfen: <a href="#" id="dirCheck">Jetzt prüfen</a> (Brave fragt nach der Freigabe, „Bei jedem Besuch erlauben“ wählen, falls angeboten)</div>`;
  else if(DEVICE==="PC" && hasToken() && window.showDirectoryPicker && DIR_STATE==="none" && PKG) html += `<div class="note">Damit die App neue Inhalte selbst findet: einmal unter Daten „Inhalte nach Drive“ ausführen und den Studienordner wählen.</div>`;
  if(DIFF && !DIFF.gesehen) html += `<div class="note">Neue Inhalte vom ${fmtDT(DIFF.at)}: ${DIFF.neu.length} neue, ${DIFF.geaendert.length} geänderte Fragen. <a href="#" data-go="stats">Anzeigen</a></div>`;
  const pkgAge = PKG ? Math.floor((Date.now()-new Date(PKG.erstellt))/864e5) : null;
  const today = new Date().toLocaleDateString("de-DE", {weekday:"long", day:"numeric", month:"long", year:"numeric"});
  const next = order.find(m => daysTo(examOf(m)) >= 0), nd = next ? daysTo(examOf(next)) : null;
  const nextTxt = next ? `Erste Klausur: ${next} ${esc(MODULES[next].short)} ${nd===0?"heute":nd===1?"morgen":`in ${nd} Tagen`}.` : "Alle Klausurtermine liegen in der Vergangenheit.";
  html += `<section class="hero" aria-label="Heute">${MOTIF.hero}
      <div><span class="kicker">${esc(today)}</span>
        <h1>${allDue ? `Heute ${allDue===1?"ist":"sind"} <em>${allDue} ${allDue===1?"Karte":"Karten"}</em> fällig.` : "Heute ist nichts fällig."}</h1>
        <p>${nextTxt} Inhalte vom ${PKG?fmtDT(PKG.erstellt):"–"}${pkgAge>7?` (${pkgAge} Tage alt)`:""}.</p></div>
      <button class="btn" id="startAll" ${allDue?"":"disabled"}>Training starten ${ICON.arrow}</button>
    </section>
    <div class="mods">`;
  for(const m of order){
    const M = MODULES[m], s = moduleStats(m), d = daysTo(examOf(m));
    const rec = recommendation(m), ut = unlockedToday(m);
    const firm = s.unl.length ? Math.round((s.fach[3]+s.fach[4]+s.fach[5]) / s.unl.length * 100) : 0;
    html += `<section class="eb mx-${m}" aria-label="${esc(M.name)}">${MOTIF[m]||""}
      <div class="eb-top"><span>Band ${bandOf(m)} · ${m}</span><span>${esc(M.doz)}</span></div>
      <div class="eb-rule"></div>
      <div class="eb-main"><h2 class="eb-title">${esc(M.name)}</h2>
        <div class="eb-nums"><div class="eb-days"><strong class="mono">${d>=0?d:"–"}</strong><span>${d>=0?`Tage bis ${fmtDate(examOf(m))}`:"Klausur vorbei"}</span></div>
          <div class="eb-firm"><strong class="mono">${firm} %</strong><span>gefestigt</span></div></div></div>
      <div class="eb-bar" role="img" aria-label="Karten je Fach 1 bis 6: ${s.fach.join(", ")}">${s.fach.map((n,i)=>`<i style="flex:${n} 1 0;background:var(--r${i+1})"></i>`).join("")}</div>
      <div class="eb-facts mono"><span><b>${s.unl.length}</b> in Fach 1–6</span><span><b>${s.fresh.length}</b> neu</span><span><b>${s.gaps.length}</b> ${s.gaps.length===1?"Lücke":"Lücken"}</span>${s.errors.length?`<span><b>${s.errors.length}</b> Fehler</span>`:""}</div>
      ${SET.autoUnlock?"":s.fresh.length?`<div class="unl">Empfehlung heute: <b>${rec}</b> neue freischalten${ut?` (heute schon ${ut})`:""}
        <div class="row" style="margin-top:8px"><button class="btn small" data-unl="${m}" data-n="${Math.max(rec,1)}">${Math.max(rec,1)} freischalten</button><button class="btn small ghost" data-unl="${m}" data-n="5">+5</button></div></div>`:""}
      <button class="eb-go" type="button" data-train="${m}" ${s.due.length?"":"disabled"}><span>${s.due.length?`${s.due.length} fällig`:"Nichts fällig"}</span><span>${s.due.length?`${m} üben →`:""}</span></button>
    </section>`;
  }
  const errN = ITEMS.filter(i => prog(i.id) && lastGrade(prog(i.id))==="f" && trainable(i)).length;
  const tm = TRANSFER_DEFAULT.M3 ? tget("M3") : null, tFill = tm ? tm.points.filter(p => (tm.texts[p]||"").trim()).length : 0;
  html += `</div>
    <section class="more" aria-label="Weiteres">
      <div><span class="kicker">Fehlerliste</span><strong>${errN} ${errN===1?"Karte":"Karten"} zuletzt falsch</strong><span class="small muted">Morgen wieder fällig, vorher zusätzlich üben möglich.</span><a href="#" data-go="errors">Fehler ansehen</a></div>
      ${tm?`<div><span class="kicker">Transfer M3</span><strong>${tFill} von ${tm.points.length} Punkten ausgearbeitet</strong><span class="small muted">${TRANSFER_DEFAULT.M3.punkte} Punkte, Aufgabe vorab bekannt.</span><a href="#" data-go="transfer">Weiter ausarbeiten</a></div>`:""}
      <div><span class="kicker">Inhalte</span><strong>${ITEMS.filter(trainable).length} Fragen, ${BUILD.merk||0} Merkhilfen</strong><span class="small muted">Stand ${PKG?fmtDT(PKG.erstellt):"–"}.</span><a href="#" data-go="data">Daten und Inhalte</a></div>
    </section>
    <p class="hint" style="margin-top:22px">${SET.autoUnlock?`Neue trainierbare Karten kommen automatisch in Fach 1 (umstellbar unter Daten). Fällige Karten bleiben fällig, bis du sie geübt hast. `:""}Empfehlung: so viele neue Karten pro Tag, dass jede bis 2 Tage vor der Klausur alle sechs Fächer durchlaufen kann (${CYCLE} Tage bei durchgehend richtig). „Gefestigt“ ist der Anteil in Fach 4 bis 6. Lücken sind bekannte Klausurfragen ohne Musterantwort, sie werden im Modulchat ergänzt.</p>`;
  main.innerHTML = html; wireBanner();
  const dc = $("#dirCheck"); if(dc) dc.onclick = e => { e.preventDefault(); autoContentCheck(true); };
  $("#startAll").onclick = () => { SESSION=null; VIEW="train"; render({modul:"ALL"}); };
  main.querySelectorAll("[data-train]").forEach(b => b.onclick = () => { SESSION=null; VIEW="train"; render({modul:b.dataset.train}); });
  main.querySelectorAll("[data-unl]").forEach(b => b.onclick = () => { const n = unlock(b.dataset.unl, Number(b.dataset.n)); toast(`${n} ${n===1?"Karte":"Karten"} in Fach 1 freigeschaltet.`); viewHome(); });
}

/* ---------- Training (Lastenheft B, C) ---------- */
let SESSION = null;
function buildQueue(modul, limit){
  const pool = ITEMS.filter(i => inScope(i) && (modul==="ALL" || i.modul===modul) && isDue(i));
  pool.sort((a,b)=> prog(a.id).due.localeCompare(prog(b.id).due) || prog(a.id).f - prog(b.id).f || examOf(a.modul).localeCompare(examOf(b.modul)));
  return pool.slice(0, limit || pool.length).map(i=>i.id);
}
function viewTrain(opts={}){
  if(!ITEMS.length) return needsContent();
  if(!STORAGE_OK){ main.innerHTML = syncBanner(); return; }
  if(opts.single){ SESSION = {modul:"EINZEL", queue:[opts.single], done:0, total:1, single:true}; }
  if(opts.ids){ SESSION = {modul:"LISTE", queue:opts.ids.slice(), done:0, total:opts.ids.length, label:opts.label}; }
  if(!SESSION){
    const modul = opts.modul || "ALL";
    const dueAll = buildQueue(modul);
    if(opts.modul && dueAll.length <= 15){ SESSION = {modul, queue:dueAll, done:0, total:dueAll.length}; }
    else return viewTrainStart(modul, dueAll.length);
  }
  if(!SESSION.queue.length) return viewTrainDone();
  const it = ITEMS.find(i=>i.id===SESSION.queue[0]);
  if(!it){ SESSION.queue.shift(); return viewTrain(); }
  const p = prog(it.id), f = p ? p.f : 1, M = MODULES[it.modul];
  const scheduled = !p || !p.hist.length || isDue(it);
  const drafts = lsGet("drafts", {}), draft = drafts[it.id] || "";
  const minutes = it.punkte || RICHTZEIT[it.form] || 6;
  const totalN = SESSION.done + SESSION.queue.length, pct = SESSION.single ? 100 : Math.round(SESSION.done / Math.max(1,totalN) * 100);
  document.body.classList.add("focus");
  main.innerHTML = `<div class="tr mx-${it.modul}">
    <div class="thead">${MOTIF[it.modul]||""}
      <button class="tback" id="endS" type="button" aria-label="Training beenden">${ICON.back}<span>Beenden</span></button>
      <div class="tt"><strong>${esc(M.name)}</strong><span>Band ${bandOf(it.modul)} · ${it.modul} · Fach ${f} von 6${scheduled?"":" · Zusatzübung, Fach bleibt"}</span></div>
      <span class="tcount mono">${SESSION.single?"Einzelfrage":`${SESSION.done+1}<span> / ${totalN}</span>`}</span>
      <div class="tprog" role="img" aria-label="${SESSION.single?"Einzelfrage":`Karte ${SESSION.done+1} von ${totalN}`}"><i style="width:${pct}%"></i></div>
    </div>${syncBanner()}
    <span class="kicker">${it.form?`${esc(it.form)} · `:""}${esc(it.thema)}</span>
    <h1 class="q">${esc(it.frage)}</h1>
    <div class="qmeta">${it.punkte?`${num(it.punkte)} Punkte`:`Richtzeit ca. ${minutes} Min.`} · ${esc(STATUS[it.status].label)} (${it.status}) · ${esc(it.id)}</div>
    ${it.form==="Zeichnen"?`<p class="hint">Erst auf Papier zeichnen, dann hier die Erläuterung schreiben.</p>`:""}
    <label class="field"><span>Deine Antwort, wie in der Klausur (Tippen oder Diktieren)</span>
      <textarea id="answer" spellcheck="true" placeholder="${DEVICE==="PC"?"Schreiben, dann aufdecken. Strg+Enter deckt auf.":"Schreiben oder diktieren, dann aufdecken."}">${esc(draft)}</textarea></label>
    <div class="row" id="pre"><button class="btn" id="reveal">Aufdecken</button><button class="btn ghost" id="headOnly">Nur im Kopf beantwortet</button>${SESSION.single?"":`<button class="btn link" id="skip">Später</button>`}</div>
    <div id="post"></div></div>`;
  wireBanner();
  const ta = $("#answer");
  ta.addEventListener("input", ()=>{ const d=lsGet("drafts",{}); d[it.id]=ta.value; lsSet("drafts", d); });
  ta.addEventListener("keydown", e=>{ if(e.key==="Enter" && (e.ctrlKey||e.metaKey)){ e.preventDefault(); doReveal(it, scheduled); } });
  $("#reveal").onclick = ()=>doReveal(it, scheduled);
  $("#headOnly").onclick = ()=>doReveal(it, scheduled);
  $("#endS").onclick = ()=>{ const done = SESSION && SESSION.done; SESSION=null; if(done) syncNow({unit:true}); go("home"); };
  if($("#skip")) $("#skip").onclick = ()=>{ SESSION.queue.push(SESSION.queue.shift()); viewTrain(); };
  if(DEVICE==="PC" && !draft) ta.focus({preventScroll:true});
}
function viewTrainStart(modul, n){
  document.body.classList.remove("focus");
  const chip = (v,l) => `<button class="chip" data-m="${v}" aria-pressed="${modul===v}">${l}</button>`;
  const per = modOrder().map(m=>`${m}: ${buildQueue(m).length}`).join(" · ");
  main.innerHTML = `<div class="tr">${syncBanner()}<h1>Training</h1>
    <p class="small muted">Heute fällig: <b>${n}</b> (${per})</p>
    <div class="chips" style="margin:10px 0 16px">${chip("ALL","Alle Module")}${modOrder().map(m=>chip(m,m)).join("")}</div>
    ${n?`<div class="row"><button class="btn" data-n="5">Kurzrunde: 5 Karten</button><button class="btn ghost" data-n="15">Lernblock: 15 Karten</button><button class="btn ghost" data-n="0">Alle fälligen (${n})</button></div>
      <p class="hint" style="margin-top:10px">Kurzrunde etwa 5 bis 10 Minuten, Lernblock 20 bis 30 Minuten. Für die Klausursimulation den Bereich Simulation nutzen.</p>`
     :`<div class="card"><p>Für diese Auswahl ist heute nichts fällig.</p><p class="hint">Neue Karten schaltest du in der Übersicht frei. Zum zusätzlichen Üben eine Frage im Fragenkatalog öffnen.</p><button class="btn" id="toHome">Zur Übersicht</button></div>`}</div>`;
  wireBanner();
  main.querySelectorAll("[data-m]").forEach(c => c.onclick = () => viewTrainStart(c.dataset.m, buildQueue(c.dataset.m).length));
  main.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { const q = buildQueue(modul, Number(b.dataset.n)); SESSION = {modul, queue:q, done:0, total:q.length}; viewTrain(); window.scrollTo(0,0); });
  const h=$("#toHome"); if(h) h.onclick=()=>go("home");
}
function viewTrainDone(){
  const n = SESSION ? SESSION.done : 0, single = SESSION && SESSION.single;
  SESSION = null; document.body.classList.remove("focus");
  if(n) syncNow({unit:true});
  if(single){ go("catalog"); toast("Bewertung gespeichert."); return; }
  main.innerHTML = `<div class="tr"><h1>Runde beendet</h1><div class="card"><p>${n} ${n===1?"Karte":"Karten"} bearbeitet.${hasToken()?" Der Lernstand wird in Drive gesichert.":""}</p>
    <div class="row"><button class="btn" id="toHome">Zur Übersicht</button><button class="btn ghost" id="more">Weiter üben</button></div></div></div>`;
  $("#toHome").onclick=()=>go("home"); $("#more").onclick=()=>go("train");
}
function claudeText(it, answer){
  const M = MODULES[it.modul];
  return `Bitte bewerte meine Klausurantwort wie ein strenger Prüfer (FOM, Soziale Arbeit, ${it.modul} ${M.name}, Dozent ${M.doz}). Nenne fehlende und falsche Punkte und schätze die Punktzahl.\n\n`+
    `Frage${it.punkte?` (${num(it.punkte)} Punkte)`:""}: ${it.frage}\n\n`+
    (it.kern.length?`Kernelemente laut Lernmaterial:\n${it.kern.map(k=>"- "+k).join("\n")}\n\n`:"")+
    (it.mind?`Mindestantwort: ${it.mind}\n\n`:"")+(it.antwort?`Musterantwort: ${it.antwort}\n\n`:"")+
    `Meine Antwort:\n${answer || "(nur im Kopf beantwortet)"}`;
}
function doReveal(it, scheduled){
  const answer = $("#answer").value.trim();
  $("#pre").remove();
  $("#answer").closest("label").remove();
  const p = prog(it.id), f = p ? p.f : 1;
  const post = $("#post"); post.className = "reveal";
  const hasKern = it.kern.length > 0;
  const nf = {r:Math.min(6,f+1), t:f, f:Math.max(1,f-1)};
  post.innerHTML = `
    ${answer?`<div class="box mine"><h3>Deine Antwort</h3><p>${esc(answer)}</p></div>`:""}
    <section class="korr" aria-label="Korrektur">
      ${hasKern?`<h3>Was steht in deiner Antwort?</h3><div id="checks">${it.kern.map((k,i)=>`<label class="check"><input type="checkbox" data-i="${i}"><span class="tick" aria-hidden="true">✓</span><span>${esc(k)}</span></label>`).join("")}</div>`
        :`<h3>Für diese Frage sind noch keine Kernelemente hinterlegt. Mit der Antwort unten vergleichen.</h3>`}
    </section>
    ${it.mind?`<div class="box"><h3>Mindestantwort</h3><p>${esc(it.mind)}</p></div>`:""}
    ${it.antwort?`<div class="box"><h3>${it.mind?"Vollantwort":"Musterantwort"}</h3><p>${esc(it.antwort)}</p></div>`:""}
    ${it.einfach?`<div class="box easy"><h3>${ICON.book}Einfach erklärt</h3><p>${esc(it.einfach)}</p></div>`:""}
    ${it.merk?`<div class="box merk"><h3>Merkhilfe</h3>${merkHTML(it.merk)}</div>`:""}
    ${it.fehler?`<div class="box err"><h3>Typische Fehler</h3><p>${esc(it.fehler)}</p></div>`:""}
    ${it.bild?(PKG && PKG.bilder && PKG.bilder[it.bild]?`<div class="box"><h3>Tafelbild zum Vergleich</h3><img class="wb" src="${PKG.bilder[it.bild]}" alt="Tafelbild zur Frage"></div>`:`<p class="hint" style="margin-top:10px">Tafelbild fehlt im Inhaltspaket: ${esc(it.bild)}</p>`):""}
    <div class="grades" role="group" aria-label="Bewertung">
      <button class="f" data-g="f">Falsch<small>${scheduled?`Fach ${nf.f}`:"Fach bleibt"}</small></button>
      <button data-g="t">Teilweise<small>${scheduled?`bleibt Fach ${nf.t}`:"Fach bleibt"}</small></button>
      <button class="r" data-g="r">Richtig<small>${scheduled?`Fach ${nf.r}`:"Fach bleibt"}</small></button>
    </div>
    <div class="gh">${scheduled?(DEVICE==="PC"?"Tasten 1, 2, 3":""):"Zusatzübung: zählt in der Statistik, das Fach bleibt."}</div>
    <div id="b6"></div>
    <div class="row" style="margin-top:10px"><button class="btn link" id="copyC">Für Claude kopieren</button></div>`;
  const buttons = [...post.querySelectorAll(".grades button")];
  let checked = 0;
  if(hasKern){
    const upd = () => { checked = post.querySelectorAll("#checks input:checked").length; const s = suggestGrade(checked, it.kern.length); buttons.forEach(b=>b.classList.toggle("sugg", b.dataset.g===s)); };
    post.querySelectorAll("#checks input").forEach(c=>c.addEventListener("change", upd)); upd();
  }
  $("#copyC").onclick = async () => { toast(await copyText(claudeText(it, answer)) ? "Kopiert. In einen Claude-Chat einfügen." : "Kopieren nicht möglich."); };
  const finish = g => {
    KEYH = null;
    rate(it, g);
    const d=lsGet("drafts",{}); delete d[it.id]; lsSet("drafts", d);
    SESSION.done++; const id = SESSION.queue.shift();
    if(g==="f" && !SESSION.single) SESSION.queue.splice(Math.min(3, SESSION.queue.length), 0, id);
    viewTrain(); window.scrollTo(0,0);
  };
  buttons.forEach(b => b.onclick = () => {
    const g = b.dataset.g;
    const missing = hasKern ? [...post.querySelectorAll("#checks input")].filter(c=>!c.checked).map(c=>it.kern[Number(c.dataset.i)]) : [];
    if(g==="f" && missing.length) return retype(it, missing, () => finish("f"));
    finish(g);
  });
  KEYH = e => { if(VIEW!=="train" || !buttons[0].isConnected || $("#b6 textarea") || e.target.tagName==="TEXTAREA" || (e.target.tagName==="INPUT" && e.target.type!=="checkbox")) return; const i={"1":0,"2":1,"3":2}[e.key]; if(i!==undefined) buttons[i].click(); };
  (post.querySelector("#checks input") || buttons[1]).focus({preventScroll:true});
}
// Merkhilfe groß setzen: Kurzformel oder erster Satz groß, Rest klein darunter (nur Darstellung)
function merkHTML(t){
  t = String(t||"").trim();
  const big = s => `<span class="mbig">${esc(s)}</span>`, sub = s => s ? `<span class="msub">${esc(s)}</span>` : "";
  let m = /^(.{3,70}?„[^“]{1,20}“)\s*:\s*(.+)$/.exec(t);
  if(m) return big(m[1]) + sub(m[2]);
  if(t.length <= 70) return big(t);
  m = /^(.{12,80}?[.!?])\s+(.+)$/.exec(t);
  if(m && !/\b(z|B|Art|Abs|Nr|bzw|ca|vgl|u|d|h|S|Jh|Std|Mio|Mrd)\.$/.test(m[1])) return big(m[1]) + sub(m[2]);
  return `<p style="font:italic 500 1.2rem/1.45 var(--serif)">${esc(t)}</p>`;
}
// Lastenheft B6: nach „falsch“ die fehlenden Kernelemente einmal selbst nachtippen
function retype(it, missing, done){
  KEYH = null;
  document.querySelectorAll(".grades button").forEach(b=>b.disabled=true);
  const box = $("#b6");
  const need = Math.ceil(missing.join(" ").replace(/\s+/g," ").length * 0.5);
  box.innerHTML = `<div class="box err" style="margin-top:14px"><h3>Einmal nachtippen: Was gefehlt hat</h3><ul style="margin:6px 0 0;padding-left:1.2em">${missing.map(m=>`<li>${esc(m)}</li>`).join("")}</ul></div>
    <label class="field"><span>Fehlende Kernelemente in eigenen Worten (Tippen oder Diktieren)</span><textarea id="rt" style="min-height:110px"></textarea></label>
    <button class="btn" id="rtOk" disabled>Fertig, weiter</button>`;
  const ta = $("#rt"), ok = $("#rtOk");
  ta.oninput = () => ok.disabled = ta.value.replace(/\s+/g," ").trim().length < need;
  ok.onclick = done;
  ta.focus();
}
let KEYH = null;
document.addEventListener("keydown", e => { if(KEYH) KEYH(e); });

/* ---------- Fehlerliste ---------- */
function viewErrors(){
  if(!ITEMS.length) return needsContent();
  const list = ITEMS.filter(i => prog(i.id) && lastGrade(prog(i.id))==="f" && trainable(i))
    .sort((a,b)=> (prog(b.id).hist.at(-1).d).localeCompare(prog(a.id).hist.at(-1).d));
  const weak = ITEMS.filter(i => prog(i.id) && (prog(i.id).lapses||0) >= 2 && lastGrade(prog(i.id))!=="f" && trainable(i));
  const row = i => `<div class="li" data-id="${esc(i.id)}" tabindex="0" role="button">${stBadge(i.status)}<span>${esc(i.frage)}</span><span class="s">Fach ${prog(i.id).f} · ${fmtDate(prog(i.id).hist.at(-1).d).slice(0,6)}</span><span class="why">${i.modul}, ${esc(i.thema)}${prog(i.id).lapses?` · ${prog(i.id).lapses}× falsch`:""}</span></div>`;
  main.innerHTML = `${syncBanner()}<h1>Fehlerliste</h1>
    <p class="hint">Karten, deren letzte Bewertung „falsch“ war. Sie sind morgen wieder fällig. Hier kannst du sie vorher zusätzlich üben, das Fach ändert sich dabei nicht.</p>
    ${list.length?`<div class="row" style="margin:12px 0"><button class="btn" id="drill">Alle ${list.length} jetzt üben</button></div><div class="list">${list.map(row).join("")}</div>`
      :`<div class="card"><p>Keine offenen Fehler.</p></div>`}
    ${weak.length?`<h2>Wiederholt falsch, inzwischen besser</h2><div class="list">${weak.map(row).join("")}</div>`:""}`;
  wireBanner();
  const d=$("#drill"); if(d) d.onclick = () => { VIEW="train"; render({ids:list.map(i=>i.id), label:"Fehler"}); };
  main.querySelectorAll(".li").forEach(li => { const open = () => { VIEW="train"; render({single:li.dataset.id}); window.scrollTo(0,0); }; li.onclick=open; li.onkeydown=e=>{ if(e.key==="Enter") open(); }; });
}

/* ---------- Klausursimulation (Lastenheft E1, E3; Dozentenmuster folgt im Pflichtenheft) ---------- */
let SIMRUN = lsGet("simrun", null);
function saveSimRun(){ lsSet("simrun", SIMRUN); }
function simPts(it){ return it.punkte || RICHTZEIT[it.form] || 6; }
function startSim(m, minutes){
  const D = TRANSFER_DEFAULT[m];
  const transfer = D && minutes >= 60 ? {m, pts:D.punkte} : null;
  let room = minutes - (transfer ? transfer.pts : 0);
  const pool = ITEMS.filter(i => i.modul===m && trainable(i) && ["A","B"].includes(i.status));
  const a = shuffle(pool.filter(i=>i.status==="A")), b = shuffle(pool.filter(i=>i.status==="B"));
  const pick = [];
  for(const it of a.concat(b)){ const p = simPts(it); if(p <= room){ pick.push({id:it.id, pts:p}); room -= p; } if(room < 3) break; }
  SIMRUN = {id:"s"+Date.now(), modul:m, minutes, start:Date.now(), items:pick, transfer, answers:{}, phase:"run", checks:{}, manual:{}};
  saveSimRun(); viewSim();
}
function viewSim(){
  stopClock();
  if(!ITEMS.length) return needsContent();
  if(!SIMRUN){
    const last = SIMS.slice(-8).reverse();
    main.innerHTML = `${syncBanner()}<h1>Klausursimulation</h1>
      <p class="hint">Vorläufige Fassung: Fragen der Stufen A und B, zufällig gemischt, 1 Punkt je Minute, bei 60 und 90 Minuten mit Transferaufgabe. Das genaue Muster je Dozent (Anteile, Punktwerte) folgt im Pflichtenheft. Die Simulation ändert keine Fächer.</p>
      <div class="card"><div class="chips" id="simM">${modOrder().map((m,i)=>`<button class="chip" data-m="${m}" aria-pressed="${i===0}">${m} ${esc(MODULES[m].short)}</button>`).join("")}</div>
        <div class="chips" id="simD" style="margin-top:10px">${[30,60,90].map(n=>`<button class="chip" data-d="${n}" aria-pressed="${n===90}">${n} Minuten</button>`).join("")}</div>
        <div class="row" style="margin-top:14px"><button class="btn" id="simGo">Simulation starten</button></div></div>
      ${last.length?`<h2>Bisherige Ergebnisse</h2><table class="t"><tr><th>Datum</th><th>Modul</th><th>Punkte</th><th>Anteil</th></tr>${last.map(s=>`<tr><td>${fmtDate(s.d)}</td><td>${s.modul}</td><td class="mono">${num(s.punkte)} von ${s.max}</td><td class="mono">${Math.round(s.punkte/s.max*100)} %</td></tr>`).join("")}</table>`:""}`;
    wireBanner();
    const sel = id => { const b=main.querySelector(`#${id} [aria-pressed="true"]`); return b ? (b.dataset.m || Number(b.dataset.d)) : null; };
    main.querySelectorAll("#simM .chip,#simD .chip").forEach(c => c.onclick = () => { c.parentElement.querySelectorAll(".chip").forEach(x=>x.setAttribute("aria-pressed", x===c)); });
    $("#simGo").onclick = () => startSim(sel("simM"), sel("simD"));
    return;
  }
  const R = SIMRUN, M = MODULES[R.modul];
  const its = R.items.map(x => ({x, it:ITEMS.find(i=>i.id===x.id)})).filter(o=>o.it);
  const max = its.reduce((n,o)=>n+o.x.pts,0) + (R.transfer ? R.transfer.pts : 0);
  if(R.phase==="run"){
    main.innerHTML = `<div class="timer" id="tm"><span class="small muted">${R.modul} ${esc(M.short)} · ${max} Punkte</span><b class="mono" id="tmv" style="margin-left:auto">–</b></div>
      ${its.map((o,n)=>`<div class="simq"><div class="qmeta">Aufgabe ${n+1} · ${num(o.x.pts)} Punkte${o.it.form?` · ${esc(o.it.form)}`:""}</div><h3 style="font-size:1.1rem">${esc(o.it.frage)}</h3>
        <textarea data-a="${esc(o.it.id)}">${esc(R.answers[o.it.id]||"")}</textarea></div>`).join("")}
      ${R.transfer?`<div class="simq"><div class="qmeta">Transferaufgabe · ${R.transfer.pts} Punkte</div><h3 style="font-size:1.1rem">${esc(TRANSFER_DEFAULT[R.modul].task)}</h3><textarea data-a="_transfer" style="min-height:240px">${esc(R.answers._transfer||"")}</textarea></div>`:""}
      <div class="row"><button class="btn" id="simEnd">Abgeben</button><button class="btn link" id="simAbort">Abbrechen</button></div>`;
    const tick = () => { const left = R.start + R.minutes*60e3 - Date.now(), s = Math.round(Math.abs(left)/1000);
      $("#tmv").textContent = (left<0?"+":"") + `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; $("#tm").classList.toggle("over", left<0); };
    tick(); CLOCK = setInterval(tick, 1000);
    main.querySelectorAll("textarea[data-a]").forEach(t => t.oninput = () => { R.answers[t.dataset.a] = t.value; saveSimRun(); });
    $("#simEnd").onclick = () => { R.phase="korr"; R.used = Math.round((Date.now()-R.start)/60e3); saveSimRun(); window.scrollTo(0,0); viewSim(); };
    $("#simAbort").onclick = () => { if(confirm("Simulation abbrechen? Die Antworten werden verworfen.")){ SIMRUN=null; saveSimRun(); viewSim(); } };
    return;
  }
  // Korrektur
  const T = R.transfer ? tget(R.modul) : null;
  const score = () => {
    let sum = 0;
    for(const o of its){ const k = o.it.kern.length;
      if(k){ const c = (R.checks[o.it.id]||[]).length; sum += Math.round(c/k*o.x.pts*2)/2; }
      else sum += (R.manual[o.it.id]||0) * o.x.pts; }
    if(R.transfer && T.points.length){ const c=(R.checks._transfer||[]).length; sum += Math.round(c/T.points.length*R.transfer.pts*2)/2; }
    return sum;
  };
  main.innerHTML = `<h1>Korrektur</h1><p class="hint">Hake ab, was in deiner Antwort steht. Die Punkte sind eine Schätzung: Anteil der Kernelemente mal Punktwert.${R.used?` Bearbeitungszeit: ${R.used} von ${R.minutes} Minuten.`:""}</p>
    ${its.map((o,n)=>`<div class="simq"><div class="qmeta">Aufgabe ${n+1} · ${num(o.x.pts)} Punkte</div><h3>${esc(o.it.frage)}</h3>
      <div class="box mine"><h3>Deine Antwort</h3><p>${esc(R.answers[o.it.id]||"(leer)")}</p></div>
      ${o.it.kern.length?`<div class="korr">${o.it.kern.map((k,i)=>`<label class="check"><input type="checkbox" data-q="${esc(o.it.id)}" data-i="${i}" ${(R.checks[o.it.id]||[]).includes(i)?"checked":""}><span class="tick">✓</span><span>${esc(k)}</span></label>`).join("")}</div>`
        :`<div class="ptsin">${[[0,"0"],[0.5,"halb"],[1,"voll"]].map(([v,l])=>`<button class="chip" data-man="${esc(o.it.id)}" data-v="${v}" aria-pressed="${(R.manual[o.it.id]||0)===v}">${l}</button>`).join("")}</div>`}
      ${o.it.mind?`<div class="box"><h3>Mindestantwort</h3><p>${esc(o.it.mind)}</p></div>`:""}
      ${o.it.antwort?`<details><summary>${o.it.mind?"Vollantwort":"Musterantwort"}</summary><div class="box"><p>${esc(o.it.antwort)}</p></div></details>`:""}
      ${o.it.einfach||o.it.merk?`<details><summary>Einfach erklärt und Merkhilfe</summary>${o.it.einfach?`<div class="box easy"><p>${esc(o.it.einfach)}</p></div>`:""}${o.it.merk?`<div class="box merk"><p>${esc(o.it.merk)}</p></div>`:""}</details>`:""}</div>`).join("")}
    ${R.transfer?`<div class="simq"><div class="qmeta">Transferaufgabe · ${R.transfer.pts} Punkte</div><div class="box mine"><h3>Deine Antwort</h3><p>${esc(R.answers._transfer||"(leer)")}</p></div>
      ${T.points.length?`<div class="korr"><h3>Gliederungspunkte getroffen?</h3>${T.points.map((p,i)=>`<label class="check"><input type="checkbox" data-q="_transfer" data-i="${i}" ${(R.checks._transfer||[]).includes(i)?"checked":""}><span class="tick">✓</span><span>${esc(p)}</span></label>`).join("")}</div>`:`<p class="hint">Für diese Transferaufgabe gibt es noch keine Gliederung.</p>`}</div>`:""}
    <div class="timer"><span>Geschätzt</span><b class="mono" id="sc" style="margin-left:auto">–</b></div>
    <div class="row"><button class="btn" id="simSave">Ergebnis speichern</button></div>`;
  const upd = () => { const s = score(); $("#sc").textContent = `${num(s)} von ${max} P. (${Math.round(s/max*100)} %)`; };
  main.querySelectorAll("input[data-q]").forEach(c => c.onchange = () => { const q=c.dataset.q, i=Number(c.dataset.i); const a=new Set(R.checks[q]||[]); c.checked?a.add(i):a.delete(i); R.checks[q]=[...a]; saveSimRun(); upd(); });
  main.querySelectorAll("[data-man]").forEach(b => b.onclick = () => { R.manual[b.dataset.man]=Number(b.dataset.v); main.querySelectorAll(`[data-man="${CSS.escape(b.dataset.man)}"]`).forEach(x=>x.setAttribute("aria-pressed", x===b)); saveSimRun(); upd(); });
  upd();
  $("#simSave").onclick = () => { const s=score(); SIMS.push({id:R.id, d:todayStr(), modul:R.modul, punkte:s, max, minuten:R.minutes, upd:Date.now()}); SIMRUN=null; saveSimRun(); changed({unit:true}); toast(`Gespeichert: ${num(s)} von ${max} Punkten.`); viewSim(); };
}

/* ---------- Transferaufgaben ---------- */
let TMODE = {};
function tget(m){ const d = TRANSFER_DEFAULT[m]; const t = TRANS[m] || {}; return {points: t.points || d.points.slice(), texts: t.texts || {}, hist: t.hist || []}; }
function tsave(m, t, unit){ TRANS[m] = Object.assign({}, TRANS[m]||{}, t, {upd:Date.now()}); changed({unit}); }
function viewTransfer(){
  const order = modOrder();
  let html = `${syncBanner()}<h1>Transferwerkstatt</h1><p class="hint">Ausarbeitung einmal sauber schreiben, dann unter Zeitvorgabe aus dem Kopf wiedergeben und vergleichen. Die Transferaufgaben in M2 und M3 bringen zusammen 21 bis 27 nahezu sichere Punkte.</p>`;
  for(const m of order){
    const D = TRANSFER_DEFAULT[m], t = tget(m), mode = TMODE[m] || "view";
    const filled = t.points.filter(p => (t.texts[p]||"").trim()).length, last = t.hist.at(-1);
    html += `<section class="card" id="tr-${m}" style="border-top:3px solid ${MODULES[m].color}"><h3>${m}: ${esc(D.title)}</h3><p class="small muted">${D.punkte} Punkte${m==="M2"?" (9 bis 12)":""}</p>
      <p>${esc(D.task)}</p><p class="small muted">${esc(D.source)}</p>
      <div class="facts"><span>Ausgearbeitet: <b class="fill">${filled} von ${t.points.length}</b></span><span>Zuletzt geübt: <b>${last?`${fmtDate(last.d)}, ${last.p} %`:"noch nie"}</b></span></div>
      <div class="row" style="margin-top:10px">
        <button class="btn small ${mode==="edit"?"":"ghost"}" data-m="${m}" data-mode="edit">Ausarbeitung bearbeiten</button>
        <button class="btn small ${mode==="drill"?"":"ghost"}" data-m="${m}" data-mode="drill" ${filled?"":"disabled"}>Aus dem Kopf üben</button>
        <button class="btn small ghost" data-m="${m}" data-mode="outline">Gliederung ändern</button>
        <button class="btn link" data-m="${m}" data-mode="md" ${filled?"":"disabled"}>Als Text speichern</button>
      </div><div class="tbody"></div></section>`;
  }
  main.innerHTML = html; wireBanner();
  main.querySelectorAll("button[data-mode]").forEach(b => b.onclick = () => {
    const m=b.dataset.m, md=b.dataset.mode;
    if(md==="md"){ const t=tget(m); download(`Transfer_${m}.md`, `# ${TRANSFER_DEFAULT[m].title}\n\n`+t.points.map(p=>`## ${p}\n\n${t.texts[p]||""}\n`).join("\n"), "text/markdown"); return; }
    TMODE[m] = TMODE[m]===md ? "view" : md; viewTransfer(); $("#tr-"+m).scrollIntoView({block:"start"});
  });
  for(const m of order){
    const box = $(`#tr-${m} .tbody`), t = tget(m), mode = TMODE[m], D = TRANSFER_DEFAULT[m];
    if(mode==="edit"){
      if(!t.points.length){ box.innerHTML = `<p class="hint" style="margin-top:12px">Noch keine Gliederung. Erst über „Gliederung ändern“ die Punkte anlegen.</p>`; continue; }
      box.innerHTML = t.points.map((p,i)=>`<div style="margin-top:14px"><h3>${esc(p)}</h3><textarea data-p="${i}" style="min-height:100px" aria-label="${esc(p)}">${esc(t.texts[p]||"")}</textarea></div>`).join("") + `<p class="hint">Wird beim Tippen gespeichert und abgeglichen.</p>`;
      box.querySelectorAll("textarea").forEach(ta => ta.oninput = () => { const tt=tget(m); tt.texts[tt.points[ta.dataset.p]] = ta.value; tsave(m, {texts:tt.texts, points:tt.points});
        const n = tt.points.filter(p => (tt.texts[p]||"").trim()).length; $(`#tr-${m} .fill`).textContent = `${n} von ${tt.points.length}`;
        $(`#tr-${m}`).querySelectorAll('[data-mode="drill"],[data-mode="md"]').forEach(b => b.disabled = !n); });
    }else if(mode==="outline"){
      box.innerHTML = `<label class="field"><span>Ein Gliederungspunkt pro Zeile</span><textarea id="ol-${m}">${esc(t.points.join("\n"))}</textarea></label><button class="btn" id="olSave-${m}">Gliederung übernehmen</button>`;
      $(`#olSave-${m}`).onclick = () => { const pts=$(`#ol-${m}`).value.split("\n").map(s=>s.trim()).filter(Boolean); tsave(m, {points:pts, texts:tget(m).texts}); TMODE[m]="edit"; viewTransfer(); toast("Gliederung übernommen."); };
    }else if(mode==="drill"){
      box.innerHTML = `<div class="timer" style="margin-top:12px"><span>Zeitvorgabe ${D.punkte} Minuten</span><b class="mono" id="tclk-${m}" style="margin-left:auto">0:00</b></div>` +
        t.points.map((p,i)=>`<div style="margin-top:14px"><h3>${esc(p)}</h3><textarea data-p="${i}" style="min-height:90px" aria-label="${esc(p)}"></textarea><div class="cmp" hidden></div></div>`).join("") +
        `<button class="btn" id="tcheck-${m}" style="margin-top:12px">Mit Ausarbeitung vergleichen</button><div id="tres-${m}"></div>`;
      const st=Date.now(), el=$(`#tclk-${m}`);
      stopClock(); CLOCK = setInterval(()=>{ const s=Math.floor((Date.now()-st)/1000); el.textContent=`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; el.style.color = s>D.punkte*60 ? "var(--red)" : ""; },1000);
      $(`#tcheck-${m}`).onclick = () => {
        stopClock();
        box.querySelectorAll(".cmp").forEach((c,i)=>{ c.hidden=false;
          c.innerHTML = `<div class="box"><h3>Deine Ausarbeitung</h3><p>${esc(t.texts[t.points[i]]||"(leer)")}</p></div><label class="check"><input type="checkbox" class="tok"><span class="tick" aria-hidden="true">✓</span><span>Kern dieses Punktes getroffen</span></label>`; });
        $(`#tcheck-${m}`).remove();
        $(`#tres-${m}`).innerHTML = `<button class="btn" id="tsave-${m}" style="margin-top:12px">Ergebnis speichern</button>`;
        $(`#tsave-${m}`).onclick = () => { const all=box.querySelectorAll(".tok"), ok=box.querySelectorAll(".tok:checked").length; const pc=Math.round(ok/all.length*100);
          const tt=tget(m); tt.hist.push({d:todayStr(), p:pc}); tsave(m,{hist:tt.hist, points:tt.points, texts:tt.texts}, true); TMODE[m]="view"; viewTransfer(); toast(`Gespeichert: ${pc} % der Punkte getroffen.`); };
      };
    }
  }
}

/* ---------- Fragenkatalog (Lastenheft E2, C3: Belege hier sichtbar) ---------- */
let CAT = {modul:"ALL", status:"ALL", q:""};
function stateLabel(it){
  if(it.status==="X") return "ausgeschlossen";
  if(it.offen) return "ohne Antwort";
  const p = prog(it.id);
  if(!p) return "neu";
  if(isDue(it)) return `Fach ${p.f}, fällig`;
  return `Fach ${p.f}, ${fmtDate(p.due).slice(0,6)}`;
}
function viewCatalog(){
  if(!ITEMS.length) return needsContent();
  const f = ITEMS.filter(i => (CAT.modul==="ALL"||i.modul===CAT.modul) && (CAT.status==="ALL"||i.status===CAT.status)
    && (!CAT.q || (i.frage+" "+i.thema+" "+i.antwort+" "+i.id).toLowerCase().includes(CAT.q.toLowerCase())));
  const chip = (k,v,l) => `<button class="chip" data-k="${k}" data-v="${v}" aria-pressed="${CAT[k]===v}">${l}</button>`;
  main.innerHTML = `<h1>Fragenkatalog</h1>
    <p class="hint">Alle Fragen mit Einstufung und Beleg. Antippen öffnet die Frage zum Üben. Noch nicht freigeschaltete Karten kommen dabei in Fach 1.</p>
    <div class="chips" style="margin:10px 0">${chip("modul","ALL","Alle Module")}${Object.keys(MODULES).sort().map(m=>chip("modul",m,m)).join("")}</div>
    <div class="chips" style="margin:0 0 10px">${chip("status","ALL","Alle Stufen")}${["A","B","C","X","?"].map(s=>chip("status",s,`${s} ${STATUS[s].label}`)).join("")}</div>
    <input type="search" id="q" placeholder="Suchen" value="${esc(CAT.q)}" aria-label="Fragen durchsuchen">
    <p class="small muted" style="margin:10px 0 6px">${f.length} Fragen</p>
    <div class="list">${f.map(i=>`<div class="li" data-id="${esc(i.id)}" tabindex="0" role="button">
      ${stBadge(i.status)}<span>${esc(i.frage)}</span><span class="s">${esc(stateLabel(i))}</span>
      <span class="why">${esc(i.id)} · ${esc(i.thema)}${i.punkte?` · ${num(i.punkte)} P.`:""}${i.beleg?` · Beleg: ${esc(i.beleg)}`:""}${i.hinweis?` · Dozent: ${esc(i.hinweis)}`:""}</span></div>`).join("")}</div>`;
  main.querySelectorAll(".chip").forEach(c => c.onclick = () => { CAT[c.dataset.k]=c.dataset.v; viewCatalog(); });
  const q=$("#q"); q.oninput = () => { CAT.q=q.value; const pos=q.selectionStart; viewCatalog(); const n=$("#q"); n.focus(); n.setSelectionRange(pos,pos); };
  main.querySelectorAll(".li").forEach(li => {
    const open = () => { const it=ITEMS.find(i=>i.id===li.dataset.id); if(!trainable(it)){ toast(it.offen ? "Für diese Frage gibt es noch keine Musterantwort." : "Diese Frage ist ausgeschlossen oder überholt."); return; } VIEW="train"; render({single:it.id}); window.scrollTo(0,0); };
    li.onclick = open; li.onkeydown = e => { if(e.key==="Enter") open(); };
  });
}

/* ---------- Lernstatistik und Veränderungen (Lastenheft E2) ---------- */
function viewStats(){
  if(!ITEMS.length) return needsContent();
  if(DIFF && !DIFF.gesehen){ DIFF.gesehen = true; lsSet("diff", DIFF); }
  const t = dayNum(todayStr()), days = [...Array(14)].map((_,i)=>numDay(t-13+i));
  const cnt = {}; days.forEach(d=>cnt[d]={r:0,t:0,f:0});
  Object.values(PROG).forEach(p => (p.hist||[]).forEach(h => { if(cnt[h.d]) cnt[h.d][h.g]++; }));
  const maxN = Math.max(1, ...days.map(d=>cnt[d].r+cnt[d].t+cnt[d].f));
  const tot = days.reduce((a,d)=>({r:a.r+cnt[d].r, t:a.t+cnt[d].t, f:a.f+cnt[d].f}), {r:0,t:0,f:0}), sum = tot.r+tot.t+tot.f;
  let html = `<h1>Lernstatistik</h1>
    <div class="card"><h3>Letzte 14 Tage</h3><p class="small muted">${sum} Bewertungen: ${tot.r} richtig, ${tot.t} teilweise, ${tot.f} falsch${sum?` (${Math.round(tot.r/sum*100)} % richtig)`:""}</p>
      <div class="bars" role="img" aria-label="Bewertungen pro Tag">${days.map(d=>{ const c=cnt[d], h=v=>Math.round(v/maxN*100); return `<div title="${fmtDate(d)}: ${c.r} richtig, ${c.t} teilweise, ${c.f} falsch"><i style="height:${h(c.f)}%;background:var(--sF)"></i><i style="height:${h(c.t)}%;background:var(--sT)"></i><i style="height:${h(c.r)}%;background:var(--sR)"></i></div>`; }).join("")}</div>
      <div class="bl mono">${days.map(d=>`<span>${d.slice(8)}</span>`).join("")}</div>
      <div class="facts"><span><i class="dot" style="--mc:var(--sR)"></i> richtig</span><span><i class="dot" style="--mc:var(--sT)"></i> teilweise</span><span><i class="dot" style="--mc:var(--sF)"></i> falsch</span></div></div>
    <table class="t"><tr><th>Modul</th><th>Fach 1–6</th><th>Frei&shy;geschaltet</th><th>Neu</th><th>Lücken</th><th>Simulation</th></tr>
    ${modOrder().map(m=>{ const s=moduleStats(m), sim=SIMS.filter(x=>x.modul===m).at(-1);
      return `<tr><td>${m}</td><td class="mono">${s.fach.join(" · ")}</td><td class="mono">${s.unl.length} von ${s.scope.length}</td><td class="mono">${s.fresh.length}</td><td class="mono">${s.gaps.length}</td><td class="mono">${sim?`${Math.round(sim.punkte/sim.max*100)} % (${fmtDate(sim.d).slice(0,6)})`:"–"}</td></tr>`; }).join("")}</table>`;
  if(DIFF){
    const name = id => { const i = ITEMS.find(x=>x.id===id); return i ? `${esc(id)}: ${esc(i.frage)}` : esc(id); };
    html += `<h2>Veränderungen im letzten Inhaltspaket (${fmtDT(DIFF.at)})</h2>
      ${DIFF.neu.length?`<h3>Neu (${DIFF.neu.length})</h3><ul class="small">${DIFF.neu.map(id=>`<li>${name(id)}</li>`).join("")}</ul>`:""}
      ${DIFF.geaendert.length?`<h3>Geändert (${DIFF.geaendert.length})</h3><ul class="small">${DIFF.geaendert.map(id=>`<li>${name(id)}</li>`).join("")}</ul>`:""}`;
  }
  main.innerHTML = html;
}

/* ---------- Daten und Einrichtung ---------- */
function viewData(){
  const setupLink = LOCAL.cid ? `${location.origin}${location.pathname}#cid=${encodeURIComponent(LOCAL.cid)}` : "";
  const st = s => `<button class="chip" data-st="${s}" aria-pressed="${SET.statuses.includes(s)}">${s} ${STATUS[s].label}</button>`;
  main.innerHTML = `<h1>Daten und Einstellungen</h1>
    <h2>Google Drive</h2>
    <div class="card">
      ${hasToken()?`<p>Angemeldet${LOCAL.email?` als <b>${esc(LOCAL.email)}</b>`:""}. Letzter Abgleich: ${LOCAL.lastSync?fmtDT(LOCAL.lastSync):"–"}.</p>
        <div class="row"><button class="btn" id="syncBtn">Jetzt abgleichen</button><button class="btn ghost" id="logoutBtn">Abmelden</button></div>`
      : LOCAL.cid ? `<p>Nicht angemeldet.${pending()?" Es gibt Änderungen, die noch nicht in Drive sind.":""}</p><button class="btn" id="loginBtn">Mit Google anmelden</button>` : `<p>Noch nicht eingerichtet.</p>`}
      <p class="hint" style="margin-top:10px">Die App sieht in deinem Drive nur, was sie selbst angelegt hat: den Ordner ${FOLDER_NAME} (Lernstand, Inhaltspaket, Sicherungen) und den Ordner 00_Eingang für Erfassungen. Auf alle anderen Dateien hat sie keinen Zugriff. Google Kalender liest sie nur, ändern kann sie dort nichts.</p>
      <details ${LOCAL.cid?"":"open"}><summary>Client-ID ${LOCAL.cid?"ändern":"eintragen"}</summary>
        <label class="field"><span>Client-ID aus der Google Cloud Console (endet auf .apps.googleusercontent.com)</span><input type="text" id="cid" value="${esc(LOCAL.cid)}" autocomplete="off" spellcheck="false"></label>
        <button class="btn small" id="cidSave">Speichern</button></details>
    </div>
    ${LOCAL.cid?`<h2>Handy einrichten</h2><div class="card">
      <p class="small">Diesen Link auf dem Handy in Chrome öffnen. Er trägt die Client-ID ein, danach nur noch „Mit Google anmelden“.</p>
      <input type="text" readonly value="${esc(setupLink)}" id="setupLink" style="font-size:.8rem">
      <div class="row" style="margin-top:8px"><button class="btn small" id="copyLink">Link kopieren</button></div>
      <p class="hint" style="margin-top:8px">Am bequemsten: in Brave in der Adresszeile auf „Teilen“ bzw. das QR-Symbol klicken, nachdem du den Link geöffnet hast, und den QR-Code mit der Handykamera scannen. Oder den Link per Mail oder Notiz an dich selbst schicken. Auf dem Handy dann im Chrome-Menü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“.</p></div>`:""}
    <h2>Inhalte</h2>
    <div class="card">
      ${PKG?`<table class="t"><tr><th>Stand</th><td>${fmtDT(PKG.erstellt)}, erstellt am ${esc(PKG.geraet||"PC")} aus ${esc(PKG.quelle||"–")}</td></tr>
        <tr><th>Umfang</th><td>${ITEMS.length} Fragen: ${BUILD.cards} Karteikarten, ${BUILD.meta} Einträge der Prüfungsebene, ${BUILD.merk||0} Merkhilfen, ${Object.keys(PKG.bilder||{}).length} Bilder</td></tr>
        <tr><th>Dateien</th><td class="small">${BUILD.files.map(esc).join("<br>")}</td></tr></table>
        ${BUILD.warnings.length?`<details><summary>${BUILD.warnings.length} Hinweise zu den Dateien</summary><ul class="small">${BUILD.warnings.map(w=>`<li>${esc(w)}</li>`).join("")}</ul></details>`:`<p class="small muted">Keine Auffälligkeiten.</p>`}`
        :`<p>Noch kein Inhaltspaket geladen.</p>`}
      ${DEVICE==="PC"?`<p class="hint" style="margin-top:10px">Nach jeder Nachbereitung im Modulchat: „Inhalte nach Drive“, dann den Ordner Studium bzw. Studium_Cloudkopie wählen. Gelesen werden nur karten.csv, Pruefung/pruefung_Mx.csv, Pruefung/merkhilfen_Mx.csv und die dort genannten Bilder. Das Handy holt sich das neue Paket beim nächsten Abgleich.</p>
        <button class="btn" id="pushBtn">Inhalte nach Drive</button>`:`<p class="hint" style="margin-top:10px">Neue Inhalte erstellst du am PC. Das Handy lädt sie beim Abgleich automatisch.</p>`}
    </div>
    <h2>Sicherungen in Drive</h2>
    <div class="card"><p class="hint">Nach jeder Lerneinheit legt die App eine Sicherung in ${FOLDER_NAME}/Sicherungen ab. Die letzten 10 bleiben erhalten.</p>
      <button class="btn small ghost" id="bkList" ${hasToken()?"":"disabled"}>Sicherungen anzeigen</button><div id="bk"></div>
      <div class="row" style="margin-top:10px"><button class="btn link" id="expBtn">Lernstand als Datei herunterladen</button></div></div>
    <h2>Training</h2>
    <div class="chips" style="margin-bottom:12px"><button class="chip" id="autoU" aria-pressed="${!!SET.autoUnlock}">Neue Karten automatisch in Fach 1</button></div>
    <p class="small muted">Welche Stufen trainiert werden (Standard A und B, C nur als Zusatz, X nie)</p><div class="chips">${["A","B","C","?"].map(st).join("")}</div>
    <h2>Klausurtermine</h2>
    <p class="hint">Die letzte Wiederholung liegt spätestens zwei Tage vor der Klausur. Bei Terminänderung hier anpassen.</p>
    ${Object.keys(MODULES).sort().map(m=>`<label class="field" style="max-width:280px"><span>${m} ${esc(MODULES[m].short)}</span><input type="date" data-exam="${m}" value="${examOf(m)}"></label>`).join("")}
    <p class="small muted" style="margin-top:24px">Version ${VERSION} · Gerät: ${DEVICE}</p>`;
  const on = (id, fn) => { const el=$("#"+id); if(el) el.onclick=fn; };
  on("syncBtn", () => syncNow({unit:true})); on("logoutBtn", () => { logout(); viewData(); }); on("loginBtn", login);
  on("cidSave", () => { const v=$("#cid").value.trim(); if(v && !/\.apps\.googleusercontent\.com$/.test(v)){ toast("Das sieht nicht wie eine Client-ID aus (Endung .apps.googleusercontent.com)."); return; } LOCAL.cid=v; G.client=null; persistLocal(); toast("Gespeichert."); viewData(); renderSync(); });
  on("copyLink", async () => toast(await copyText(setupLink) ? "Link kopiert." : "Kopieren nicht möglich, Link markieren und kopieren."));
  on("pushBtn", pushContent);
  on("expBtn", () => download(`lernstand_${todayStr()}.json`, JSON.stringify(stateObj())));
  on("bkList", async () => {
    const box = $("#bk"); box.innerHTML = `<p class="small muted">Lade …</p>`;
    try{
      const list = await listBackups();
      box.innerHTML = list.length ? `<table class="t" style="margin-top:8px">${list.map(f=>`<tr><td>${fmtDT(f.createdTime)}</td><td class="small">${esc(f.name.replace(/^lernstand_|\.json$/g,""))}</td><td><button class="btn link" data-bk="${f.id}">Übernehmen</button></td></tr>`).join("")}</table>` : `<p class="small muted">Noch keine Sicherung.</p>`;
      box.querySelectorAll("[data-bk]").forEach(b => b.onclick = async () => {
        if(!confirm("Diesen gesicherten Stand übernehmen? Alles, was du danach gelernt hast, wird durch die Sicherung ersetzt, auch auf dem anderen Gerät.")) return;
        try{
          const d = await readJSON(b.dataset.bk), now = Date.now();
          PROG = d.prog || {}; Object.values(PROG).forEach(p => p.upd = now);
          TRANS = d.transfer || {}; Object.values(TRANS).forEach(t => t.upd = now);
          SIMS = d.sims || []; if(d.settings){ SET = Object.assign({statuses:["A","B"], exams:{}}, d.settings, {upd:now}); }
          LOCAL.ids.lernstand && await writeJSON(LOCAL.ids.lernstand, "lernstand.json", null, stateObj());
          changed(); toast("Sicherung übernommen."); go("home");
        }catch(e){ toast("Übernehmen fehlgeschlagen: " + e.message); }
      });
    }catch(e){ box.innerHTML = `<p class="small">Nicht möglich: ${esc(e.message)}</p>`; }
  });
  on("autoU", () => { SET.autoUnlock = !SET.autoUnlock; SET.upd = Date.now(); if(SET.autoUnlock) autoUnlock(); changed(); viewData(); });
  main.querySelectorAll("[data-st]").forEach(c => c.onclick = () => { const s=c.dataset.st; SET.statuses = SET.statuses.includes(s) ? SET.statuses.filter(x=>x!==s) : SET.statuses.concat(s); if(!SET.statuses.length) SET.statuses=["A"]; SET.upd=Date.now(); autoUnlock(); changed(); viewData(); });
  main.querySelectorAll("[data-exam]").forEach(i => i.onchange = () => { if(!i.value) return; SET.exams[i.dataset.exam] = i.value; SET.upd=Date.now(); changed(); toast("Termin gespeichert."); });
}

