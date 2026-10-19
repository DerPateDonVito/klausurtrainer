"use strict";
/* ============================================================
   Statistik (Lastenheft H6, Design Variante C „Lernjournal“, gewählt 19.10.2026)
   (a) gesicherte Punkte je Modul, (b) Schwachstellen als Runde, (c) Lernpensum mit Vorschau und Lernzeit,
   (d) Lernserie ohne Ruhetag. Darunter die bisherige Statistik (E2) als „Details“.
   Liest nur. Lernstand und Lernlogik werden hier nie verändert.
   ============================================================ */

// Lerntage: jede Bewertung, jede gespeicherte Simulation und jede Transfer-Übung zählt (H6 d: ohne Ruhetag)
function statTage(){
  const T = {};
  const add = (d, g) => { if(!d) return; const x = T[d] || (T[d] = {r:0, t:0, f:0, n:0}); if(g && x[g] !== undefined){ x[g]++; x.n++; } };
  Object.values(PROG).forEach(p => (p.hist || []).forEach(h => add(h.d, h.g)));
  SIMS.forEach(s => add(s.d));
  Object.values(TRANS).forEach(t => (t.hist || []).forEach(h => add(h.d)));
  return T;
}
function statSerie(T){
  const heute = dayNum(todayStr()), da = d => !!T[numDay(d)];
  const ende = da(heute) ? heute : heute - 1;
  let akt = 0; for(let d = ende; da(d); d--) akt++;
  let best = 0, lauf = 0, vor = null;
  for(const d of Object.keys(T).map(dayNum).sort((a, b) => a - b)){ lauf = (vor !== null && d === vor + 1) ? lauf + 1 : 1; best = Math.max(best, lauf); vor = d; }
  return {akt, best, heute: da(heute), ende};
}
// Lernzeit in Sekunden je Tag, alle Geräte zusammen (kt2.zeit, ab 1.4.0)
function statZeit(){ const Z = lsGet("zeit", {}), o = {}; for(const d in Z) o[d] = Object.values(Z[d] || {}).reduce((a, b) => a + (Number(b) || 0), 0); return o; }
function fmtDauer(sek){ const m = Math.round(sek / 60); return m < 60 ? `${m} Min.` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`; }

// (a) Gesicherte Punkte: Punktwerte der Fragen in Fach 4 bis 6 im Verhältnis zum Fragenbestand.
// Ohne Punktwert vom Dozenten gilt die Richtzeit (1 Punkt je Minute), wie in der Simulation.
function statPunkte(m){
  const bestand = ITEMS.filter(i => i.modul === m && i.status !== "X" && SET.statuses.includes(i.status) && i.gueltig !== "überholt" && i.gueltig !== "ueberholt");
  let ges = 0, sum = 0, geschaetzt = 0, luecken = 0;
  for(const i of bestand){
    const p = simPts(i); sum += p;
    if(!i.punkte) geschaetzt++;
    if(i.offen) luecken++;
    const pr = prog(i.id); if(pr && pr.f >= 4 && trainable(i)) ges += p;
  }
  return {ges, sum, n: bestand.length, geschaetzt, luecken, pct: sum ? Math.round(ges / sum * 100) : 0};
}

// (b) Schwachstellen je Frage: mindestens 2 Antworten, Fehlerquote (falsch = 1, teilweise = 0,5) ab 40 %
function statSchwach(){
  return ITEMS.filter(trainable).map(i => {
    const h = (prog(i.id) || {}).hist || [], f = h.filter(x => x.g === "f").length, t = h.filter(x => x.g === "t").length;
    return {i, n: h.length, f, t, q: h.length ? (f + t / 2) / h.length : 0};
  }).filter(x => x.n >= 2 && x.q >= 0.4).sort((a, b) => b.q - a.q || b.n - a.n || a.i.id.localeCompare(b.i.id, "de", {numeric: true}));
}

// (c) Vorschau: fällige Karten je Tag laut heutigem Stand (morgen bis in 7 Tagen)
function statVorschau(){
  const heute = dayNum(todayStr()), tage = [...Array(7)].map((_, k) => heute + 1 + k), cnt = {};
  ITEMS.forEach(i => { const p = prog(i.id); if(p && p.due && inScope(i)) { const d = dayNum(p.due); if(d > heute && d <= heute + 7) cnt[d] = (cnt[d] || 0) + 1; } });
  return tage.map(d => ({d, n: cnt[d] || 0}));
}

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const wtag = d => WT[new Date(d * 864e5).getUTCDay()];

function viewStatistik(){
  if(!ITEMS.length) return needsContent();
  const diffNeu = DIFF && !DIFF.gesehen;
  viewStats();                                  // bisherige Statistik (E2), unverändert, als „Details“
  const alt = main.innerHTML.replace(/^\s*<h1>Lernstatistik<\/h1>/, "");

  const T = statTage(), S = statSerie(T), Z = statZeit(), heute = dayNum(todayStr());
  const titel = S.heute ? (S.akt === 1 ? "Heute gelernt." : `Seit <em>${S.akt} Tagen</em> jeden Tag gelernt.`)
    : S.akt ? `<em>${S.akt} ${S.akt === 1 ? "Tag" : "Tage"}</em> in Folge, heute fehlt noch.` : "Noch keine Lernserie.";

  // Kalender: 5 Wochen, Montag bis Sonntag, die aktuelle Woche unten
  const wd = (new Date(heute * 864e5).getUTCDay() + 6) % 7, start = heute - wd - 28;
  const zellen = [...Array(35)].map((_, k) => {
    const d = start + k, iso = numDay(d);
    let cls = "c0", lab = `${fmtDate(iso)}: nicht gelernt`;
    if(d > heute){ cls = "cz"; lab = `${fmtDate(iso)}: kommt noch`; }
    else if(T[iso]){ const inSerie = S.akt && d <= S.ende && d > S.ende - S.akt; cls = inSerie ? "c2" : "c1"; lab = `${fmtDate(iso)}: ${T[iso].n} Antworten`; }
    return `<span class="${cls}${d === heute ? " ch" : ""}" title="${esc(lab)}"></span>`;
  }).join("");

  // Letzte 7 Tage
  const tage7 = [...Array(7)].map((_, k) => heute - 6 + k);
  const w = tage7.reduce((a, d) => { const x = T[numDay(d)]; if(x){ a.r += x.r; a.t += x.t; a.f += x.f; } a.z += Z[numDay(d)] || 0; return a; }, {r:0, t:0, f:0, z:0});
  const wn = w.r + w.t + w.f, maxN = Math.max(1, ...tage7.map(d => (T[numDay(d)] || {n:0}).n));
  const balken = tage7.map(d => { const x = T[numDay(d)] || {r:0, t:0, f:0, n:0}, h = v => (v / maxN * 100).toFixed(1);
    return `<span title="${fmtDate(numDay(d))}: ${x.r} richtig, ${x.t} teilweise, ${x.f} falsch"><i style="height:${h(x.f)}%;background:var(--sF)"></i><i style="height:${h(x.t)}%;background:var(--sT)"></i><i style="height:${h(x.r)}%;background:var(--sR)"></i></span>`; }).join("");

  const vor = statVorschau(), vorSum = vor.reduce((a, x) => a + x.n, 0);
  const P = modOrder().map(m => ({m, ...statPunkte(m)})), est = P.reduce((a, x) => a + x.geschaetzt, 0), alle = P.reduce((a, x) => a + x.n, 0);
  const sw = statSchwach(), runde = sw.slice(0, 8).map(x => x.i.id);
  const zeitSeit = Object.keys(Z).sort()[0];

  main.innerHTML = `<div class="stat">
    <header class="shead"><span class="kicker">Lernjournal · Woche ${isoWeek(new Date())}</span><h1>${titel}</h1></header>
    <div class="scols"><div class="scol">
      <section class="tile" aria-label="Lernserie">
        <div class="sbox">
          <div class="cal-h" aria-hidden="true"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div>
          <div class="cal" role="img" aria-label="Lerntage der letzten fünf Wochen, aktuelle Serie ${S.akt} Tage">${zellen}</div>
          <p class="hint" style="margin:0">Längste Serie: ${S.best} ${S.best === 1 ? "Tag" : "Tage"}. Ein Tag zählt ab einer Antwort, ohne Ruhetag.</p>
        </div>
      </section>
      <section class="tile" aria-label="Letzte 7 Tage">
        <span class="kicker">Letzte 7 Tage</span>
        <div class="sbox">
          <div class="snums">
            <div><strong class="mono">${wn}</strong><span>${wn === 1 ? "Antwort" : "Antworten"}${wn ? `, ${Math.round(w.r / wn * 100)} % richtig` : ""}</span></div>
            <div><strong class="mono">${fmtDauer(w.z)}</strong><span>Lernzeit${zeitSeit ? ` seit ${fmtDate(zeitSeit).slice(0, 6)}` : ", wird ab jetzt gemessen"}</span></div>
          </div>
          <div class="sbars" role="img" aria-label="Antworten je Tag der letzten 7 Tage">${balken}</div>
          <div class="sdays" aria-hidden="true">${tage7.map(d => `<span>${d === heute ? "heute" : wtag(d)}</span>`).join("")}</div>
          <div class="facts" style="margin:0"><span><i class="dot" style="--mc:var(--sR)"></i> richtig</span><span><i class="dot" style="--mc:var(--sT)"></i> teilweise</span><span><i class="dot" style="--mc:var(--sF)"></i> falsch</span></div>
        </div>
      </section>
    </div><div class="scol">
      <section class="tile" aria-label="Vorschau">
        <div class="tile-h"><span class="kicker">Nächste 7 Tage fällig</span><span class="tile-n mono">${vorSum}</span></div>
        <div class="svor">${vor.map(x => `<div><span>${wtag(x.d)}</span><strong class="mono">${x.n}</strong></div>`).join("")}</div>
      </section>
      <section class="tile" aria-label="Gesicherte Punkte">
        <span class="kicker">Gesicherte Punkte${est ? " · geschätzt" : ""}</span>
        <div class="cd">${P.map(x => `<div class="cdb mx-${x.m}" title="${x.m}: Fragen in Fach 4 bis 6 im Verhältnis zum Fragenbestand">
          <span>${x.m}</span><strong class="mono">${x.pct} %</strong><span>${x.geschaetzt ? "≈ " : ""}${Math.round(x.ges)} / ${Math.round(x.sum)} P.</span></div>`).join("")}</div>
        <p class="hint" style="margin:0">Lücken: ${P.map(x => `${x.m} ${x.luecken}`).join(" · ")} Fragen ohne Musterantwort.${est ? ` ${est} von ${alle} Fragen ohne Punktwert vom Dozenten, dort zählt die Richtzeit (1 Punkt je Minute).` : ""}</p>
      </section>
      <section class="tile" aria-label="Schwachstellen">
        <span class="kicker">Schwachstellen</span>
        ${sw.length ? `<ol class="sweak">${sw.slice(0, 3).map(x => `<li>${esc(x.i.frage)} <span class="muted">· ${x.i.modul} · ${x.f} von ${x.n} falsch${x.t ? `, ${x.t} teilweise` : ""}</span></li>`).join("")}</ol>
          <button type="button" class="btn ghost big" id="swRunde">Als Runde üben (${runde.length} ${runde.length === 1 ? "Frage" : "Fragen"})</button>`
          : `<p class="hint" style="margin:0">Noch keine Schwachstellen: Eine Frage zählt ab 2 Antworten mit mindestens 40 % Fehlern (teilweise zählt halb).</p>`}
      </section>
    </div></div>
    <details class="sdet"${diffNeu ? " open" : ""}><summary>Details: Fächer, Simulationen, Veränderungen im Inhaltspaket</summary>${alt}</details>
  </div>`;
  const b = $("#swRunde"); if(b) b.onclick = () => { ORIGIN = "stats"; SESSION = null; VIEW = "train"; render({ids: runde, label: "Schwachstellen"}); window.scrollTo(0, 0); };
}
