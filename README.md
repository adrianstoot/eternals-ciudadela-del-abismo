# ETERNALS — Ciudadela del Abismo

Juego de acción 3D en navegador con Three.js. Controles de teclado/ratón en PC y controles táctiles en móvil horizontal.

## Desarrollo local

```sh
npm ci
npm run dev
```

## Publicación

GitHub Actions compila el juego y lo publica en GitHub Pages al actualizar `main`. Los modelos y archivos multimedia originales que no se usan en tiempo de ejecución no se copian a la web.

```sh
npm ci
npm run build -- --base=/eternals-ciudadela-del-abismo/
npm run preview
```
