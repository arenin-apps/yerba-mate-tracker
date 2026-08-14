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
        if (!r.ok) throw new Error('El servidor respondió ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items) || !data.items.length) {
          throw new Error('El archivo de precios está vacío.');
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
        $('ym-error-detail').textContent =
          'Vuelve a intentarlo en unos minutos. Detalle técnico: ' + err.message;
        $('ym-status-badge').textContent = 'Sin conexión';
        $('ym-status-badge').setAttribute('data-state', 'error');
        $('ym-update-text').textContent = 'No disponible';
      });
  }

  function pintarEstado() {
    var badge = $('ym-status-badge');
    if (!state.actualizado) {
      $('ym-update-text').textContent = 'Fecha desconocida';
      badge.textContent = 'Sin fecha';
      badge.setAttribute('data-state', 'stale');
      return;
    }
    var fecha = new Date(state.actualizado);
    var horas = (Date.now() - fecha.getTime()) / 36e5;
    $('ym-update-text').textContent = fecha.toLocaleString('es-ES', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
    if (horas > HORAS_PARA_CADUCAR) {
      badge.textContent = 'Pueden estar desfasados';
      badge.setAttribute('data-state', 'stale');
    } else {
      badge.textContent = 'Al día';
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
        (e.gratisDesde ? '<small>Gratis desde ' + libras(e.gratisDesde) + '</small>' : '');
      var der = document.createElement('span');
      der.textContent = typeof e.coste === 'number' ? libras(e.coste) : (e.nota || 'Varía');
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

    if (orden === 'price-asc') masBaratos.sort(function (a, b) { return precioFinal(a) - precioFinal(b); });
    else if (orden === 'price-desc') masBaratos.sort(function (a, b) { return precioFinal(b) - precioFinal(a); });
    else if (orden === 'brand-asc') masBaratos.sort(function (a, b) { return a.brand.localeCompare(b.brand, 'es'); });

    $('ym-count-500').textContent = filtrar('500g').length;
    $('ym-count-1000').textContent = filtrar('1kg').length;

    var total = filas.length;
    $('ym-table-title').textContent = total > LIMITE
      ? 'Los ' + LIMITE + ' más baratos'
      : (total === 1 ? 'Un resultado' : total + ' resultados');

    pintarTabla(masBaratos);
  }

  function pintarTabla(datos) {
    var tbody = $('ym-tbody');
    tbody.innerHTML = '';
    $('ym-empty').hidden = datos.length > 0;

    datos.forEach(function (item, idx) {
      var href = urlSegura(item.url);
      var envio = state.envios[item.shop] || {};
      var textoEnvio = typeof envio.coste === 'number' ? libras(envio.coste) : (envio.nota || 'Varía');
      var promo = item.isPromo
        ? '<span class="ym-tag ym-tag--promo">' + esc(item.promoDetails || 'Oferta') + '</span>'
        : '';

      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td data-col="pos"><span class="ym-pos' + (idx < 3 ? ' ym-pos--top' : '') + '">' + (idx + 1) + '</span></td>' +
        '<td data-col="prod"><span class="ym-prod">' + esc(item.brand) + promo +
          '<small>' + esc(item.title) + '</small></span></td>' +
        '<td><span class="ym-tag">' + esc(item.shop) + '</span></td>' +
        '<td class="ym-num" data-col="price"><span class="ym-price">' + libras(precioFinal(item)) + '</span></td>' +
        '<td class="ym-num"><span class="ym-kilo">' + libras(precioPorKilo(item)) + '/kg</span></td>' +
        '<td class="ym-ship-cell">' + esc(textoEnvio) +
          (envio.gratisDesde ? '<br>Gratis desde ' + libras(envio.gratisDesde) : '') + '</td>' +
        '<td data-col="link">' + (href
          ? '<a class="ym-go" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer sponsored">Ver en tienda</a>'
          : '<span class="ym-note">Sin enlace</span>') + '</td>';
      tbody.appendChild(tr);
    });
  }

  /* --- eventos ---------------------------------------------------------- */

  function init() {
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
      $('ym-table-sub').textContent = state.conEnvio
        ? 'El precio incluye el envío estándar de una unidad.'
        : 'Ordenados por precio por kilo, que es lo que permite comparar formatos distintos.';
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
