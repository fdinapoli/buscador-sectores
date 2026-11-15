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

  // ---------- Nombres de calles: comparar variantes ----------
  // "MAHATMA GANDHI", "M GANDHI" y "Gandhi" son la misma calle; Georef a veces solo encuentra una.
  const STOP = new Set(("AV AVDA AVENIDA CALLE PJE PASAJE DIAG DIAGONAL GRL GRAL GENERAL DR DOCTOR PTE PRESIDENTE INT INTENDENTE " +
    "CNEL CORONEL TTE TENIENTE ALTE ALMIRANTE SGTO SARGENTO CMTE COMODORO MONS MONSENOR PBRO ING INGENIERO PROF PROFESOR " +
    "DE DEL LA LAS LOS EL Y").split(" "));
  const sig = (n) => norm(n).split(" ").filter((t) => t && !STOP.has(t));
  function mismaCalle(a, b) {
    const A = sig(a), B = sig(b);
    if (!A.length || !B.length || A[A.length - 1] !== B[B.length - 1]) return false;
    const [s, l] = A.length <= B.length ? [A, B] : [B, A];
    return s.slice(0, -1).every((t) => l.slice(0, -1).some((u) => u === t || (t.length === 1 && u[0] === t) || (u.length === 1 && t[0] === u)));
  }
  let callesGeoref = [];
  function variantes(nombre) {
    const v = [nombre];
    for (const n of callesGeoref) if (norm(n) !== norm(nombre) && mismaCalle(n, nombre)) v.push(n);
    const s = sig(nombre);
    if (s.length > 1) v.push(s[s.length - 1]);
    return [...new Map(v.map((x) => [norm(x), x])).values()].slice(0, 4);
  }

  // ---------- Datos locales (OSM): alturas y lugares ----------
  let alturas = null, lugares = [];
  const datosListos = Promise.all([
    fetch("alturas.json").then((r) => r.json()).then((j) => { alturas = j; }).catch(() => {}),
    fetch("lugares.json").then((r) => r.json()).catch(() => []).then((j) => {
      const extra = (C.lugaresExtra || []).map((x) => ({ n: x.nombre, t: x.tipo || "Lugar", k: x.palabras || "", c: [x.lat, x.lon] }));
      lugares = extra.concat(j);
      lugares.forEach((l) => { l._q = norm(`${l.n} ${l.t} ${l.k}`).split(" "); });
      $("#lugares").innerHTML = [...new Map(lugares.map((l) => [l.n, l])).values()]
        .map((l) => `<option value="${esc(l.n)}">${esc(l.t)}</option>`).join("");
    }),
  ]);

  // ---------- Autocompletado de calles (Georef + OSM) ----------
  (async function cargarCalles() {
    const key = "calles:" + JSON.stringify(C.georef);
    try { callesGeoref = JSON.parse(sessionStorage.getItem(key)) || []; } catch (_) {}
    if (!callesGeoref.length) {
      try {
        const p = filtros({ max: 5000, campos: "nombre" });
        const j = await (await fetch(`${API}/calles?${p}`)).json();
        callesGeoref = [...new Set((j.calles || []).map((c) => c.nombre))].filter((n) => !/^CALLE (SN|SIN SALIDA)$/.test(n));
        try { sessionStorage.setItem(key, JSON.stringify(callesGeoref)); } catch (_) {}
      } catch (_) {}
    }
    await datosListos;
    // nombres de OSM primero (mejor escritos); se omiten los de Georef que ya están
    const porNorm = new Map();
    for (const n of Object.keys((alturas && alturas.calles) || {})) porNorm.set(norm(n), n);
    for (const n of callesGeoref) if (!porNorm.has(norm(n))) porNorm.set(norm(n), n);
    const nombres = [...porNorm.values()].sort((a, b) => a.localeCompare(b, "es"));
    $("#calles").innerHTML = nombres.map((n) => `<option value="${esc(n)}">`).join("");
  })();

  // Interpolar una altura con los números de puerta de OSM
  function osmAltura(calle, altura) {
    const n = parseInt(altura, 10);
    if (!alturas || !Number.isFinite(n)) return null;
    const nombres = Object.keys(alturas.calles);
    let cands = nombres.filter((k) => norm(k) === norm(calle));
    if (!cands.length) cands = nombres.filter((k) => mismaCalle(k, calle));
    const metros = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * 0.795) * 111000;
    let mejor = null;
    for (const k of cands) {
      const a = alturas.calles[k], pts = [];
      for (let i = 0; i < a.length; i += 3) pts.push({ n: a[i], lat: alturas.base[0] + a[i + 1] / 1e5, lon: alturas.base[1] + a[i + 2] / 1e5 });
      let r = null;
      const exacto = pts.find((p) => p.n === n);
      if (exacto) r = { lat: exacto.lat, lon: exacto.lon, err: 0 };
      else {
        for (const p of pts) if (p.n < n) for (const q of pts) {
          if (q.n <= n || q.n - p.n > 200 || metros(p, q) > 300) continue;
          const err = q.n - p.n + (p.n % 2 !== n % 2 ? 40 : 0) + (q.n % 2 !== n % 2 ? 40 : 0);
          if (!r || err < r.err) { const t = (n - p.n) / (q.n - p.n); r = { lat: p.lat + (q.lat - p.lat) * t, lon: p.lon + (q.lon - p.lon) * t, err }; }
        }
      }
      if (r && (!mejor || r.err < mejor.err)) mejor = { ...r, calle: k };
    }
    return mejor;
  }

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
      $(".campo-calle").hidden = modo === "lugar";
      $(".modo-altura").hidden = modo !== "altura";
      $(".modo-esquina").hidden = modo !== "esquina";
      $(".modo-entre").hidden = modo !== "entre";
      $(".modo-lugar").hidden = modo !== "lugar";
      $("#calle").required = modo !== "lugar";
      $("#altura").required = modo === "altura";
      $("#cruce").required = modo === "esquina";
      $("#entre1").required = $("#entre2").required = modo === "entre";
      $("#lugar").required = modo === "lugar";
      (modo === "lugar" ? $("#lugar") : $("#calle")).focus();
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
      else if (modo === "esquina") await buscarEsquina();
      else if (modo === "lugar") await buscarLugar();
      else await buscarEntre();
    } catch (e) {
      mostrarError("Error consultando el servicio de direcciones: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Buscar";
    }
  });

  // ---------- Mano de la calle (para direcciones sobre una calle límite) ----------
  const COS = Math.cos((C.mapa.centro[0] * Math.PI) / 180);
  const aXY = (p, o) => [(p[1] - o[1]) * 111320 * COS, (p[0] - o[0]) * 110540];   // metros [este, norte] desde o
  const deXY = (v, o) => [o[0] + v[1] / 110540, o[1] + v[0] / (111320 * COS)];

  // Con los números de puerta de OSM cercanos: hacia dónde crece la numeración y de qué lado van los pares
  function geometriaMano(calle, altura, pt) {
    if (!alturas) return null;
    const n = parseInt(altura, 10);
    const nombres = Object.keys(alturas.calles);
    let cands = nombres.filter((k) => norm(k) === norm(calle));
    if (!cands.length) cands = nombres.filter((k) => mismaCalle(k, calle));
    let mejor = null;
    for (const k of cands) {
      const a = alturas.calles[k], pts = [];
      for (let i = 0; i < a.length; i += 3) {
        const v = aXY([alturas.base[0] + a[i + 1] / 1e5, alturas.base[1] + a[i + 2] / 1e5], pt);
        if (Math.hypot(v[0], v[1]) < 250 && Math.abs(a[i] - n) <= 250) pts.push({ n: a[i], v });
      }
      const pares = pts.filter((p) => p.n % 2 === 0), impares = pts.filter((p) => p.n % 2 === 1);
      if (pts.length < 3 || !pares.length || !impares.length) continue;
      // dirección de numeración creciente (regresión posición ~ número)
      const media = pts.reduce((s, p) => s + p.n, 0) / pts.length;
      let dx = 0, dy = 0;
      for (const p of pts) { dx += (p.n - media) * p.v[0]; dy += (p.n - media) * p.v[1]; }
      const largo = Math.hypot(dx, dy);
      if (!largo) continue;
      const dir = [dx / largo, dy / largo], izq = [-dir[1], dir[0]];
      const desvio = (g) => g.reduce((s, p) => s + p.v[0] * izq[0] + p.v[1] * izq[1], 0) / g.length;
      const oPar = desvio(pares), oImpar = desvio(impares);
      if (Math.abs(oPar - oImpar) < 4) continue; // no se distinguen las veredas
      const r = { calle: k, dir, izq, paresIzq: oPar > oImpar, centro: (oPar + oImpar) / 2, cant: pts.length };
      if (!mejor || r.cant > mejor.cant) mejor = r;
    }
    return mejor;
  }

  // Si el punto está sobre una calle límite, decide la zona según la mano (par / impar) de la altura
  function resolverMano(calle, altura, pt) {
    const cerca = zonasAlrededor(pt, 30);
    if (cerca.length < 2) return null;
    const g = geometriaMano(calle, altura, pt);
    if (!g) return { cerca };
    const par = parseInt(altura, 10) % 2 === 0;
    const izquierda = par === g.paresIzq;
    const s = izquierda ? 1 : -1;
    // además, correrse unos metros hacia adentro de la cuadra (el 800 está al principio de la cuadra del 800,
    // el 899 al final): resuelve las alturas que caen justo en una esquina con otra calle límite
    const adentro = (parseInt(altura, 10) % 100 < 50 ? 1 : -1) * 12;
    const vereda = (d) => deXY([g.izq[0] * (g.centro + d) + g.dir[0] * adentro, g.izq[1] * (g.centro + d) + g.dir[1] * adentro], pt);
    const pMano = vereda(s * 15), pEnfrente = vereda(-s * 15);
    return { cerca, par, izquierda, pMano, zMano: Geo.sectoresDe(pMano, sectores), zEnfrente: Geo.sectoresDe(pEnfrente, sectores) };
  }

  // Arma zona(s) + aviso para una dirección con altura, teniendo en cuenta la mano
  function zonaConMano(calle, altura, pt) {
    const orden = (a, b) => nombreDe(a).localeCompare(nombreDe(b), "es", { numeric: true });
    const m = resolverMano(calle, altura, pt);
    if (!m) return { secs: Geo.sectoresDe(pt, sectores), pt };
    const nombres = (z) => (z.length ? z.map(nombreDe).join(" / ") : "fuera de zonas");
    if (m.zMano && m.zMano.length === 1) {
      const igual = nombres(m.zMano) === nombres(m.zEnfrente);
      return {
        secs: m.zMano,
        pt: m.pMano,
        aviso: igual ? null : `Calle límite: el ${altura} es mano ${m.par ? "par" : "impar"} (${m.izquierda ? "izquierda" : "derecha"} según crece la numeración) → ${nombres(m.zMano)}. Vereda de enfrente: ${nombres(m.zEnfrente)}.`,
      };
    }
    return {
      secs: m.cerca.sort(orden), limite: true, pt,
      aviso: `Está sobre un límite entre ${m.cerca.length} zonas y no pude determinar la mano de la calle. Confirmá de qué vereda es.`,
    };
  }

  // Prueba la consulta con las variantes del nombre de cada calle hasta que Georef encuentre algo
  async function georefVariantes(armar, calle, otra) {
    const vc = variantes(calle), vo = otra ? variantes(otra) : [null];
    let intentos = 0;
    for (const a of vc) for (const b of vo) {
      if (intentos++ >= 8) return [];
      const res = await georef(armar(a, b), a);
      if (res.length) return res;
    }
    return [];
  }

  async function buscarAltura() {
    const calle = $("#calle").value.trim();
    const altura = $("#altura").value.trim();
    // 1) números de puerta de OSM (más precisos en Tandil: error mediano ~18 m contra ~67 m de Georef)
    // 2) Georef con el nombre tal cual  3) Georef con variantes del nombre
    await datosListos;
    let res = [], pt, nomenclatura, alts = [];
    const o = osmAltura(calle, altura);
    if (o) {
      pt = [o.lat, o.lon];
      nomenclatura = `${o.calle} ${altura}`;
    } else {
      res = await georef(`${calle} ${altura}`, calle);
      if (!res.length) res = await georefVariantes((a) => `${a} ${altura}`, calle);
    }
    if (!pt) {
      if (!res.length) return mostrarError(`No encontré "${calle} ${altura}". Puede que esa calle no tenga la numeración cargada: probá con la pestaña Esquina o Entre calles.`);
      pt = [res[0].ubicacion.lat, res[0].ubicacion.lon];
      nomenclatura = res[0].nomenclatura;
      alts = alternativas(res);
    }
    const z = zonaConMano(calle, altura, pt);

    marcas.clearLayers();
    L.circleMarker(z.pt, { radius: 8, color: "#fff", weight: 2, fillColor: z.secs[0] ? colorDe.get(z.secs[0]) : "#ff5f7e", fillOpacity: 1 })
      .bindPopup(esc(nomenclatura)).addTo(marcas);
    map.setView(z.pt, Math.max(map.getZoom(), z.aviso ? 18 : 16));

    render({ secs: z.secs, limite: z.limite, aviso: z.aviso, lineas: [`Interpretado: ${nomenclatura}`], alternativas: alts, destino: z.pt });
  }

  // Zonas que hay en un radio chico alrededor de un punto (para detectar límites)
  function zonasAlrededor(pt, radio = 25) {
    const dLat = radio / 110540, dLon = radio / (111320 * Math.cos((pt[0] * Math.PI) / 180));
    const set = new Set();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      Geo.sectoresDe([pt[0] + dLat * Math.sin(a), pt[1] + dLon * Math.cos(a)], sectores).forEach((f) => set.add(f));
    }
    return [...set];
  }

  async function buscarEsquina() {
    const calle = $("#calle").value.trim();
    const cruce = $("#cruce").value.trim();
    const res = await georefVariantes((a, b) => `${a} y ${b}`, calle, cruce);
    if (!res.length) return mostrarError(`No encontré la esquina "${calle} y ${cruce}". ¿Seguro que esas calles se cruzan? Usá las sugerencias para los nombres.`);
    const d = res[0];
    const pt = [d.ubicacion.lat, d.ubicacion.lon];
    const secs = Geo.sectoresDe(pt, sectores);
    const cerca = zonasAlrededor(pt);

    marcas.clearLayers();
    L.circleMarker(pt, { radius: 8, color: "#fff", weight: 2, fillColor: secs[0] ? colorDe.get(secs[0]) : "#ff5f7e", fillOpacity: 1 })
      .bindPopup(esc(d.nomenclatura)).addTo(marcas);
    map.setView(pt, Math.max(map.getZoom(), 17));

    let aviso = null;
    if (cerca.length > 1) {
      aviso = `La esquina está sobre un límite entre ${cerca.length} zonas. Confirmá de qué lado de la calle es el viaje.`;
    }
    const orden = (a, b) => nombreDe(a).localeCompare(nombreDe(b), "es", { numeric: true });
    render({ secs: cerca.length > 1 ? cerca.sort(orden) : secs, limite: cerca.length > 1, lineas: [`Interpretado: ${d.nomenclatura}`], aviso, alternativas: alternativas(res), destino: pt });
  }

  // ---------- Lugares ----------
  function filtrarLugares(texto) {
    const q = norm(texto), toks = q.split(" ").filter(Boolean);
    if (!toks.length) return [];
    const rank = (l) => { const n = norm(l.n); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3; };
    return lugares
      .filter((l) => toks.every((t) => l._q.some((w) => w.startsWith(t))))
      .sort((a, b) => rank(a) - rank(b) || a.n.localeCompare(b.n, "es"));
  }

  const zonaTexto = (l) => {
    const pt = l.c, dir = l.d && l.d.match(/^(.*\D)\s+(\d+)$/);
    if (dir && zonasAlrededor(pt, 30).length > 1) {
      const z = zonaConMano(dir[1].trim(), dir[2], pt);
      if (!z.limite && z.secs.length) return z.secs.map(nombreDe).join(" / ");
    }
    const cerca = zonasAlrededor(pt), dentro = Geo.sectoresDe(pt, sectores);
    const s = cerca.length > 1 ? cerca : dentro;
    return s.length ? s.map(nombreDe).sort((a, b) => a.localeCompare(b, "es", { numeric: true })).join(" / ") : "fuera de zonas";
  };

  async function buscarLugar() {
    await datosListos;
    const texto = $("#lugar").value.trim();
    const m = filtrarLugares(texto);
    if (!m.length) return mostrarError(`No encontré ningún lugar que coincida con "${texto}". Probá con otra palabra (ej: hospital, terminal, escuela, super) o buscá por dirección.`);
    const exactos = m.filter((l) => norm(l.n) === norm(texto));
    if (m.length === 1 || exactos.length === 1) return mostrarLugar(exactos[0] || m[0]);

    // varios resultados: lista con la zona de cada uno
    marcas.clearLayers();
    const MAX = 25;
    m.slice(0, MAX).forEach((l) => L.circleMarker(l.c, { radius: 6, color: "#fff", weight: 1, fillColor: "#ffb000", fillOpacity: 1 }).bindTooltip(esc(l.n)).addTo(marcas));
    map.fitBounds(L.latLngBounds(m.slice(0, MAX).map((l) => l.c)).pad(0.2), { maxZoom: 16 });
    $("#resultado").innerHTML = `<div class="res"><div class="meta">${m.length} lugares${m.length > MAX ? ` (se muestran ${MAX})` : ""}. Tocá uno:</div>
      <ul class="lista-lugares">${m.slice(0, MAX).map((l, i) => `<li><button type="button" data-i="${i}">
        <span class="ln">${esc(l.n)}</span><span class="lt">${esc(l.t)}${l.d ? " · " + esc(l.d) : ""}</span><span class="lz">${esc(zonaTexto(l))}</span>
      </button></li>`).join("")}</ul></div>`;
    $("#resultado").querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => mostrarLugar(m[+b.dataset.i])));
  }

  function mostrarLugar(l) {
    // Si el lugar tiene dirección con altura y está sobre un límite, decidir por la mano
    const dir = l.d && l.d.match(/^(.*\D)\s+(\d+)$/);
    if (dir && zonasAlrededor(l.c, 30).length > 1) {
      const z = zonaConMano(dir[1].trim(), dir[2], l.c);
      marcas.clearLayers();
      L.circleMarker(z.pt, { radius: 8, color: "#fff", weight: 2, fillColor: z.secs[0] ? colorDe.get(z.secs[0]) : "#ff5f7e", fillOpacity: 1 })
        .bindPopup(esc(l.n)).addTo(marcas);
      map.setView(z.pt, Math.max(map.getZoom(), 18));
      return render({ secs: z.secs, limite: z.limite, aviso: z.aviso, lineas: [l.n, `${l.t} · ${l.d}`], destino: l.c });
    }
    const pt = l.c, secs = Geo.sectoresDe(pt, sectores), cerca = zonasAlrededor(pt);
    marcas.clearLayers();
    L.circleMarker(pt, { radius: 8, color: "#fff", weight: 2, fillColor: secs[0] ? colorDe.get(secs[0]) : "#ff5f7e", fillOpacity: 1 })
      .bindPopup(esc(l.n)).addTo(marcas);
    map.setView(pt, Math.max(map.getZoom(), 16));
    const limite = cerca.length > 1;
    const orden = (a, b) => nombreDe(a).localeCompare(nombreDe(b), "es", { numeric: true });
    render({
      secs: limite ? cerca.sort(orden) : secs,
      limite,
      lineas: [l.n, l.t + (l.d ? ` · ${l.d}` : "")],
      aviso: limite ? `El lugar está sobre un límite entre ${cerca.length} zonas. Confirmá por qué calle es la entrada.` : null,
      destino: pt,
    });
  }

  async function buscarEntre() {
    const calle = $("#calle").value.trim();
    const e1 = $("#entre1").value.trim();
    const e2 = $("#entre2").value.trim();
    const armar = (a, b) => `${a} y ${b}`;
    const [r1, r2] = await Promise.all([georefVariantes(armar, calle, e1), georefVariantes(armar, calle, e2)]);
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
    render({ secs: sm, lineas, aviso, alternativas: alternativas(r1.concat(r2)), destino: pm });
  }

  function alternativas(res) {
    const principal = res[0] && res[0].calle.nombre;
    return [...new Set(res.map((d) => d.calle.nombre))].filter((n) => n !== principal);
  }

  // Botones para abrir la navegación en Google Maps / Waze
  function botonesNav(pt) {
    if (!pt) return "";
    const [lat, lon] = pt.map((x) => x.toFixed(6));
    return `<div class="nav">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving" target="_blank" rel="noopener">▶ Google Maps</a>
      <a href="https://waze.com/ul?ll=${lat},${lon}&navigate=yes" target="_blank" rel="noopener">▶ Waze</a>
    </div>`;
  }

  function render({ secs, limite = false, lineas = [], aviso, alternativas = [], destino }) {
    let html = '<div class="res">';
    if (!secs.length) {
      html += `<div class="sector" style="color:var(--err)">Fuera de todos los sectores</div>`;
    } else {
      html += secs.map((f) => `<div class="sector"><span class="sw" style="background:${esc(colorDe.get(f))};color:${esc(colorDe.get(f))}"></span>${esc(nombreDe(f))}</div>`).join("");
      if (secs.length > 1 && !limite) aviso = (aviso ? aviso + " " : "") + "El punto cae en más de un sector (los polígonos se superponen).";
    }
    html += `<div class="meta">${lineas.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
    if (aviso) html += `<div class="warn">⚠ ${esc(aviso)}</div>`;
    html += botonesNav(destino);
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

  // ---------- GPS: mi ubicación y seguimiento ----------
  const capaGps = L.layerGroup().addTo(map);
  let watchId = null, wakeLock = null, zonaActual = null, primeraVez = true;

  function pintarGps(pos) {
    const pt = [pos.coords.latitude, pos.coords.longitude];
    const acc = Math.round(pos.coords.accuracy);
    const secs = Geo.sectoresDe(pt, sectores);
    const cerca = zonasAlrededor(pt, Math.max(25, Math.min(acc, 100))).filter((f) => !secs.includes(f));

    capaGps.clearLayers();
    L.circle(pt, { radius: acc, color: "#4dd0ff", weight: 1, fillOpacity: 0.08, interactive: false }).addTo(capaGps);
    L.circleMarker(pt, { radius: 7, color: "#fff", weight: 2, fillColor: "#4dd0ff", fillOpacity: 1, interactive: false }).addTo(capaGps);
    if (primeraVez || !map.getBounds().pad(-0.15).contains(pt)) map.setView(pt, primeraVez ? Math.max(map.getZoom(), 16) : map.getZoom());
    primeraVez = false;

    const nombre = secs.length ? secs.map(nombreDe).join(" / ") : "Fuera de zonas";
    const caja = $("#gps");
    if (watchId !== null && zonaActual !== null && nombre !== zonaActual) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      caja.classList.remove("cambio"); void caja.offsetWidth; caja.classList.add("cambio");
    }
    const anterior = watchId !== null && zonaActual !== null && nombre !== zonaActual ? zonaActual : null;
    zonaActual = nombre;

    const col = secs[0] ? colorDe.get(secs[0]) : "var(--err)";
    let html = `<div class="sector"><span class="sw" style="background:${esc(col)};color:${esc(col)}"></span>${esc(nombre)}</div>`;
    html += `<div class="meta"><div>Estás acá · precisión ±${acc} m${watchId !== null ? " · siguiendo" : ""}</div>`;
    if (anterior) html += `<div>Entraste desde ${esc(anterior)}</div>`;
    html += "</div>";
    if (acc > 60) html += `<div class="warn">⚠ Precisión baja: activá el GPS del celular o esperá unos segundos al aire libre.</div>`;
    else if (cerca.length) html += `<div class="warn">⚠ Cerca del límite con ${esc(cerca.map(nombreDe).join(", "))}.</div>`;
    caja.innerHTML = html;
    caja.hidden = false;
  }

  function errorGps(e) {
    const msg = {
      1: "No diste permiso de ubicación. Habilitalo para este sitio en la configuración del navegador (el candado al lado de la dirección).",
      2: "No se pudo obtener la ubicación. Revisá que el GPS / ubicación del celular esté activado.",
      3: "La ubicación tardó demasiado. Probá de nuevo.",
    }[e.code] || "Error de ubicación: " + e.message;
    $("#gps").innerHTML = `<div class="warn">⚠ ${esc(msg)}</div>`;
    $("#gps").hidden = false;
    if (e.code === 1) dejarDeSeguir();
  }

  const OPC_GPS = { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 };

  $("#btn-ubicacion").addEventListener("click", () => {
    if (!navigator.geolocation) return errorGps({ code: 0, message: "este navegador no tiene GPS" });
    const btn = $("#btn-ubicacion");
    btn.disabled = true;
    btn.textContent = "📍 Buscando…";
    primeraVez = true;
    navigator.geolocation.getCurrentPosition(
      (p) => { pintarGps(p); btn.disabled = false; btn.textContent = "📍 Mi ubicación"; },
      (e) => { errorGps(e); btn.disabled = false; btn.textContent = "📍 Mi ubicación"; },
      OPC_GPS
    );
  });

  async function pedirPantallaEncendida() {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
  document.addEventListener("visibilitychange", () => {
    if (watchId !== null && document.visibilityState === "visible") pedirPantallaEncendida();
  });

  function dejarDeSeguir() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    zonaActual = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    $("#btn-seguir").classList.remove("on");
    $("#btn-seguir").textContent = "Seguir";
  }

  $("#btn-seguir").addEventListener("click", () => {
    if (watchId !== null) return dejarDeSeguir();
    if (!navigator.geolocation) return errorGps({ code: 0, message: "este navegador no tiene GPS" });
    primeraVez = true;
    watchId = navigator.geolocation.watchPosition(pintarGps, errorGps, OPC_GPS);
    $("#btn-seguir").classList.add("on");
    $("#btn-seguir").textContent = "■ Parar";
    $("#gps").hidden = false;
    $("#gps").innerHTML = `<div class="meta">Buscando ubicación…</div>`;
    pedirPantallaEncendida();
  });

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
