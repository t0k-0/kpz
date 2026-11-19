const CACHE = "kpz-v16-worksheet-dates";
const CORE = [
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./assets/map-trainer.css",
  "./assets/map-trainer.js",
  "./assets/icon.svg",
  "./manifest.webmanifest",
  "./data/config.json",
  "./data/sets/index.json",
  "./data/maps/world-assignment.json",
  "./data/maps/ne_110m_land.geojson",
  "./worksheets/index.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    })
    .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
