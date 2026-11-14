// Genera alturas.json: números de puerta de OSM por calle, para interpolar alturas
// cuando Georef no las tiene.
// Uso:
//   curl -s --data-urlencode "data@overpass-alturas.txt" https://overpass-api.de/api/interpreter -o alturas-osm.json
//   node generar-alturas.js alturas-osm.json ../alturas.json
//
// Formato: { base: [lat0, lon0], calles: { "Nombre": [num, dLat, dLon, num, dLat, dLon, ...] } }
// con dLat/dLon en 1e-5 grados relativos a base (≈ 1 m de resolución).
const fs = require("fs");
const [, , IN, OUT] = process.argv;
const els = JSON.parse(fs.readFileSync(IN, "utf8")).elements;
const BASE = [-37.32, -59.13];

const calles = {};
for (const e of els) {
  const num = parseInt(e.tags["addr:housenumber"], 10);
  const c = e.type === "node" ? [e.lat, e.lon] : e.center && [e.center.lat, e.center.lon];
  if (!Number.isFinite(num) || !c) continue;
  const calle = e.tags["addr:street"].trim();
  (calles[calle] = calles[calle] || []).push([num, Math.round((c[0] - BASE[0]) * 1e5), Math.round((c[1] - BASE[1]) * 1e5)]);
}
for (const k of Object.keys(calles)) {
  calles[k] = calles[k].sort((a, b) => a[0] - b[0]).flat();
}
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, calles }));
console.log("ok", Object.keys(calles).length, "calles,", els.length, "números");
