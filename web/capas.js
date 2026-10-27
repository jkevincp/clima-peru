/* Capas del mapa: Riesgo 7 días (por defecto) · Lluvia de hoy · Lluvia de la semana · Satélite (NASA).
 * Las de lluvia colorean provincias (y distritos donde se vigilan) con una sola gama de azules a morado:
 * más oscuro = más lluvia; sin color = sin lluvia. No usa rojo, para no confundirse con el semáforo de riesgo.
 */
(function () {
  "use strict";

  var MODOS = [
    { id: "riesgo", nombre: "Riesgo 7 días" },
    { id: "hoy", nombre: "Lluvia hoy" },
    { id: "semana", nombre: "Lluvia 7 días" },
    { id: "satelite", nombre: "Satélite" },
  ];
  // Cortes en mm y colores (de claro a oscuro). Debajo del primer corte no se colorea.
  var ESCALAS = {
    hoy: { titulo: "Lluvia de hoy (mm)", cortes: [0.5, 2, 5, 10, 20, 40] },
    semana: { titulo: "Lluvia próximos 7 días (mm)", cortes: [1, 5, 15, 30, 60, 120] },
  };
  var COLORES = ["--ll1", "--ll2", "--ll3", "--ll4", "--ll5", "--ll6"];
  var CLAVE = "vigia-capa";

  var mapa, zonasGeo = null, capaZonas = null, capaSat = null, satInfo = null, modo = "riesgo";
  var opts = {};

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function clase(v, cortes) { var k = -1; for (var i = 0; i < cortes.length; i++) if (v >= cortes[i]) k = i; return k; }

  function valorZona(z, porId) {
    var max = null;
    (z.properties.puntos || []).forEach(function (id) {
      var p = porId[id];
      if (!p) return;
      var v = modo === "hoy" ? (p.hoy ? (p.hoy.hasta_ahora_mm || 0) + (p.hoy.resto_mm || 0) : null) : p.lluvia_7d_mm;
      if (v != null && (max == null || v > max)) max = v;
    });
    return max;
  }
  function estilo(f) {
    var esc_ = ESCALAS[modo], k = f.properties._k;
    return {
      pane: "zonas", weight: 0.6, color: css("--tinta-3"), opacity: 0.5,
      fillColor: k >= 0 ? css(COLORES[k]) : "transparent", fillOpacity: k >= 0 ? 0.78 : 0,
    };
  }

  function pintarZonas() {
    if (!capaZonas) return;
    if (modo !== "hoy" && modo !== "semana") { if (mapa.hasLayer(capaZonas)) mapa.removeLayer(capaZonas); return; }
    var porId = {};
    opts.resumen().puntos.forEach(function (p) { porId[p.id] = p; });
    capaZonas.eachLayer(function (l) {
      var v = valorZona(l.feature, porId);
      l.feature.properties._v = v;
      l.feature.properties._k = v == null ? -1 : clase(v, ESCALAS[modo].cortes);
    });
    capaZonas.setStyle(estilo);
    if (!mapa.hasLayer(capaZonas)) capaZonas.addTo(mapa);
  }

  // ---------- satélite (NASA GIBS, IMERG: lluvia estimada por satélite cada 30 min) ----------
  function horaSat(atrasoMin) {
    var t = new Date(Date.now() - atrasoMin * 60000);
    t.setUTCMinutes(t.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
    return t;
  }
  function urlSat(t) {
    var iso = t.toISOString().slice(0, 19) + "Z";
    return "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate/default/" + iso + "/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png";
  }
  function ponerSatelite(intento) {
    intento = intento || 0;
    if (capaSat) { mapa.removeLayer(capaSat); capaSat = null; }
    if (intento > 8) { satInfo = { error: true }; leyenda(); return; }
    var t = horaSat(240 + intento * 60);  // IMERG temprano llega con unas 4 horas de retraso
    var ok = 0, mal = 0, decidido = false;
    capaSat = L.tileLayer(urlSat(t), { pane: "zonas", opacity: 0.8, maxNativeZoom: 6, maxZoom: 12, className: "capa-satelite",
      attribution: 'Lluvia satelital: <a href="https://gpm.nasa.gov/data/imerg">NASA GPM IMERG</a> vía GIBS' });
    capaSat.on("tileload", function () { ok++; if (!decidido && ok >= 2) { decidido = true; satInfo = { hora: t }; leyenda(); } });
    capaSat.on("tileerror", function () {
      mal++;
      if (!decidido && mal >= 3 && ok === 0) { decidido = true; ponerSatelite(intento + 1); }  // probar una hora antes
    });
    satInfo = { cargando: true }; leyenda();
    capaSat.addTo(mapa);
  }

  // ---------- leyenda y selector ----------
  function leyenda() {
    var el = document.getElementById("leyenda");
    if (!el || modo === "riesgo") return false;
    var h;
    if (modo === "satelite") {
      h = '<div class="leyenda-titulo">Lluvia por satélite</div>';
      if (!satInfo || satInfo.cargando) h += '<div class="leyenda-nota">Buscando la imagen más reciente…</div>';
      else if (satInfo.error) h += '<div class="leyenda-nota">La imagen satelital no está disponible ahora. Prueba más tarde.</div>';
      else h += '<div class="leyenda-nota">Imagen de las ' + satInfo.hora.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }) +
        ' (hora de Lima). Llega con unas 4 horas de retraso.</div><div class="leyenda-nota">Colores de NASA: más intenso = más lluvia por hora.</div>';
    } else {
      var e = ESCALAS[modo];
      h = '<div class="leyenda-titulo">' + e.titulo + "</div>" + e.cortes.map(function (c, i) {
        var hasta = e.cortes[i + 1];
        return '<div class="leyenda-fila"><span class="caja-ll" style="background:var(' + COLORES[i] + ')"></span>' + (hasta ? c + "–" + hasta : "más de " + c) + "</div>";
      }).join("") + '<div class="leyenda-nota">Sin color: menos de ' + e.cortes[0] + " mm.</div>";
      if (modo === "hoy") h += '<div class="leyenda-nota">Lo que ya cayó más lo que falta hoy.</div>';
    }
    el.innerHTML = h;
    return true;
  }
  function pintarSelector() {
    var el = document.getElementById("capas");
    el.innerHTML = MODOS.map(function (m) {
      return '<button type="button" class="capa-op' + (m.id === modo ? " activo" : "") + '" data-modo="' + m.id + '" aria-pressed="' + (m.id === modo) + '">' + esc(m.nombre) + "</button>";
    }).join("");
  }
  function cambiar(nuevo, guardar) {
    if (!MODOS.some(function (m) { return m.id === nuevo; })) nuevo = "riesgo";
    modo = nuevo;
    if (guardar) { try { localStorage.setItem(CLAVE, modo); } catch (e) {} }
    pintarSelector();
    if (modo === "satelite") ponerSatelite(0); else if (capaSat) { mapa.removeLayer(capaSat); capaSat = null; }
    pintarZonas();
    if (opts.alCambiar) opts.alCambiar(modo);
  }

  function iniciar(o) {
    opts = o; mapa = o.mapa;
    mapa.createPane("zonas").style.zIndex = 420;
    mapa.getPane("zonas").style.pointerEvents = "none";
    var inicial = "riesgo";
    try { inicial = localStorage.getItem(CLAVE) || "riesgo"; } catch (e) {}
    document.getElementById("capas").addEventListener("click", function (e) {
      var b = e.target.closest("[data-modo]");
      if (b && b.dataset.modo !== modo) cambiar(b.dataset.modo, true);
    });
    fetch("data/zonas.json?v=" + encodeURIComponent(o.resumen().generado || "")).then(function (r) { return r.ok ? r.json() : null; }).then(function (gj) {
      if (gj && gj.features && gj.features.length) {
        zonasGeo = gj;
        capaZonas = L.geoJSON(gj, {
          pane: "zonas", style: estilo,
          onEachFeature: function (f, l) {
            l.bindTooltip(function () {
              var v = f.properties._v, u = modo === "hoy" ? " mm hoy" : " mm en 7 días";
              return "<b>" + esc(f.properties.nombre) + "</b> · " + (f.properties.tipo === "distrito" ? "distrito" : "provincia") +
                "<br>" + (v == null ? "sin dato" : v.toFixed(1) + u);
            }, { sticky: true, direction: "top" });
            l.on("click", function () { if (opts.alSeleccionar) opts.alSeleccionar(f.properties); });
          },
        });
      }
      cambiar(inicial, false);
    }).catch(function () { cambiar(inicial === "satelite" ? "satelite" : "riesgo", false); });
  }

  window.Capas = { iniciar: iniciar, modo: function () { return modo; }, repintar: function () { pintarZonas(); leyenda(); }, leyenda: leyenda };
})();
