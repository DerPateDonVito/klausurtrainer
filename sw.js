// Klausurtrainer: Offline-Speicher für den Programmcode. Inhalte und Lernstand liegen nicht hier, sondern in Google Drive und im Browser.
const CACHE = "klausurtrainer-1.2.0";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== "klausurtrainer-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Schrift von Google Fonts: einmal laden, dann offline aus dem Speicher
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open("klausurtrainer-fonts").then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return; // Google-Anmeldung und Drive nie abfangen
  if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) {
    // Programmseite: zuerst Netz (damit Updates sofort ankommen), offline aus dem Speicher
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
