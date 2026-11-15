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

// Eje de una línea compuesta por varias calles, siguiendo la geometría real de cada una.
// Las avenidas de doble mano se promedian. Entre una calle y la siguiente (ej. Pellegrini →
// Guatemala, que arranca corrida una cuadra) el borde va en línea recta del final de una al
// principio de la otra, en vez de cortar cuadras en diagonal.
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function cercano(p, l) {
  let m = null;
  for (let i = 0; i < l.length - 1; i++) {
    const a = l[i], b = l[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy], d = dist2(p, q);
    if (!m || d < m.d) m = { q, d, pos: i + t };
  }
  return m;
}
function largo(l) { let s = 0; for (let i = 1; i < l.length; i++) s += dist2(l[i - 1], l[i]); return s; }

function calle(nombre) {
  // unir los tramos (ways) que comparten extremos
  let cad = W.filter((e) => e.tags.name === nombre).map((e) => e.geometry.map(xy)).filter((g) => Math.hypot(...g[0]) < 7000);
  for (let unido = true; unido;) {
    unido = false;
    for (let i = 0; i < cad.length && !unido; i++) for (let j = 0; j < cad.length && !unido; j++) {
      if (i === j) continue;
      const a = cad[i], b = cad[j];
      let r = null;
      // no unir si en la unión la calle pega media vuelta (las dos manos de una avenida que se juntan)
      const sigue = (c) => {
        const p0 = a[a.length - 2], p1 = a[a.length - 1], p2 = c[1];
        const u = [p1[0] - p0[0], p1[1] - p0[1]], v = [p2[0] - p1[0], p2[1] - p1[1]];
        return (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1) > -0.5;
      };
      const br = [...b].reverse();
      if (dist2(a[a.length - 1], b[0]) < 3 && sigue(b)) r = [...a, ...b.slice(1)];
      else if (dist2(a[a.length - 1], b[b.length - 1]) < 3 && sigue(br)) r = [...a, ...br.slice(1)];
      if (r) { cad = cad.filter((_, k) => k !== i && k !== j); cad.push(r); unido = true; }
    }
  }
  // eje principal de la calle, para ordenar y orientar los tramos
  const pts = cad.flat(), mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ax = [Math.cos(ang), Math.sin(ang)];
  const S = (p) => (p[0] - mx) * ax[0] + (p[1] - my) * ax[1];
  cad = cad.map((c) => (S(c[c.length - 1]) < S(c[0]) ? [...c].reverse() : c)).sort((a, b) => largo(b) - largo(a));
  // doble mano: un tramo que corre paralelo a otro más largo (a < 45 m) se promedia con él;
  // uno paralelo pero lejos (homónimo) se descarta
  const usados = [];
  for (const c of cad) {
    const par = usados.find((u) => {
      const ov = c.filter((p) => S(p) > S(u.l[0]) && S(p) < S(u.l[u.l.length - 1]));
      return ov.length >= Math.max(2, c.length * 0.5);
    });
    if (!par) { usados.push({ l: c, otros: [] }); continue; }
    const d = c.map((p) => cercano(p, par.l).d).sort((x, y) => x - y)[Math.floor(c.length / 2)];
    if (d < 45) par.otros.push(c);
  }
  let tramos = usados.map((u) => {
    if (!u.otros.length) return u.l;
    return u.l.map((p) => {
      const m = u.otros.map((o) => cercano(p, o)).filter((m) => m.d < 45 && m.pos > 0 && m.pos < 1e9).sort((x, y) => x.d - y.d)[0];
      return m ? [(p[0] + m.q[0]) / 2, (p[1] + m.q[1]) / 2] : p;
    });
  }).sort((a, b) => S(a[0]) - S(b[0]));
  // quedarse con el grupo continuo más largo (saltos de más de 800 m = otro barrio)
  const grupos = [[tramos[0]]];
  for (let i = 1; i < tramos.length; i++) {
    const prev = grupos[grupos.length - 1];
    if (dist2(prev[prev.length - 1].at(-1), tramos[i][0]) > 800) grupos.push([]);
    grupos[grupos.length - 1].push(tramos[i]);
  }
  const g = grupos.sort((a, b) => b.reduce((s, t) => s + largo(t), 0) - a.reduce((s, t) => s + largo(t), 0))[0];
  return g.flat();
}

function eje(nombres) {
  const cs = nombres.map(calle);
  // orientar cada calle en el sentido de la línea
  if (dist2(cs[0][0], cs[1][0]) < dist2(cs[0].at(-1), cs[1][0]) && dist2(cs[0][0], cs[1].at(-1)) < dist2(cs[0].at(-1), cs[1].at(-1))) cs[0].reverse();
  let linea = [...cs[0]];
  for (let k = 1; k < cs.length; k++) {
    let c = cs[k];
    const fin = linea.at(-1);
    if (dist2(c.at(-1), fin) < dist2(c[0], fin)) c = [...c].reverse();
    // si se superponen, cortar la anterior en el punto más cercano al comienzo de esta
    const m = cercano(c[0], linea);
    if (m.pos < linea.length - 1.001 && m.d < 150) linea = [...linea.slice(0, Math.floor(m.pos) + 1), m.q];
    linea.push(...c);
  }
  return simplificar(linea, 1);
}

// Douglas-Peucker (tolerancia en metros)
function simplificar(l, tol) {
  if (l.length < 3) return l;
  const a = l[0], b = l[l.length - 1], L = dist2(a, b);
  let max = 0, idx = 0;
  for (let i = 1; i < l.length - 1; i++) {
    const p = l[i];
    const d = L ? Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L : dist2(p, a);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...simplificar(l.slice(0, idx + 1), tol).slice(0, -1), ...simplificar(l.slice(idx), tol)];
}

// Prolongar los extremos en línea recta
function extender(l, dist) {
  const dir = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy); return [dx / n, dy / n]; };
  const atras = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) { s += dist2(pts[i - 1], pts[i]); if (s > 300) return pts[i]; } return pts[pts.length - 1]; };
  const d0 = dir(atras(l), l[0]), d1 = dir(atras([...l].reverse()), l[l.length - 1]);
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
  // varios cruces pegados (la línea pasa justo por la esquina): quedarse con el primero
  if (!res.length || res.some((r) => dist2(r.p, res[0].p) > 10)) throw new Error(`cruces encontrados: ${res.length}`);
  return res.sort((x, y) => x.ia - y.ia)[0];
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
