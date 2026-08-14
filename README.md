# Comparador de precios de yerba mate en UK

Página estática que compara los precios de yerba mate de Urushop, Casa Argentina y eBay. Los precios se regeneran solos una vez al día con una acción de GitHub.

## Qué hay en cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La página. No contiene datos ni claves. |
| `assets/styles.css` | Estilos propios. Todo cuelga de `.ym` para no chocar con el resto de arenin.uk. |
| `assets/app.js` | Filtros, orden y pintado de la tabla. Lee `data/precios.json`. |
| `data/precios.json` | **Generado automáticamente.** No lo edites a mano. |
| `data/manual.json` | Lo que sí editas tú: tarifas de envío y productos sueltos. |
| `scripts/actualizar-precios.mjs` | El robot que lee las tiendas y reescribe `precios.json`. |
| `.github/workflows/actualizar-precios.yml` | El cron diario (06:00 UTC). |

## Probarlo en local

Hace falta un servidor, porque `fetch` no funciona abriendo el archivo directamente:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Para lanzar el actualizador a mano:

```bash
node scripts/actualizar-precios.mjs
```

## Publicarlo

### Opción A — GitHub Pages + dominio propio

1. Sube el repo a GitHub (puede ser privado; Pages funciona igual en cuentas Pro).
2. **Settings → Pages → Source: Deploy from a branch**, rama `main`, carpeta `/`.
3. **Settings → Pages → Custom domain**: `yerba.arenin.uk`.
4. En tu DNS, un registro `CNAME` de `yerba` a `<tu-usuario>.github.io`.
5. Marca **Enforce HTTPS**.

Si prefieres que viva en `arenin.uk/yerba-mate/` en vez de un subdominio, usa la opción B.

### Opción B — arenin.uk es WordPress

Aquí GitHub solo sirve para generar el JSON; la página la sirve tu WordPress.

1. Sube `index.html` (solo el contenido de `<body>`) a una página nueva en un bloque HTML personalizado.
2. Sube `styles.css` y `app.js` a `/wp-content/uploads/yerba/` y encólalos desde el `functions.php` de un child theme.
3. Cambia en `app.js` la constante `DATA_URL` a la URL pública del JSON, por ejemplo:
   `https://raw.githubusercontent.com/<usuario>/<repo>/main/data/precios.json`
   (o mejor, la de GitHub Pages, que tiene CDN: `https://<usuario>.github.io/<repo>/data/precios.json`).

## Ajustes que querrás tocar

- **Tarifas de envío**: `data/manual.json` → `envios`.
- **Hora de actualización**: el `cron` del workflow.
- **Enlaces de afiliado**: pon tus URLs en `data/manual.json` y cambia `afiliados` a `true`
  en `scripts/actualizar-precios.mjs` para que la página muestre el aviso obligatorio.

## Aviso

Los precios se recogen de las webs públicas de las tiendas y pueden cambiar en cualquier
momento. La página lo indica al usuario y enlaza siempre a la ficha original.
