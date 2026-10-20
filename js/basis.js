"use strict";
/* ============================================================
   Konfiguration
   ============================================================ */
const VERSION = "1.6.0 (20.10.2026)";
// Selbstheilung (ab 1.4.2, verbessert 1.4.3): Passt die geladene Startseite nicht zu dieser Programmdatei (alte
// index.html aus einem Zwischenspeicher, neue Dateien vom Server), die Startseite einmal mit Zeitstempel in der Adresse
// frisch vom Server holen. Höchstens einmal je Sitzung und Version. Danach den Zeitstempel aus der Adresse entfernen.
(function(){
  let v = null; try{ v = new URL(document.currentScript.src).searchParams.get("v"); }catch(e){}
  const ok = !v || VERSION.startsWith(v + " ");
  if(ok){
    try{ sessionStorage.removeItem("sb.heal"); }catch(e){}
    if(/[?&]sbt=/.test(location.search)) try{ history.replaceState(null, "", location.pathname + location.hash); }catch(e){}
    return;
  }
  let done = false; try{ done = sessionStorage.getItem("sb.heal") === VERSION; sessionStorage.setItem("sb.heal", VERSION); }catch(e){ done = true; }
  if(done) return;
  location.replace(location.pathname + "?sbt=" + Date.now() + location.hash);
  throw new Error("Startseite veraltet, wird neu geladen");
})();
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_NAME = "Klausurtrainer";
const MODULES = {
  M2:{name:"Aufbau des Sozialsystems und Sozialpolitik", short:"Sozialsystem", doz:"Boroch", exam:"2027-01-14", color:"var(--m2)",
      rule:"Freitext, keine MC. Systeme grafisch und schriftlich. 90 Punkte, bestanden ab 45."},
  M3:{name:"Lebensphasenorientierte Handlungsfelder", short:"Lebensphasen", doz:"Herberg", exam:"2027-01-22", color:"var(--m3)",
      rule:"Freitext, keine MC. Die KR-Fragen ergeben die Klausur. Tätigkeiten eindeutig benennen."},
  M1:{name:"Grundlagen der Sozialen Arbeit", short:"Grundlagen", doz:"Thiele", exam:"2027-01-28", color:"var(--m1)",
      rule:"Überwiegend freie Fragen. Klausur wie die Übungsblätter. Zusammenhang vor Definition."}
};
const STATUS = {
  A:{label:"Offiziell", long:"Vom Dozenten als Übungs- oder Klausurfrage ausgegeben"},
  B:{label:"Betont", long:"Vom Dozenten angekündigt oder klar betont"},
  C:{label:"Abgeleitet", long:"Aus Lernzielen, Skript oder Vorlesung abgeleitet"},
  X:{label:"Ausgeschlossen", long:"Vom Dozenten ausdrücklich ausgeschlossen"},
  "?":{label:"Unbewertet", long:"Karte ohne Eintrag in der Prüfungsebene"}
};
const RICHTZEIT = {Nennen:3, Definition:4, Erklären:6, Verständnis:6, Vergleichen:6, Vergleich:6, Zeichnen:8, Fall:10, Transfer:10};
// Lastenheft B4: 6 Fächer, Abstände 1-3-7-14-30 Tage. Fach 1 und 2: nächster Tag.
const IVL = {1:1, 2:1, 3:3, 4:7, 5:14, 6:30};
const CYCLE = 25; // Tage von Fach 1 bis Fach 6 bei durchgehend „richtig“
const TRANSFER_DEFAULT = {
  M3:{title:"Theorie-Praxis-Transferaufgabe (Herberg)", punkte:15, known:true,
      task:"Recherchieren Sie in der Nähe Ihres Wohnortes ein Angebot der Sozialen Arbeit für Kinder, Jugendliche oder Familien (SGB VIII §§ 16-21, §§ 22-26, §§ 27-41) und beschreiben Sie es kurz.",
      source:"Skript S. 196, dazu S. 167 und 194. Herberg: 15 Punkte, vorab bekannt, gleiche Aufgabe in der Klausur (V1 2:37:55).",
      points:["Name des Angebots","Art des Angebots","Rechtliche Verortung im SGB VIII","Zielsetzung des Angebots","Arbeitsprinzipien (wie wird gearbeitet?)","Besondere Methoden und Techniken"]},
  M2:{title:"Transferaufgabe Träger des Sozialen (Boroch)", punkte:12, known:false,
      task:"Noch nicht ausgegeben. Thema laut Skript Teil 2, Folie 61: Kapitel 3.2 Träger des Sozialen (Folien 61-79). Gliederung anpassen, sobald die Aufgabe vorliegt.",
      source:"Folie: 10 % = 9 Punkte, mündlich meistens 12 (V1 1:25:02-1:27:18). Gliederung unten ist vorläufig.",
      points:["Leistungsträger bzw. Kostenträger (Bund, Länder, Kommunen, Sozialversicherungen)","Leistungserbringer: öffentliche Träger","Leistungserbringer: frei-gemeinnützige Träger (Spitzenverbände der Wohlfahrtspflege)","Privat-gewerbliche Träger","Sozialrechtliches Dreiecksverhältnis","Einordnung des eigenen Arbeitgebers"]},
  M1:{title:"Transferaufgabe (Thiele)", punkte:9, known:false,
      task:"Inhalt noch unbekannt. Laut Modulbeschreibung ca. 10 % der Klausur. Ob die Aufgabe vorab bekannt gegeben wird, ist offen.",
      source:"Modulbeschreibung M1, Abschnitt Prüfung.", points:[]}
};
/* Design 1.3: Linien-Symbole und Hintergrundmotive (nur Darstellung) */
const SVG = (w, body, cls="ico") => `<svg class="${cls}" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  arrow: SVG(18, '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>'),
  back: SVG(22, '<path d="M15 18l-6-6 6-6"/>'),
  book: SVG(18, '<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>'),
  moon: SVG(18, '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  sun: SVG(18, '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')
};
// Motive je Modul: M2 Netz (soziales Netz), M3 Jahresringe (Lebensphasen), M1 Säulen (Grundlagen)
const MOTIF = {
  M2: `<svg class="motif" viewBox="0 0 230 170" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-opacity=".17" stroke-width="1.3"><path d="M30 40L90 20L150 50L205 25M30 40L60 100L120 95L150 50M90 20L120 95L180 110L205 25M60 100L40 150L110 145L120 95M110 145L190 150L180 110M150 50L180 110"/></g><g fill="currentColor" fill-opacity=".17"><circle cx="30" cy="40" r="4"/><circle cx="90" cy="20" r="4"/><circle cx="150" cy="50" r="5"/><circle cx="205" cy="25" r="3"/><circle cx="60" cy="100" r="4"/><circle cx="120" cy="95" r="6"/><circle cx="180" cy="110" r="4"/><circle cx="40" cy="150" r="3"/><circle cx="110" cy="145" r="4"/><circle cx="190" cy="150" r="3"/></g></svg>`,
  M3: `<svg class="motif" viewBox="20 -30 260 260" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-opacity=".16"><ellipse cx="150" cy="100" rx="14" ry="12" stroke-width="2"/><ellipse cx="148" cy="101" rx="30" ry="27" stroke-width="1.4"/><ellipse cx="151" cy="99" rx="48" ry="44" stroke-width="2.2"/><ellipse cx="149" cy="102" rx="68" ry="62" stroke-width="1.2"/><ellipse cx="152" cy="100" rx="90" ry="83" stroke-width="1.8"/><ellipse cx="150" cy="98" rx="114" ry="104" stroke-width="1.2"/><ellipse cx="151" cy="101" rx="138" ry="126" stroke-width="2"/></g></svg>`,
  M1: `<svg class="motif" viewBox="0 0 230 170" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-opacity=".17" stroke-width="1.5" stroke-linejoin="round"><path d="M20 52L115 12L210 52Z"/><path d="M14 58H216"/><rect x="34" y="66" width="20" height="78"/><rect x="78" y="66" width="20" height="78"/><rect x="132" y="66" width="20" height="78"/><rect x="176" y="66" width="20" height="78"/><path d="M14 150H216"/><path d="M6 160H224"/></g></svg>`,
  hero: `<svg class="motif" viewBox="0 0 900 420" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-opacity=".08" stroke-width="1.4"><path d="M100 400V120h700v280"/><path d="M140 400V150h620v250"/><path d="M180 400V180h540v220"/><path d="M220 400V210h460v190"/><path d="M260 400V240h380v160"/><path d="M300 400V280h300v120"/></g><path d="M100 120L450 20L800 120" fill="none" stroke="#C9A227" stroke-opacity=".55" stroke-width="1.6"/></svg>`
};
const ROMAN = ["I","II","III","IV","V"];
function bandOf(m){ return ROMAN[modOrder().indexOf(m)] || ""; }

const K = "kt2.";
const DEVICE =/Android|iPhone|iPad/i.test(navigator.userAgent) ? "Handy" : "PC";

/* ============================================================
   Hilfsfunktionen
   ============================================================ */
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let STORAGE_OK = true;
try{ localStorage.setItem(K+"probe","1"); localStorage.removeItem(K+"probe"); }catch(e){ STORAGE_OK = false; }
function lsGet(key, fb){ try{ const v = localStorage.getItem(K+key); return v ? JSON.parse(v) : fb; }catch(e){ return fb; } }
function lsSet(key, val){ try{ localStorage.setItem(K+key, JSON.stringify(val)); return true; }catch(e){ STORAGE_OK = false; toast("Speichern im Browser fehlgeschlagen: " + e.message); return false; } }
function todayStr(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function dayNum(s){ const [y,m,d]=s.split("-").map(Number); return Math.round(Date.UTC(y,m-1,d)/864e5); }
function numDay(n){ return new Date(n*864e5).toISOString().slice(0,10); }
function fmtDate(s){ if(!s) return "–"; const [y,m,d]=s.slice(0,10).split("-"); return `${d}.${m}.${y}`; }
function fmtDT(iso){ if(!iso) return "–"; const d=new Date(iso); return d.toLocaleDateString("de-DE")+", "+d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); }
function daysTo(s){ return dayNum(s) - dayNum(todayStr()); }
function num(x){ return String(Math.round(x*10)/10).replace(".", ","); }
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.setAttribute("role","status"); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(), 3600); }
function download(name, text, type="application/json"){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();}, 500); }
function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(36); }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function waitFor(cond, ms){ return new Promise((res,rej)=>{ const t0=Date.now(); (function loop(){ if(cond()) return res(); if(Date.now()-t0>ms) return rej(new Error("timeout")); setTimeout(loop,100); })(); }); }
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(e){ const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta); ta.select(); let ok=false; try{ ok=document.execCommand("copy"); }catch(_){} ta.remove(); return ok; }
}

function parseCSV(text, delim=";"){
  text = text.replace(/^﻿/, "");
  const rows=[]; let row=[], f="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=c; continue; }
    if(c==='"' && f===""){ q=true; continue; }
    if(c===delim){ row.push(f); f=""; continue; }
    if(c==="\r") continue;
    if(c==="\n"){ row.push(f); rows.push(row); row=[]; f=""; continue; }
    f+=c;
  }
  if(f!=="" || row.length){ row.push(f); rows.push(row); }
  const clean = rows.filter(r => r.some(x => x.trim()!==""));
  if(!clean.length) return {head:[], rows:[], bad:[]};
  const head = clean[0].map(h=>h.trim());
  const out=[], bad=[];
  clean.slice(1).forEach((r,i)=>{
    if(r.length!==head.length) bad.push({line:i+2, cols:r.length, expected:head.length});
    const o={}; head.forEach((h,j)=>o[h]=(r[j]??"").trim()); out.push(o);
  });
  return {head, rows:out, bad};
}

/* ---------- IndexedDB für das Inhaltspaket (kann mehrere MB groß sein) ---------- */
function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open("kt2",1); r.onupgradeneeded=()=>r.result.createObjectStore("kv"); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbSet(k,v){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{ const tx=db.transaction("kv","readwrite"); tx.objectStore("kv").put(v,k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); return true; }catch(e){ return false; } }
async function idbGet(k){ try{ const db=await idbOpen(); return await new Promise(res=>{ const r=db.transaction("kv").objectStore("kv").get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); }); }catch(e){ return null; } }

