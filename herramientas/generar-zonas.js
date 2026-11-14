// Genera sectores.geojson a partir de las calles límite (OSM) del croquis de zonas de Tandil.
// Uso: node build.js all.json salida.geojson
const fs = require("fs");
const [, , IN, OUT] = process.argv;
const W = JSON.parse(fs.readFileSync(IN, "utf8")).elements;

const LAT0 = -37.322, LON0 = -59.135;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540;
const xy = (p) => [(p.lon - LON0) * KX, (p.lat - LAT0) * KY];
const ll = ([x, y]) => [+(LON0 + x / KX).toFixed(6), +(LAT0 + y / KY).toFixed(6)]; // [lon, lat]

// Líneas del croquis. Verticales (SO→NE) de NO a SE; horizontales (NO→SE) de NE a SO.
const VERT = {
  A: ["Artigas", "Pellegrini", "Guatemala"],
  B: ["Avenida Monseñor de Andrea", "Avenida España", "Avenida Marconi", "Avenida Espora"],
  C: ["Almirante Brown", "General Pinto", "Italia"],
};
const HORI = {
  H1: ["Francisco Beiró", "11 de Septiembre", "Santos Vega"],
  H2: ["Quintana", "Avenida Colón", "Avenida Santamarina", "Avenida Bolívar"],
  H3: ["Lisandro de la Torre", "Yrigoyen", "Fuerte Independencia", "Libertad"],
};

// Eje central de una línea compuesta por varias calles (promedia avenidas de doble mano)
function eje(nombres) {
  const pts = W.filter((e) => nombres.includes(e.tags.name)).flatMap((e) => e.geometry.map(xy));
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = [Math.cos(ang), Math.sin(ang)], pe = [-ax[1], ax[0]];
  const BIN = 30, bins = new Map();
  for (const [x, y] of pts) {
    const s = (x - mx) * ax[0] + (y - my) * ax[1], t = (x - mx) * pe[0] + (y - my) * pe[1];
    const k = Math.round(s / BIN);
    (bins.get(k) || bins.set(k, []).get(k)).push(t);
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  let filas = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, ts]) => ({ s: k * BIN, t: (Math.min(...ts) + Math.max(...ts)) / 2 }));
  // descartar bins atípicos (calles homónimas lejanas)
  filas = filas.filter((f, i) => {
    const vec = filas.slice(Math.max(0, i - 4), i + 5).map((g) => g.t);
    return Math.abs(f.t - med(vec)) < 50;
  });
  // cortar en saltos grandes: quedarse con el tramo continuo más largo
  const tramos = [[filas[0]]];
  for (let i = 1; i < filas.length; i++) {
    if (filas[i].s - filas[i - 1].s > 600) tramos.push([]);
    tramos[tramos.length - 1].push(filas[i]);
  }
  filas = tramos.sort((a, b) => b.length - a.length)[0];
  const linea = filas.map((f) => [mx + ax[0] * f.s + pe[0] * f.t, my + ax[1] * f.s + pe[1] * f.t]);
  return suavizar(linea);
}

function suavizar(l) {
  return l.map((p, i) => {
    const v = l.slice(Math.max(0, i - 2), i + 3);
    return [v.reduce((s, q) => s + q[0], 0) / v.length, v.reduce((s, q) => s + q[1], 0) / v.length];
  });
}

// Prolongar los extremos en línea recta
function extender(l, dist) {
  const dir = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy); return [dx / n, dy / n]; };
  const k = Math.min(6, l.length - 1);
  const d0 = dir(l[k], l[0]), d1 = dir(l[l.length - 1 - k], l[l.length - 1]);
  return [[l[0][0] + d0[0] * dist, l[0][1] + d0[1] * dist], ...l, [l[l.length - 1][0] + d1[0] * dist, l[l.length - 1][1] + d1[1] * dist]];
}

// Intersección de polilíneas → {p, ia, ta, ib, tb}
function cruce(a, b) {
  const res = [];
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) {
    const [p, p2] = [a[i], a[i + 1]], [q, q2] = [b[j], b[j + 1]];
    const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q[0], q2[1] - q[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den;
    const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) res.push({ p: [p[0] + r[0] * t, p[1] + r[1] * t], ia: i + t, ib: j + u });
  }
  if (res.length !== 1) throw new Error(`cruces encontrados: ${res.length}`);
  return res[0];
}

// Sub-tramo de polilínea entre dos posiciones paramétricas
function tramo(l, pa, pb) {
  const at = (pos) => { const i = Math.min(Math.floor(pos), l.length - 2), t = pos - i; return [l[i][0] + (l[i + 1][0] - l[i][0]) * t, l[i][1] + (l[i + 1][1] - l[i][1]) * t]; };
  const out = [at(pa)];
  if (pa < pb) for (let i = Math.ceil(pa); i < pb; i++) { if (i > pa) out.push(l[i]); }
  else for (let i = Math.floor(pa); i > pb; i--) { if (i < pa) out.push(l[i]); }
  out.push(at(pb));
  return out;
}

const R = 4500; // radio aproximado del área cubierta (m)
const V = Object.values(VERT).map((n) => extender(eje(n), 9000));
const H = Object.values(HORI).map((n) => extender(eje(n), 9000));

// Ejes de la grilla para el marco exterior
const unit = (l) => { const a = l[0], b = l[l.length - 1], n = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / n, (b[1] - a[1]) / n]; };
const dv = unit(V[1]), dh = unit(H[1]); // dv: SO→NE ; dh: NO→SE
const recta = (c, d) => [[c[0] - d[0] * 20000, c[1] - d[1] * 20000], [c[0] + d[0] * 20000, c[1] + d[1] * 20000]];
const C0 = cruce(V[1], H[1]).p;
const marco = (dir, dist) => [C0[0] + dir[0] * dist, C0[1] + dir[1] * dist];
const Vs = [recta(marco(dh, -R), dv), ...V, recta(marco(dh, R), dv)];   // NO → SE
const Hs = [recta(marco(dv, R), dh), ...H, recta(marco(dv, -R), dh)];   // NE → SO

const NUM = [[17, 16, 15, 14], [13, 12, 11, 10], [9, 8, 7, 6], [5, 4, 3, 2]];
const COLORES = ["#39ff88", "#ffb000", "#4dd0ff", "#ff5f7e"];
const X = Vs.map((v) => Hs.map((h) => cruce(v, h))); // X[i][j]: vertical i con horizontal j

const features = [];
for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
  const a = X[i][j], b = X[i][j + 1], c = X[i + 1][j + 1], d = X[i + 1][j];
  const ring = [
    ...tramo(Vs[i], a.ia, b.ia),
    ...tramo(Hs[j + 1], b.ib, c.ib).slice(1),
    ...tramo(Vs[i + 1], c.ia, d.ia).slice(1),
    ...tramo(Hs[j], d.ib, a.ib).slice(1),
  ].map(ll);
  ring[ring.length - 1] = ring[0];
  features.push({
    type: "Feature",
    properties: { nombre: `Zona ${NUM[j][i]}`, color: COLORES[(i + 2 * j) % 4] },
    geometry: { type: "Polygon", coordinates: [ring] },
  });
}
features.sort((p, q) => parseInt(p.properties.nombre.slice(5)) - parseInt(q.properties.nombre.slice(5)));
fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }, null, 1));
console.log("ok", features.length, "zonas;", features.map((f) => f.geometry.coordinates[0].length).join(","));
