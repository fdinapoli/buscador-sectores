// Service worker: permite instalar la app y que funcione con poca o ninguna señal.
// Archivos propios: primero la red (para recibir actualizaciones), y si no responde en 3 s, la copia guardada.
// Librerías y fuentes de CDN: la copia guardada. El mapa (tiles) y la API de direcciones van siempre a la red.
const CACHE = "sectores-v1";
const PROPIOS = [
  "./", "index.html", "style.css", "config.js", "geo.js", "app.js",
  "sectores.geojson", "alturas.json", "lugares.json", "manifest.webmanifest",
  "iconos/icono-192.png", "iconos/icono-512.png",
];
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...PROPIOS, ...CDN])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function redPrimero(req) {
  const c = await caches.open(CACHE);
  const red = fetch(req).then((r) => {
    if (r.ok) c.put(req, r.clone());
    return r;
  });
  try {
    return await Promise.race([red, new Promise((_, no) => setTimeout(() => no(new Error("lento")), 3000))]);
  } catch (_) {
    return (await c.match(req, { ignoreSearch: true })) || red;
  }
}

function guardadoPrimero(req) {
  return caches.match(req).then((g) => g || fetch(req).then((r) => {
    if (r.ok || r.type === "opaque") caches.open(CACHE).then((c) => c.put(req, r.clone()));
    return r;
  }));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(redPrimero(req));
  else if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) e.respondWith(guardadoPrimero(req));
  // el resto (tiles del mapa, API Georef) sin intervenir
});
