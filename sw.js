const CACHE = "kpz-v9-subject-home";
const CORE = [
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/app.js",
  "./assets/icon.svg",
  "./manifest.webmanifest",
  "./data/config.json",
  "./data/sets/index.json",
  "./data/sets/biology-cell.sql",
  "./data/sets/english-travel.sql",
  "./data/sets/history-industrial.sql",
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
