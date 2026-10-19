"use strict";
/* ============================================================
   Lernzeit (Lastenheft H6 c, gemessen ab Version 1.4)
   Gezählt wird aktive Zeit in Training, Klausursimulation und Transferwerkstatt:
   nur bei sichtbarem Fenster und nur, wenn in den letzten 3 Minuten bedient wurde
   (Tippen, Diktieren, Klicken, Scrollen). Ein offen liegengelassenes Fenster zählt nicht.
   Speicher: kt2.zeit = {"JJJJ-MM-TT": {"PC": Sekunden, "Handy": Sekunden}}
   Neuer Schlüssel, getrennt vom Lernstand. Anzeige und Abgleich über Drive folgen mit Paket 2.
   ============================================================ */
const ZEIT_TAKT = 15e3, ZEIT_RUHE = 180e3, ZEIT_MAX_SCHRITT = 30e3;
let ZEIT_BEDIENT = 0, ZEIT_TICK = Date.now(), ZEIT_REST = 0;

function zeitLernt(){
  if(document.visibilityState !== "visible") return false;
  if(VIEW === "train") return !!SESSION;
  if(VIEW === "sim") return !!SIMRUN;
  if(VIEW === "transfer") return Object.values(TMODE).some(m => m === "edit" || m === "drill");
  return false;
}
function zeitBuchen(ms){
  if(!STORAGE_OK || ms <= 0) return;
  ZEIT_REST += ms;
  const s = Math.floor(ZEIT_REST / 1000); if(!s) return;
  ZEIT_REST -= s * 1000;
  const Z = lsGet("zeit", {}), d = todayStr();
  Z[d] = Z[d] || {}; Z[d][DEVICE] = (Z[d][DEVICE] || 0) + s;
  lsSet("zeit", Z);
}
function zeitTakt(){
  const now = Date.now(), dt = Math.min(Math.max(0, now - ZEIT_TICK), ZEIT_MAX_SCHRITT);
  ZEIT_TICK = now;
  if(zeitLernt() && now - ZEIT_BEDIENT < ZEIT_RUHE) zeitBuchen(dt);
}
["keydown", "pointerdown", "input", "wheel", "touchstart", "scroll"].forEach(ev =>
  document.addEventListener(ev, () => { ZEIT_BEDIENT = Date.now(); }, {passive:true, capture:true}));
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "hidden") zeitTakt();   // bis zum Verlassen buchen
  else ZEIT_TICK = Date.now();                              // Zeit im Hintergrund nie mitzählen
});
setInterval(zeitTakt, ZEIT_TAKT);
function lernzeitHeute(){ const z = lsGet("zeit", {})[todayStr()] || {}; return Object.values(z).reduce((a,b)=>a+b, 0); }
