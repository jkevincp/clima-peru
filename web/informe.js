/* Mi informe: pronóstico de 7 días para los lugares que eligió la persona.
 * - Se arma en el navegador con Open-Meteo: ECMWF 9 km (cifra principal), GFS y GEM (acuerdo entre modelos).
 * - Días de 7 a. m. a 7 a. m. (como SENAMHI), con bloques Día (7 a. m.–7 p. m.) y Noche (7 p. m.–7 a. m.).
 * - Lo normal (1991–2020) sale del lugar vigilado más cercano de la red (data/puntos/<id>.json → clima).
 * - "Vs. pronóstico anterior": API de pronósticos anteriores de Open-Meteo (o, si falla, la consulta anterior guardada).
 */
(function () {
  "use strict";

  var C = window.ConfigInforme;
  var URL_PRON = "https://api.open-meteo.com/v1/forecast";
  var URL_PREVIO = "https://previous-runs-api.open-meteo.com/v1/forecast";
  var MODELOS = [{ id: "ecmwf_ifs", nombre: "ECMWF 9 km" }, { id: "gfs_seamless", nombre: "GFS" }, { id: "gem_seamless", nombre: "GEM" }];
  var HORARIAS = ["precipitation", "temperature_2m", "apparent_temperature", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "uv_index"];
  var CLAVE_ANTERIOR = "vigia-informe-anterior";
  var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var DIAS_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MESES_C = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var LLUVIA = ["Sin lluvia", "Ligera", "Moderada", "Fuerte", "Muy fuerte"];
  var UMBRAL_FIJO = { t1: 5, t2: 10, t3: 20 };  // si no hay normales: mismos pisos que el mapa
  var raiz = document.getElementById("informe");
  var compartida = false, cfg = null;

  // ---------- formato ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function f1(v) { return v == null || isNaN(v) ? "—" : (+v).toFixed(1).replace(".", ","); }
  function f0(v) { return v == null || isNaN(v) ? "—" : String(Math.round(v)); }
  function signo(v) { return (v > 0 ? "+" : v < 0 ? "−" : "±") + f1(Math.abs(v)); }
  function fecha(d) { return new Date(d + "T12:00:00"); }
  function diaCorto(d) { var x = fecha(d); return DIAS[x.getDay()] + " " + x.getDate() + "/" + (x.getMonth() + 1); }
  function diaLargo(d) { var x = fecha(d); return DIAS_LARGO[x.getDay()] + " " + x.getDate() + " de " + MESES[x.getMonth()]; }
  function doy(d) { var x = fecha(d), ini = new Date(x.getFullYear(), 0, 0); return Math.floor((x - ini) / 86400000); }
  function sumarDias(d, n) { var x = fecha(d); x.setDate(x.getDate() + n); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); }
  function horaLima(t) { return t.toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" }); }
  function rumbo(g) {
    var n = ["norte", "norte-noreste", "noreste", "este-noreste", "este", "este-sureste", "sureste", "sur-sureste", "sur", "sur-suroeste", "suroeste", "oeste-suroeste", "oeste", "oeste-noroeste", "noroeste", "norte-noroeste"];
    return n[Math.round(((g % 360) + 360) % 360 / 22.5) % 16];
  }

  // ---------- escalas ----------
  function catLluvia(mm, u) {
    if (mm == null || isNaN(mm)) return null;
    u = u || UMBRAL_FIJO;
    return mm < 0.2 ? 0 : mm < u.t1 ? 1 : mm < u.t2 ? 2 : mm < u.t3 ? 3 : 4;
  }
  function pillLluvia(c) { return c == null ? "" : '<span class="pill ll-' + c + '">' + LLUVIA[c] + "</span>"; }
  // Viento: escala fija por ráfagas (km/h), igual en todas partes (Beaufort aproximado)
  function catViento(g) { return g == null ? null : g < 40 ? 0 : g < 50 ? 1 : g < 62 ? 2 : g < 75 ? 3 : 4; }
  var VIENTO = ["Normal", "Moderado", "Fuerte", "Muy fuerte", "Peligroso"];
  function pillViento(c) { return c == null ? "" : '<span class="pill vt-' + c + '">' + VIENTO[c] + "</span>"; }
  // Sensación térmica (escala del índice de calor del NWS) e índice UV (OMS)
  function catCalor(t) { return t == null ? null : t < 27 ? 0 : t < 32 ? 1 : t < 41 ? 2 : t < 54 ? 3 : 4; }
  var CALOR = ["Sin riesgo", "Precaución", "Precaución extrema", "Peligro", "Peligro extremo"];
  function catUV(u) { return u == null ? null : u < 3 ? 0 : u < 6 ? 1 : u < 8 ? 2 : u < 11 ? 3 : 4; }
  var UV = ["Bajo", "Moderado", "Alto", "Muy alto", "Extremo"];

  // ---------- datos ----------
  function pedir(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  function lista(js) { return Array.isArray(js) ? js : [js]; }
  function coords(lugares) {
    return "latitude=" + lugares.map(function (l) { return l.lat; }).join(",") + "&longitude=" + lugares.map(function (l) { return l.lon; }).join(",");
  }
  function pronostico(lugares) {
    return pedir(URL_PRON + "?" + coords(lugares) + "&hourly=" + HORARIAS.join(",") + "&daily=et0_fao_evapotranspiration" +
      "&models=" + MODELOS.map(function (m) { return m.id; }).join(",") + "&forecast_days=8&timezone=America%2FLima").then(lista);
  }
  function previo(lugares) {
    return pedir(URL_PREVIO + "?" + coords(lugares) + "&hourly=precipitation_previous_day1&models=ecmwf_ifs&forecast_days=8&timezone=America%2FLima").then(lista);
  }
  function red() { return pedir("data/resumen.json?t=" + Date.now()).catch(function () { return null; }); }
  var cacheClima = {};
  function climaDe(id) {
    if (!cacheClima[id]) cacheClima[id] = pedir("data/puntos/" + encodeURIComponent(id) + ".json").then(function (d) { return d.clima ? d : null; }).catch(function () { return null; });
    return cacheClima[id];
  }
  function referencia(l, resumen) {
    if (!resumen || !C.enPeru(l.lat, l.lon)) return Promise.resolve(null);
    var cand = resumen.puntos.filter(function (p) { return p.nivel != null; })
      .map(function (p) { return { p: p, km: C.km(l, p) }; }).filter(function (x) { return x.km <= 60; })
      .sort(function (a, b) { return a.km - b.km; });
    if (!cand.length) return Promise.resolve(null);
    return climaDe(cand[0].p.id).then(function (d) { return d ? { nombre: d.nombre, km: cand[0].km, clima: d.clima } : null; });
  }

  // ---------- cálculo por lugar ----------
  function serie(r, v, m) { var h = r.hourly || {}; return h[v + "_" + m] || (MODELOS.length === 1 ? h[v] : null) || null; }
  function suma(a, i, j) { if (!a) return null; var s = 0, n = 0; for (var k = i; k <= j && k < a.length; k++) if (a[k] != null) { s += a[k]; n++; } return n ? s : null; }
  function maxi(a, i, j) { if (!a) return null; var m = null; for (var k = i; k <= j && k < a.length; k++) if (a[k] != null && (m == null || a[k] > m)) m = a[k]; return m; }
  function mini(a, i, j) { if (!a) return null; var m = null; for (var k = i; k <= j && k < a.length; k++) if (a[k] != null && (m == null || a[k] < m)) m = a[k]; return m; }
  function media(vals) { var v = vals.filter(function (x) { return x != null && !isNaN(x); }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function primero(r, v) { for (var i = 0; i < MODELOS.length; i++) { var s = serie(r, v, MODELOS[i].id); if (s && s.some(function (x) { return x != null; })) return s; } return null; }

  function calcular(l, r, prev, ref, anterior) {
    var t = r.hourly.time, idx = {};
    t.forEach(function (x, i) { idx[x] = i; });
    var hoy = t[0].slice(0, 10), clima = ref && ref.clima;
    var pp = {}; MODELOS.forEach(function (m) { pp[m.id] = serie(r, "precipitation", m.id); });
    var principal = pp[MODELOS[0].id] && pp[MODELOS[0].id].some(function (x) { return x != null; }) ? MODELOS[0].id : null;
    var temp = primero(r, "temperature_2m"), apar = primero(r, "apparent_temperature"), uv = primero(r, "uv_index"), hr = primero(r, "relative_humidity_2m");
    var vel = MODELOS.map(function (m) { return serie(r, "wind_speed_10m", m.id); }), raf = MODELOS.map(function (m) { return serie(r, "wind_gusts_10m", m.id); });
    var dir = primero(r, "wind_direction_10m");
    var pPrev = prev && prev.hourly ? (prev.hourly.precipitation_previous_day1 || prev.hourly.precipitation_previous_day1_ecmwf_ifs) : null;

    var dias = [];
    for (var n = 0; n < 7; n++) {
      var D = sumarDias(hoy, n), i0 = idx[D + "T00:00"];
      if (i0 == null || i0 + 31 >= t.length) break;
      var u = clima ? { t1: clima.t1[doy(D) - 1], t2: clima.t2[doy(D) - 1], t3: clima.t3[doy(D) - 1] } : UMBRAL_FIJO;
      // la lluvia de la hora h es la caída entre h-1 y h: el día de 7 a 7 suma de las 8:00 a las 7:00 del día siguiente
      var bloques = { dia: [i0 + 8, i0 + 19], noche: [i0 + 20, i0 + 31] };
      var porModelo = {};
      MODELOS.forEach(function (m) {
        var s = pp[m.id];
        porModelo[m.id] = { dia: suma(s, i0 + 8, i0 + 19), noche: suma(s, i0 + 20, i0 + 31) };
        porModelo[m.id].total = porModelo[m.id].dia == null && porModelo[m.id].noche == null ? null : (porModelo[m.id].dia || 0) + (porModelo[m.id].noche || 0);
      });
      var base = principal ? porModelo[principal] : {
        dia: media(MODELOS.map(function (m) { return porModelo[m.id].dia; })),
        noche: media(MODELOS.map(function (m) { return porModelo[m.id].noche; })),
      };
      var total = base.total != null ? base.total : (base.dia || 0) + (base.noche || 0);
      var cat = catLluvia(total, u);
      // acuerdo: cuántos modelos ven lluvia moderada o más ese día
      var disp = MODELOS.filter(function (m) { return porModelo[m.id].total != null; });
      var ven = disp.filter(function (m) { return catLluvia(porModelo[m.id].total, u) >= 2; });
      // vs. pronóstico anterior
      var antes = null, fuenteAntes = null;
      if (pPrev) { antes = suma(pPrev, i0 + 8, i0 + 31); fuenteAntes = "ayer"; }
      if ((antes == null) && anterior && anterior.lugares[l.id] && anterior.lugares[l.id][D] != null) { antes = anterior.lugares[l.id][D]; fuenteAntes = "consulta"; }
      // percentil del mes (solo se muestra desde "moderada")
      var rango = null;
      if (clima && cat >= 2 && clima.rango) {
        var q = clima.rango[String(fecha(D).getMonth() + 1)];
        if (q) clima.rango_niveles.forEach(function (lv, k) { if (total > q[k]) rango = lv; });
      }
      var gustM = raf.map(function (s) { return maxi(s, i0 + 7, i0 + 31); });
      var velB = function (a, b) { return media(vel.map(function (s) { return s ? media(s.slice(a, b + 1)) : null; })); };
      var gustB = function (a, b) { return media(raf.map(function (s) { return maxi(s, a, b); })); };
      // dirección dominante: promedio vectorial ponderado por velocidad
      var sx = 0, sy = 0, vv = vel[0] || vel[1] || vel[2];
      if (dir) for (var k = i0 + 7; k <= i0 + 31; k++) if (dir[k] != null) { var w = vv && vv[k] != null ? vv[k] : 1; sx += w * Math.sin(dir[k] * Math.PI / 180); sy += w * Math.cos(dir[k] * Math.PI / 180); }
      var tmax = maxi(temp, i0 + 7, i0 + 31), tmin = mini(temp, i0 + 7, i0 + 31);
      dias.push({
        fecha: D, plazo: n, u: u, cat: cat, total: total, dia: base.dia, noche: base.noche,
        catDia: catLluvia(base.dia, u), catNoche: catLluvia(base.noche, u),
        porModelo: porModelo, n: disp.length, ven: ven.map(function (m) { return m.nombre; }),
        antes: antes, fuenteAntes: fuenteAntes, rango: rango,
        tmax: tmax, tmin: tmin,
        anomMax: clima && tmax != null ? tmax - clima.tx[doy(D) - 1] : null, anomMin: clima && tmin != null ? tmin - clima.tn[doy(D) - 1] : null,
        viento: velB(i0 + 7, i0 + 31), rafaga: media(gustM), dir: dir && (sx || sy) ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null,
        vDia: { v: velB(i0 + 7, i0 + 19), g: gustB(i0 + 7, i0 + 19) }, vNoche: { v: velB(i0 + 19, i0 + 31), g: gustB(i0 + 19, i0 + 31) },
        sensacion: maxi(apar, i0 + 7, i0 + 31), uv: maxi(uv, i0 + 7, i0 + 31),
      });
    }
    // datos hora a hora para "Mi cultivo" (campo.js): ECMWF, desde las 0:00 de hoy
    var et0 = {}, dd = r.daily || {}, e = dd["et0_fao_evapotranspiration_" + MODELOS[0].id] || dd.et0_fao_evapotranspiration;
    if (dd.time && e) dd.time.forEach(function (f, i) { if (e[i] != null) et0[f] = e[i]; });
    var campo = temp && hr ? { horario: { inicio: t[0], t: temp, hr: hr, v: vel[0] || vel[1], p: pp[principal] || pp.gfs_seamless }, et0: et0 } : null;
    return { lugar: l, dias: dias, ref: ref, principal: principal, campo: campo, serieP: pp[principal] };
  }

  // ---------- HTML ----------
  var ICONOS = {
    sol: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4M7.2 7.2l2.8 2.8M22 22l2.8 2.8M7.2 24.8 10 22M22 10l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    nube: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9.5 20.5h13a5 5 0 0 0 .4-10 7 7 0 0 0-13.3 2A4 4 0 0 0 9.5 20.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13 24.5l-.8 2M18 24.5l-.8 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    lluvia: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9.5 18.5h13a5 5 0 0 0 .4-10 7 7 0 0 0-13.3 2A4 4 0 0 0 9.5 18.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 22l-1.2 3M16 22l-1.2 3M21 22l-1.2 3M13.5 26l-.8 2M18.5 26l-.8 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  function icono(c) { return c == null || c === 0 ? ICONOS.sol : c === 1 ? ICONOS.nube : ICONOS.lluvia; }
  function certeza(d) {
    if (d.cat < 2) return d.ven.length ? '<span class="certeza-txt">Solo ' + esc(d.ven.join(" y ")) + " ve" + (d.ven.length > 1 ? "n" : "") + " lluvia moderada o más</span>" : "";
    var n = d.ven.length, t = n >= d.n ? "Alta" : n >= 2 ? "Media" : "Baja";
    var txt = n >= d.n ? "Los " + d.n + " modelos coinciden" : n >= 2 ? n + " de " + d.n + " modelos la ven" : "Solo " + d.ven[0] + " la ve";
    if (d.plazo >= 5 && t === "Alta") t = "Media";
    return '<span class="certeza certeza-' + t.toLowerCase() + '">Certeza ' + t.toLowerCase() + '</span> <span class="certeza-txt">' + txt + "</span>";
  }
  function cambio(d) {
    if (d.antes == null) return d.plazo >= 6 ? '<span class="cambio">Sin pronóstico anterior para este día</span>' : "";
    var dif = d.total - d.antes, quien = d.fuenteAntes === "ayer" ? "Vs. pronóstico de ayer" : "Vs. tu consulta anterior";
    if (Math.abs(dif) < 0.5) return '<span class="cambio">' + quien + ": sin cambios (" + f1(d.antes) + " mm)</span>";
    return '<span class="cambio">' + quien + ': <b class="' + (dif > 0 ? "sube" : "baja") + '">' + (dif > 0 ? "+" : "−") + f1(Math.abs(dif)) + " mm</b> (antes " + f1(d.antes) + " mm)</span>";
  }

  function tarjeta(d, I) {
    return '<div class="tarjeta"><span class="tarjeta-dia">' + DIAS[fecha(d.fecha).getDay()] + '<small>' + fecha(d.fecha).getDate() + "/" + (fecha(d.fecha).getMonth() + 1) + "</small></span>" +
      '<span class="tarjeta-icono ll-ic-' + (d.cat || 0) + '">' + icono(d.cat) + "</span>" +
      (I.temperatura ? '<span class="tarjeta-temp"><b>' + f0(d.tmax) + "°</b> " + f0(d.tmin) + "°</span>" : "") +
      '<span class="tarjeta-mm num">' + f1(d.total) + " mm</span>" + pillLluvia(d.cat) +
      (I.viento ? '<span class="tarjeta-viento">' + pillViento(catViento(d.rafaga)) + "<small>ráfagas " + f0(d.rafaga) + " km/h" + (d.dir != null ? " del " + rumbo(d.dir) : "") + "</small></span>" : "") +
      "</div>";
  }
  function filaDia(d, I, mes) {
    var h = '<tr><th scope="row" class="col-dia">' + diaCorto(d.fecha) + "</th>";
    if (I.temperatura) {
      h += '<td class="col-temp"><span class="num">' + f1(d.tmax) + " / " + f1(d.tmin) + " °C</span>" +
        (d.anomMax != null ? '<span class="anom ' + (d.anomMax > 0 ? "sube" : "baja") + '">' + signo(d.anomMax) + " / " + signo(d.anomMin) + " °C vs. lo normal</span>" : "") + "</td>";
    }
    h += '<td class="col-lluvia"><div class="lluvia-total"><b class="num">' + f1(d.total) + " mm</b> " + pillLluvia(d.cat) + "</div>" +
      (d.rango ? '<span class="rango">Más que el ' + String(d.rango).replace(".", ",") + " % de los días de " + MESES[fecha(d.fecha).getMonth()] + " (" + esc(mes) + ")</span>" : "") +
      '<div class="bloques"><div class="bloque-fila"><span class="bloque bl-dia">Día · 7 a. m.–7 p. m.</span><b class="num">' + f1(d.dia) + " mm</b>" + (d.catDia >= 2 ? pillLluvia(d.catDia) : "") + "</div>" +
      '<div class="bloque-fila"><span class="bloque bl-noche">Noche · 7 p. m.–7 a. m.</span><b class="num">' + f1(d.noche) + " mm</b>" + (d.catNoche >= 2 ? pillLluvia(d.catNoche) : "") + "</div></div>" +
      cambio(d) + '<div class="certeza-fila">' + certeza(d) + "</div></td>";
    if (I.viento) {
      h += '<td class="col-viento"><div>' + pillViento(catViento(d.rafaga)) + ' <span class="num">ráfagas ' + f0(d.rafaga) + " km/h</span></div>" +
        '<span class="nota-tabla">Promedio ' + f0(d.viento) + " km/h" + (d.dir != null ? " del " + rumbo(d.dir) : "") + "</span>" +
        '<span class="nota-tabla">Día: ráfagas ' + f0(d.vDia.g) + " · Noche: " + f0(d.vNoche.g) + " km/h</span></td>";
    }
    if (I.personal) {
      var cc = catCalor(d.sensacion), cu = catUV(d.uv);
      h += '<td class="col-personal"><span class="num">Sensación ' + f1(d.sensacion) + " °C</span> " + (cc != null ? '<span class="pill ca-' + cc + '">' + CALOR[cc] + "</span>" : "") +
        '<span class="num">UV ' + f1(d.uv) + "</span> " + (cu != null ? '<span class="pill uv-' + cu + '">' + UV[cu] + "</span>" : "") + "</td>";
    }
    return h + "</tr>";
  }
  function tablaModelos(R) {
    var h = '<details class="modelos"><summary>Ver la lluvia según los ' + MODELOS.length + " modelos (bloques de 12 horas)</summary>" +
      '<p class="nota">Cada modelo en su celda más cercana: ECMWF de 9 km, GFS de unos 13 km y GEM de unos 15 km. La cifra principal del informe es la de ECMWF 9 km; los otros dos sirven para medir la certeza.</p>' +
      '<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Día</th><th>Bloque</th>' + MODELOS.map(function (m) { return '<th class="num">' + m.nombre + "</th>"; }).join("") + '<th class="num">Promedio</th></tr></thead><tbody>';
    R.dias.forEach(function (d) {
      ["dia", "noche"].forEach(function (b, k) {
        var vals = MODELOS.map(function (m) { return d.porModelo[m.id][b]; });
        h += "<tr>" + (k === 0 ? '<th scope="rowgroup" rowspan="2">' + diaCorto(d.fecha) + "</th>" : "") +
          '<td><span class="bloque bl-' + b + '">' + (b === "dia" ? "Día" : "Noche") + "</span></td>" +
          vals.map(function (v) { return '<td class="num">' + f1(v) + "</td>"; }).join("") + '<td class="num"><b>' + f1(media(vals)) + "</b></td></tr>";
      });
    });
    return h + "</tbody></table></div></details>";
  }
  function seccionLugar(R, I, gemelos) {
    var l = R.lugar, ref = R.ref;
    var h = '<section class="inf-lugar" id="' + esc(l.id) + '"><header class="lugar-cabeza"><div><h2>' + esc(l.nombre) + "</h2>" +
      '<p class="sub">' + (l.grupo ? '<span class="pill grupo">' + esc(l.grupo) + "</span> " : "") +
      '<span class="num">' + l.lat.toFixed(4) + ", " + l.lon.toFixed(4) + "</span> · " +
      (ref ? "Lo normal sale de " + esc(ref.nombre) + ", a " + f0(ref.km) + " km (" + esc(ref.clima.base) + ")" :
        C.enPeru(l.lat, l.lon) ? "Sin datos de lo normal: el lugar vigilado más cercano está a más de 60 km o aún se está preparando" : "Fuera del Perú: sin comparación con lo normal") +
      "</p>" + (gemelos.length ? '<p class="nota">' + esc(gemelos.join(", ")) + " cae" + (gemelos.length > 1 ? "n" : "") + " en la misma celda del modelo de 9 km: su pronóstico es el mismo.</p>" : "") +
      "</div></header>";
    if (!R.dias.length) return h + '<p class="vacio">No llegó el pronóstico para este lugar.</p></section>';
    h += '<div class="tarjetas">' + R.dias.map(function (d) { return tarjeta(d, I); }).join("") + "</div>";
    h += '<div class="tabla-scroll"><table class="tabla tabla-dias"><thead><tr><th>Día</th>' + (I.temperatura ? "<th>Máx. / mín.</th>" : "") +
      "<th>Lluvia del día (7 a. m.–7 a. m.)</th>" + (I.viento ? "<th>Viento</th>" : "") + (I.personal ? "<th>Calor y sol</th>" : "") +
      "</tr></thead><tbody>" + R.dias.map(function (d) { return filaDia(d, I, ref ? ref.clima.base : ""); }).join("") + "</tbody></table></div>";
    if (I.cultivo && window.Campo && R.campo) {
      var c = window.Campo.seccion({ campo: R.campo });
      c = c.replace(/<button class="enlace" type="button" data-campo="abrir">Cambiar<\/button>/, '<a class="enlace" href="./#cultivo">Cambiar</a>')
        .replace(/<button class="boton" type="button" data-campo="abrir">Elegir mi cultivo<\/button>/, '<a class="boton" href="./#cultivo">Elegir mi cultivo en el mapa</a>');
      h += '<div class="cultivo-informe">' + c + "</div>";
    }
    return h + tablaModelos(R) + "</section>";
  }

  function nl(c) { return c == null ? "sin dato" : LLUVIA[c].toLowerCase(); }
  function frase(R, d) {
    return esc(R.lugar.nombre) + ", " + diaLargo(d.fecha) + ": lluvia " + nl(d.cat) + " (" + f1(d.total) + " mm), de día " +
      nl(d.catDia) + " (" + f1(d.dia) + " mm) y de noche " + nl(d.catNoche) + " (" + f1(d.noche) + " mm)";
  }
  function resumen(res, I, mar) {
    var porGrupo = {}, orden = [];
    res.forEach(function (R) { var g = R.lugar.grupo || "Mis lugares"; if (!porGrupo[g]) { porGrupo[g] = []; orden.push(g); } porGrupo[g].push(R); });
    var h = '<section class="resumen"><h2>Lo más importante de la semana</h2>';
    if (mar && mar.anom != null) {
      h += '<p class="contexto">Mar frente a la costa norte (Niño 1+2): <b>' + signo(mar.anom) + " °C</b> de anomalía" +
        (mar.icen ? ", condición " + esc(mar.icen.categoria.toLowerCase()) : "") + ". Con el mar cálido, las lluvias en la costa norte pueden ser más intensas que lo que muestran los modelos.</p>";
    }
    orden.forEach(function (g) {
      var Rs = porGrupo[g], filas = [];
      Rs.forEach(function (R) { R.dias.forEach(function (d) { if (d.cat >= 2 || d.catDia >= 2 || d.catNoche >= 2) filas.push({ R: R, d: d }); }); });
      var lugaresCon = {}, porDia = {};
      filas.forEach(function (f) { if (f.d.cat >= 2) { lugaresCon[f.R.lugar.id] = 1; porDia[f.d.fecha] = (porDia[f.d.fecha] || 0) + 1; } });
      var nCon = Object.keys(lugaresCon).length;
      h += '<div class="grupo"><h3>' + esc(g) + "</h3><p>";
      if (nCon) {
        var top = filas.slice().sort(function (a, b) { return b.d.total - a.d.total; })[0];
        h += "<b>" + nCon + " de " + Rs.length + "</b> " + (Rs.length === 1 ? "lugar tiene" : "lugares tienen") + " al menos un día con lluvia moderada o mayor: " +
          Object.keys(porDia).sort().map(function (f) { return "<b>" + diaCorto(f) + "</b> (" + porDia[f] + ")"; }).join(", ") +
          ". Lo más fuerte: <b>" + frase(top.R, top.d) + "</b>. " + certeza(top.d).replace(/<[^>]+>/g, "") + ".";
      } else {
        var max = null;
        Rs.forEach(function (R) { R.dias.forEach(function (d) { if (!max || d.total > max.d.total) max = { R: R, d: d }; }); });
        h += "Sin lluvia moderada o mayor en la semana." + (max && max.d.total >= 0.2 ? " Lo más alto: " + f1(max.d.total) + " mm en " + esc(max.R.lugar.nombre) + " el " + diaCorto(max.d.fecha) + "." : "");
      }
      h += "</p>";
      if (filas.length) {
        filas.sort(function (a, b) { return a.d.fecha < b.d.fecha ? -1 : a.d.fecha > b.d.fecha ? 1 : b.d.total - a.d.total; });
        h += '<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Fecha</th><th>Lugar</th><th>Día completo</th><th>Día · 7 a. m.–7 p. m.</th><th>Noche · 7 p. m.–7 a. m.</th><th>Certeza</th></tr></thead><tbody>';
        var ult = null;
        filas.forEach(function (f) {
          var d = f.d, nueva = d.fecha !== ult; ult = d.fecha;
          h += "<tr" + (nueva ? ' class="fecha-nueva"' : "") + "><th scope=\"row\">" + (nueva ? diaCorto(d.fecha) : "") + '</th><td><a href="#' + esc(f.R.lugar.id) + '">' + esc(f.R.lugar.nombre) + "</a></td>" +
            '<td><span class="num">' + f1(d.total) + " mm</span> " + pillLluvia(d.cat) + "</td>" +
            '<td' + (d.catDia >= 2 ? ' class="fuerte"' : "") + '><span class="num">' + f1(d.dia) + " mm</span> " + pillLluvia(d.catDia) + "</td>" +
            '<td' + (d.catNoche >= 2 ? ' class="fuerte"' : "") + '><span class="num">' + f1(d.noche) + " mm</span> " + pillLluvia(d.catNoche) + "</td>" +
            "<td>" + certeza(d) + "</td></tr>";
        });
        h += "</tbody></table></div>";
      }
      var sinMod = Rs.filter(function (R) { return !lugaresCon[R.lugar.id]; }).map(function (R) { return R.lugar.nombre; });
      if (nCon && sinMod.length) h += '<p class="nota">Sin lluvia moderada o mayor en la semana: ' + esc(sinMod.join(", ")) + ".</p>";
      // viento, temperatura y calor del grupo
      var extra = [];
      if (I.viento) {
        var v = [];
        Rs.forEach(function (R) { R.dias.forEach(function (d) { if (catViento(d.rafaga) >= 2) v.push(esc(R.lugar.nombre) + " " + diaCorto(d.fecha) + " (" + f0(d.rafaga) + " km/h)"); }); });
        extra.push(v.length ? "<b>Ráfagas fuertes (50 km/h o más):</b> " + v.slice(0, 8).join(", ") + (v.length > 8 ? " y " + (v.length - 8) + " más" : "") + "."
          : "<b>Viento:</b> sin ráfagas fuertes; todas bajo 50 km/h.");
      }
      if (I.temperatura) {
        var anom = [], tx = [];
        Rs.forEach(function (R) { R.dias.forEach(function (d) { if (d.anomMax != null) anom.push(d.anomMax); if (d.tmax != null) tx.push(d.tmax); }); });
        if (tx.length) extra.push("<b>Temperatura:</b> máximas de " + f0(Math.min.apply(null, tx)) + " a " + f0(Math.max.apply(null, tx)) + " °C" +
          (anom.length ? ", en promedio " + signo(media(anom)) + " °C frente a lo normal" : "") + ".");
      }
      if (I.personal) {
        var pel = 0, uvx = 0;
        Rs.forEach(function (R) { R.dias.forEach(function (d) { if (catCalor(d.sensacion) >= 2) pel++; if (catUV(d.uv) >= 3) uvx++; }); });
        extra.push("<b>Personal:</b> " + (pel ? pel + " días-lugar con sensación térmica de precaución extrema o más" : "sensación térmica sin niveles de riesgo alto") +
          (uvx ? "; UV muy alto o extremo en " + uvx + " días-lugar" : "") + "." +
          (pel || uvx ? " Programa pausas con sombra e hidratación entre las 11 y las 15 h, y protección solar (sombrero, manga larga, bloqueador)." : ""));
      }
      if (extra.length) h += '<ul class="extra">' + extra.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
      h += "</div>";
    });
    h += '<p class="nota">Niveles de lluvia según lo normal de cada lugar en esa época (percentiles 90, 95 y 99 de los días con lluvia, 1991–2020), con pisos de 5, 10 y 20 mm. Los bloques de Día y Noche usan los mismos umbrales. El viento usa una escala fija de ráfagas: moderado desde 40, fuerte desde 50, muy fuerte desde 62 y peligroso desde 75 km/h.</p></section>';
    return h;
  }

  // ---------- pantalla ----------
  function cabecera(desde, hasta, consultado) {
    var grupos = C.grupos(cfg);
    return '<header class="inf-cabeza"><div class="inf-marca"><svg class="marca-icono" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 20c4-5 8-5 12 0s8 5 14 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M3 26c4-5 8-5 12 0s8 5 14 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" opacity=".45"/><circle cx="22" cy="9" r="4.5" fill="currentColor"/></svg>' +
      "<span>Vigía Niño</span></div>" +
      '<div class="inf-acciones no-imprimir">' + (compartida ? '<button class="boton" type="button" id="guardar-compartida">Guardar en este navegador</button>' : "") +
      '<button class="boton" type="button" id="imprimir">Descargar PDF</button><a class="boton-sec" href="./#configurar">Editar mis lugares</a><a class="enlace" href="./">Volver al mapa</a></div>' +
      "<h1>Informe de 7 días" + (grupos.length ? " · " + esc(grupos.join(" y ")) : "") + "</h1>" +
      '<p class="inf-meta"><b>' + (desde ? diaCorto(desde) + " al " + diaCorto(hasta) + " de " + fecha(hasta).getFullYear() : "") + "</b> · Consultado el " + esc(horaLima(consultado)) + " (hora de Lima)</p>" +
      '<p class="inf-meta">Cifra principal: ECMWF de 9 km. GFS y GEM se usan para medir la certeza. Cada día va de 7 a. m. a 7 a. m. del día siguiente.</p>' +
      (compartida ? '<p class="aviso-compartida no-imprimir">Estás viendo un informe compartido. Guárdalo para tenerlo en este navegador.</p>' : "") + "</header>";
  }
  function vacio(titulo, texto, boton) {
    raiz.innerHTML = '<div class="inf-vacio"><h1>' + titulo + "</h1><p>" + texto + "</p>" + boton + "</div>";
  }

  function cargar() {
    raiz.innerHTML = '<div class="inf-vacio"><p class="cargando">Armando tu informe…</p></div>';
    var I = cfg.intereses, lugares = cfg.lugares;
    var anterior = null;
    try { anterior = JSON.parse(localStorage.getItem(CLAVE_ANTERIOR) || "null"); } catch (e) {}
    var ahora = Date.now();
    var usarAnterior = anterior && ahora - anterior.t >= 3 * 3600000 ? anterior : null;
    Promise.all([pronostico(lugares), previo(lugares).catch(function () { return null; }), red()]).then(function (r) {
      var pron = r[0], prev = r[1], resumenRed = r[2];
      return Promise.all(lugares.map(function (l) { return referencia(l, resumenRed); })).then(function (refs) {
        var res = lugares.map(function (l, i) { return calcular(l, pron[i], prev ? prev[i] : null, refs[i], usarAnterior); });
        pintar(res, I, resumenRed ? resumenRed.mar : null, new Date());
        // guardar esta consulta para comparar la próxima vez (se renueva cada 12 horas)
        if (!anterior || ahora - anterior.t >= 12 * 3600000) {
          var snap = { t: ahora, lugares: {} };
          res.forEach(function (R) { snap.lugares[R.lugar.id] = {}; R.dias.forEach(function (d) { snap.lugares[R.lugar.id][d.fecha] = Math.round(d.total * 10) / 10; }); });
          try { localStorage.setItem(CLAVE_ANTERIOR, JSON.stringify(snap)); } catch (e) {}
        }
      });
    }).catch(function () {
      vacio("No se pudo armar el informe", "No se pudo obtener el pronóstico. Revisa tu conexión a internet y vuelve a intentarlo.",
        '<button class="boton" type="button" id="reintentar">Volver a intentar</button>');
      document.getElementById("reintentar").addEventListener("click", cargar);
    });
  }
  function pintar(res, I, mar, consultado) {
    var dias0 = res[0] && res[0].dias;
    // lugares que caen en la misma celda de ECMWF 9 km (misma serie de lluvia)
    var firma = {};
    res.forEach(function (R) { var k = (R.serieP || []).join(","); (firma[k] = firma[k] || []).push(R); });
    var h = cabecera(dias0 && dias0.length ? dias0[0].fecha : null, dias0 && dias0.length ? dias0[dias0.length - 1].fecha : null, consultado);
    h += resumen(res, I, mar);
    h += '<nav class="indice no-imprimir" aria-label="Lugares">' + res.map(function (R) { return '<a class="chip" href="#' + esc(R.lugar.id) + '">' + esc(R.lugar.nombre) + "</a>"; }).join("") + "</nav>";
    res.forEach(function (R) {
      var k = (R.serieP || []).join(","), gem = (firma[k] || []).filter(function (x) { return x !== R; }).map(function (x) { return x.lugar.nombre; });
      h += seccionLugar(R, I, k && R.serieP && R.serieP.some(function (x) { return x; }) ? gem : []);
    });
    h += '<footer class="inf-pie"><p>Pronóstico automático de modelos globales (Open-Meteo: ECMWF, GFS y GEM). Lo normal: ERA5 1991–2020. No reemplaza los avisos oficiales de SENAMHI e INDECI.</p></footer>';
    raiz.innerHTML = h;
    document.title = "Informe de 7 días · Vigía Niño";
    document.getElementById("imprimir").addEventListener("click", function () { abrirDetalles(true); window.print(); });
    var g = document.getElementById("guardar-compartida");
    if (g) g.addEventListener("click", function () { C.guardar(cfg); compartida = false; history.replaceState(null, "", location.pathname); g.textContent = "Guardado"; g.disabled = true; });
    var destino = decodeURIComponent((location.hash || "").slice(1));
    if (destino && destino.indexOf("config=") !== 0) { var el = document.getElementById(destino); if (el) el.scrollIntoView(); }
  }
  function abrirDetalles(on) { document.querySelectorAll("details.modelos").forEach(function (d) { if (on) { d.dataset.antes = d.open ? "1" : ""; d.open = true; } else if (d.dataset.antes === "") d.open = false; }); }
  window.addEventListener("beforeprint", function () { abrirDetalles(true); });
  window.addEventListener("afterprint", function () { abrirDetalles(false); });

  // ---------- inicio ----------
  var m = /config=([^&]+)/.exec(location.hash || "");
  if (m) { cfg = C.decodificar(m[1]); compartida = !!cfg; }
  if (!cfg) cfg = C.leer();
  if (!cfg || !cfg.lugares.length) {
    vacio("Aún no configuras tu informe", "Elige qué quieres ver y marca tus lugares en el mapa. Se hace una sola vez y queda guardado en este navegador.",
      '<a class="boton" href="./#configurar">Configurar mi informe</a>');
  } else cargar();
})();
