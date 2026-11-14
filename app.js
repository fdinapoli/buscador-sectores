(function () {
  const C = window.CONFIG;
  const API = "https://apis.datos.gob.ar/georef/api";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  document.title = C.titulo;
  $("#titulo").textContent = C.titulo;

  // ---------- Mapa ----------
  const map = L.map("map").setView(C.mapa.centro, C.mapa.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Direcciones: <a href="https://datosgobar.github.io/georef-ar-api/">Georef AR</a>',
    maxZoom: 19,
  }).addTo(map);
  const marcas = L.layerGroup().addTo(map);

  let sectores = [];
  const colorDe = new Map();
  const nombreDe = (f) => Geo.nombre(f, C.propiedadNombre);

  // Si hay un borrador del editor en este navegador, se usa (salvo ?publicado)
  const borrador = new URLSearchParams(location.search).has("publicado") ? null : Geo.leerBorrador();
  if (borrador) {
    $("#borrador").hidden = false;
    $("#usar-publicado").addEventListener("click", () => { location.search = "?publicado"; });
  }

  (borrador
    ? Promise.resolve(borrador)
    : fetch(C.sectoresUrl, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }))
    .then((fc) => {
      sectores = Geo.soloPoligonos(fc);
      sectores.forEach((f, i) => colorDe.set(f, Geo.color(f, i)));
      const capa = L.geoJSON({ type: "FeatureCollection", features: sectores }, {
        style: (f) => ({ color: colorDe.get(f), weight: 2, fillOpacity: 0.12 }),
        onEachFeature: (f, layer) => layer.bindTooltip(esc(nombreDe(f)), { permanent: true, direction: "center", className: "sector-label" }),
        interactive: false,
      }).addTo(map);
      if (sectores.length) map.fitBounds(capa.getBounds(), { padding: [20, 20] });
    })
    .catch((e) => mostrarError(`No se pudo cargar ${C.sectoresUrl} (${e.message}).`));

  // ---------- Autocompletado de calles ----------
  (async function cargarCalles() {
    const key = "calles:" + JSON.stringify(C.georef);
    let nombres;
    try { nombres = JSON.parse(sessionStorage.getItem(key)); } catch (_) {}
    if (!nombres) {
      try {
        const p = filtros({ max: 5000, campos: "nombre" });
        const j = await (await fetch(`${API}/calles?${p}`)).json();
        nombres = [...new Set((j.calles || []).map((c) => c.nombre))].sort();
        try { sessionStorage.setItem(key, JSON.stringify(nombres)); } catch (_) {}
      } catch (_) { return; }
    }
    $("#calles").innerHTML = nombres.map((n) => `<option value="${esc(n)}">`).join("");
  })();

  // ---------- Georef ----------
  function filtros(extra) {
    const p = new URLSearchParams(extra);
    for (const k of ["provincia", "departamento", "localidad_censal"]) if (C.georef[k]) p.set(k, C.georef[k]);
    return p;
  }

  async function georef(direccion, calleBuscada) {
    const p = filtros({ direccion, max: 10 });
    const r = await fetch(`${API}/direcciones?${p}`);
    if (!r.ok) throw new Error(`Georef respondió ${r.status}`);
    const j = await r.json();
    const ok = (j.direcciones || []).filter((d) => d.ubicacion && d.ubicacion.lat != null);
    // priorizar: 1) cae dentro de algún sector, 2) nombre de calle exacto
    const q = norm(calleBuscada);
    const score = (d) =>
      (Geo.sectoresDe([d.ubicacion.lat, d.ubicacion.lon], sectores).length ? 2 : 0) + (norm(d.calle.nombre) === q ? 1 : 0);
    ok.sort((a, b) => score(b) - score(a));
    return ok;
  }

  // ---------- UI ----------
  let modo = "altura";
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      modo = b.dataset.modo;
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
      $(".modo-altura").hidden = modo !== "altura";
      $(".modo-entre").hidden = modo !== "entre";
      $("#altura").required = modo === "altura";
      $("#entre1").required = $("#entre2").required = modo === "entre";
    })
  );
  $("#altura").required = true;

  $("#form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = $("#buscar");
    btn.disabled = true;
    btn.textContent = "Buscando…";
    try {
      if (modo === "altura") await buscarAltura();
      else await buscarEntre();
    } catch (e) {
      mostrarError("Error consultando el servicio de direcciones: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Buscar";
    }
  });

  async function buscarAltura() {
    const calle = $("#calle").value.trim();
    const altura = $("#altura").value.trim();
    const res = await georef(`${calle} ${altura}`, calle);
    if (!res.length) return mostrarError(`No encontré "${calle} ${altura}". Revisá el nombre de la calle (usá las sugerencias) y la altura.`);
    const d = res[0];
    const pt = [d.ubicacion.lat, d.ubicacion.lon];
    const secs = Geo.sectoresDe(pt, sectores);

    marcas.clearLayers();
    L.circleMarker(pt, { radius: 8, color: "#fff", weight: 2, fillColor: secs[0] ? colorDe.get(secs[0]) : "#ff5f7e", fillOpacity: 1 })
      .bindPopup(esc(d.nomenclatura)).addTo(marcas);
    map.setView(pt, Math.max(map.getZoom(), 16));

    render({ secs, lineas: [`Interpretado: ${d.nomenclatura}`], alternativas: alternativas(res) });
  }

  async function buscarEntre() {
    const calle = $("#calle").value.trim();
    const e1 = $("#entre1").value.trim();
    const e2 = $("#entre2").value.trim();
    const [r1, r2] = await Promise.all([georef(`${calle} y ${e1}`, calle), georef(`${calle} y ${e2}`, calle)]);
    const faltan = [];
    if (!r1.length) faltan.push(`${calle} y ${e1}`);
    if (!r2.length) faltan.push(`${calle} y ${e2}`);
    if (faltan.length) return mostrarError(`No encontré la esquina ${faltan.map((f) => `"${f}"`).join(" ni ")}. ¿Seguro que esas calles se cruzan? Usá las sugerencias para los nombres.`);

    // elegir el par de esquinas más cercano, preferentemente sobre la MISMA calle principal
    const ll = (d) => [d.ubicacion.lat, d.ubicacion.lon];
    let a = null, b = null, mejor = Infinity;
    for (const x of r1) for (const y of r2) {
      const dist = map.distance(ll(x), ll(y)) + (x.calle.id === y.calle.id ? 0 : 1e7);
      if (dist < mejor) { mejor = dist; a = x; b = y; }
    }

    const pa = ll(a);
    const pb = ll(b);
    const pm = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
    const sa = Geo.sectoresDe(pa, sectores), sb = Geo.sectoresDe(pb, sectores), sm = Geo.sectoresDe(pm, sectores);

    const metros = map.distance(pa, pb);
    marcas.clearLayers();
    const col = sm[0] ? colorDe.get(sm[0]) : "#ff5f7e";
    L.polyline([pa, pb], { color: col, weight: 6, opacity: 0.9 }).addTo(marcas);
    [[pa, a], [pb, b]].forEach(([p, d]) =>
      L.circleMarker(p, { radius: 5, color: "#fff", weight: 1, fillColor: "#fff", fillOpacity: 1 }).bindPopup(esc(d.nomenclatura)).addTo(marcas));
    L.circleMarker(pm, { radius: 8, color: "#fff", weight: 2, fillColor: col, fillOpacity: 1 }).addTo(marcas);
    map.fitBounds(L.latLngBounds([pa, pb]).pad(0.6), { maxZoom: 18 });

    const lineas = [`Esquina 1: ${a.nomenclatura}`, `Esquina 2: ${b.nomenclatura}`, `Largo del tramo: ${Math.round(metros)} m`];
    const ids = (s) => s.map(nombreDe).sort().join("|");
    let aviso = null;
    if (ids(sa) !== ids(sm) || ids(sb) !== ids(sm)) {
      const desc = (s) => (s.length ? s.map(nombreDe).join(" / ") : "fuera de sectores");
      aviso = `El tramo cruza un límite: esquina 1 → ${desc(sa)}, esquina 2 → ${desc(sb)}. Se muestra el sector del punto medio.`;
    }
    if (metros > 400) aviso = (aviso ? aviso + " " : "") + "Ojo: las esquinas están a más de 400 m, puede que no sean cuadras consecutivas.";
    render({ secs: sm, lineas, aviso, alternativas: alternativas(r1.concat(r2)) });
  }

  function alternativas(res) {
    const principal = res[0] && res[0].calle.nombre;
    return [...new Set(res.map((d) => d.calle.nombre))].filter((n) => n !== principal);
  }

  function render({ secs, lineas = [], aviso, alternativas = [] }) {
    let html = '<div class="res">';
    if (!secs.length) {
      html += `<div class="sector" style="color:var(--err)">Fuera de todos los sectores</div>`;
    } else {
      html += secs.map((f) => `<div class="sector"><span class="sw" style="background:${esc(colorDe.get(f))};color:${esc(colorDe.get(f))}"></span>${esc(nombreDe(f))}</div>`).join("");
      if (secs.length > 1) aviso = (aviso ? aviso + " " : "") + "El punto cae en más de un sector (los polígonos se superponen).";
    }
    html += `<div class="meta">${lineas.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
    if (aviso) html += `<div class="warn">⚠ ${esc(aviso)}</div>`;
    if (alternativas.length) {
      html += `<div class="alt">¿Era otra calle? ${alternativas.map((n) => `<button type="button" data-calle="${esc(n)}">${esc(n)}</button>`).join("")}</div>`;
    }
    html += "</div>";
    $("#resultado").innerHTML = html;
    $("#resultado").querySelectorAll("[data-calle]").forEach((b) =>
      b.addEventListener("click", () => { $("#calle").value = b.dataset.calle; $("#form").requestSubmit(); }));
  }

  function mostrarError(msg) {
    $("#resultado").innerHTML = `<div class="res err">${esc(msg)}</div>`;
  }

  // ---------- Click en el mapa ----------
  map.on("click", (e) => {
    const pt = [e.latlng.lat, e.latlng.lng];
    const secs = Geo.sectoresDe(pt, sectores);
    L.popup()
      .setLatLng(e.latlng)
      .setContent(secs.length ? secs.map((f) => `<b>${esc(nombreDe(f))}</b>`).join("<br>") : "Fuera de todos los sectores")
      .openOn(map);
  });
})();
