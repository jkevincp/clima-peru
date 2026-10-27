/* "Hoy" en vivo: la página consulta Open-Meteo directamente desde el navegador de quien la mira
 * (cada 30 minutos mientras está visible), sin depender de las corridas programadas de GitHub.
 * Si la consulta falla, se sigue usando el "Hoy" publicado por la última corrida.
 * Misma lógica que herramientas/hoy.py.
 */
(function () {
  "use strict";

  var URL = "https://api.open-meteo.com/v1/forecast";
  var INTERVALO = 30 * 60000;  // con ~250 lugares, cada consulta cuenta como ~250 en el cupo gratuito de quien mira
  var MIN_MM = 0.1;
  var NIEVE = [71, 73, 75, 77, 85, 86];
  var CODIGOS = {
    0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado", 45: "Neblina", 48: "Neblina",
    51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna intensa", 56: "Llovizna", 57: "Llovizna",
    61: "Lluvia ligera", 63: "Lluvia moderada", 65: "Lluvia fuerte", 66: "Lluvia", 67: "Lluvia fuerte",
    71: "Nevada ligera", 73: "Nevada", 75: "Nevada fuerte", 77: "Granizo menudo",
    80: "Chubascos ligeros", 81: "Chubascos", 82: "Chubascos fuertes", 85: "Nevada", 86: "Nevada fuerte",
    95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo",
  };
  var datos = {}, consultado = null, puntos = [], alActualizar = function () {}, temporizador = null;

  function intensidad(mm) { return mm < 0.5 ? "muy ligera" : mm < 2.5 ? "ligera" : mm < 7.6 ? "moderada" : "fuerte"; }
  function rango(idx) {  // el valor de las 15:00 es lo caído entre 14:00 y 15:00
    var ini = Math.max(idx[0] - 1, 0), fin = idx[idx.length - 1];
    return fin - ini > 1 ? "entre las " + ini + ":00 y las " + fin + ":00" : "cerca de las " + fin + ":00";
  }
  function f1(v) { return v.toFixed(1); }

  function resumir(r) {
    var cur = r.current || {}, h = r.hourly || {};
    if (!cur.time || !h.time) return null;
    var dia = cur.time.slice(0, 10), horaActual = +cur.time.slice(11, 13);
    var ayerD = new Date(dia + "T12:00:00"); ayerD.setDate(ayerD.getDate() - 1);
    var ayer = ayerD.getFullYear() + "-" + String(ayerD.getMonth() + 1).padStart(2, "0") + "-" + String(ayerD.getDate()).padStart(2, "0");
    var horas = new Array(24).fill(0), codigos = new Array(24).fill(0), sumAyer = 0, ult3 = 0;
    var tAhora = new Date(cur.time.slice(0, 13) + ":00:00").getTime();
    for (var i = 0; i < h.time.length; i++) {
      var t = h.time[i], p = +(h.precipitation[i] || 0);
      if (t.slice(0, 10) === dia) { horas[+t.slice(11, 13)] = p; codigos[+t.slice(11, 13)] = +(h.weather_code ? h.weather_code[i] || 0 : 0); }
      else if (t.slice(0, 10) === ayer) sumAyer += p;
      var dt = tAhora - new Date(t + ":00").getTime();
      if (dt >= 0 && dt <= 2 * 3600000) ult3 += p;
    }
    var pasado = horas.slice(0, horaActual + 1), futuro = horas.slice(horaActual + 1);
    var hasta = pasado.reduce(function (a, b) { return a + b; }, 0), resto = futuro.reduce(function (a, b) { return a + b; }, 0);
    var codigo = +(cur.weather_code || 0), mmAhora = +(cur.precipitation || 0);
    var lloviendo = mmAhora >= MIN_MM || (codigo >= 51 && NIEVE.indexOf(codigo) < 0 && ult3 >= MIN_MM);
    var desc = CODIGOS[codigo] || "", partes = [], estado;
    var idxPasado = pasado.map(function (v, k) { return v >= MIN_MM ? k : -1; }).filter(function (k) { return k >= 0; });
    var idxFuturo = futuro.map(function (v, k) { return v >= MIN_MM ? k + horaActual + 1 : -1; }).filter(function (k) { return k >= 0; });
    if (lloviendo) { estado = "lloviendo"; partes.push((desc || "Lluvia") + " en este momento."); }
    else if (hasta >= MIN_MM) { estado = "llovio"; partes.push("Llovió hoy " + rango(idxPasado) + "."); }
    else if (resto >= MIN_MM) estado = "llovera";
    else estado = "seco";
    if (hasta >= MIN_MM) partes.push("Van " + f1(hasta) + " mm, lluvia " + intensidad(Math.max.apply(null, pasado)) + ".");
    if (resto >= MIN_MM) {
      partes.push((estado !== "llovera" ? "Se esperan" : "Se espera lluvia " + intensidad(Math.max.apply(null, futuro)) + ":") + " " +
        f1(resto) + " mm " + (hasta >= MIN_MM ? "más " : "") + rango(idxFuturo) + ".");
    } else if (estado === "lloviendo" || estado === "llovio") partes.push("No se espera más lluvia hoy.");
    if (estado === "seco") partes.push("Sin lluvia hoy." + (sumAyer >= MIN_MM ? " Ayer cayeron " + f1(sumAyer) + " mm." : ""));
    return {
      consultado: cur.time, fecha: dia, hora_actual: horaActual, estado: estado, descripcion: desc, texto: partes.join(" "),
      hasta_ahora_mm: +f1(hasta), resto_mm: +f1(resto), ayer_mm: +f1(sumAyer), temperatura: cur.temperature_2m,
      horas: horas.map(function (v) { return Math.round(v * 100) / 100; }), codigos: codigos, vivo: true,
    };
  }

  function consultar() {
    if (document.hidden || !puntos.length) return;
    var lotes = [];
    for (var i = 0; i < puntos.length; i += 100) lotes.push(puntos.slice(i, i + 100));
    Promise.all(lotes.map(function (lote) {
      var q = "?latitude=" + lote.map(function (p) { return p.lat; }).join(",") + "&longitude=" + lote.map(function (p) { return p.lon; }).join(",") +
        "&current=precipitation,weather_code,temperature_2m&hourly=precipitation,weather_code&past_days=1&forecast_days=2&timezone=America%2FLima";
      return fetch(URL + q).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (js) {
        (Array.isArray(js) ? js : [js]).forEach(function (r, k) { var s = resumir(r); if (s && lote[k]) datos[lote[k].id] = s; });
      });
    })).then(function () { consultado = new Date(); alActualizar(); })
      .catch(function () { /* sin conexión o límite de uso: queda el "Hoy" publicado */ });
  }

  window.Vivo = {
    iniciar: function (opts) {
      puntos = opts.puntos || []; alActualizar = opts.alActualizar || alActualizar;
      consultar();
      clearInterval(temporizador); temporizador = setInterval(consultar, INTERVALO);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && (!consultado || Date.now() - consultado > INTERVALO)) consultar();
      });
    },
    de: function (id) { return datos[id] || null; },
    consultado: function () { return consultado; },
    _resumir: resumir,
  };
})();
