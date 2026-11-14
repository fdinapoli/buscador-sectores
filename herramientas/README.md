# Generar zonas desde las calles límite

`generar-zonas.js` arma `sectores.geojson` a partir del eje real de las calles que delimitan
las zonas (según el croquis de la empresa), usando datos de OpenStreetMap.

1. Bajar las calles de Tandil (consulta en `overpass-calles.txt`):
   ```
   curl -s --data-urlencode "data@overpass-calles.txt" https://overpass-api.de/api/interpreter -o calles-osm.json
   ```
2. Generar:
   ```
   node generar-zonas.js calles-osm.json ../sectores.geojson
   ```

Las líneas límite (`VERT`, `HORI`) y la numeración (`NUM`) están al principio del script.
`R` es el radio aproximado (en metros) que cubren las zonas exteriores.
