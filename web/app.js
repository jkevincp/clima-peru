/* Vigía Niño: mapa y panel de lectura. Lee data/resumen.json, data/departamentos.json y data/puntos/<id>.json */
(function () {
  "use strict";

  var NIVELES = ["Sin señales", "Vigilar", "Prepararse", "Actuar"];
  var DESC_NIVEL = [
    "Nada fuera de lo normal en los próximos 7 días.",
    "Algo fuera de lo normal. Sigue los avisos y ten lo básico listo.",
    "Señal fuerte. Prepara tu casa, tu campo y tus rutas.",
    "Señal muy fuerte. Protege a las personas primero.",
  ];
  var DIAS_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var estado = { hoyAbierto: {}, resumen: null, deps: null, cache: {}, seleccion: null, dep: null, verTodos: false };
  var mapa, capaDeps, capaPuntos, capaBase, capaEtiquetas, capaLluvia, capaToque, marcadores = {}, etiquetas = {}, anillos = {}, toques = {};
  var ESTADO_HOY = { lloviendo: "Lloviendo ahora", llovio: "Llovió hoy", llovera: "Lloverá más tarde", seco: "Sin lluvia hoy" };
  var panel = document.getElementById("panel");

  // ---------- utilidades ----------
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function colorNivel(n) { return n == null ? css("--tinta-3") : css("--n" + n); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fechaCorta(iso) { if (!iso) return "—"; var p = iso.split("-"); return +p[2] + " " + MESES[+p[1] - 1] + " " + p[0]; }
  function signo(v) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(1); }
  function oscuro() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function cargar(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); }
  function nivelPill(n) {
    var barras = [0, 1, 2, 3].map(function (i) { return '<span class="' + (i <= n ? "on" : "") + '"></span>'; }).join("");
    return '<span class="nivel-pill" style="--c:var(--n' + n + ')"><i aria-hidden="true">' + barras + "</i>" + NIVELES[n] + "</span>";
  }

  // ---------- mapa ----------
  function iniciarMapa() {
    mapa = L.map("mapa", { zoomControl: false, attributionControl: true, minZoom: 4, maxBounds: [[-25, -90], [5, -60]] })
      .fitBounds([[-18.4, -81.4], [-0.1, -68.6]], { padding: [10, 10] });
    L.control.zoom({ position: "bottomright", zoomInTitle: "Acercar", zoomOutTitle: "Alejar" }).addTo(mapa);
    mapa.attributionControl.setPrefix(false);
    // Capas propias encima de los departamentos (los nombres van arriba de todo para que siempre se puedan tocar). La capa no captura clics (pointer-events: none);
    // solo sus elementos interactivos, así un clic fuera de un punto llega al departamento de abajo.
    ["lluvia", 490, "puntos", 500, "etiquetas", 520].forEach(function (v, i, a) {
      if (i % 2) return;
      var pane = mapa.createPane(v);
      pane.style.zIndex = a[i + 1];
      pane.style.pointerEvents = "none";
    });
    ponerBase();
    capaDeps = L.geoJSON(estado.deps, {
      style: estiloDep,
      onEachFeature: function (f, capa) {
        capa.on("click", function () { elegirDep(f.properties.nombre, capa.getBounds()); });
        capa.on("mouseover", function () { resaltarDep(f.properties.nombre, true); });
        capa.on("mouseout", function () { resaltarDep(f.properties.nombre, false); });
        f._capa = capa;
      },
    }).addTo(mapa);
    capaEtiquetas = L.layerGroup().addTo(mapa);
    estado.deps.features.forEach(function (f) {
      var pr = f.properties;
      var et = L.marker(pr.centro, {
        pane: "etiquetas", keyboard: true, title: "Ver " + pr.nombre, riseOnHover: true,
        icon: L.divIcon({ className: "etiqueta-dep", html: htmlEtiqueta(pr.nombre), iconSize: null }),
      }).addTo(capaEtiquetas);
      et.on("click", function () { elegirDep(pr.nombre, f._capa.getBounds()); });
      et.on("mouseover", function () { resaltarDep(pr.nombre, true); });
      et.on("mouseout", function () { resaltarDep(pr.nombre, false); });
      etiquetas[pr.nombre] = { marcador: et, area: pr.area };
    });
    mapa.on("zoomend", visibilidadEtiquetas);
    visibilidadEtiquetas();
    capaLluvia = L.featureGroup().addTo(mapa);
    capaPuntos = L.featureGroup().addTo(mapa);
    capaToque = L.featureGroup().addTo(mapa);
    crearPuntos();
  }
  var TACTIL = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  function crearPuntos() {
    capaLluvia.clearLayers(); capaPuntos.clearLayers(); capaToque.clearLayers();
    marcadores = {}; anillos = {}; toques = {};
    var orden = estado.resumen.puntos.slice().sort(function (a, b) { return (a.nivel || 0) - (b.nivel || 0); });
    orden.forEach(function (p) {
      var conAnillo = !window.Capas || ["riesgo", "hoy"].indexOf(window.Capas.modo()) >= 0;
      if (conAnillo && p.hoy && p.hoy.estado !== "seco") {
        anillos[p.id] = L.circleMarker([p.lat, p.lon], Object.assign({ pane: "lluvia", interactive: false }, estiloAnillo(p.hoy.estado))).addTo(capaLluvia);
      }
      // el punto visible no recibe clics; los recibe un círculo invisible más grande (más fácil de tocar)
      marcadores[p.id] = L.circleMarker([p.lat, p.lon], Object.assign({ pane: "puntos", interactive: false }, estiloPunto(p, false))).addTo(capaPuntos);
      var t = L.circleMarker([p.lat, p.lon], {
        pane: "puntos", radius: TACTIL ? 15 : 11, stroke: false, fill: true, fillColor: "#000", fillOpacity: 0, bubblingMouseEvents: false,
      }).addTo(capaToque);
      t.bindTooltip(function () { return tooltipPunto(p); }, { direction: "top", offset: [0, -8] });
      t.on("click", function () { seleccionar(p.id); });
      t.on("mouseover", function () { if (p.id !== estado.seleccion) marcadores[p.id].setStyle({ weight: 2.5, color: css("--tinta") }); });
      t.on("mouseout", function () { if (p.id !== estado.seleccion) marcadores[p.id].setStyle(estiloPunto(p, false)); });
      toques[p.id] = t;
    });
    if (estado.seleccion && marcadores[estado.seleccion]) {
      marcadores[estado.seleccion].setStyle(estiloPunto(buscarResumen(estado.seleccion), true)).bringToFront();
    }
  }
  function tooltipPunto(p) {
    return "<b>" + esc(p.nombre) + "</b> · " + (p.nivel == null ? "en preparación" : NIVELES[p.nivel]) +
      (p.cuando ? "<br>" + esc(p.cuando) : "") + (p.hoy && p.hoy.estado !== "seco" ? "<br>" + textoHoyCorto(p.hoy) : "");
  }
  function ponerBase() {
    if (capaBase) mapa.removeLayer(capaBase);
    // Mapa de fondo de OpenStreetMap (sin clave). Se pasa a grises con CSS para que no compita con los colores de riesgo.
    capaBase = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12, className: "capa-mapa" + (oscuro() ? " capa-mapa-oscura" : ""),
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    capaBase.bringToBack();
  }
  function estiloAnillo(estado) {
    return {
      radius: 12, color: css("--lluvia"), weight: estado === "lloviendo" ? 3 : 2, fill: true, fillColor: css("--lluvia"),
      fillOpacity: estado === "lloviendo" ? 0.18 : 0.06, opacity: estado === "llovio" ? 0.7 : 1,
      dashArray: estado === "llovera" ? "3 4" : null, className: estado === "lloviendo" ? "anillo-activo" : "",
    };
  }
  function textoHoyCorto(h) {
    var mm = h.hasta_ahora_mm >= 0.1 ? " · " + h.hasta_ahora_mm.toFixed(1) + " mm" : h.resto_mm >= 0.1 ? " · " + h.resto_mm.toFixed(1) + " mm" : "";
    return ESTADO_HOY[h.estado] + mm;
  }
  function htmlEtiqueta(nombre) {
    var n = peorNivelDep(nombre);
    return '<span class="etiqueta-caja"><span class="etiqueta-punto" style="background:' + (n >= 0 ? "var(--n" + n + ")" : "var(--tinta-3)") + '"></span>' +
      '<span class="etiqueta-texto">' + esc(nombre) + "</span></span>";
  }
  function visibilidadEtiquetas() {
    var z = mapa.getZoom();
    mapa.getContainer().dataset.zoom = z <= 4 ? "lejos" : z <= 6 ? "medio" : "cerca";
    Object.keys(etiquetas).forEach(function (k) {
      var e = etiquetas[k], el = e.marcador.getElement();
      if (el) el.hidden = e.area < 0.05 && z < 8;  // Callao: solo de cerca
    });
  }
  function resaltarDep(nombre, on) {
    var f = estado.deps.features.find(function (x) { return x.properties.nombre === nombre; });
    if (!f) return;
    if (on) f._capa.setStyle({ weight: 2, color: css("--acento"), opacity: 1 }); else capaDeps.resetStyle(f._capa);
    var el = etiquetas[nombre] && etiquetas[nombre].marcador.getElement();
    if (el) el.classList.toggle("hover", on);
  }
  function marcarEtiquetas() {
    Object.keys(etiquetas).forEach(function (k) {
      var el = etiquetas[k].marcador.getElement();
      if (el) { el.classList.toggle("activa", estado.dep === k); el.innerHTML = htmlEtiqueta(k); }
    });
  }
  function peorNivelDep(nombre) {
    var n = -1;
    estado.resumen.puntos.forEach(function (p) { if (p.departamento === nombre && p.nivel != null) n = Math.max(n, p.nivel); });
    return n;
  }
  function estiloDep(f) {
    var n = modoLluvia() ? -1 : peorNivelDep(f.properties.nombre);
    var activo = estado.dep === f.properties.nombre;
    return {
      color: activo ? css("--acento") : css("--tinta-3"), weight: activo ? 2 : 0.8, opacity: activo ? 1 : 0.6,
      fillColor: n >= 1 ? colorNivel(n) : css("--tierra"), fillOpacity: n >= 1 ? 0.2 : 0.55,
    };
  }
  function modoLluvia() { return window.Capas && window.Capas.modo() !== "riesgo"; }
  function estiloPunto(p, sel) {
    if (modoLluvia()) {  // en los mapas de lluvia los puntos se vuelven discretos para no competir con el color de las zonas
      return { radius: sel ? 8 : 3.5, color: sel ? css("--tinta") : css("--tinta-2"), weight: sel ? 3 : 1,
        fillColor: css("--superficie"), fillOpacity: 1, opacity: 1 };
    }
    return {
      radius: sel ? 10 : (p.nivel >= 2 ? 7 : 6), color: sel ? css("--tinta") : css("--superficie"), weight: sel ? 3 : 1.5,
      fillColor: colorNivel(p.nivel), fillOpacity: 1, opacity: 1,
    };
  }
  function repintar() {
    if (!mapa) return;
    ponerBase();
    capaDeps.setStyle(estiloDep);
    estado.resumen.puntos.forEach(function (p) {
      marcadores[p.id].setStyle(estiloPunto(p, p.id === estado.seleccion));
      if (anillos[p.id]) anillos[p.id].setStyle(estiloAnillo(p.hoy.estado));
    });
    marcarEtiquetas();
    pintarLeyenda();
    if (window.Capas) window.Capas.repintar();
    if (estado.seleccion && estado.cache[estado.seleccion]) mostrarPunto(estado.cache[estado.seleccion], false);
    else mostrarResumen();
  }

  function pintarLeyenda() {
    if (window.Capas && window.Capas.leyenda()) return;
    var conteo = [0, 0, 0, 0];
    estado.resumen.puntos.forEach(function (p) { if (p.nivel != null) conteo[p.nivel]++; });
    document.getElementById("leyenda").innerHTML = '<div class="leyenda-titulo">Próximos 7 días</div>' +
      [3, 2, 1, 0].map(function (n) {
        return '<div class="leyenda-fila"><span class="punto" style="background:var(--n' + n + ')"></span>' + NIVELES[n] + "</div>";
      }).join("") + (estado.resumen.puntos.some(function (p) { return p.nivel == null; }) ?
        '<div class="leyenda-fila"><span class="punto" style="background:var(--tinta-3)"></span>En preparación</div>' : "") +
      (Object.keys(anillos).length ? '<div class="leyenda-titulo leyenda-sep">Hoy</div>' +
        '<div class="leyenda-fila"><span class="anillo"></span>Llueve o llovió</div>' +
        '<div class="leyenda-fila"><span class="anillo anillo-luego"></span>Lloverá más tarde</div>' : "");
  }

  // ---------- cabecera: mar ----------
  function pintarMar() {
    var m = estado.resumen.mar || {};
    document.getElementById("mar-chip-valor").textContent = m.anom == null ? "—" : signo(m.anom) + " °C";
    document.getElementById("mar-chip-cat").textContent = m.icen ? m.icen.categoria : "";
    document.getElementById("mar-chip").onclick = function () {
      volverPais();
      var s = document.getElementById("sec-mar");
      if (s) s.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  // ---------- panel: resumen país / departamento ----------
  function lugaresVisibles() {
    return estado.resumen.puntos.filter(function (p) { return !estado.dep || p.departamento === estado.dep; });
  }
  function mostrarResumen() {
    var lugares = lugaresVisibles();
    var conteo = [0, 0, 0, 0];
    lugares.forEach(function (p) { if (p.nivel != null) conteo[p.nivel]++; });
    var conSenal = lugares.filter(function (p) { return p.nivel >= 1; })
      .sort(function (a, b) { return b.nivel - a.nivel || (b.lluvia_7d_mm || 0) - (a.lluvia_7d_mm || 0); });
    var lista = estado.dep ? lugares.slice().sort(function (a, b) { return (b.nivel || 0) - (a.nivel || 0) || a.nombre.localeCompare(b.nombre); }) : conSenal;
    var limite = estado.verTodos ? lista.length : 10;

    var h = '<section class="seccion">';
    if (estado.dep) h += '<button class="volver" data-accion="pais" type="button">← Todo el Perú</button>';
    h += '<p class="eyebrow">Semana del ' + fechaCorta(estado.resumen.fechas.pronostico_emitido) + "</p>";
    h += "<h2>" + (estado.dep ? esc(estado.dep) : "Perú esta semana") + "</h2>";
    var prep = lugares.filter(function (p) { return p.nivel == null; }).length;
    h += '<p class="sub">' + lugares.length + " lugares vigilados. Toca uno en el mapa o en la lista para ver el detalle.</p>";
    if (prep) h += '<p class="nota">' + prep + (prep === 1 ? " lugar está" : " lugares están") +
      " en preparación: se están descargando sus datos históricos. Aparecen en gris y se completan solos en los próximos días.</p>";
    h += '<div class="conteo">' + [3, 2, 1, 0].map(function (n) {
      return '<div class="conteo-item" style="--c:var(--n' + n + ')"><b>' + conteo[n] + "</b><span>" + NIVELES[n] + "</span></div>";
    }).join("") + "</div>";
    if (estado.dep) {
      var top = conSenal[0];
      if (top) {
        h += '<div class="destacado" style="--c:var(--n' + top.nivel + ");--c-suave:var(--n" + top.nivel + '-suave)">' +
          '<p class="eyebrow">Lo más importante en ' + esc(estado.dep) + "</p>" + nivelPill(top.nivel) +
          '<p class="destacado-texto"><b>' + esc(top.nombre) + ":</b> " + esc(top.veredicto) + "</p>" +
          (top.cuando ? '<p class="destacado-cuando">' + esc(top.cuando) + "</p>" : "") +
          '<button class="boton" type="button" data-id="' + esc(top.id) + '">Ver ' + esc(top.nombre) + " en detalle →</button></div>";
      } else {
        h += '<div class="destacado" style="--c:var(--n0);--c-suave:var(--n0-suave)">' + nivelPill(0) +
          '<p class="destacado-texto">Ningún lugar de ' + esc(estado.dep) + " muestra lluvias ni calor fuera de lo normal en los próximos 7 días.</p></div>";
      }
    }
    h += "</section>";

    h += seccionMiInforme();
    h += seccionHoyResumen(lugares);
    h += '<section class="seccion"><h3>' + (estado.dep ? "Lugares" : "Dónde mirar") + "</h3>";
    if (!lista.length) h += '<p class="vacio">Ningún lugar muestra señales fuera de lo normal en los próximos 7 días.</p>';
    else {
      h += '<div class="lista">' + lista.slice(0, limite).map(filaLugar).join("") + "</div>";
      if (lista.length > limite) h += '<button class="mas" data-accion="todos" type="button">Ver los ' + lista.length + "</button>";
    }
    h += "</section>";
    h += seccionMar();
    h += seccionNiveles();
    h += pie();
    panel.innerHTML = h;
  }
  function seccionMiInforme() {
    var c = window.ConfigInforme && window.ConfigInforme.leer();
    if (estado.dep) return "";
    if (!c || !c.lugares.length) {
      return '<section class="seccion mi-informe-invita"><div class="campo-cabeza"><span class="campo-icono">' +
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2.8h6l3.2 3.2V17a.8.8 0 0 1-.8.8H6a.8.8 0 0 1-.8-.8V3.6a.8.8 0 0 1 .8-.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h5M8 12h5M8 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
        '</span><h3>Tu informe de 7 días</h3></div><p class="sub">Marca tus fundos, estaciones o ciudades y recibe un informe con lluvia de día y de noche, viento, temperatura y lo que importa para tu cultivo, listo para descargar en PDF.</p>' +
        '<button class="boton" type="button" data-mi="editar">Configurar mi informe</button></section>';
    }
    return '<section class="seccion"><div class="campo-cabeza"><h3>Mis lugares</h3><button class="enlace" type="button" data-mi="editar">Editar</button></div>' +
      '<div class="chips">' + c.lugares.map(function (l) {
        return '<a class="chip" href="informe.html#' + encodeURIComponent(l.id) + '">' + esc(l.nombre) + (l.grupo ? ' <span class="num">' + esc(l.grupo) + "</span>" : "") + "</a>";
      }).join("") + '</div><a class="boton" href="informe.html">Ver mi informe completo</a></section>';
  }
  function seccionHoyResumen(lugares) {
    if (!estado.resumen.hoy_consultado) return "";
    var grupos = { lloviendo: [], llovio: [], llovera: [] };
    lugares.forEach(function (p) { if (p.hoy && grupos[p.hoy.estado]) grupos[p.hoy.estado].push(p); });
    var total = grupos.lloviendo.length + grupos.llovio.length + grupos.llovera.length;
    var h = '<section class="seccion"><div class="hoy-cabeza"><h3>Hoy</h3><span class="nota">' + horaConsulta() + "</span></div>";
    if (!total) return h + '<p class="vacio">Sin lluvia hoy en ' + (estado.dep ? esc(estado.dep) : "los lugares vigilados") + ".</p></section>";
    var nacional = !estado.dep;
    ["lloviendo", "llovio", "llovera"].forEach(function (k) {
      if (!grupos[k].length) return;
      var mmDe = function (p) { return k === "llovera" ? p.hoy.resto_mm : p.hoy.hasta_ahora_mm; };
      var items;
      if (nacional) {
        // Vista nacional: un chip por departamento (cuántos lugares y el mayor acumulado); al tocarlo se abre el departamento
        var porDep = {};
        grupos[k].forEach(function (p) {
          var d = porDep[p.departamento] || (porDep[p.departamento] = { nombre: p.departamento, n: 0, max: 0 });
          d.n++; d.max = Math.max(d.max, mmDe(p));
        });
        items = Object.keys(porDep).map(function (n) { return porDep[n]; }).sort(function (a, b) { return b.n - a.n || b.max - a.max; })
          .map(function (d) {
            return '<button class="chip" type="button" data-dep="' + esc(d.nombre) + '" title="Ver ' + esc(d.nombre) + '">' + esc(d.nombre) +
              ' <span class="num">' + d.n + (d.n === 1 ? " lugar" : " lugares") + " · hasta " + d.max.toFixed(1) + " mm</span></button>";
          });
      } else {
        grupos[k].sort(function (a, b) { return (b.hoy.hasta_ahora_mm + b.hoy.resto_mm) - (a.hoy.hasta_ahora_mm + a.hoy.resto_mm); });
        items = grupos[k].map(function (p) {
          return '<button class="chip" type="button" data-id="' + esc(p.id) + '">' + esc(p.nombre) + ' <span class="num">' + mmDe(p).toFixed(1) + " mm</span></button>";
        });
      }
      var max = 12, abierto = estado.hoyAbierto[k];
      var visibles = abierto ? items : items.slice(0, max);
      var boton = items.length > max
        ? '<button class="chip chip-mas" type="button" data-accion="hoy-mas" data-grupo="' + k + '" aria-expanded="' + (abierto ? "true" : "false") + '">' +
          (abierto ? "Ver menos" : "Ver " + (items.length - max) + " más") + "</button>"
        : "";
      h += '<div class="hoy-grupo"><p class="hoy-grupo-titulo"><span class="anillo' + (k === "llovera" ? " anillo-luego" : "") + '"></span>' +
        ESTADO_HOY[k] + ' <span class="nota">(' + grupos[k].length + (nacional ? " lugares" : "") + ')</span></p><div class="chips">' +
        visibles.join("") + boton + "</div></div>";
    });
    return h + '<p class="nota">Lluvia estimada por los modelos hora a hora. Una llovizna muy local puede no aparecer.</p></section>';
  }
  function horaConsulta() {
    var c = estado.resumen.hoy_consultado;
    if (!c) return "";
    var t = c.replace(" ", "T").slice(0, 16);
    return (window.Vivo && window.Vivo.consultado() ? '<span class="en-vivo">En vivo</span> ' : "Actualizado ") + t.slice(11, 16) + " h";
  }
  function filaLugar(p) {
    var c = p.nivel == null ? "var(--tinta-3)" : "var(--n" + p.nivel + ")";
    var lugar = p.departamento === p.nombre ? "" : p.departamento;
    return '<button class="lugar" type="button" data-id="' + esc(p.id) + '" style="--c:' + c + '">' +
      '<span class="lugar-barra"></span>' +
      '<span><span class="lugar-nombre">' + esc(p.nombre) + '</span> <span class="lugar-dep">' + esc(lugar) + "</span></span>" +
      '<span class="lugar-mm">' + (p.lluvia_7d_mm != null ? Math.round(p.lluvia_7d_mm) + " mm" : "") + "</span>" +
      '<span class="lugar-texto">' + esc(p.veredicto) + "</span>" +
      (p.cuando && p.nivel >= 1 ? '<span class="lugar-cuando">' + reloj() + esc(p.cuando) + "</span>" : "") + "</button>";
  }
  function reloj() {
    return '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  }
  function seccionMar() {
    var m = estado.resumen.mar || {};
    if (m.anom == null) return "";
    var texto = m.anom >= 0.4
      ? "El mar frente a la costa norte está más caliente de lo normal. Si se mantiene sobre +0.4 °C, favorece lluvias intensas en Tumbes, Piura y Lambayeque."
      : m.anom <= -1 ? "El mar está más frío de lo normal: en la costa norte suele significar menos lluvia."
      : "El mar está cerca de lo normal. Por ahora no empuja lluvias extraordinarias en la costa norte.";
    var cambio = m.cambio_4sem == null ? "" : '<span class="sub">' + (m.cambio_4sem > 0 ? "subió " : m.cambio_4sem < 0 ? "bajó " : "sin cambio ") +
      (m.cambio_4sem ? Math.abs(m.cambio_4sem).toFixed(1) + " °C " : "") + "en 4 semanas</span>";
    return '<section class="seccion" id="sec-mar"><p class="eyebrow">Contexto El Niño</p><h3>El mar frente a la costa (Niño 1+2)</h3>' +
      '<div class="mar-grande"><b>' + signo(m.anom) + " °C</b>" + cambio + "</div>" +
      graficoMar(m.semanas || []) +
      '<p class="sub">' + texto + "</p>" +
      (m.icen ? '<p class="nota">ICEN aproximado (' + esc(m.icen.mes) + "): " + signo(m.icen.valor) + " °C, " + esc(m.icen.categoria) +
        (m.icen.fuente === "OISST semanal" ? ", estimado con datos semanales" : "") + ". El oficial lo publica el ENFEN.</p>" : "") +
      "</section>";
  }
  function seccionNiveles() {
    return '<section class="seccion"><h3>Cómo leer los niveles</h3><div class="lista">' + [0, 1, 2, 3].map(function (n) {
      return '<div class="lugar" style="--c:var(--n' + n + ');cursor:default"><span class="lugar-barra"></span><span class="lugar-nombre">' + NIVELES[n] +
        '</span><span></span><span class="lugar-texto">' + DESC_NIVEL[n] + "</span></div>";
    }).join("") + '</div><p class="nota">Cada lugar se compara con lo normal para esa misma zona y época del año: 20 mm pueden ser poco en la selva y mucho en la costa.</p></section>';
  }
  function pie() {
    var f = estado.resumen.fechas || {};
    return '<section class="seccion pie"><p>Pronóstico emitido el ' + fechaCorta(f.pronostico_emitido) + " · Observado hasta el " + fechaCorta(f.era5_hasta) +
      "</p><p>Indicadores automáticos con datos de ERA5, ECMWF, GFS, NOAA y CHIRPS. No reemplazan los avisos oficiales.</p>" +
      '<p class="fuentes"><a href="https://www.senamhi.gob.pe/?p=aviso-meteorologico" target="_blank" rel="noopener">Avisos SENAMHI</a>' +
      '<a href="https://enfen.imarpe.gob.pe/" target="_blank" rel="noopener">Comunicados ENFEN</a>' +
      '<a href="https://www.gob.pe/indeci" target="_blank" rel="noopener">INDECI</a></p></section>';
  }

  // ---------- panel: detalle de un lugar ----------
  function seleccionar(id, desdeHash, silencioso) {
    var anterior = estado.seleccion;
    estado.seleccion = id;
    if (anterior && marcadores[anterior]) marcadores[anterior].setStyle(estiloPunto(buscarResumen(anterior), false));
    if (marcadores[id]) { marcadores[id].setStyle(estiloPunto(buscarResumen(id), true)); marcadores[id].bringToFront(); }
    if (!desdeHash) { try { history.replaceState(null, "", "#" + id); } catch (e) {} }
    var p = buscarResumen(id);
    if (p && estado.dep !== p.departamento) {  // el panel queda en el contexto del departamento del lugar
      estado.dep = p.departamento; estado.verTodos = false;
      capaDeps.setStyle(estiloDep); marcarEtiquetas();
    }
    if (!silencioso && p && mapa && !mapa.getBounds().pad(-0.15).contains([p.lat, p.lon])) mapa.panTo([p.lat, p.lon]);
    if (estado.cache[id]) return mostrarPunto(estado.cache[id], !silencioso);
    if (!silencioso) panel.innerHTML = '<div class="cargando">Cargando ' + esc(p ? p.nombre : id) + "…</div>";
    cargar("data/puntos/" + encodeURIComponent(id) + ".json?v=" + encodeURIComponent(estado.resumen.generado || "")).then(function (d) {
      estado.cache[id] = d;
      if (window.Vivo && window.Vivo.de(id)) d.hoy = window.Vivo.de(id);
      if (estado.seleccion === id) {
        var arriba = panel.scrollTop;
        mostrarPunto(d, !silencioso);
        if (silencioso) panel.scrollTop = arriba;
      }
    }).catch(function () {
      panel.innerHTML = '<section class="seccion"><button class="volver" data-accion="pais" type="button">← Todo el Perú</button><p>No se pudo cargar este lugar. Recarga la página.</p></section>';
    });
  }
  function buscarResumen(id) {
    for (var i = 0; i < estado.resumen.puntos.length; i++) if (estado.resumen.puntos[i].id === id) return estado.resumen.puntos[i];
    return null;
  }
  function mostrarPunto(d, desplazar) {
    var n = d.nivel;
    var h = '<section class="seccion">';
    h += '<button class="volver" data-accion="' + (estado.dep ? "dep" : "pais") + '" type="button">← ' + (estado.dep ? esc(estado.dep) : "Todo el Perú") + "</button>";
    h += "<div><h2>" + esc(d.nombre) + '</h2><p class="sub">' + (d.provincia && d.provincia !== d.nombre ? "Provincia " + esc(d.provincia) + " · " : "") + esc(d.departamento) + "</p></div>";
    if (d.hoy) h += bloqueHoy(d.hoy);
    if (n == null) h += '<div class="veredicto" style="--c-suave:var(--superficie-2)"><p>' + esc(d.veredicto) + "</p></div>";
    else h += '<div class="veredicto" style="--c:var(--n' + n + ");--c-suave:var(--n" + n + '-suave)"><div class="veredicto-cabeza"><span class="eyebrow">Próximos 7 días</span>' +
      nivelPill(n) + "</div><p>" + esc(d.veredicto) + "</p></div>";
    h += "</section>";

    if (d.dias && d.dias.length) {
      h += '<section class="seccion"><h3>Próximos 7 días</h3>' + tiraDias(d.dias) +
        '<p class="nota"><span class="muestra"></span> lluvia muy fuerte para la zona · mm = promedio de los modelos · h = horas de lluvia · °C = máxima</p></section>';
    }
    if (window.Campo) h += window.Campo.seccion(d);
    var conHora = (d.dias || []).filter(function (x) { return x.horas; });
    if (conHora.length) {
      var relevantes = conHora.filter(function (x) { return x.clase >= 1; });
      var lista = (relevantes.length ? relevantes : conHora).slice(0, 4);
      h += '<section class="seccion"><h3>Cuándo llovería</h3>' + lista.map(function (x) { return bloqueHora(x, d); }).join("") +
        '<p class="nota">Horas de referencia: el día de la lluvia se pronostica mejor que la hora exacta. Certeza alta a 1–2 días, media a 3–4 y baja a 5–7.</p></section>';
    }
    if (d.criterios && d.criterios.length) {
      h += '<section class="seccion"><h3>Por qué este nivel</h3><ul class="criterios">' + d.criterios.map(filaCriterio).join("") + "</ul></section>";
    }
    if (d.acciones) {
      h += '<section class="seccion"><h3>Qué hacer</h3><div class="acciones">' +
        "<div><h4>En casa y en la comunidad</h4><ul>" + d.acciones.general.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul></div>" +
        "<div><h4>En el campo</h4><ul>" + d.acciones.campo.map(function (a) { return "<li>" + esc(a) + "</li>"; }).join("") + "</ul></div></div></section>";
    }
    if (d.serie && d.serie.fechas.length) {
      h += '<section class="seccion"><h3>Lluvia de los últimos 60 días y lo que viene</h3>' + graficoSerie(d.serie) +
        '<p class="nota"><span class="muestra"></span> umbral de lluvia muy fuerte para la zona</p></section>';
    }
    if (d.temporadas && d.temporadas.normal_mm != null) h += seccionTemporadas(d.temporadas);
    h += pie();
    panel.innerHTML = h;
    if (desplazar) {
      panel.scrollTop = 0;
      if (window.matchMedia("(max-width: 860px)").matches) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
  function nombreModelo(k) { return k.indexOf("ecmwf") === 0 ? "ECMWF" : k.indexOf("gfs") === 0 ? "GFS" : k.indexOf("gem") === 0 ? "GEM" : k.toUpperCase(); }
  function hora(h) { return h === 0 || h === 24 ? "0:00" : h + ":00"; }
  function bloqueHora(x, d) {
    var v = x.horas, f = new Date(x.fecha + "T12:00:00");
    var serie = (d.horario || []).find(function (hh) { return hh.fecha === x.fecha; });
    var acuerdo = v.acuerdo === true ? "Los modelos coinciden en la hora" : v.acuerdo === false ? "Los modelos difieren en la hora" : "";
    return '<div class="hora-bloque">' +
      '<div class="hora-cabeza"><span class="hora-dia">' + DIAS_LARGO[f.getDay()] + " " + f.getDate() + "</span>" +
      '<span class="certeza certeza-' + v.certeza + '">Certeza ' + v.certeza + "</span></div>" +
      '<p class="hora-texto">' + esc(v.texto.charAt(0).toUpperCase() + v.texto.slice(1)) + " · " + esc(v.franja) + "</p>" +
      '<p class="nota">Más fuerte cerca de las ' + hora(v.pico) + " · " + Math.round(x.lluvia_mm) + " mm en el día" + (acuerdo ? " · " + acuerdo : "") + "</p>" +
      (serie ? grafico24(serie, v, x.clase) : "") + "</div>";
  }
  function grafico24(serie, v, clase) {
    var W = 400, H = 112, iz = 52, de = 6, ar = 6, filaModelo = 11;
    var modelos = Object.keys(serie.modelos);
    var barrasAlto = H - ar - 18 - modelos.length * filaModelo;
    var media = [];
    for (var i = 0; i < 24; i++) {
      var s = 0, n = 0;
      modelos.forEach(function (m) { s += serie.modelos[m][i]; n++; });
      media.push(n ? s / n : 0);
    }
    var tope = Math.max.apply(null, media.concat([1]));
    var paso = (W - iz - de) / 24;
    function x(h) { return iz + h * paso; }
    var base = ar + barrasAlto, color = clase ? css("--n" + clase) : css("--acento");
    var g = '<rect x="' + x(v.inicio) + '" y="' + ar + '" width="' + (x(v.fin) - x(v.inicio)) + '" height="' + barrasAlto + '" fill="' + color + '" fill-opacity=".12" rx="3"/>';
    g += '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + base + '" y2="' + base + '"/>';
    g += '<text x="' + (iz - 6) + '" y="' + (ar + 9) + '" text-anchor="end">' + tope.toFixed(tope < 10 ? 1 : 0) + "</text>";
    g += '<text x="' + (iz - 6) + '" y="' + (ar + 20) + '" text-anchor="end" style="font-size:9px">mm/h</text>';
    media.forEach(function (val, h) {
      if (val <= 0.05) return;
      var alto = val / tope * (barrasAlto - 2);
      g += '<rect x="' + (x(h) + paso * 0.14).toFixed(1) + '" y="' + (base - alto).toFixed(1) + '" width="' + (paso * 0.72).toFixed(1) +
        '" height="' + alto.toFixed(1) + '" fill="' + color + '" rx="1"><title>' + h + ":00 · " + val.toFixed(1) + " mm</title></rect>";
    });
    modelos.forEach(function (m, k) {
      var y = base + 7 + k * filaModelo, w = v.por_modelo && v.por_modelo[m];
      g += '<text x="' + (iz - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + nombreModelo(m) + "</text>";
      g += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + y + '" y2="' + y + '" stroke="' + css("--linea") + '" stroke-width="5" stroke-linecap="round"/>';
      if (w) g += '<line x1="' + (x(w.inicio) + 2) + '" x2="' + (x(w.fin) - 2) + '" y1="' + y + '" y2="' + y + '" stroke="' + css("--tinta-2") + '" stroke-width="5" stroke-linecap="round"><title>' +
        nombreModelo(m) + ": " + w.inicio + "–" + w.fin + " h</title></line>";
    });
    [0, 6, 12, 18, 24].forEach(function (h) {
      g += '<text x="' + x(h) + '" y="' + (H - 2) + '" text-anchor="' + (h === 0 ? "start" : h === 24 ? "end" : "middle") + '">' + h + " h</text>";
    });
    return '<svg class="grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lluvia hora por hora y franja de cada modelo">' + g + "</svg>";
  }
  function bloqueHoy(x) {
    var f = new Date(x.fecha + "T12:00:00");
    var cls = x.estado === "seco" ? "hoy-seco" : "hoy-lluvia";
    return '<div class="hoy ' + cls + '">' +
      '<div class="hoy-cabeza"><span class="eyebrow">Hoy, ' + DIAS_LARGO[f.getDay()].toLowerCase() + " " + f.getDate() + "</span>" +
      '<span class="nota">' + (x.vivo ? '<span class="en-vivo">En vivo</span> ' : "Actualizado ") + x.consultado.slice(11, 16) + " h</span></div>" +
      '<p class="hoy-estado">' + (x.estado !== "seco" ? '<span class="anillo' + (x.estado === "llovera" ? " anillo-luego" : "") + '"></span>' : "") +
      esc(ESTADO_HOY[x.estado]) + (x.temperatura != null ? ' <span class="hoy-temp num">' + Math.round(x.temperatura) + " °C</span>" : "") + "</p>" +
      '<p class="hoy-texto">' + esc(x.texto) + "</p>" + (x.estado !== "seco" ? graficoHoy(x) : "") + "</div>";
  }
  function graficoHoy(x) {
    var W = 400, H = 70, iz = 30, de = 6, ar = 6, ab = 16;
    var tope = Math.max.apply(null, x.horas.concat([0.5]));
    var paso = (W - iz - de) / 24, base = H - ab;
    function px(h) { return iz + h * paso; }
    var lluvia = css("--lluvia");
    // el valor de la hora h es lo caído entre h-1 y h: se dibuja en esa franja
    var g = '<rect x="' + iz + '" y="' + ar + '" width="' + (px(x.hora_actual) - iz) + '" height="' + (base - ar) + '" fill="' + css("--superficie-2") + '"/>';
    g += '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + base + '" y2="' + base + '"/>';
    x.horas.forEach(function (v, h) {
      if (v < 0.05 || h === 0) return;
      var alto = Math.max(2, v / tope * (base - ar - 2));
      g += '<rect x="' + (px(h - 1) + paso * 0.12).toFixed(1) + '" y="' + (base - alto).toFixed(1) + '" width="' + (paso * 0.76).toFixed(1) + '" height="' + alto.toFixed(1) +
        '" fill="' + lluvia + '" fill-opacity="' + (h <= x.hora_actual ? 1 : 0.45) + '" rx="1"><title>' + (h - 1) + "–" + h + " h · " + v.toFixed(1) + " mm</title></rect>";
    });
    var xa = px(x.hora_actual);
    g += '<line x1="' + xa + '" x2="' + xa + '" y1="' + (ar - 2) + '" y2="' + base + '" stroke="' + css("--tinta") + '" stroke-width="1.5"/>';
    g += '<text x="' + (xa + (x.hora_actual > 20 ? -4 : 4)) + '" y="' + (ar + 8) + '" text-anchor="' + (x.hora_actual > 20 ? "end" : "start") + '" style="fill:' + css("--tinta") + '">ahora</text>';
    g += '<text x="' + (iz - 5) + '" y="' + (ar + 8) + '" text-anchor="end">' + tope.toFixed(1) + "</text>";
    g += '<text x="' + (iz - 5) + '" y="' + (base) + '" text-anchor="end">mm</text>';
    [0, 6, 12, 18, 24].forEach(function (h) {
      g += '<text x="' + px(h) + '" y="' + (H - 3) + '" text-anchor="' + (h === 0 ? "start" : h === 24 ? "end" : "middle") + '">' + h + " h</text>";
    });
    return '<svg class="grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lluvia de hoy hora por hora">' + g + "</svg>";
  }
  function tiraDias(dias) {
    var tope = Math.max.apply(null, dias.map(function (x) { return Math.max(x.lluvia_mm, x.umbral_fuerte_mm * 1.15, 5); }));
    return '<div class="dias">' + dias.map(function (x) {
      var c = x.clase ? "var(--n" + x.clase + ")" : "var(--acento)";
      var alto = Math.min(100, x.lluvia_mm / tope * 100);
      var umbral = Math.min(100, x.umbral_fuerte_mm / tope * 100);
      var titulo = Object.keys(x.modelos || {}).map(function (k) { return nombreModelo(k) + " " + x.modelos[k] + " mm"; }).join(" · ");
      return '<div class="dia" title="' + esc(titulo) + '"><span class="dia-nombre">' + esc(x.dia) + "</span>" +
        '<span class="dia-tubo" style="--c:' + c + '"><span class="dia-agua" style="height:' + alto.toFixed(1) + '%"></span>' +
        '<span class="dia-umbral" style="bottom:' + umbral.toFixed(1) + '%"></span></span>' +
        '<span class="dia-mm">' + (x.lluvia_mm < 0.5 ? "0" : Math.round(x.lluvia_mm)) + "</span>" +
        '<span class="dia-h">' + (x.horas && x.lluvia_mm >= 1 ? esc(x.horas.corto) : "") + "</span>" +
        '<span class="dia-t' + (x.tmax_z >= 2 ? " calor" : "") + '">' + (x.tmax != null ? Math.round(x.tmax) + "°" : "") + "</span></div>";
    }).join("") + "</div>";
  }
  function filaCriterio(c) {
    var n = c.estado || 0;
    var icono = n === 0
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="6" cy="9.2" r="1.1" fill="currentColor"/></svg>';
    return '<li class="criterio" style="--c:var(--n' + n + ");--c-suave:var(--n" + n + '-suave)">' +
      '<span class="criterio-marca" title="' + (n ? NIVELES[n] : "Normal") + '">' + icono + "</span>" +
      '<span class="criterio-titulo">' + esc(c.titulo) + "</span>" +
      '<span class="criterio-valor">' + esc(c.valor) + "</span>" +
      '<span class="criterio-detalle">' + esc(c.detalle) + "</span></li>";
  }
  function seccionTemporadas(t) {
    var filas = [{ nombre: "Año normal", mm: t.normal_mm, c: "var(--obs)" }];
    t.eventos.forEach(function (e) { filas.push({ nombre: e.nombre, mm: e.mm, c: "var(--n2)" }); });
    var actual = "";
    if (t.actual) {
      filas.push({ nombre: "Esta temporada", mm: t.actual.mm, c: "var(--acento)" });
      actual = '<p class="nota">Esta temporada va del ' + fechaCorta(t.actual.desde) + " al " + fechaCorta(t.actual.hasta) +
        ". Lo normal a esta fecha: " + Math.round(t.actual.normal_a_la_fecha_mm) + " mm.</p>";
    }
    var tope = Math.max.apply(null, filas.map(function (f) { return f.mm || 0; })) || 1;
    var veces = t.eventos.length ? Math.max.apply(null, t.eventos.map(function (e) { return e.mm; })) / Math.max(t.normal_mm, 1) : 0;
    var frase = veces >= 3 ? "En los Niños fuertes aquí llovió hasta " + Math.round(veces) + " veces lo de un año normal." :
      veces >= 1.5 ? "En los Niños pasados aquí llovió bastante más que en un año normal." :
      "Aquí los Niños pasados no cambiaron mucho la lluvia de la temporada.";
    return '<section class="seccion"><p class="eyebrow">Memoria del lugar</p><h3>Temporada de lluvias (dic–may) en Niños pasados</h3>' +
      '<p class="sub">' + frase + '</p><div class="barras">' + filas.map(function (f) {
        return '<div class="barra-fila"><span>' + esc(f.nombre) + '</span><span class="barra-pista"><span class="barra-relleno" style="--c:' + f.c +
          ";width:" + Math.max(1, f.mm / tope * 100).toFixed(1) + '%;display:block"></span></span><span class="barra-valor">' +
          Math.round(f.mm).toLocaleString("es-PE") + " mm</span></div>";
      }).join("") + "</div>" + actual + "</section>";
  }

  // ---------- gráficos SVG ----------
  function graficoSerie(s) {
    var W = 400, H = 150, iz = 30, de = 6, ar = 8, ab = 22;
    var n = s.fechas.length, ancho = (W - iz - de) / n;
    var vals = s.obs.concat(s.pron, s.umbral).filter(function (v) { return v != null; });
    var tope = Math.max.apply(null, vals.concat([5]));
    var paso = tope > 60 ? 20 : tope > 25 ? 10 : 5;
    tope = Math.ceil(tope / paso) * paso;
    function y(v) { return ar + (H - ar - ab) * (1 - v / tope); }
    var g = "";
    for (var t = 0; t <= tope; t += paso) {
      g += '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(t) + '" y2="' + y(t) + '"' + (t ? ' stroke-dasharray="2 3"' : "") + "/>";
      g += '<text x="' + (iz - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + t + "</text>";
    }
    var hoyI = -1;
    s.fechas.forEach(function (f, i) {
      var x = iz + i * ancho;
      if (s.pron[i] != null && hoyI < 0) hoyI = i;
      var v = s.obs[i] != null ? s.obs[i] : s.pron[i];
      if (v == null || v <= 0) return;
      var color = s.obs[i] != null ? css("--obs") : css("--acento");
      g += '<rect x="' + (x + ancho * 0.12).toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + (ancho * 0.76).toFixed(1) +
        '" height="' + (y(0) - y(v)).toFixed(1) + '" fill="' + color + '" rx="1"><title>' + fechaCorta(f) + ": " + v + " mm</title></rect>";
    });
    var linea = s.umbral.map(function (u, i) {
      var x0 = iz + i * ancho, x1 = x0 + ancho;
      return (i ? "L" : "M") + x0.toFixed(1) + " " + y(u).toFixed(1) + " L" + x1.toFixed(1) + " " + y(u).toFixed(1);
    }).join(" ");
    g += '<path d="' + linea + '" fill="none" stroke="' + css("--tinta") + '" stroke-opacity=".5" stroke-width="1.5"/>';
    if (hoyI >= 0) {
      var xh = iz + hoyI * ancho;
      g += '<line x1="' + xh + '" x2="' + xh + '" y1="' + ar + '" y2="' + y(0) + '" stroke="' + css("--acento") + '" stroke-dasharray="3 3"/>';
      g += '<text x="' + (xh + 4) + '" y="' + (ar + 8) + '" style="fill:' + css("--acento") + '">pronóstico</text>';
    }
    g += '<text x="' + iz + '" y="' + (H - 6) + '">' + fechaCorta(s.fechas[0]).replace(/ \d{4}$/, "") + "</text>";
    g += '<text x="' + (W - de) + '" y="' + (H - 6) + '" text-anchor="end">' + fechaCorta(s.fechas[n - 1]).replace(/ \d{4}$/, "") + "</text>";
    g += '<text x="' + iz + '" y="' + (ar - 1) + '" dy="-1" style="font-size:9px">mm/día</text>';
    return '<svg class="grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Lluvia diaria observada y pronosticada">' + g + "</svg>";
  }
  function graficoMar(sem) {
    if (!sem.length) return "";
    var W = 400, H = 90, iz = 30, de = 6, ar = 8, ab = 16;
    var vals = sem.map(function (s) { return s.anom; });
    var mx = Math.max(1, Math.ceil(Math.max.apply(null, vals.map(Math.abs)) * 2) / 2);
    function y(v) { return ar + (H - ar - ab) * (1 - (v + mx) / (2 * mx)); }
    function x(i) { return iz + (W - iz - de) * i / (sem.length - 1); }
    var g = '<line class="eje" x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    g += '<line x1="' + iz + '" x2="' + (W - de) + '" y1="' + y(0.4) + '" y2="' + y(0.4) + '" stroke="' + css("--n2") + '" stroke-dasharray="3 3" stroke-opacity=".8"/>';
    g += '<text x="' + (W - de) + '" y="' + (y(0.4) - 4) + '" text-anchor="end" style="fill:' + css("--n2") + '">+0.4 cálido</text>';
    [mx, 0, -mx].forEach(function (t) { g += '<text x="' + (iz - 5) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + (t > 0 ? "+" : "") + t + "</text>"; });
    var d = sem.map(function (s, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s.anom).toFixed(1); }).join(" ");
    var area = d + " L" + x(sem.length - 1).toFixed(1) + " " + y(0) + " L" + x(0) + " " + y(0) + " Z";
    g += '<path d="' + area + '" fill="' + css("--acento") + '" fill-opacity=".14"/>';
    g += '<path d="' + d + '" fill="none" stroke="' + css("--acento") + '" stroke-width="2" stroke-linejoin="round"/>';
    var u = sem.length - 1;
    g += '<circle cx="' + x(u) + '" cy="' + y(sem[u].anom) + '" r="4" fill="' + css("--acento") + '" stroke="' + css("--superficie") + '" stroke-width="2"/>';
    g += '<text x="' + iz + '" y="' + (H - 3) + '">' + fechaCorta(sem[0].fecha).replace(/ \d{4}$/, "") + "</text>";
    g += '<text x="' + x(u) + '" y="' + (H - 3) + '" text-anchor="end">' + fechaCorta(sem[u].fecha).replace(/ \d{4}$/, "") + "</text>";
    return '<svg class="grafico" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Anomalía semanal de la temperatura del mar, últimos 6 meses">' + g + "</svg>";
  }

  // ---------- navegación ----------
  function elegirDep(nombre, limites) {
    estado.dep = nombre; estado.verTodos = false; estado.hoyAbierto = {}; quitarSeleccion();
    capaDeps.setStyle(estiloDep); marcarEtiquetas();
    if (limites) mapa.fitBounds(limites, { padding: [30, 30], maxZoom: 8 });
    mostrarResumen(); panel.scrollTop = 0;
  }
  function quitarSeleccion() {
    if (estado.seleccion && marcadores[estado.seleccion]) marcadores[estado.seleccion].setStyle(estiloPunto(buscarResumen(estado.seleccion), false));
    estado.seleccion = null;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  function volverPais() {
    estado.dep = null; estado.verTodos = false; estado.hoyAbierto = {}; quitarSeleccion();
    capaDeps.setStyle(estiloDep); marcarEtiquetas();
    mapa.fitBounds([[-18.4, -81.4], [-0.1, -68.6]], { padding: [10, 10] });
    mostrarResumen(); panel.scrollTop = 0;
  }
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("[data-id],[data-accion],[data-dep]");
    if (!b) return;
    if (b.dataset.dep) {
      var f = estado.deps.features.find(function (x) { return x.properties.nombre === b.dataset.dep; });
      return elegirDep(b.dataset.dep, f && f._capa ? f._capa.getBounds() : null);
    }
    if (b.dataset.id) return seleccionar(b.dataset.id);
    var a = b.dataset.accion;
    if (a === "pais") volverPais();
    else if (a === "dep") { quitarSeleccion(); mostrarResumen(); panel.scrollTop = 0; }
    else if (a === "todos") { estado.verTodos = true; mostrarResumen(); }
    else if (a === "hoy-mas") {
      var g = b.dataset.grupo, arriba = panel.scrollTop;
      estado.hoyAbierto[g] = !estado.hoyAbierto[g]; mostrarResumen(); panel.scrollTop = arriba;
      var foco = panel.querySelector('[data-accion="hoy-mas"][data-grupo="' + g + '"]'); if (foco) foco.focus();
    }
  });
  function prepararBusqueda() {
    var dl = document.getElementById("lugares"), indice = {};
    dl.innerHTML = estado.resumen.puntos.map(function (p) {
      var etiqueta = p.nombre + (p.departamento && p.departamento !== p.nombre ? " — " + p.departamento : "");
      indice[etiqueta.toLowerCase()] = p.id;
      return '<option value="' + esc(etiqueta) + '"></option>';
    }).join("");
    var input = document.getElementById("buscar");
    function ir() {
      var v = input.value.trim().toLowerCase();
      if (!v) return;
      var id = indice[v];
      if (!id) {
        var p = estado.resumen.puntos.find(function (q) { return q.nombre.toLowerCase().indexOf(v) === 0; }) ||
          estado.resumen.puntos.find(function (q) { return (q.provincia || "").toLowerCase().indexOf(v) === 0; });
        if (p) id = p.id;
      }
      if (id) { seleccionar(id); var q = buscarResumen(id); mapa.setView([q.lat, q.lon], Math.max(mapa.getZoom(), 7)); input.value = ""; input.blur(); }
    }
    input.addEventListener("change", ir);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ir(); } });
  }

  // ---------- actualización automática ----------
  // El sitio se regenera cada hora. La página abierta revisa cada 5 minutos si hay datos nuevos y los
  // aplica sin recargar, conservando el lugar o departamento que se está viendo.
  function pintarActualizado() {
    var el = document.getElementById("actualizado");
    var g = estado.resumen && estado.resumen.generado;
    if (!el || !g) return;
    function hace(t) {
      var min = Math.max(0, Math.round((Date.now() - t) / 60000));
      return { min: min, txt: min < 1 ? "hace un momento" : min < 60 ? "hace " + min + " min" : min < 1440 ? "hace " + Math.round(min / 60) + " h" : "hace " + Math.round(min / 1440) + " d" };
    }
    var t = new Date(g), pron = hace(t), vivo = window.Vivo && window.Vivo.consultado();
    var fmt = function (x) { return x.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" }); };
    if (vivo) {
      el.textContent = "Hoy en vivo · " + hace(vivo).txt;
      el.title = "La lluvia de hoy se consulta cada 30 minutos (" + fmt(vivo) + "). Pronóstico y niveles: " + fmt(t) + ".";
      el.classList.toggle("viejo", false);
    } else {
      el.textContent = "Actualizado " + pron.txt;
      el.title = "Datos generados el " + fmt(t);
      el.classList.toggle("viejo", pron.min > 180);
    }
  }
  // "Hoy" en vivo (vivo.js): se mezcla con lo publicado y se vuelve a dibujar sin perder lo que se está viendo
  function aplicarVivo() {
    if (!window.Vivo || !estado.resumen) return;
    var ultimo = null;
    estado.resumen.puntos.forEach(function (p) {
      var v = window.Vivo.de(p.id);
      if (!v) return;
      p.hoy = { estado: v.estado, hasta_ahora_mm: v.hasta_ahora_mm, resto_mm: v.resto_mm, descripcion: v.descripcion };
      if (estado.cache[p.id]) estado.cache[p.id].hoy = v;
      if (!ultimo || v.consultado > ultimo) ultimo = v.consultado;
    });
    if (!ultimo) return;
    estado.resumen.hoy_consultado = ultimo;
    crearPuntos(); pintarLeyenda(); pintarActualizado();
    if (window.Capas) window.Capas.repintar();
    var arriba = panel.scrollTop;
    if (estado.seleccion && estado.cache[estado.seleccion]) mostrarPunto(estado.cache[estado.seleccion], false); else mostrarResumen();
    panel.scrollTop = arriba;
  }
  function aplicarResumen(r) {
    estado.resumen = r; estado.cache = {};
    crearPuntos(); capaDeps.setStyle(estiloDep); marcarEtiquetas(); pintarLeyenda(); pintarMar(); pintarActualizado();
    if (window.Capas) window.Capas.repintar();
    if (estado.seleccion && buscarResumen(estado.seleccion)) seleccionar(estado.seleccion, true, true);
    else { var arriba = panel.scrollTop; mostrarResumen(); panel.scrollTop = arriba; }
    aplicarVivo();
    var aviso = document.getElementById("aviso-nuevo");
    aviso.hidden = false; clearTimeout(aviso._t); aviso._t = setTimeout(function () { aviso.hidden = true; }, 6000);
  }
  function revisarNuevos() {
    if (document.hidden) return;
    cargar("data/resumen.json?t=" + Date.now()).then(function (r) {
      if (r.generado && r.generado !== estado.resumen.generado) aplicarResumen(r);
    }).catch(function () {});
  }
  // ---------- ampliar / reducir el panel ----------
  function iniciarAmpliar() {
    var cuerpo = document.getElementById("cuerpo"), boton = document.getElementById("ampliar"), texto = document.getElementById("ampliar-texto");
    function aplicar(on, guardar) {
      cuerpo.classList.toggle("ampliado", on);
      boton.setAttribute("aria-pressed", on ? "true" : "false");
      texto.textContent = on ? "Reducir" : "Ampliar";
      boton.title = on ? "Reducir el panel" : "Ampliar el panel";
      if (guardar) { try { localStorage.setItem("vigia-panel-ampliado", on ? "1" : "0"); } catch (e) {} }
      // el mapa cambia de tamaño: Leaflet debe recalcular cuando termina la transición
      setTimeout(function () { if (mapa) mapa.invalidateSize({ pan: false }); }, 320);
    }
    var inicial = false;
    try { inicial = localStorage.getItem("vigia-panel-ampliado") === "1"; } catch (e) {}
    aplicar(inicial, false);
    boton.addEventListener("click", function () { aplicar(!cuerpo.classList.contains("ampliado"), true); });
  }

  function iniciarActualizacion() {
    pintarActualizado();
    setInterval(pintarActualizado, 60000);
    setInterval(revisarNuevos, 5 * 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { pintarActualizado(); revisarNuevos(); } });
  }

  // ---------- arranque ----------
  Promise.all([cargar("data/resumen.json?t=" + Date.now()), cargar("data/departamentos.json")]).then(function (r) {
    estado.resumen = r[0]; estado.deps = r[1];
    document.getElementById("aviso-demo").hidden = !estado.resumen.demo;
    iniciarMapa(); pintarLeyenda(); pintarMar(); prepararBusqueda(); iniciarActualizacion(); iniciarAmpliar();
    if (window.Capas) window.Capas.iniciar({
      mapa: mapa, resumen: function () { return estado.resumen; },
      alSeleccionar: function (z) {  // tocar una zona abre su lugar con más lluvia
        var mejor = null;
        (z.puntos || []).forEach(function (id) {
          var p = buscarResumen(id); if (!p) return;
          var v = window.Capas.modo() === "hoy" ? (p.hoy ? p.hoy.hasta_ahora_mm + p.hoy.resto_mm : 0) : (p.lluvia_7d_mm || 0);
          if (!mejor || v > mejor.v) mejor = { id: id, v: v };
        });
        if (mejor) seleccionar(mejor.id);
      },
      alCambiar: function () {
        capaDeps.setStyle(estiloDep); marcarEtiquetas(); crearPuntos(); pintarLeyenda();
      },
    });
    if (window.MisLugares) window.MisLugares.iniciar({ mapa: mapa, alCambiar: function () { if (!estado.seleccion) { var arriba = panel.scrollTop; mostrarResumen(); panel.scrollTop = arriba; } } });
    if (location.hash === "#cultivo") setTimeout(function () { document.getElementById("mi-cultivo").click(); }, 300);
    if (window.Vivo) window.Vivo.iniciar({ puntos: estado.resumen.puntos, alActualizar: aplicarVivo });
    if (window.Campo) window.Campo.iniciar({ alCambiar: function () {
      if (estado.seleccion && estado.cache[estado.seleccion]) { var arriba = panel.scrollTop; mostrarPunto(estado.cache[estado.seleccion], false); panel.scrollTop = arriba; }
    } });
    var id = decodeURIComponent((location.hash || "").slice(1));
    if (id && buscarResumen(id)) seleccionar(id, true); else mostrarResumen();
    if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repintar);
    new MutationObserver(repintar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }).catch(function (e) {
    panel.innerHTML = '<section class="seccion"><h3>No se pudieron cargar los datos</h3><p class="sub">Genera el sitio con <code>python run.py web</code> y ábrelo desde un servidor (no con doble clic). Detalle: ' + esc(e.message) + "</p></section>";
  });
})();
