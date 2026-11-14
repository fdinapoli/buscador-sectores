// ============================================================
//  CONFIGURACIÓN — editá esto para tu ciudad
// ============================================================
window.CONFIG = {
  titulo: "Buscador de sectores",

  // Filtros para la API Georef (apis.datos.gob.ar). Usá los nombres oficiales.
  // Para ver los valores válidos:
  //   https://apis.datos.gob.ar/georef/api/departamentos?nombre=TU_PARTIDO
  //   https://apis.datos.gob.ar/georef/api/localidades-censales?nombre=TU_CIUDAD
  // Dejá en "" lo que no quieras filtrar.
  georef: {
    provincia: "Buenos Aires",
    departamento: "Tandil",   // partido / departamento
    // IMPORTANTE: completalo si el partido tiene varias localidades; si no,
    // "San Martín 500" puede caer en otro pueblo del mismo partido.
    localidad_censal: "Tandil",
  },

  // Vista inicial del mapa (si hay sectores, se ajusta a ellos)
  mapa: { centro: [-37.3217, -59.1332], zoom: 13 },

  // Archivo con los sectores (GeoJSON con Polygon / MultiPolygon)
  sectoresUrl: "sectores.geojson",

  // Propiedad del GeoJSON que tiene el nombre del sector.
  // Si no existe, se prueba con: nombre, name, Name, sector.
  propiedadNombre: "nombre",
};
