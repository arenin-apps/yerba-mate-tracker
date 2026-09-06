/**
 * Regenera data/precios.json leyendo las tiendas directamente.
 *
 * Casa Argentina usa Shopify, que publica un JSON con todo su catálogo.
 * Urushop usa WooCommerce, que tiene la Store API abierta.
 * eBay entra por su propia API (hace falta cuenta de desarrollador).
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
  'Nobleza Gaucha', 'Liebig', 'Mañanita', 'La Merced', 'Kraus', 'Verdeflor',
  // Estas últimas son marcas polacas de yerba mate, muy vendidas en UK
  // (MateMundo las tiene casi en exclusiva) — no son argentinas, pero son
  // yerba mate real y el comparador es de precios en UK, no solo de
  // marcas argentinas.
  'El Fuego', 'Verde Mate', 'Yaguar', 'Guarani', 'Rio Parana', 'Soul Mate'
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

// WooCommerce devuelve los títulos con entidades HTML (&#038; en vez de &).
function decodificar(texto) {
  return String(texto)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

// Packs de varias unidades: el precio por kilo saldría mal, así que los dejamos fuera.
function esMultipack(titulo) {
  return /\d+\s*x\s*\d+\s*g|pack of \d|combo|bundle|\bset\b/i.test(titulo);
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

// Fuera accesorios y termos, que también llevan "mate" en el nombre.
function esAccesorio(titulo) {
  return /(bombilla|gourd|calabaza|термо|thermos|termo|cup|set|kit|straw|matera)/i.test(titulo.toLowerCase());
}

function esYerba(titulo) {
  const t = titulo.toLowerCase();
  if (!t.includes('yerba') && !t.includes('mate')) return false;
  return !esAccesorio(titulo);
}

/* --- Tiendas Shopify (Casa Argentina, Argentina Premium) ---------------
   Shopify publica el catálogo en /products.json, así que la misma función
   vale para cualquier tienda montada sobre esa plataforma. */

async function shopify({ tienda, dominio, coleccion }) {
  const items = [];
  const base = coleccion
    ? `https://${dominio}/collections/${coleccion}/products.json`
    : `https://${dominio}/products.json`;

  for (let pagina = 1; pagina <= 6; pagina++) {
    const data = await pedirJson(`${base}?limit=250&page=${pagina}`);
    const productos = data.products || [];
    if (!productos.length) break;

    for (const p of productos) {
      const titulo = decodificar(p.title);
      if (!esYerba(titulo) || esMultipack(titulo)) continue;

      for (const v of p.variants || []) {
        if (v.available === false) continue;
        const nombre = `${titulo} ${decodificar(v.title || '')}`;
        if (esMultipack(nombre)) continue;

        const peso = detectarPeso(nombre) || detectarPeso(titulo);
        const marca = detectarMarca(titulo);
        const precio = parseFloat(v.price);
        if (!peso || !marca || !Number.isFinite(precio) || precio <= 0) continue;

        const rebajado = v.compare_at_price && parseFloat(v.compare_at_price) > precio;
        items.push({
          brand: marca,
          title: titulo,
          weight: peso.weight,
          grams: peso.grams,
          price: Number(precio.toFixed(2)),
          shop: tienda,
          url: `https://${dominio}/products/${p.handle}`,
          isPromo: Boolean(rebajado),
          promoKey: rebajado ? 'rebajado' : '',
          promoDetails: rebajado ? 'Rebajado' : ''
        });
      }
    }
  }
  return items;
}

const casaArgentina = () => shopify({
  tienda: 'Casa Argentina',
  dominio: 'casaargentina.com',
  coleccion: 'yerba-mate-1'
});

// Sin colección: leemos el catálogo entero y filtramos, porque no sabemos
// cómo han llamado a su colección de yerba.
const argentinaPremium = () => shopify({
  tienda: 'Argentina Premium',
  dominio: 'gsiargentinapremium.com',
  coleccion: null
});

/* --- Urushop (WooCommerce Store API) --------------------------------- */

async function urushop() {
  const items = [];
  for (let pagina = 1; pagina <= 5; pagina++) {
    const data = await pedirJson(`https://urushop.co.uk/wp-json/wc/store/v1/products?search=yerba%20mate&per_page=100&page=${pagina}`);
    if (!Array.isArray(data) || !data.length) break;

    for (const p of data) {
      const titulo = decodificar(p.name);
      if (!esYerba(titulo) || esMultipack(titulo)) continue;
      if (p.is_in_stock === false) continue;

      const peso = detectarPeso(titulo);
      const marca = detectarMarca(titulo);
      if (!peso || !marca) continue;

      // La Store API devuelve céntimos: 399 con minor_unit 2 son £3.99.
      const minor = p.prices?.currency_minor_unit ?? 2;
      const precio = Number(p.prices?.price) / Math.pow(10, minor);
      const regular = Number(p.prices?.regular_price) / Math.pow(10, minor);
      if (!Number.isFinite(precio) || precio <= 0) continue;

      items.push({
        brand: marca,
        title: titulo,
        weight: peso.weight,
        grams: peso.grams,
        price: Number(precio.toFixed(2)),
        shop: 'Urushop',
        url: p.permalink,
        isPromo: regular > precio,
        promoKey: regular > precio ? 'value_deal' : '',
        promoDetails: regular > precio ? 'Value deal' : ''
      });
    }
  }
  return items;
}


