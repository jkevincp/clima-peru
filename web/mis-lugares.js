/* Ventana "Mi informe" en la página del mapa: qué ver y en qué lugares.
 * Se abre sola la primera vez. Los lugares se marcan tocando el mapa, con la ubicación del celular o pegando coordenadas.
 */
(function () {
  "use strict";

  var C = window.ConfigInforme;
  var VISTO = "vigia-informe-visto";
  var mapa, capa, borrador, editando = null, pinTemporal = null, opts = {};

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function coord(v) { return (+v).toFixed(4); }
  function $(id) { return document.getElementById(id); }
  function aviso(texto) {
    var a = $("aviso-nuevo"); if (!a) return;
    a.textContent = texto; a.hidden = false; clearTimeout(a._t); a._t = setTimeout(function () { a.hidden = true; a.textContent = "Datos actualizados"; }, 4000);
  }

  // ---------- lugares en el mapa ----------
  function icono(nombre) {
    return L.divIcon({ className: "mi-lugar", iconSize: null,
      html: '<span class="mi-lugar-pin" aria-hidden="true"></span><span class="mi-lugar-nombre">' + esc(nombre) + "</span>" });
  }
  function pintarMapa() {
    if (!mapa) return;
    capa.clearLayers();
    var c = C.leer();
    (c ? c.lugares : []).forEach(function (l) {
      var m = L.marker([l.lat, l.lon], { pane: "mios", icon: icono(l.nombre), keyboard: true, title: l.nombre }).addTo(capa);
      m.bindPopup('<div class="popup-lugar"><b>' + esc(l.nombre) + "</b>" + (l.grupo ? '<span class="nota">' + esc(l.grupo) + "</span>" : "") +
        '<a class="boton" href="informe.html#' + encodeURIComponent(l.id) + '">Ver su informe</a>' +
        '<button class="enlace" type="button" data-editar="' + esc(l.id) + '">Editar</button></div>', { closeButton: true });
    });
    etiquetaBoton();
  }
  function etiquetaBoton() {
    var c = C.leer(), n = c ? c.lugares.length : 0, t = $("mi-informe-texto");
    if (t) t.textContent = n ? "Mi informe · " + n + (n === 1 ? " lugar" : " lugares") : "Mi informe";
  }

  // ---------- ventana ----------
  function abrir() {
    borrador = C.leer() || C.vacia();
    editando = null;
    pintar();
    var m = $("modal-informe"); m.hidden = false; document.body.classList.add("con-modal");
    var f = m.querySelector("input, button.interes"); if (f) f.focus();
  }
  function cerrar(marcarVisto) {
    $("modal-informe").hidden = true; document.body.classList.remove("con-modal");
    if (marcarVisto) { try { localStorage.setItem(VISTO, "1"); } catch (e) {} }
    quitarPin();
  }
  function quitarPin() { if (pinTemporal) { mapa.removeLayer(pinTemporal); pinTemporal = null; } }

  function filaLugar(l) {
    return '<li class="lugar-fila"><span class="mi-lugar-pin" aria-hidden="true"></span><span class="lugar-fila-txt"><b>' + esc(l.nombre) + "</b>" +
      (l.grupo ? ' <span class="nota">· ' + esc(l.grupo) + "</span>" : "") + '<span class="lugar-fila-coord num">' + coord(l.lat) + ", " + coord(l.lon) + "</span></span>" +
      '<button class="enlace" type="button" data-accion="editar" data-id="' + esc(l.id) + '">Editar</button>' +
      '<button class="enlace peligro" type="button" data-accion="quitar" data-id="' + esc(l.id) + '" aria-label="Quitar ' + esc(l.nombre) + '">Quitar</button></li>';
  }
  function formulario() {
    var e = editando, grupos = C.grupos(borrador);
    var lejos = e.lat != null && !C.enPeru(e.lat, e.lon);
    return '<div class="lugar-form" role="group" aria-label="' + (e.id ? "Editar lugar" : "Nuevo lugar") + '">' +
      '<div class="lugar-form-fila"><label for="lf-nombre">Nombre</label><input id="lf-nombre" type="text" maxlength="60" value="' + esc(e.nombre || "") + '" placeholder="Por ejemplo: Fundo San Vicente o Estación EM-08"></div>' +
      '<div class="lugar-form-fila"><label for="lf-grupo">Grupo <span>(opcional)</span></label><input id="lf-grupo" type="text" list="lf-grupos" maxlength="60" value="' + esc(e.grupo || "") + '" placeholder="Por ejemplo: Agrícola Chira">' +
      '<datalist id="lf-grupos">' + grupos.map(function (g) { return '<option value="' + esc(g) + '"></option>'; }).join("") + "</datalist></div>" +
      '<div class="lugar-form-fila"><label for="lf-coord">Coordenadas</label><input id="lf-coord" type="text" inputmode="text" value="' + (e.lat != null ? coord(e.lat) + ", " + coord(e.lon) : "") +
      '" placeholder="-4.9273, -80.3443  o  4°55\'38&quot;S 80°20\'39&quot;W">' +
      '<p class="av-ref" id="lf-coord-msg">' + (lejos ? "Este punto está fuera del Perú: no tendrá comparación con lo normal." : "Latitud y longitud. Puedes copiarlas de Google Maps.") + "</p></div>" +
      '<div class="lugar-form-pie"><button class="enlace" type="button" data-accion="cancelar-form">Cancelar</button>' +
      '<button class="boton" type="button" data-accion="guardar-lugar">' + (e.id ? "Guardar cambios" : "Agregar lugar") + "</button></div></div>";
  }
  function pintar() {
    var c = borrador, h = "";
    h += '<fieldset class="paso"><legend>1. ¿Qué necesitas ver?</legend><div class="intereses">' + C.INTERESES.map(function (i) {
      var on = !!c.intereses[i.id];
      return '<button type="button" class="interes' + (on ? " activo" : "") + '" data-interes="' + i.id + '" aria-pressed="' + on + '"' + (i.fijo ? " disabled" : "") + ">" +
        '<span class="interes-check" aria-hidden="true"></span><span><b>' + esc(i.nombre) + "</b>" + (i.fijo ? " <span class=\"nota\">(siempre)</span>" : "") +
        '<span class="interes-detalle">' + esc(i.detalle) + "</span></span></button>";
    }).join("") + "</div></fieldset>";
    h += '<fieldset class="paso"><legend>2. Tus lugares <span class="nota">(' + c.lugares.length + " de " + C.MAX_LUGARES + ")</span></legend>";
    if (c.lugares.length) h += '<ul class="lugares-lista">' + c.lugares.map(filaLugar).join("") + "</ul>";
    else h += '<p class="sub">Agrega los fundos, estaciones o ciudades que quieres seguir. Se hace una sola vez.</p>';
    if (editando) h += formulario();
    else if (c.lugares.length < C.MAX_LUGARES) {
      h += '<div class="agregar"><button class="boton-sec" type="button" data-accion="marcar">Marcar en el mapa</button>' +
        '<button class="boton-sec" type="button" data-accion="ubicacion">Usar mi ubicación</button>' +
        '<button class="boton-sec" type="button" data-accion="pegar">Escribir coordenadas</button></div>';
    }
    h += "</fieldset>";
    if (c.lugares.length) {
      h += '<div class="compartir"><span class="sub">¿Lo quieres en otro celular o computadora?</span>' +
        '<button class="enlace" type="button" data-accion="copiar">Copiar enlace de mi informe</button>' +
        '<input id="enlace-informe" class="enlace-campo" type="text" readonly hidden aria-label="Enlace de mi informe"></div>';
    }
    $("modal-informe-cuerpo").innerHTML = h;
    $("mi-guardar").disabled = !!editando;
    $("mi-ver").disabled = !!editando || !c.lugares.length;
  }

  function leerFormulario() {
    var nombre = $("lf-nombre").value.trim(), grupo = $("lf-grupo").value.trim(), pos = C.leerCoordenadas($("lf-coord").value);
    var msg = $("lf-coord-msg");
    if (!nombre) { $("lf-nombre").focus(); $("lf-nombre").setAttribute("aria-invalid", "true"); return null; }
    if (!pos) { msg.textContent = "No reconozco estas coordenadas. Escríbelas como -4.9273, -80.3443."; msg.classList.add("error"); $("lf-coord").focus(); return null; }
    return { id: editando.id || C.nuevoId(), nombre: nombre, grupo: grupo, lat: pos.lat, lon: pos.lon };
  }
  function nuevo(datos) {
    editando = datos || { id: null };
    pintar();
    var f = editando.lat != null ? $("lf-nombre") : $("lf-coord");
    if (f) f.focus();
  }

  // ---------- marcar en el mapa ----------
  function modoMarcar(on) {
    var cuerpo = $("cuerpo"), banda = $("banda-marcar");
    cuerpo.classList.toggle("modo-marcar", on);
    banda.hidden = !on;
    if (on) {
      $("modal-informe").hidden = true; document.body.classList.remove("con-modal");
      if (window.matchMedia("(max-width: 860px)").matches) $("mapa").scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () { $("banda-cancelar").focus(); }, 50);
    }
  }
  function alTocarMapa(e) {
    if (!$("cuerpo").classList.contains("modo-marcar")) return;
    modoMarcar(false);
    quitarPin();
    pinTemporal = L.marker(e.latlng, { pane: "mios", icon: icono("Nuevo lugar"), interactive: false }).addTo(mapa);
    var datos = Object.assign({}, editando || { id: null }, { lat: e.latlng.lat, lon: e.latlng.lng });
    $("modal-informe").hidden = false; document.body.classList.add("con-modal");
    nuevo(datos);
  }

  function iniciar(o) {
    opts = o; mapa = o.mapa;
    mapa.createPane("mios").style.zIndex = 640;
    capa = L.layerGroup().addTo(mapa);
    mapa.on("click", alTocarMapa);
    mapa.on("popupopen", function (e) {
      var b = e.popup.getElement().querySelector("[data-editar]");
      if (b) b.addEventListener("click", function () {
        mapa.closePopup(); abrir();
        var l = borrador.lugares.filter(function (x) { return x.id === b.dataset.editar; })[0];
        if (l) nuevo(Object.assign({}, l));
      });
    });
    pintarMapa();

    $("mi-informe").addEventListener("click", function () {
      var c = C.leer();
      if (c && c.lugares.length) location.href = "informe.html"; else abrir();
    });
    $("panel").addEventListener("click", function (e) { if (e.target.closest("[data-mi='editar']")) abrir(); });
    $("banda-cancelar").addEventListener("click", function () { modoMarcar(false); $("modal-informe").hidden = false; document.body.classList.add("con-modal"); pintar(); });

    var m = $("modal-informe");
    m.addEventListener("click", function (e) {
      if (e.target === m || e.target.closest("[data-mi='cerrar']")) return cerrar(true);
      var b = e.target.closest("[data-interes],[data-accion]");
      if (!b || b.disabled) return;
      if (b.dataset.interes) {
        borrador.intereses[b.dataset.interes] = !borrador.intereses[b.dataset.interes];
        pintar(); var f = m.querySelector('[data-interes="' + b.dataset.interes + '"]'); if (f) f.focus();
        return;
      }
      var a = b.dataset.accion;
      if (a === "marcar") { editando = editando || { id: null }; modoMarcar(true); }
      else if (a === "pegar") nuevo();
      else if (a === "ubicacion") {
        if (!navigator.geolocation) return aviso("Este navegador no puede dar tu ubicación. Marca el punto en el mapa.");
        b.disabled = true; b.textContent = "Buscando tu ubicación…";
        navigator.geolocation.getCurrentPosition(function (p) {
          nuevo({ id: null, lat: p.coords.latitude, lon: p.coords.longitude });
          if (p.coords.accuracy > 1000) { var msg = $("lf-coord-msg"); if (msg) msg.textContent = "Ubicación aproximada (± " + Math.round(p.coords.accuracy / 1000) + " km). Revísala en el mapa si hace falta."; }
        }, function () {
          aviso("No se pudo obtener tu ubicación. Revisa el permiso o marca el punto en el mapa."); pintar();
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      }
      else if (a === "editar") nuevo(Object.assign({}, borrador.lugares.filter(function (x) { return x.id === b.dataset.id; })[0]));
      else if (a === "quitar") { borrador.lugares = borrador.lugares.filter(function (x) { return x.id !== b.dataset.id; }); pintar(); }
      else if (a === "cancelar-form") { editando = null; quitarPin(); pintar(); }
      else if (a === "guardar-lugar") {
        var l = leerFormulario(); if (!l) return;
        var i = borrador.lugares.findIndex(function (x) { return x.id === l.id; });
        if (i >= 0) borrador.lugares[i] = l; else borrador.lugares.push(l);
        editando = null; quitarPin(); pintar();
        var bt = m.querySelector("[data-accion='marcar']"); if (bt) bt.focus();
      }
      else if (a === "copiar") {
        var url = C.enlace(borrador), campo = $("enlace-informe");
        campo.value = url; campo.hidden = false;
        var hecho = function () { b.textContent = "Enlace copiado"; };
        try { navigator.clipboard.writeText(url).then(hecho, function () { campo.select(); }); } catch (err) { campo.select(); }
      }
    });
    m.addEventListener("input", function (e) {
      if (e.target.id === "lf-coord") {
        var pos = C.leerCoordenadas(e.target.value), msg = $("lf-coord-msg");
        msg.classList.toggle("error", !pos && e.target.value.trim().length > 4);
        msg.textContent = !e.target.value.trim() ? "Latitud y longitud. Puedes copiarlas de Google Maps." :
          !pos ? "Aún no reconozco las coordenadas." :
          !C.enPeru(pos.lat, pos.lon) ? "Este punto está fuera del Perú: no tendrá comparación con lo normal." :
          "Ubicación: " + coord(pos.lat) + ", " + coord(pos.lon);
      }
      if (e.target.id === "lf-nombre") e.target.removeAttribute("aria-invalid");
    });
    m.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); if (editando) { editando = null; pintar(); } else cerrar(true); }
      if (e.key === "Enter" && e.target.closest(".lugar-form") && e.target.tagName === "INPUT") {
        e.preventDefault(); var g = m.querySelector("[data-accion='guardar-lugar']"); if (g) g.click();
      }
    });
    $("mi-guardar").addEventListener("click", function () {
      C.guardar(borrador); cerrar(true); pintarMapa(); aviso("Tu informe quedó guardado en este navegador");
      if (opts.alCambiar) opts.alCambiar();
    });
    $("mi-ver").addEventListener("click", function () { C.guardar(borrador); try { localStorage.setItem(VISTO, "1"); } catch (e) {} location.href = "informe.html"; });

    // Primera visita: se ofrece configurar el informe (una sola vez)
    var visto = false; try { visto = localStorage.getItem(VISTO) === "1"; } catch (e) {}
    if (location.hash === "#configurar") abrir();
    else if (!visto && !C.leer() && !location.hash) setTimeout(abrir, 600);
  }

  window.MisLugares = { iniciar: iniciar, abrir: abrir, repintar: pintarMapa };
})();
