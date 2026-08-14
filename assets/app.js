/* Comparador de yerba mate UK — front-end.
   No hay claves de API aquí: los datos llegan ya preparados desde data/precios.json,
   que regenera cada día una acción de GitHub. */
(function () {
  'use strict';

  var DATA_URL = 'data/precios.json';
  var LIMITE = 20;
  var HORAS_PARA_CADUCAR = 48;

  var state = {
    items: [],
    envios: {},
    actualizado: null,
    peso: '500g',
    marcas: [],
    tiendas: [],
    conEnvio: false
  };

  var $ = function (id) { return document.getElementById(id); };

  /* --- Idiomas ---------------------------------------------------------
     El español manda: es lo que está escrito en el HTML y lo que ve
     cualquiera que llegue sin haber elegido nada. */

  var IDIOMA_CLAVE = 'ym_idioma';
  var idioma = 'es';

  var TEXTOS = {
    en: {
      h1: 'Yerba mate prices in the UK',
      lede: 'Prices are updated automatically every day.',
      datos: 'Data',
      filtrar: 'Filter',
      marca_producto: 'Brand or product',
      ph_busqueda: 'Playadito, Taragüi…',
      tienda: 'Shop',
      marca: 'Brand',
      quitar_filtros: 'Clear all filters',
      envio: 'Delivery',
      sumar_envio: 'Include delivery in the price',
      nota_envio: 'This adds standard delivery for a single pack. Buying several packs is almost always cheaper.',
      medio_kilo: 'Half a kilo',
      un_kilo: 'One kilo',
      ordenar_por: 'Sort by',
      orden_asc: 'Price: low to high',
      orden_desc: 'Price: high to low',
      orden_marca: 'Brand (A-Z)',
      col_producto: 'Product',
      col_tienda: 'Shop',
      col_precio: 'Price',
      col_kilo: 'Per kilo',
      col_envio: 'Delivery',
      vacio_titulo: 'No products match these filters',
      vacio_texto: 'Try removing a brand or a shop from the filter.',
      error_titulo: 'Prices could not be loaded',
      aviso: 'Prices are collected automatically from the shops\' own websites and may change. Always check the final price in the shop before buying.',
      afiliados: 'Some links are affiliate links: if you buy through them, this site may earn a commission at no extra cost to you.',
      boton: 'Español',
      boton_aria: 'Cambiar a español',
      mas_baratos: 'The {n} cheapest',
      un_resultado: 'One result',
      resultados: '{n} results',
      sub_kilo: 'Sorted by price per kilo, which is what lets you compare different pack sizes.',
      sub_envio: 'The price includes standard delivery for a single pack.',
      al_dia: 'Up to date',
      desfasado: 'May be out of date',
      sin_fecha: 'No date',
      sin_conexion: 'Offline',
      cargando: 'Checking',
      fecha_desconocida: 'Unknown date',
      no_disponible: 'Not available',
      reintenta: 'Try again in a few minutes. Technical detail: ',
      ver_tienda: 'View in shop',
      sin_enlace: 'No link',
      varia: 'Varies',
      gratis_desde: 'Free over ',
      consultar: 'Check shop',
      rebajado: 'Reduced',
      value_deal: 'Value deal',
      envio_gratis: 'Free delivery',
      envio_incluido: 'Delivery included',
      oferta: 'Offer',
      vacio_datos: 'The price file is empty.',
      servidor: 'The server replied '
    },
    es: {
      boton: 'English',
      boton_aria: 'Switch to English',
      mas_baratos: 'Los {n} más baratos',
      un_resultado: 'Un resultado',
      resultados: '{n} resultados',
      sub_kilo: 'Ordenados por precio por kilo, que es lo que permite comparar formatos distintos.',
      sub_envio: 'El precio incluye el envío estándar de una unidad.',
      al_dia: 'Al día',
      desfasado: 'Pueden estar desfasados',
      sin_fecha: 'Sin fecha',
      sin_conexion: 'Sin conexión',
      cargando: 'Comprobando',
      fecha_desconocida: 'Fecha desconocida',
      no_disponible: 'No disponible',
      reintenta: 'Vuelve a intentarlo en unos minutos. Detalle técnico: ',
      ver_tienda: 'Ver en tienda',
      sin_enlace: 'Sin enlace',
      varia: 'Varía',
      gratis_desde: 'Gratis desde ',
      consultar: 'Consultar',
      rebajado: 'Rebajado',
      value_deal: 'Value deal',
      envio_gratis: 'Envío gratis',
      envio_incluido: 'Envío incluido',
      oferta: 'Oferta',
      vacio_datos: 'El archivo de precios está vacío.',
      servidor: 'El servidor respondió '
    }
  };

  // Los textos fijos en español viven en el HTML, así que los guardamos
  // al arrancar para poder volver a ellos sin recargar la página.
  var ORIGINAL_ES = {};

  function t(clave, valores) {
    var texto = (TEXTOS[idioma] && TEXTOS[idioma][clave]) || ORIGINAL_ES[clave] || clave;
    if (valores) {
      Object.keys(valores).forEach(function (k) {
        texto = texto.replace('{' + k + '}', valores[k]);
      });
    }
    return texto;
  }

  function guardarOriginales() {
    document.querySelectorAll('#ym-app [data-i18n]').forEach(function (el) {
      ORIGINAL_ES[el.dataset.i18n] = el.textContent;
    });
    document.querySelectorAll('#ym-app [data-i18n-ph]').forEach(function (el) {
      ORIGINAL_ES[el.dataset.i18nPh] = el.placeholder;
    });
  }

  function aplicarIdioma() {
    document.querySelectorAll('#ym-app [data-i18n]').forEach(function (el) {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('#ym-app [data-i18n-ph]').forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPh);
    });

    var btn = $('ym-lang');
    btn.textContent = t('boton');
    btn.setAttribute('aria-label', t('boton_aria'));
    document.documentElement.lang = idioma;

    pintarEstado();
    pintarEnvios();
    aplicar();
  }

  function cambiarIdioma() {
    idioma = idioma === 'es' ? 'en' : 'es';
    try { localStorage.setItem(IDIOMA_CLAVE, idioma); } catch (e) { /* modo privado */ }
    aplicarIdioma();
  }


  /* --- utilidades seguras --------------------------------------------- */

  // Escapa el texto que venga del JSON antes de meterlo en el HTML.
  function esc(valor) {
    return String(valor == null ? '' : valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Solo dejamos pasar http(s): así una URL manipulada no puede ejecutar código.
  function urlSegura(valor) {
    try {
      var u = new URL(valor, window.location.href);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
    } catch (e) { return ''; }
  }

  // El robot guarda una clave neutra (promoKey) para que la etiqueta
  // pueda mostrarse en cualquier idioma. Los datos antiguos traen texto suelto.
  function etiquetaPromo(item) {
    if (item.promoKey && TEXTOS.es[item.promoKey]) return t(item.promoKey);
    return item.promoDetails || t('oferta');
  }

  function textoNota(nota) {
    if (!nota) return t('varia');
    if (nota === 'Varía' || nota === 'Varies') return t('varia');
    if (nota === 'Consultar') return t('consultar');
    return nota;
  }

  function libras(n) { return '£' + Number(n).toFixed(2); }

  function gramos(item) {
    if (item.grams) return item.grams;
    return item.weight === '1kg' ? 1000 : 500;
  }

  function precioPorKilo(item) {
    return precioFinal(item) / (gramos(item) / 1000);
  }

  function precioFinal(item) {
    if (!state.conEnvio) return item.price;
    var envio = state.envios[item.shop];
    if (!envio || typeof envio.coste !== 'number') return item.price;
    return item.price + envio.coste;
  }

  /* --- carga de datos -------------------------------------------------- */

  function cargar() {
    fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(t('servidor') + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) {
          throw new Error(t('vacio_datos'));
        }
        state.items = data.items.filter(function (i) {
          return i && typeof i.price === 'number' && i.price > 0 && i.weight && i.shop;
        });
        state.envios = data.envios || {};
        state.actualizado = data.actualizado || null;
        if (data.afiliados) $('ym-affiliate').hidden = false;

        pintarEstado();
        pintarEnvios();
        pintarTiendas();
        pintarMarcas();
        aplicar();
      })
      .catch(function (err) {
        $('ym-error').hidden = false;
        $('ym-error-detail').textContent = t('reintenta') + err.message;
        $('ym-status-badge').textContent = t('sin_conexion');
        $('ym-status-badge').setAttribute('data-state', 'error');
        $('ym-update-text').textContent = t('no_disponible');
      });
  }

  function pintarEstado() {
    var badge = $('ym-status-badge');
    if (!state.actualizado) {
      $('ym-update-text').textContent = t('fecha_desconocida');
      badge.textContent = t('sin_fecha');
      badge.setAttribute('data-state', 'stale');
      return;
    }
    var fecha = new Date(state.actualizado);
    var horas = (Date.now() - fecha.getTime()) / 36e5;
    $('ym-update-text').textContent = fecha.toLocaleString(idioma === 'en' ? 'en-GB' : 'es-ES', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
    if (horas > HORAS_PARA_CADUCAR) {
      badge.textContent = t('desfasado');
      badge.setAttribute('data-state', 'stale');
    } else {
      badge.textContent = t('al_dia');
      badge.setAttribute('data-state', 'fresh');
    }
  }

  function pintarEnvios() {
    var lista = $('ym-shipping');
    lista.innerHTML = '';
    Object.keys(state.envios).forEach(function (tienda) {
      var e = state.envios[tienda];
      var li = document.createElement('li');
      var izq = document.createElement('div');
      izq.innerHTML = '<strong>' + esc(tienda) + '</strong>' +
        (e.gratisDesde ? '<small>' + t('gratis_desde') + libras(e.gratisDesde) + '</small>' : '');
      var der = document.createElement('span');
      der.textContent = typeof e.coste === 'number' ? libras(e.coste) : textoNota(e.nota);
      li.appendChild(izq); li.appendChild(der);
      lista.appendChild(li);
    });
  }

  function pintarTiendas() {
    var cont = $('ym-shops');
    cont.innerHTML = '';
    var tiendas = Array.from(new Set(state.items.map(function (i) { return i.shop; })));
    tiendas.sort().forEach(function (tienda, n) {
      var id = 'ym-shop-' + n;                       // id generado por índice, no por nombre
      var label = document.createElement('label');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.value = tienda;
      input.addEventListener('change', function () {
        state.tiendas = input.checked
          ? state.tiendas.concat([tienda])
          : state.tiendas.filter(function (t) { return t !== tienda; });
        aplicar();
      });
      label.setAttribute('for', id);
      label.appendChild(input);
      label.appendChild(document.createTextNode(tienda));
      cont.appendChild(label);
    });
  }

  function pintarMarcas() {
    var cont = $('ym-brands');
    cont.innerHTML = '';
    var marcas = Array.from(new Set(state.items.map(function (i) { return i.brand; })));
    marcas.sort().forEach(function (marca) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ym-pill';
      b.textContent = marca;
      b.setAttribute('aria-pressed', state.marcas.indexOf(marca) > -1 ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.marcas = state.marcas.indexOf(marca) > -1
          ? state.marcas.filter(function (m) { return m !== marca; })
          : state.marcas.concat([marca]);
        pintarMarcas();
        aplicar();
      });
      cont.appendChild(b);
    });
  }

  /* --- filtros y orden -------------------------------------------------- */

  function filtrar(peso) {
    var texto = $('ym-search').value.toLowerCase().trim();
    return state.items.filter(function (i) {
      if (i.weight !== peso) return false;
      if (state.tiendas.length && state.tiendas.indexOf(i.shop) === -1) return false;
      if (state.marcas.length && state.marcas.indexOf(i.brand) === -1) return false;
      if (texto) {
        var campo = (i.title + ' ' + i.brand).toLowerCase();
        if (campo.indexOf(texto) === -1) return false;
      }
      return true;
    });
  }

  function aplicar() {
    var orden = $('ym-sort').value;
    var filas = filtrar(state.peso);

    // Los 20 que se muestran son SIEMPRE los más baratos; el orden elegido
    // solo cambia cómo se presentan esos 20. Así el título nunca miente.
    var masBaratos = filas.slice().sort(function (a, b) {
      return precioPorKilo(a) - precioPorKilo(b);
    }).slice(0, LIMITE);

    if (orden === 'price-desc') masBaratos.sort(function (a, b) { return precioFinal(b) - precioFinal(a); });
    else if (orden === 'brand-asc') masBaratos.sort(function (a, b) { return a.brand.localeCompare(b.brand, 'es'); });

    $('ym-count-500').textContent = filtrar('500g').length;
    $('ym-count-1000').textContent = filtrar('1kg').length;

    var total = filas.length;
    $('ym-table-title').textContent = total > LIMITE
      ? t('mas_baratos', { n: LIMITE })
      : (total === 1 ? t('un_resultado') : t('resultados', { n: total }));
    $('ym-table-sub').textContent = state.conEnvio ? t('sub_envio') : t('sub_kilo');

    pintarTabla(masBaratos, orden === 'price-asc');
  }

  function pintarTabla(datos, numerar) {
    var tbody = $('ym-tbody');
    tbody.innerHTML = '';
    $('ym-empty').hidden = datos.length > 0;

    datos.forEach(function (item, idx) {
      var href = urlSegura(item.url);
      var envio = state.envios[item.shop] || {};
      var textoEnvio = typeof envio.coste === 'number' ? libras(envio.coste) : textoNota(envio.nota);
      var promo = item.isPromo
        ? '<span class="ym-tag ym-tag--promo">' + esc(etiquetaPromo(item)) + '</span>'
        : '';

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td data-col="pos">' + (numerar
          ? '<span class="ym-pos' + (idx < 3 ? ' ym-pos--top' : '') + '">' + (idx + 1) + '</span>'
          : '') + '</td>' +
        '<td data-col="prod"><span class="ym-prod">' + esc(item.brand) + promo +
          '<small>' + esc(item.title) + '</small></span></td>' +
        '<td><span class="ym-tag">' + esc(item.shop) + '</span></td>' +
        '<td class="ym-num" data-col="price"><span class="ym-price">' + libras(precioFinal(item)) + '</span></td>' +
        '<td class="ym-num"><span class="ym-kilo">' + libras(precioPorKilo(item)) + '/kg</span></td>' +
        '<td class="ym-ship-cell">' + esc(textoEnvio) +
          (envio.gratisDesde ? '<br>' + t('gratis_desde') + libras(envio.gratisDesde) : '') + '</td>' +
        '<td data-col="link">' + (href
          ? '<a class="ym-go" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer sponsored">' + t('ver_tienda') + '</a>'
          : '<span class="ym-note">' + t('sin_enlace') + '</span>') + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* --- eventos ---------------------------------------------------------- */

  function init() {
    guardarOriginales();
    try {
      var guardado = localStorage.getItem(IDIOMA_CLAVE);
      if (guardado === 'en' || guardado === 'es') idioma = guardado;
    } catch (e) { /* modo privado */ }

    $('ym-lang').addEventListener('click', cambiarIdioma);
    if (idioma === 'en') aplicarIdioma();

    $('ym-search').addEventListener('input', aplicar);
    $('ym-sort').addEventListener('change', aplicar);
    $('ym-clear').addEventListener('click', function () {
      state.marcas = []; state.tiendas = [];
      $('ym-search').value = '';
      Array.prototype.forEach.call(document.querySelectorAll('#ym-shops input'), function (cb) { cb.checked = false; });
      pintarMarcas();
      aplicar();
    });
    $('ym-include-shipping').addEventListener('change', function (e) {
      state.conEnvio = e.target.checked;
      aplicar();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.ym-tab'), function (tab) {
      tab.addEventListener('click', function () {
        state.peso = tab.dataset.weight;
        Array.prototype.forEach.call(document.querySelectorAll('.ym-tab'), function (t) {
          t.setAttribute('aria-selected', String(t === tab));
        });
        aplicar();
      });
    });

    cargar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
