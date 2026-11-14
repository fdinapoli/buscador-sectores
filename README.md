# Buscador de sectores

App estática (HTML + JS, sin build) que, dada una dirección, dice a qué sector pertenece:

- **Calle + altura** → ej. `San Martín 1250`
- **Calle entre calles** → ej. `San Martín entre Rodríguez y 9 de Julio` (calcula las dos esquinas y usa el punto medio de la cuadra; avisa si el tramo cruza un límite entre sectores)
- **Click en el mapa** → muestra el sector de ese punto

Las direcciones se resuelven con la [API Georef](https://datosgobar.github.io/georef-ar-api/) (gratuita, del Estado argentino, sin API key). Los sectores son polígonos en `sectores.geojson`.

## Archivos

| Archivo | Qué es |
|---|---|
| `config.js` | **Tu ciudad** (provincia / partido / localidad), centro del mapa, nombre de la propiedad del sector |
| `sectores.geojson` | Los polígonos de los sectores (los que vienen son de ejemplo) |
| `editor.html` | Editor para dibujar sectores, importar KML (Google My Maps) / GeoJSON y descargar `sectores.geojson` |
| `index.html`, `app.js`, `geo.js`, `style.css` | La app |

## Cargar tus sectores

1. Abrí `editor.html` (en local o ya publicado).
2. Dibujá los sectores o importá tu KML/GeoJSON. Si tenés un **KMZ**, descomprimilo (es un zip) y usá el `.kml` de adentro.
3. Poneles nombre y color → **Descargar sectores.geojson** → reemplazá el archivo en el repo.

## Probar en local

Hace falta un servidor (por `fetch` del GeoJSON), por ejemplo:

```
npx serve .
# o
python -m http.server 8000
```

## Deploy en GitHub Pages

```
git init
git add .
git commit -m "Buscador de sectores"
git branch -M main
git remote add origin https://github.com/USUARIO/buscador-sectores.git
git push -u origin main
```

En GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**. Queda en `https://USUARIO.github.io/buscador-sectores/`.

## Notas

- Completá `localidad_censal` en `config.js` si el partido tiene varias localidades; si no, una calle con el mismo nombre en otro pueblo puede confundir la búsqueda.
- Para "entre calles", las calles tienen que cruzarse de verdad con la principal. Usá los nombres que sugiere el autocompletado.
- La altura la interpola Georef según los datos de catastro/INDEC, así que puede tener un margen de error de algunos metros.
