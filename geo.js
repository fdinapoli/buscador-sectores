// Utilidades geográficas compartidas (sin dependencias)
(function () {
  const PALETA = ["#39ff88", "#ffb000", "#4dd0ff", "#ff5f7e", "#c38bff", "#e6ff4d", "#ff8a3d", "#5effd6"];

  // pt y ring en [lon, lat]
  function pointInRing(pt, ring) {
    const [x, y] = pt;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(pt, rings) {
    if (!rings.length || !pointInRing(pt, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (pointInRing(pt, rings[k])) return false; // huecos
    return true;
  }

  function contiene(feature, pt) {
    const g = feature.geometry;
    if (!g) return false;
    if (g.type === "Polygon") return pointInPolygon(pt, g.coordinates);
    if (g.type === "MultiPolygon") return g.coordinates.some((p) => pointInPolygon(pt, p));
    return false;
  }

  function nombre(f, prop) {
    const p = f.properties || {};
    return p[prop] ?? p.nombre ?? p.name ?? p.Name ?? p.sector ?? "(sin nombre)";
  }

  function color(f, i) {
    return (f.properties && f.properties.color) || PALETA[i % PALETA.length];
  }

  // latlng = [lat, lon] → features que lo contienen
  function sectoresDe(latlng, features) {
    const pt = [latlng[1], latlng[0]];
    return features.filter((f) => contiene(f, pt));
  }

  function soloPoligonos(fc) {
    const feats = fc.type === "FeatureCollection" ? fc.features : fc.type === "Feature" ? [fc] : [];
    return feats.filter((f) => f.geometry && /Polygon$/.test(f.geometry.type));
  }

  // Borrador del editor, guardado en el navegador (solo lo ve quien lo editó)
  const CLAVE_BORRADOR = "buscador-sectores:borrador";
  function leerBorrador() {
    try {
      const fc = JSON.parse(localStorage.getItem(CLAVE_BORRADOR));
      return fc && soloPoligonos(fc).length ? fc : null;
    } catch (_) {
      return null;
    }
  }

  window.Geo = { PALETA, contiene, nombre, color, sectoresDe, soloPoligonos, CLAVE_BORRADOR, leerBorrador };
})();
