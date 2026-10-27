/* "Mi cultivo": configuración (guardada en este navegador) y cálculos para el lugar elegido.
 * Usa window.CULTIVOS y window.CAMPO_GENERAL (cultivos.js) y los datos hora a hora de data/puntos/<id>.json → campo.
 */
(function () {
  "use strict";

  var CLAVE = "vigia-cultivo";
  var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var alCambiar = function () {};
  var borrador = null;  // configuración que se está editando en la ventana

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(v, d) { return v == null || isNaN(v) ? "—" : (+v).toLocaleString("es-PE", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function buscar(id) { return (window.CULTIVOS || []).filter(function (c) { return c.id === id; })[0] || null; }
  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || "null"); } catch (e) { return null; } }
  function guardar(cfg) { try { cfg ? localStorage.setItem(CLAVE, JSON.stringify(cfg)) : localStorage.removeItem(CLAVE); } catch (e) {} }
  function fuenteHtml(f) {
    if (!f) return "";
    return f.url ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.texto) + "</a>" : esc(f.texto);
  }

  /** Valores efectivos: referencia del cultivo + ajustes del usuario. */
  function valores(cfg) {
    var c = buscar(cfg.id);
    if (!c) return null;
    var a = cfg.ajustes || {}, g = window.CAMPO_GENERAL;
    var kcRef = c.kc ? c.kc[cfg.etapa] : null;
    var aplica = function (r) { return r && (!r.etapas || r.etapas.indexOf(cfg.etapa) >= 0) ? r : null; };
    var ind = aplica(c.induccion), cal = aplica(c.calor), fri = aplica(c.frio);
    function v(campo, ref) { return a[campo] != null && a[campo] !== "" ? +a[campo] : ref; }
    return {
      cultivo: c, nombre: c.otro && cfg.nombre ? cfg.nombre : c.nombre, etapa: cfg.etapa,
      sensible: (c.sensibles || []).indexOf(cfg.etapa) >= 0,
      kc: v("kc", kcRef), base: v("base", c.base),
      induccion: v("induccion", ind ? ind.umbral : null), induccionVar: ind ? ind.variable : "min", induccionRef: ind,
      calor: v("calor", cal ? cal.umbral : null), calorRef: cal,
      frio: v("frio", fri ? fri.umbral : null), frioVar: fri ? fri.variable : "hora", frioRef: fri,
      humedad: v("humedad", g.humedad.umbral), viento: v("viento", g.viento.umbral),
      ajustado: Object.keys(a).some(function (k) { return a[k] != null && a[k] !== ""; }),
    };
  }

  // ---------- cálculos ----------
  /** Agrupa el pronóstico hora a hora en días (de mañana en adelante, hasta 7). */
  function dias(campo) {
    var h = campo && campo.horario;
    if (!h || !h.t) return [];
    var inicio = new Date(h.inicio + ":00"), porDia = {}, orden = [];
    for (var i = 0; i < h.t.length; i++) {
      var f = new Date(inicio.getTime() + i * 3600000);
      var k = f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
      if (!porDia[k]) { porDia[k] = { fecha: k, d: f, horas: [] }; orden.push(k); }
      porDia[k].horas.push({ h: f.getHours(), t: h.t[i], hr: h.hr[i], v: h.v[i], p: h.p[i] });
    }
    return orden.slice(1, 8).map(function (k) { return porDia[k]; }).filter(function (d) { return d.horas.length >= 20; });
  }
  function ventanas(dia, vientoMax) {
    // hora apta: de 6 a 18 h, sin lluvia en esa hora ni en las 2 siguientes (para que el producto seque) y viento bajo
    var hs = dia.horas, apta = [];
    for (var i = 0; i < hs.length; i++) {
      var x = hs[i], ok = x.h >= 6 && x.h < 18 && x.v != null && x.v < vientoMax;
      for (var j = i; j <= i + 2 && j < hs.length; j++) ok = ok && (hs[j].p || 0) < 0.1;
      apta.push(ok);
    }
    var mejor = null, ini = -1;
    for (var k = 0; k <= apta.length; k++) {
      if (k < apta.length && apta[k]) { if (ini < 0) ini = k; continue; }
      if (ini >= 0 && k - ini >= 3 && (!mejor || k - ini > mejor[1] - mejor[0])) mejor = [hs[ini].h, hs[k - 1].h + 1];
      ini = -1;
    }
    return mejor;
  }
  function etiquetaDia(d) { return DIAS[d.d.getDay()] + " " + d.d.getDate(); }

  function calcular(d, val) {
    var ds = dias(d.campo);
    if (!ds.length) return null;
    var res = [];
    var resumenDias = ds.map(function (x) {
      var ts = x.horas.map(function (h) { return h.t; }).filter(function (t) { return t != null; });
      var tmin = Math.min.apply(null, ts), tmax = Math.max.apply(null, ts);
      var tmed = ts.reduce(function (a, b) { return a + b; }, 0) / ts.length;
      return {
        x: x, tmin: tmin, tmax: tmax, tmed: tmed,
        lluvia: x.horas.reduce(function (a, h) { return a + (h.p || 0); }, 0),
        hum: x.horas.filter(function (h) { return (h.hr != null && h.hr >= val.humedad) || (h.p || 0) >= 0.2; }).length,
        calor: val.calor != null ? x.horas.filter(function (h) { return h.t != null && h.t >= val.calor; }).length : 0,
        frioH: val.frio != null ? x.horas.filter(function (h) { return h.t != null && h.t <= val.frio; }).length : 0,
        ventana: ventanas(x, val.viento),
      };
    });
    var n = resumenDias.length;

    // 1. Agua
    var et0 = resumenDias.reduce(function (a, r) { var e = (d.campo.et0 || {})[r.x.fecha]; return a + (e == null ? 0 : e); }, 0);
    var lluviaUtil = resumenDias.reduce(function (a, r) { return a + (r.lluvia >= 2 ? r.lluvia * 0.8 : 0); }, 0);
    if (val.kc != null) {
      var etc = val.kc * et0, falta = Math.max(0, etc - lluviaUtil);
      res.push({
        clave: "agua", titulo: "Agua para el cultivo", estado: "info",
        valor: falta > 0 ? num(falta) + " mm" : "Cubierta por la lluvia",
        detalle: (falta > 0 ? "Necesidad aproximada de riego en " + n + " días: " + num(falta) + " mm, unos " + num(falta * 10) + " m³ por hectárea. " : "") +
          "Consumo estimado " + num(etc) + " mm (Kc " + num(val.kc, 2) + " × ET0 " + num(et0) + " mm) menos " + num(lluviaUtil) + " mm de lluvia útil. Ajústalo según tu sistema de riego y tu suelo.",
      });
    } else {
      res.push({
        clave: "agua", titulo: "Agua para el cultivo", estado: "info", valor: "ET0 " + num(et0) + " mm",
        detalle: "La evapotranspiración de referencia de " + n + " días es " + num(et0) + " mm. Para estimar el riego de " + esc(val.nombre) +
          " falta su coeficiente Kc: no hay valor de referencia FAO-56; ingrésalo en Avanzado.",
      });
    }

    // 2. Hongos
    var diasAlto = resumenDias.filter(function (r) { return r.hum >= 10; }), diasMedio = resumenDias.filter(function (r) { return r.hum >= 6 && r.hum < 10; });
    var eH = diasAlto.length ? (val.sensible ? "alerta" : "atencion") : diasMedio.length ? (val.sensible ? "atencion" : "ok") : "ok";
    res.push({
      clave: "hongos", titulo: "Riesgo de hongos", estado: eH,
      valor: diasAlto.length ? diasAlto.length + (diasAlto.length === 1 ? " día" : " días") + " de riesgo alto" : diasMedio.length ? diasMedio.length + (diasMedio.length === 1 ? " día" : " días") + " de riesgo medio" : "Bajo",
      detalle: (diasAlto.length ? "Muchas horas de humedad alta o lluvia: " + diasAlto.map(function (r) { return etiquetaDia(r.x) + " (" + r.hum + " h)"; }).join(", ") + ". " : "") +
        "Se cuentan las horas con humedad relativa de " + num(val.humedad) + " % o más, o con lluvia." + (val.sensible ? " En " + esc(val.etapa.toLowerCase()) + " el cultivo es más sensible." : ""),
    });

    // 3. Ventanas de aplicación
    var conV = resumenDias.filter(function (r) { return r.ventana; });
    res.push({
      clave: "ventanas", titulo: "Ventanas para aplicar", estado: conV.length >= 3 ? "ok" : conV.length ? "atencion" : "alerta",
      valor: conV.length + " de " + n + " días",
      detalle: conV.length ? "Mejores horarios: " + conV.slice(0, 5).map(function (r) { return etiquetaDia(r.x) + " " + r.ventana[0] + "–" + r.ventana[1] + " h"; }).join(" · ") +
        ". Sin lluvia en las 2 horas siguientes y viento menor de " + num(val.viento) + " km/h." :
        "No hay horarios de día sin lluvia y con viento menor de " + num(val.viento) + " km/h en los próximos " + n + " días.",
      dias: resumenDias.map(function (r) { return { dia: etiquetaDia(r.x), v: r.ventana }; }),
    });

    // 4. Inducción floral por frío
    if (val.induccion != null && val.induccionRef) {
      var frescos = resumenDias.filter(function (r) { return (val.induccionVar === "media" ? r.tmed : r.tmin) <= val.induccion; }).length;
      var palabra = val.induccionVar === "media" ? "días con temperatura media" : "noches con mínima";
      res.push({
        clave: "induccion", titulo: "Frío para inducir la floración", estado: frescos >= 4 ? "ok" : frescos ? "atencion" : "alerta",
        valor: frescos + " de " + n + " " + (val.induccionVar === "media" ? "días" : "noches"),
        detalle: frescos + " " + palabra + " de " + num(val.induccion) + " °C o menos. " + (frescos ? "" : "Sin frío suficiente la floración puede retrasarse o ser débil; es común en años de El Niño. ") +
          (val.induccionRef.nota || ""),
      });
    }
    // 5. Calor
    if (val.calor != null && val.calorRef) {
      var hc = resumenDias.reduce(function (a, r) { return a + r.calor; }, 0);
      res.push({
        clave: "calor", titulo: "Calor que daña en esta etapa", estado: hc === 0 ? "ok" : hc <= 5 ? "atencion" : "alerta",
        valor: hc + " h ≥ " + num(val.calor) + " °C",
        detalle: (hc ? "Días con calor: " + resumenDias.filter(function (r) { return r.calor; }).map(function (r) { return etiquetaDia(r.x) + " (" + r.calor + " h, máx. " + num(r.tmax) + " °C)"; }).join(", ") + ". " : "Sin horas de calor dañino. ") + (val.calorRef.nota || ""),
      });
    }
    // 6. Frío
    if (val.frio != null && val.frioRef) {
      var cuenta = val.frioVar === "media" ? resumenDias.filter(function (r) { return r.tmed <= val.frio; }).length : resumenDias.reduce(function (a, r) { return a + r.frioH; }, 0);
      res.push({
        clave: "frio", titulo: "Frío que daña en esta etapa", estado: cuenta === 0 ? "ok" : cuenta <= (val.frioVar === "media" ? 1 : 5) ? "atencion" : "alerta",
        valor: val.frioVar === "media" ? cuenta + " días ≤ " + num(val.frio) + " °C" : cuenta + " h ≤ " + num(val.frio) + " °C",
        detalle: (cuenta ? "" : "Sin frío dañino. ") + (val.frioRef.nota || ""),
      });
    }
    // 7. Grados-día
    if (val.base != null) {
      var gd = resumenDias.reduce(function (a, r) { return a + Math.max(0, (r.tmin + r.tmax) / 2 - val.base); }, 0);
      res.push({
        clave: "gd", titulo: "Calor acumulado (grados-día)", estado: "info", valor: num(gd) + " GD",
        detalle: "Suma de la temperatura media sobre " + num(val.base) + " °C en " + n + " días: mide cuánto avanza el desarrollo del cultivo. Promedio: " + num(gd / n, 1) + " GD por día.",
      });
    }
    return { indicadores: res, dias: n };
  }

  // ---------- HTML de la sección en el detalle de un lugar ----------
  var ICONO = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17V9M10 9c0-3 2-5.5 6-6-0.3 4-2.6 6-6 6Zm0 2C10 8 8.2 6 4.5 5.6 4.7 9 6.8 11 10 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ESTADO = { ok: { n: 0, t: "Bien" }, atencion: { n: 1, t: "Atención" }, alerta: { n: 2, t: "Alerta" }, info: { n: -1, t: "" } };

  function seccion(d) {
    var cfg = leer(), val = cfg && valores(cfg);
    if (!val) {
      return '<section class="seccion campo-invita"><div class="campo-cabeza"><span class="campo-icono">' + ICONO + '</span><h3>Para tu cultivo</h3></div>' +
        '<p class="sub">Elige tu cultivo y su etapa para ver cuánta agua necesita esta semana, el riesgo de hongos, los mejores horarios para aplicar y el efecto del calor o el frío.</p>' +
        '<button class="boton" type="button" data-campo="abrir">Elegir mi cultivo</button></section>';
    }
    var r = calcular(d, val);
    var h = '<section class="seccion campo"><div class="campo-cabeza"><span class="campo-icono">' + ICONO + "</span>" +
      "<h3>Para tu " + esc(val.nombre.toLowerCase()) + '</h3><button class="enlace" type="button" data-campo="abrir">Cambiar</button></div>' +
      '<p class="sub">Etapa: ' + esc(val.etapa) + (val.ajustado ? " · con tus valores" : " · valores de referencia") + "</p>";
    if (!r) {
      return h + '<p class="vacio">Los datos hora a hora para tu cultivo estarán disponibles desde la próxima actualización completa (cada mañana).</p></section>';
    }
    h += '<ul class="criterios">' + r.indicadores.map(function (i) {
      var e = ESTADO[i.estado];
      var color = e.n < 0 ? "--c:var(--acento);--c-suave:var(--acento-suave)" : "--c:var(--n" + e.n + ");--c-suave:var(--n" + e.n + "-suave)";
      var marca = e.n < 0 ? '<span class="campo-punto"></span>' : e.n === 0
        ? '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="6" cy="9.2" r="1.1" fill="currentColor"/></svg>';
      var tira = i.dias ? '<span class="ventanas">' + i.dias.map(function (x) {
        return '<span class="ventana' + (x.v ? " si" : "") + '" title="' + esc(x.dia + (x.v ? ": " + x.v[0] + "–" + x.v[1] + " h" : ": sin ventana")) + '"><b>' + esc(x.dia.split(" ")[0]) + "</b>" + (x.v ? x.v[0] + "–" + x.v[1] : "—") + "</span>";
      }).join("") + "</span>" : "";
      return '<li class="criterio" style="' + color + '"><span class="criterio-marca" title="' + e.t + '">' + marca + "</span>" +
        '<span class="criterio-titulo">' + esc(i.titulo) + "</span>" + '<span class="criterio-valor">' + esc(i.valor) + "</span>" +
        '<span class="criterio-detalle">' + esc(i.detalle) + tira + "</span></li>";
    }).join("") + "</ul>";
    h += '<p class="nota">Valores generales para orientar decisiones; varían según variedad, zona y manejo. Contrástalos con tu técnico.</p></section>';
    return h;
  }

  // ---------- ventana de configuración ----------
  function etiquetaBoton() {
    var cfg = leer(), val = cfg && valores(cfg), el = document.getElementById("mi-cultivo-texto");
    if (el) el.textContent = val ? val.nombre + " · " + val.etapa : "Mi cultivo";
  }
  function abrir() {
    var cfg = leer();
    borrador = cfg ? JSON.parse(JSON.stringify(cfg)) : { id: null, etapa: null, ajustes: {} };
    pintarModal();
    var m = document.getElementById("modal-cultivo");
    m.hidden = false;
    document.body.classList.add("con-modal");
    var primero = m.querySelector(".cultivo-op.activo") || m.querySelector(".cultivo-op");
    if (primero) primero.focus();
  }
  function cerrar() {
    document.getElementById("modal-cultivo").hidden = true;
    document.body.classList.remove("con-modal");
    var b = document.getElementById("mi-cultivo");
    if (b) b.focus();
  }
  function campoAvanzado(id, etiqueta, unidad, ref, fuente, nota) {
    var val = borrador.ajustes && borrador.ajustes[id];
    return '<div class="av-campo"><label for="av-' + id + '">' + esc(etiqueta) + (unidad ? " <span>(" + esc(unidad) + ")</span>" : "") + "</label>" +
      '<input id="av-' + id + '" data-av="' + id + '" type="number" step="any" inputmode="decimal" value="' + (val != null ? esc(val) : "") +
      '" placeholder="' + (ref != null ? esc(ref) : "sin valor") + '">' +
      '<p class="av-ref">' + (ref != null ? "Referencia: " + esc(ref) + (unidad ? " " + esc(unidad) : "") + ". " + fuenteHtml(fuente) : "Sin valor de referencia confiable para este cultivo.") +
      (nota ? " " + esc(nota) : "") + "</p></div>";
  }
  function pintarModal() {
    var c = buscar(borrador.id), cont = document.getElementById("modal-cultivo-cuerpo");
    var h = '<fieldset class="paso"><legend>1. ¿Qué cultivas?</legend><div class="cultivo-ops">' + window.CULTIVOS.map(function (x) {
      return '<button type="button" class="cultivo-op' + (x.id === borrador.id ? " activo" : "") + '" data-cultivo="' + x.id + '" aria-pressed="' + (x.id === borrador.id) + '">' + esc(x.nombre) + "</button>";
    }).join("") + "</div>";
    if (c && c.otro) h += '<label class="otro-nombre" for="otro-nombre">Nombre del cultivo</label><input id="otro-nombre" type="text" value="' + esc(borrador.nombre || "") + '" placeholder="Por ejemplo: cacao, espárrago, maracuyá">';
    h += "</fieldset>";
    if (c) {
      if (c.etapas.indexOf(borrador.etapa) < 0) borrador.etapa = null;
      h += '<fieldset class="paso"><legend>2. ¿En qué etapa está?</legend><div class="etapa-ops">' + c.etapas.map(function (e) {
        return '<button type="button" class="etapa-op' + (e === borrador.etapa ? " activo" : "") + '" data-etapa="' + esc(e) + '" aria-pressed="' + (e === borrador.etapa) + '">' + esc(e) + "</button>";
      }).join("") + "</div></fieldset>";
      if (borrador.etapa) {
        var v = valores({ id: c.id, etapa: borrador.etapa, ajustes: {} }), g = window.CAMPO_GENERAL;
        h += '<details class="avanzado"' + (borrador.ajustes && Object.keys(borrador.ajustes).some(function (k) { return borrador.ajustes[k] !== "" && borrador.ajustes[k] != null; }) ? " open" : "") + ">" +
          "<summary>Avanzado: ajustar valores</summary>" +
          '<p class="sub">Déjalo vacío para usar la referencia. Si tu técnico usa otros valores, escríbelos aquí.</p>' +
          campoAvanzado("kc", "Coeficiente de cultivo Kc en " + borrador.etapa.toLowerCase(), "", v.kc, c.fuenteKc,
            [c.notaKc, c.kc && (window.KC_INTERPOLADO || {})[borrador.etapa] ? "Valor intermedio entre la etapa inicial y la media de la tabla." : ""].filter(Boolean).join(" ")) +
          campoAvanzado("base", "Temperatura base para grados-día", "°C", v.base, c.fuenteBase) +
          (c.induccion ? campoAvanzado("induccion", "Frío para inducir floración (" + (c.induccion.variable === "media" ? "temperatura media" : "mínima nocturna") + ")", "°C", c.induccion.umbral, c.induccion.fuente, "Se usa en: " + c.induccion.etapas.join(", ") + ".") : "") +
          (c.calor ? campoAvanzado("calor", "Calor que daña", "°C", c.calor.umbral, c.calor.fuente, "Se usa en: " + c.calor.etapas.join(", ") + ".") : "") +
          (c.frio ? campoAvanzado("frio", "Frío que daña (" + (c.frio.variable === "media" ? "temperatura media" : "por hora") + ")", "°C", c.frio.umbral, c.frio.fuente, "Se usa en: " + c.frio.etapas.join(", ") + ".") : "") +
          campoAvanzado("humedad", "Humedad para riesgo de hongos", "%", g.humedad.umbral, g.humedad.fuente) +
          campoAvanzado("viento", "Viento máximo para aplicar", "km/h", g.viento.umbral, g.viento.fuente) +
          '<button type="button" class="enlace" data-campo="restablecer">Volver a los valores de referencia</button></details>';
      }
    }
    cont.innerHTML = h;
    document.getElementById("modal-guardar").disabled = !(c && borrador.etapa && (!c.otro || (borrador.nombre || "").trim()));
    document.getElementById("modal-quitar").hidden = !leer();
  }
  function leerAvanzado() {
    var a = {};
    document.querySelectorAll("#modal-cultivo [data-av]").forEach(function (inp) {
      if (inp.value !== "" && !isNaN(+inp.value)) a[inp.dataset.av] = +inp.value;
    });
    borrador.ajustes = a;
    var otro = document.getElementById("otro-nombre");
    if (otro) borrador.nombre = otro.value.trim();
  }

  function iniciar(opciones) {
    alCambiar = opciones.alCambiar || alCambiar;
    etiquetaBoton();
    document.getElementById("mi-cultivo").addEventListener("click", abrir);
    var m = document.getElementById("modal-cultivo");
    m.addEventListener("click", function (e) {
      if (e.target === m || e.target.closest("[data-campo='cerrar']")) return cerrar();
      var b = e.target.closest("[data-cultivo],[data-etapa],[data-campo='restablecer']");
      if (!b) return;
      leerAvanzado();
      if (b.dataset.cultivo) { if (borrador.id !== b.dataset.cultivo) { borrador.id = b.dataset.cultivo; borrador.ajustes = {}; } }
      else if (b.dataset.etapa) { if (borrador.etapa !== b.dataset.etapa) { borrador.etapa = b.dataset.etapa; if (borrador.ajustes) delete borrador.ajustes.kc; } }
      else borrador.ajustes = {};
      pintarModal();
      var foco = m.querySelector(b.dataset.cultivo ? ".cultivo-op.activo" : b.dataset.etapa ? ".etapa-op.activo" : ".avanzado summary");
      if (foco) foco.focus();
    });
    m.addEventListener("input", function (e) {
      if (e.target.id === "otro-nombre") { borrador.nombre = e.target.value.trim(); document.getElementById("modal-guardar").disabled = !borrador.nombre || !borrador.etapa; }
    });
    m.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); cerrar(); }
      if (e.key === "Tab") {  // mantener el foco dentro de la ventana
        var f = m.querySelectorAll("button:not([disabled]):not([hidden]), input, summary, a[href]");
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    document.getElementById("modal-guardar").addEventListener("click", function () {
      leerAvanzado();
      guardar({ id: borrador.id, nombre: borrador.nombre, etapa: borrador.etapa, ajustes: borrador.ajustes });
      cerrar(); etiquetaBoton(); alCambiar();
    });
    document.getElementById("modal-quitar").addEventListener("click", function () {
      guardar(null); cerrar(); etiquetaBoton(); alCambiar();
    });
    // botones "Elegir mi cultivo" / "Cambiar" dentro del panel
    document.getElementById("panel").addEventListener("click", function (e) {
      if (e.target.closest("[data-campo='abrir']")) abrir();
    });
  }

  window.Campo = { iniciar: iniciar, seccion: seccion, _calcular: calcular, _valores: valores };
})();