/* --- MateMundo (IdoSell) ----------------------------------------------
   Esta tienda no publica un JSON de catálogo. Hasta septiembre 2026 leíamos
   el marcado schema.org (@type: Product) que traían las páginas de
   categoría, pero lo sacaron en un rediseño — la web sigue funcionando
   igual para un visitante, pero el HTML ya no trae esos bloques.
   Los datos siguen ahí, solo que en HTML plano de toda la vida (server-side,
   no hace falta ejecutar JS): cada producto es un <div class="product"
   data-product_id="...">, con el nombre en <a class="product__name"> y el
   precio en <strong class="price --main">. Es la fuente más frágil del
   proyecto: si vuelven a rediseñar, dejará de encontrar productos y
   aparecerá en "fuentesConError" sin romper el resto. */

const MATEMUNDO_PAGINAS = [
  'https://www.matemundo.co.uk/eng_n_Categories_Yerba-Mate_Yerba-mate-A-Z-7340.html',
  'https://www.matemundo.co.uk/eng_m_Categories_Yerba-Mate-7337.html'
];

function extraerProductosHtml(html) {
  const encontrados = [];
  const trozos = html.split(/(?=<div class="product" data-product_id="\d+")/);

  for (const trozo of trozos.slice(1)) {
    const nombre = trozo.match(/class="product__name"[^>]*href="([^"]+)"[^>]*title="([^"]+)"/);
    const precio = trozo.match(/class="price --main">£([\d.,]+)/);
    if (!nombre || !precio) continue;

    encontrados.push({
      name: nombre[2],
      url: nombre[1],
      price: parseFloat(precio[1].replace(',', ''))
    });
  }
  return encontrados;
}

async function pedirHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function mateMundo() {
  const items = [];
  const vistos = new Set();

  for (const pagina of MATEMUNDO_PAGINAS) {
    for (let n = 0; n <= 9; n++) {
      const url = n === 0 ? pagina : `${pagina}?counter=${n}`;
      let html;
      try { html = await pedirHtml(url); } catch { break; }

      const productos = extraerProductosHtml(html);
      if (!productos.length) break;

      let nuevos = 0;
      for (const p of productos) {
        const titulo = decodificar(p.name);
        // A diferencia de las otras tiendas, acá no exigimos que el
        // título diga "yerba"/"mate": estas páginas SON la categoría de
        // yerba mate del sitio, y los productos vienen listados solo
        // como "Marca Variante Peso" (ej. "Cruz de Malta 0.5kg"), sin
        // repetir el nombre de la categoría. La marca conocida + el peso
        // detectado ya alcanzan como filtro de relevancia acá.
        if (esAccesorio(titulo) || esMultipack(titulo)) continue;

        const peso = detectarPeso(titulo);
        const marca = detectarMarca(titulo);
        if (!peso || !marca) continue;

        const precio = p.price;
        if (!Number.isFinite(precio) || precio <= 0) continue;

        const enlace = p.url;
        if (!enlace || vistos.has(enlace)) continue;
        vistos.add(enlace);
        nuevos++;

        items.push({
          brand: marca,
          title: titulo,
          weight: peso.weight,
          grams: peso.grams,
          price: Number(precio.toFixed(2)),
          shop: 'MateMundo',
          url: enlace,
          isPromo: false,
          promoDetails: ''
        });
      }
      if (!nuevos) break;   // la paginación ya no aporta nada
    }
  }

  if (!items.length) throw new Error('No se encontró ningún producto: puede que hayan cambiado la web.');
  return items;
}

/* --- eBay UK (Browse API) --------------------------------------------- */
/* Necesita dos secretos en GitHub: EBAY_CLIENT_ID y EBAY_CLIENT_SECRET.
   Si no están puestos, esta parte se salta sin romper nada.
   EBAY_CAMPAIGN_ID es opcional: solo si te das de alta en eBay Partner Network. */

