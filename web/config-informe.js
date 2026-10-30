/* Configuración de "Mi informe": qué quiere ver la persona y sus lugares.
 * Se guarda en este navegador (localStorage) y se puede compartir con un enlace (informe.html#config=...).
 * La usan la página del mapa (para configurarla) y la del informe (para armarlo).
 */
(function () {
  "use strict";

  var CLAVE = "vigia-informe";
  var MAX_LUGARES = 20;
  // Límites aproximados del Perú (con un margen): los lugares fuera de aquí no tienen normales de referencia
  var PERU = { latMin: -18.6, latMax: 0.2, lonMin: -81.6, lonMax: -68.4 };

  var INTERESES = [
    { id: "lluvia", nombre: "Lluvia", detalle: "Cuánto, cuándo (día o noche) y si es fuera de lo normal", fijo: true },
    { id: "viento", nombre: "Viento y ráfagas", detalle: "Velocidad, ráfagas y dirección" },
    { id: "temperatura", nombre: "Temperatura", detalle: "Máximas y mínimas frente a lo normal" },
    { id: "personal", nombre: "Calor y sol para el personal", detalle: "Sensación térmica e índice UV para turnos y pausas" },
    { id: "cultivo", nombre: "Mi cultivo", detalle: "Riego, hongos y ventanas para aplicar (elige el cultivo en el mapa)" },
  ];

  function vacia() {
    return { v: 1, intereses: { lluvia: true, viento: true, temperatura: true, personal: false, cultivo: false }, lugares: [] };
  }
  function normalizar(c) {
    if (!c || typeof c !== "object") return null;
    var out = vacia();
    if (c.intereses) INTERESES.forEach(function (i) { if (i.id in c.intereses) out.intereses[i.id] = !!c.intereses[i.id]; });
    out.intereses.lluvia = true;
    (Array.isArray(c.lugares) ? c.lugares : []).slice(0, MAX_LUGARES).forEach(function (l) {
      var lat = +l.lat, lon = +l.lon;
      if (!isFinite(lat) || !isFinite(lon) || !l.nombre) return;
      out.lugares.push({ id: String(l.id || nuevoId()), nombre: String(l.nombre).slice(0, 60), grupo: String(l.grupo || "").slice(0, 60),
        lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
    });
    return out;
  }
  function leer() { try { return normalizar(JSON.parse(localStorage.getItem(CLAVE) || "null")); } catch (e) { return null; } }
  function guardar(c) { try { localStorage.setItem(CLAVE, JSON.stringify(normalizar(c))); return true; } catch (e) { return false; } }
  function nuevoId() { return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Enlace para compartir: JSON → UTF-8 → base64url
  function codificar(c) {
    var json = JSON.stringify(normalizar(c));
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodificar(s) {
    try {
      var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return normalizar(JSON.parse(decodeURIComponent(escape(atob(b64)))));
    } catch (e) { return null; }
  }
  function enlace(c) {
    var base = location.href.replace(/[#?].*$/, "").replace(/[^/]*$/, "");
    return base + "informe.html#config=" + codificar(c);
  }

  /** Interpreta coordenadas escritas a mano: "-4.9273, -80.3443", "-4.9273 -80.3443",
   *  "4°55'38\"S 80°20'39\"W" o "4 55 38 S, 80 20 39 O". Devuelve {lat, lon} o null. */
  function leerCoordenadas(texto) {
    var t = String(texto || "").trim().replace(/[′’']/g, "'").replace(/[″”"]/g, '"').replace(/,(\d)/g, function (m, d, i, s) {
      // coma decimal ("-4,92") solo si no hay punto en el texto
      return s.indexOf(".") >= 0 ? m : "." + d;
    });
    var dms = /(\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'?\s*)?(?:(\d+(?:\.\d+)?)\s*"?\s*)?([NSEWOnsewo])/g, m, partes = [];
    while ((m = dms.exec(t))) {
      var v = +m[1] + (m[2] ? +m[2] / 60 : 0) + (m[3] ? +m[3] / 3600 : 0);
      var h = m[4].toUpperCase();
      partes.push({ v: (h === "S" || h === "W" || h === "O") ? -v : v, eje: (h === "N" || h === "S") ? "lat" : "lon" });
    }
    if (partes.length === 2 && partes[0].eje !== partes[1].eje) {
      var r = {}; partes.forEach(function (p) { r[p.eje] = p.v; }); return valida(r.lat, r.lon);
    }
    var nums = t.match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length === 2) {
      var a = +nums[0], b = +nums[1];
      // En Perú la latitud va de 0 a -18 y la longitud de -68 a -82: si vienen al revés, se corrigen
      if (Math.abs(a) > 20 && Math.abs(b) <= 20) { var x = a; a = b; b = x; }
      if (a > 0 && a <= 18.6 && t.indexOf("-") < 0) { a = -a; b = -Math.abs(b); }  // "4.92 80.34" sin signos
      return valida(a, b);
    }
    return null;
  }
  function valida(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }
  function enPeru(lat, lon) { return lat >= PERU.latMin && lat <= PERU.latMax && lon >= PERU.lonMin && lon <= PERU.lonMax; }
  function km(a, b) {
    var r = Math.PI / 180, la1 = a.lat * r, la2 = b.lat * r;
    var h = Math.pow(Math.sin((la2 - la1) / 2), 2) + Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((b.lon - a.lon) * r / 2), 2);
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  function grupos(c) {
    var g = [];
    (c ? c.lugares : []).forEach(function (l) { if (l.grupo && g.indexOf(l.grupo) < 0) g.push(l.grupo); });
    return g;
  }

  window.ConfigInforme = {
    INTERESES: INTERESES, MAX_LUGARES: MAX_LUGARES,
    vacia: vacia, leer: leer, guardar: guardar, nuevoId: nuevoId, normalizar: normalizar,
    codificar: codificar, decodificar: decodificar, enlace: enlace,
    leerCoordenadas: leerCoordenadas, enPeru: enPeru, km: km, grupos: grupos,
  };
})();
