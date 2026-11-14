// Genera lugares.json (puntos de interés de Tandil) a partir de una consulta Overpass.
// Uso:
//   curl -s --data-urlencode "data@overpass-lugares.txt" https://overpass-api.de/api/interpreter -o lugares-osm.json
//   node generar-lugares.js lugares-osm.json ../lugares.json
const fs = require("fs");
const [, , IN, OUT] = process.argv;
const els = JSON.parse(fs.readFileSync(IN, "utf8")).elements;

// tipo OSM → [etiqueta, palabras extra para la búsqueda]
const TIPOS = {
  "amenity=hospital": ["Hospital / sanatorio", "hospital sanatorio salud guardia"],
  "amenity=clinic": ["Clínica", "clinica salud"],
  "amenity=doctors": ["Consultorio", "medico salud"],
  "amenity=bus_station": ["Terminal", "terminal omnibus micros colectivos"],
  "amenity=university": ["Universidad", "facultad universidad unicen"],
  "amenity=college": ["Instituto", "instituto terciario"],
  "amenity=school": ["Escuela", "escuela colegio"],
  "amenity=kindergarten": ["Jardín", "jardin infantes"],
  "amenity=police": ["Policía", "policia comisaria"],
  "amenity=fire_station": ["Bomberos", "bomberos"],
  "amenity=townhall": ["Municipalidad", "municipio municipalidad"],
  "amenity=courthouse": ["Tribunales", "tribunales juzgado"],
  "amenity=theatre": ["Teatro", "teatro"],
  "amenity=cinema": ["Cine", "cine"],
  "amenity=library": ["Biblioteca", "biblioteca"],
  "amenity=marketplace": ["Mercado / feria", "feria mercado"],
  "amenity=community_centre": ["Centro comunitario", "centro comunitario"],
  "amenity=social_facility": ["Asistencia social", "geriatrico hogar"],
  "amenity=place_of_worship": ["Iglesia / templo", "iglesia templo parroquia"],
  "amenity=nightclub": ["Boliche", "boliche bailable"],
  "amenity=events_venue": ["Salón de eventos", "salon eventos fiestas"],
  "amenity=arts_centre": ["Centro cultural", "centro cultural"],
  "amenity=fuel": ["Estación de servicio", "estacion servicio nafta"],
  "shop=supermarket": ["Supermercado", "super supermercado"],
  "shop=mall": ["Shopping", "shopping"],
  "shop=department_store": ["Tienda", "tienda"],
  "leisure=stadium": ["Estadio", "estadio cancha"],
  "leisure=park": ["Plaza / parque", "plaza parque"],
  "leisure=sports_centre": ["Club / polideportivo", "club gimnasio polideportivo"],
  "leisure=golf_course": ["Golf", "golf"],
  "leisure=water_park": ["Parque acuático", "parque acuatico"],
  "tourism=hotel": ["Hotel", "hotel"],
  "tourism=hostel": ["Hostel", "hostel"],
  "tourism=motel": ["Motel", "motel"],
  "tourism=museum": ["Museo", "museo"],
  "tourism=attraction": ["Atracción turística", "turismo"],
  "tourism=viewpoint": ["Mirador", "mirador"],
  "tourism=camp_site": ["Camping", "camping"],
  "aeroway=aerodrome": ["Aeropuerto", "aeropuerto aerodromo aeroclub"],
  "railway=station": ["Estación de tren", "estacion tren ferrocarril"],
  "office=government": ["Oficina pública", "oficina publica"],
};

const dist = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * 0.795) * 111000;
const lugares = [];
for (const e of els) {
  const key = Object.keys(TIPOS).find((k) => { const [t, v] = k.split("="); return e.tags[t] === v; });
  if (!key) continue;
  const c = e.type === "node" ? [e.lat, e.lon] : e.center && [e.center.lat, e.center.lon];
  if (!c) continue;
  const n = e.tags.name.trim();
  // sin duplicados: mismo nombre a menos de 300 m
  if (lugares.some((l) => l.n === n && dist(l.c, c) < 300)) continue;
  const dir = e.tags["addr:street"] ? `${e.tags["addr:street"]} ${e.tags["addr:housenumber"] || ""}`.trim() : undefined;
  lugares.push({ n, t: TIPOS[key][0], k: TIPOS[key][1], c: [+c[0].toFixed(6), +c[1].toFixed(6)], ...(dir && { d: dir }) });
}
lugares.sort((a, b) => a.n.localeCompare(b.n, "es"));
fs.writeFileSync(OUT, JSON.stringify(lugares));
console.log("ok", lugares.length, "lugares");
