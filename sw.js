// Studienbuch (bis 1.3 „Klausurtrainer“): Offline-Speicher für den Programmcode.
// Inhalte und Lernstand liegen nicht hier, sondern in Google Drive und im Browser.
// Bei jeder neuen Version: CACHE und V erhöhen, gleicher Wert wie ?v= in index.html.
const V = "1.5.0";
const CACHE = "studienbuch-" + V;
const FONTS = "klausurtrainer-fonts";   // Schriften: Name bleibt, damit sie offline nicht neu geladen werden müssen
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  ...["css/basis.css", "css/lernen.css", "css/studienbuch.css",
      "js/basis.js", "js/lernlogik.js", "js/drive.js", "js/lernen.js", "js/heute.js", "js/zeit.js", "js/statistik.js", "js/erfassen.js", "js/app.js"].map(f => `./${f}?v=${V}`)];

self.addEventListener("install", e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting())));

// Alte Programmspeicher (auch „klausurtrainer-1.x“) löschen, Schriften behalten
const cleanup = () => caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FONTS).map(k => caches.delete(k))));
self.addEventListener("activate", e => e.waitUntil(cleanup().then(() => self.clients.claim())));
// Der alte Service Worker kann seinen Speicher nach dem Löschen noch einmal anlegen (letzter Schreibvorgang).
// Deshalb beim ersten Seitenaufruf nach jedem Start noch einmal aufräumen.
let cleaned = false;

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Schrift von Google Fonts: einmal laden, dann offline aus dem Speicher
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return; // Google-Anmeldung, Drive und Kalender nie abfangen
  // Eigene Dateien: immer zuerst aus dem Netz (Updates kommen sofort an, nie alte und neue Dateien gemischt),
  // ohne Netz aus dem Speicher.
  if (req.mode === "navigate" && !cleaned) { cleaned = true; e.waitUntil(cleanup()); }
  // Startseite bei jedem Öffnen mit Zeitstempel in der Adresse holen: So kommt sie garantiert frisch vom Server,
  // an Browser- und CDN-Zwischenspeicher vorbei, und passt immer zu den Dateien mit ?v= (Fehler beim Update auf 1.4.1).
  // Dateien mit Prüfung beim Server (no-cache). Bei Weiterleitung oder Fehler den Seitenaufruf unverändert holen.
  let net;
  if (req.mode === "navigate") {
    const u = new URL(req.url); u.searchParams.set("sbt", Date.now());
    net = fetch(u.href, {cache: "no-store", credentials: "same-origin"}).then(r => (r.ok && !r.redirected) ? r : fetch(req)).catch(() => fetch(req));
  } else net = fetch(req, {cache: "no-cache"});
  e.respondWith(
    net.then(r => {
      if (r.ok && r.type === "basic") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(async () => {
      const c = await caches.open(CACHE);
      return (await c.match(req)) || (await c.match(req, {ignoreSearch: true}))
        || (req.mode === "navigate" ? await c.match("./index.html") : undefined) || Response.error();
    })
  );
});
