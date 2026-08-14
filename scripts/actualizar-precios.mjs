/**
 * Regenera data/precios.json leyendo las tiendas directamente.
 *
 * Casa Argentina usa Shopify, que publica un JSON con todo su catálogo.
 * Urushop usa WooCommerce, que tiene la Store API abierta.
 * Amazon y eBay no se pueden leer así: esos productos salen de data/manual.json.
 *
 * Uso:  node scripts/actualizar-precios.mjs
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'data', 'precios.json');
const MANUAL = join(RAIZ, 'data', 'manual.json');

const MARCAS = [
  'Playadito', 'Taragüi', 'Taragui', 'Rosamonte', 'Cruz de Malta', 'Canarias',
  'Amanda', 'Unión', 'Union', 'CBSé', 'CBSe', 'Piporé', 'Pipore', 'Pajarito',
  'Nobleza Gaucha', 'Liebig', 'Mañanita', 'La Merced', 'Kraus', 'Verdeflor'
];

const UA = 'yerba-tracker/1.0 (+https://arenin.uk)';

/* ------------------------------------------------------------------ */

async function pedirJson(url, intentos = 3) {
  let ultimoError;
  for (let n = 1; n <= intentos; n++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      ultimoError = err;
      // Espera creciente: 2s, 4s. Siempre acaba, nunca da vueltas infinitas.
      if (n < intentos) await new Promise(r => setTimeout(r, 2000 * n));
    }
  }
  throw ultimoError;
}

function detectarMarca(titulo) {
  const t = titulo.toLowerCase();
  const encontrada = MARCAS.find(m => t.includes(m.toLowerCase()));
  if (!encontrada) return null;
  return { Taragui: 'Taragüi', Union: 'Unión', CBSe: 'CBSé', Pipore: 'Piporé' }[encontrada] || encontrada;
}

function detectarPeso(titulo) {
  const t = titulo.toLowerCase().replace(',', '.');
  if (/\b1\s?kg\b|\b1000\s?g\b/.test(t)) return { weight: '1kg', grams: 1000 };
  if (/\b500\s?g\b|\b0\.5\s?kg\b/.test(t)) return { weight: '500g', grams: 500 };
  return null;
}

function esYerba(titulo) {
  const t = titulo.toLowerCase();
  if (!t.includes('yerba') && !t.includes('mate')) return false;
  // Fuera accesorios y termos, que también llevan "mate" en el nombre.
  return !/(bombilla|gourd|calabaza|термо|thermos|termo|cup|set|kit|straw|matera)/i.test(t);
}

/* --- Casa Argentina (Shopify) --------------------------------------- */

async function casaArgentina() {
  const items = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const data = await pedirJson(`https://casaargentina.com/collections/yerba-mate-1/products.json?limit=250&page=${pagina}`);
    const productos = data.products || [];
    if (!productos.length) break;

    for (const p of productos) {
      if (!esYerba(p.title)) continue;
      for (const v of p.variants || []) {
        if (v.available === false) continue;
        const nombre = `${p.title} ${v.title || ''}`;
        const peso = detectarPeso(nombre) || detectarPeso(p.title);
        const marca = detectarMarca(p.title);
        const precio = parseFloat(v.price);
        if (!peso || !marca || !Number.isFinite(precio) || precio <= 0) continue;

        const rebajado = v.compare_at_price && parseFloat(v.compare_at_price) > precio;
        items.push({
          brand: marca,
          title: p.title.trim(),
          weight: peso.weight,
          grams: peso.grams,
          price: Number(precio.toFixed(2)),
          shop: 'Casa Argentina',
          url: `https://casaargentina.com/products/${p.handle}`,
          isPromo: Boolean(rebajado),
          promoDetails: rebajado ? 'Rebajado' : ''
        });
      }
    }
  }
  return items;
}

/* --- Urushop (WooCommerce Store API) --------------------------------- */

async function urushop() {
  const items = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const data = await pedirJson(`https://urushop.co.uk/wp-json/wc/store/v1/products?search=yerba%20mate&per_page=100&page=${pagina}`);
    if (!Array.isArray(data) || !data.length) break;

    for (const p of data) {
      if (!esYerba(p.name)) continue;
      if (p.is_in_stock === false) continue;

      const peso = detectarPeso(p.name);
      const marca = detectarMarca(p.name);
      if (!peso || !marca) continue;

      // La Store API devuelve céntimos: 399 con minor_unit 2 son £3.99.
      const minor = p.prices?.currency_minor_unit ?? 2;
      const precio = Number(p.prices?.price) / Math.pow(10, minor);
      const regular = Number(p.prices?.regular_price) / Math.pow(10, minor);
      if (!Number.isFinite(precio) || precio <= 0) continue;

      items.push({
        brand: marca,
        title: p.name.trim(),
        weight: peso.weight,
        grams: peso.grams,
        price: Number(precio.toFixed(2)),
        shop: 'Urushop',
        url: p.permalink,
        isPromo: regular > precio,
        promoDetails: regular > precio ? 'Value deal' : ''
      });
    }
  }
  return items;
}

/* --- Montaje final ---------------------------------------------------- */

function deduplicar(items) {
  const mapa = new Map();
  for (const i of items) {
    const clave = `${i.shop}|${i.brand}|${i.weight}|${i.title.toLowerCase()}`;
    const previo = mapa.get(clave);
    if (!previo || i.price < previo.price) mapa.set(clave, i);
  }
  return [...mapa.values()];
}

async function main() {
  const manual = JSON.parse(await readFile(MANUAL, 'utf8'));
  const recogidos = [];
  const errores = [];

  for (const [nombre, fn] of [['Casa Argentina', casaArgentina], ['Urushop', urushop]]) {
    try {
      const r = await fn();
      console.log(`${nombre}: ${r.length} productos`);
      recogidos.push(...r);
    } catch (err) {
      // Si una tienda falla, seguimos con las demás en vez de dejar la web sin datos.
      console.error(`${nombre} falló: ${err.message}`);
      errores.push(nombre);
    }
  }

  if (!recogidos.length) {
    console.error('Ninguna tienda respondió. No se toca precios.json.');
    process.exit(1);
  }

  const items = deduplicar([...recogidos, ...(manual.items || [])])
    .sort((a, b) => a.price / a.grams - b.price / b.grams);

  const salida = {
    actualizado: new Date().toISOString(),
    fuentesConError: errores,
    afiliados: false,
    envios: manual.envios,
    items
  };

  await writeFile(SALIDA, JSON.stringify(salida, null, 2) + '\n', 'utf8');
  console.log(`Escritos ${items.length} productos en data/precios.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