async function tokenEbay() {
  const id = process.env.EBAY_CLIENT_ID;
  const secreto = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secreto) return null;

  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secreto}`).toString('base64')
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope')
  });
  if (!res.ok) throw new Error(`No se pudo pedir el token de eBay (HTTP ${res.status})`);
  const data = await res.json();
  return data.access_token;
}

async function ebay() {
  const token = await tokenEbay();
  if (!token) {
    console.log('eBay: sin credenciales, se omite.');
    return [];
  }

  const campana = process.env.EBAY_CAMPAIGN_ID;
  const cabeceras = {
    Authorization: `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    Accept: 'application/json'
  };
  if (campana) cabeceras['X-EBAY-C-ENDUSERCTX'] = `affiliateCampaignId=${campana}`;

  const items = [];
  for (const consulta of ['yerba mate 500g', 'yerba mate 1kg']) {
    const url = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
      + `?q=${encodeURIComponent(consulta)}&limit=100`
      + '&filter=' + encodeURIComponent('buyingOptions:{FIXED_PRICE},itemLocationCountry:GB');

    const res = await fetch(url, { headers: cabeceras });
    if (!res.ok) throw new Error(`Búsqueda en eBay falló (HTTP ${res.status})`);
    const data = await res.json();

    for (const it of data.itemSummaries || []) {
      const titulo = decodificar(it.title || '');
      if (!esYerba(titulo) || esMultipack(titulo)) continue;

      const peso = detectarPeso(titulo);
      const marca = detectarMarca(titulo);
      const precio = parseFloat(it.price?.value);
      if (!peso || !marca || !Number.isFinite(precio) || precio <= 0) continue;
      if (it.price?.currency !== 'GBP') continue;

      // En eBay el envío se cobra aparte muy a menudo, así que lo sumamos al precio.
      const envio = parseFloat(it.shippingOptions?.[0]?.shippingCost?.value || 0);
      const total = precio + (Number.isFinite(envio) ? envio : 0);

      items.push({
        brand: marca,
        title: titulo,
        weight: peso.weight,
        grams: peso.grams,
        price: Number(total.toFixed(2)),
        shop: 'eBay',
        url: it.itemAffiliateWebUrl || it.itemWebUrl,
        isPromo: false,
        promoKey: envio > 0 ? 'envio_incluido' : 'envio_gratis',
        promoDetails: envio > 0 ? 'Envío incluido' : 'Envío gratis'
      });
    }
  }
  return items;
}

/* --- Amazon UK (SerpApi) -----------------------------------------------
   Amazon bloquea el scraping directo (403/CAPTCHA incluso vía proxy de
   renderizado), así que en vez de leerla nosotros usamos SerpApi
   (serpapi.com), que hace de intermediario y entrega los resultados de
   búsqueda ya en JSON. Necesita el secreto SERPAPI_KEY en GitHub. Si no
   está puesto, esta parte se salta sin romper nada — igual que eBay sin
   credenciales. Con 2 búsquedas por día el uso mensual queda muy por
   debajo del límite gratuito de SerpApi (250/mes). */

async function amazon() {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    console.log('Amazon: sin SERPAPI_KEY, se omite.');
    return [];
  }

  const items = [];
  const vistos = new Set();

  for (const consulta of ['yerba mate 500g', 'yerba mate 1kg']) {
    const url = 'https://serpapi.com/search.json'
      + '?engine=amazon&amazon_domain=amazon.co.uk'
      + `&k=${encodeURIComponent(consulta)}`
      + `&api_key=${apiKey}`;

    const data = await pedirJson(url);
    if (data.error) throw new Error(`SerpApi: ${data.error}`);

    for (const r of data.organic_results || []) {
      const titulo = decodificar(r.title || '');
      if (!esYerba(titulo) || esMultipack(titulo)) continue;

      const peso = detectarPeso(titulo);
      const marca = detectarMarca(titulo);
      const precio = Number(r.extracted_price);
      if (!peso || !marca || !Number.isFinite(precio) || precio <= 0) continue;

      const enlace = r.link_clean || r.link;
      if (!enlace || vistos.has(enlace)) continue;
      vistos.add(enlace);

      const rebajado = Number.isFinite(r.extracted_old_price) && r.extracted_old_price > precio;
      items.push({
        brand: marca,
        title: titulo,
        weight: peso.weight,
        grams: peso.grams,
        price: Number(precio.toFixed(2)),
        shop: 'Amazon',
        url: enlace,
        isPromo: Boolean(rebajado),
        promoKey: rebajado ? 'rebajado' : '',
        promoDetails: rebajado ? 'Rebajado' : ''
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

  const FUENTES = [
    ['Casa Argentina', casaArgentina],
    ['Urushop', urushop],
    ['Argentina Premium', argentinaPremium],
    ['MateMundo', mateMundo],
    ['eBay', ebay],
    ['Amazon', amazon]
  ];

  for (const [nombre, fn] of FUENTES) {
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
