"""Exporta los datos al sitio web estático (carpeta sitio/), listo para GitHub Pages."""
import json
import shutil

import numpy as np
import pandas as pd

from fuentes.comun import DATOS, RAIZ, cargar_puntos, get, log, sesion
from fuentes import horas, noaa_enso
from fuentes.openmeteo import HORARIO_ULTIMO
from herramientas import criterios, hoy as hoy_mod
from herramientas.puntos import _centroide

WEB = RAIZ / "web"
SITIO = RAIZ / "sitio"
MIN_DIAS_HISTORIA = 3650  # 10 años: mínimo para calcular lo "normal" de un lugar
URL_DEPS = "https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_departamental_simple.geojson"


def _json(ruta, obj):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"),
                  default=lambda o: None if isinstance(o, float) and np.isnan(o) else str(o))


def _departamentos():
    ruta = DATOS / "geo" / "departamentos.geojson"
    if not ruta.exists():
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(get(sesion(), URL_DEPS).content)
    gj = json.loads(ruta.read_text(encoding="utf-8"))
    for f in gj["features"]:  # solo nombre, centro y tamaño; se reduce el peso
        g = f["geometry"]
        poligonos = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        lon, lat, area = max((_centroide([tuple(c[:2]) for c in pol[0]]) for pol in poligonos), key=lambda t: t[2])
        f["properties"] = {"nombre": f["properties"].get("NOMBDEP", "").title(),
                           "centro": [round(lat, 3), round(lon, 3)], "area": round(area, 3)}
        f["geometry"]["coordinates"] = _redondear(f["geometry"]["coordinates"])
    return gj


def _redondear(c):
    return [_redondear(x) for x in c] if isinstance(c[0], list) else [round(c[0], 3), round(c[1], 3)]


def _mar():
    out = {"anom": None}
    r = DATOS / "enso" / "nino_semanal.parquet"
    if r.exists():
        w = pd.read_parquet(r).sort_values("fecha")
        out["anom"] = float(w.nino12_anom.iloc[-1])
        out["fecha"] = f"{w.fecha.iloc[-1]:%Y-%m-%d}"
        out["cambio_4sem"] = round(float(w.nino12_anom.iloc[-1] - w.nino12_anom.iloc[-5]), 1) if len(w) > 5 else None
        out["semanas"] = [{"fecha": f"{f:%Y-%m-%d}", "anom": float(a)} for f, a in
                          zip(w.fecha.iloc[-26:], w.nino12_anom.iloc[-26:])]
    r = DATOS / "enso" / "nino_mensual.parquet"
    if r.exists():
        m = pd.read_parquet(r).dropna(subset=["icen_aprox"]).sort_values("fecha")
        if len(m):
            u = m.iloc[-1]
            out["icen"] = {"mes": f"{u.fecha:%Y-%m}", "valor": float(u.icen_aprox), "categoria": u.icen_categoria,
                           "fuente": "ERSST mensual"}
    # El archivo mensual de NOAA a veces se atrasa meses; si es así, se estima con el semanal (OISST):
    # media móvil de 3 meses de la anomalía mensual de Niño 1+2.
    r = DATOS / "enso" / "nino_semanal.parquet"
    if r.exists():
        w = pd.read_parquet(r).set_index("fecha").sort_index()
        mes = w["nino12_anom"].resample("MS").mean()
        cuenta = w["nino12_anom"].resample("MS").count()
        mes = mes[cuenta >= 3]  # meses con al menos 3 semanas
        icen = mes.rolling(3).mean().dropna()
        if len(icen):
            centro = icen.index[-1] - pd.DateOffset(months=1)  # el valor corresponde al mes central
            actual = out.get("icen")
            if not actual or pd.Timestamp(actual["mes"] + "-01") < centro - pd.DateOffset(months=1):
                v = round(float(icen.iloc[-1]), 2)
                out["icen"] = {"mes": f"{centro:%Y-%m}", "valor": v, "categoria": noaa_enso.categoria_icen(v),
                               "fuente": "OISST semanal"}
    return out


def _ultimo_pronostico():
    archivos = sorted((DATOS / "openmeteo_pronosticos").glob("*.parquet"))[-2:]
    if not archivos:
        return pd.DataFrame(), None
    df = pd.concat(pd.read_parquet(a) for a in archivos)
    emision = df.fecha_emision.max()
    # cada lugar usa su pronóstico más reciente (si una corrida no alcanzó a bajarlos todos), con hasta 1 día de antigüedad
    ultima = df.groupby("punto_id")["fecha_emision"].transform("max")
    df = df[(df.fecha_emision == ultima) & (ultima >= emision - pd.Timedelta(days=1))]
    return df, emision


def _horario_campo(emision):
    """Pronóstico hora a hora (promedio de modelos) para los cálculos de "Mi cultivo" en el navegador."""
    if not HORARIO_ULTIMO.exists():
        return {}
    hh = pd.read_parquet(HORARIO_ULTIMO)
    if emision is not None and "fecha_emision" in hh and hh.fecha_emision.max() != emision:
        return {}
    cols = {"temperature_2m": "t", "relative_humidity_2m": "hr", "wind_speed_10m": "v", "precipitation": "p"}
    cols = {k: v for k, v in cols.items() if k in hh}
    if len(cols) < 4:
        return {}  # descarga anterior sin temperatura/humedad/viento
    media = hh.groupby(["punto_id", "hora"])[list(cols)].mean().reset_index()
    out = {}
    for pid, g in media.groupby("punto_id"):
        g = g.sort_values("hora")
        out[pid] = {"inicio": f"{g.hora.iloc[0]:%Y-%m-%dT%H:%M}",
                    **{corto: [None if pd.isna(x) else round(float(x), 1) for x in g[larga]] for larga, corto in cols.items()}}
    return out


def _et0(pron):
    """ET0 diaria (promedio de modelos) por lugar: {punto: {fecha: mm}}"""
    if pron is None or not len(pron):
        return {}
    e = pron[pron.variable == "et0_fao_evapotranspiration"]
    e = e.groupby(["punto_id", "fecha_objetivo"])["valor"].mean()
    out = {}
    for (pid, f), v in e.items():
        out.setdefault(pid, {})[f"{f:%Y-%m-%d}"] = round(float(v), 2)
    return out


def _matrices(emision):
    """Lluvia hora a hora del último pronóstico: {punto: {(modelo, fecha): 24 valores}}"""
    if not HORARIO_ULTIMO.exists():
        return {}
    hh = pd.read_parquet(HORARIO_ULTIMO)
    if emision is not None and "fecha_emision" in hh and hh.fecha_emision.max() != emision:
        return {}  # el horario no corresponde al pronóstico diario vigente
    out = {}
    for (p, m, f), arr in horas.a_matriz(hh).items():
        out.setdefault(p, {})[(m, f)] = arr
    return out


def _ahora():
    """Condiciones de hoy por punto, si la consulta tiene menos de 12 horas."""
    d = DATOS / "ahora"
    if not (d / "horario.parquet").exists() or not (d / "actual.parquet").exists():
        return {}, {}
    act = pd.read_parquet(d / "actual.parquet")
    if act.empty or pd.Timestamp.now(tz="America/Lima").tz_localize(None) - act.hora.max() > pd.Timedelta(hours=12):
        return {}, {}
    hh = pd.read_parquet(d / "horario.parquet")
    return {k: g for k, g in hh.groupby("punto_id")}, {r["punto_id"]: r for r in act.to_dict("records")}


def exportar(cfg, demo=False):
    mar = _mar()
    pron, emision = _ultimo_pronostico()
    hoy = emision if emision is not None else pd.Timestamp.today().normalize()
    matrices = _matrices(emision)
    ahora_h, ahora_c = _ahora()
    campo, et0 = _horario_campo(emision), _et0(pron)
    semana = {}
    if len(pron):
        x = pron[(pron.variable == "precipitation_sum") & pron.plazo_dias.between(1, 7)]
        semana = {pid: round(float(v), 1) for pid, v in
                  x.groupby(["punto_id", "fecha_objetivo"])["valor"].mean().groupby("punto_id").sum().items()}
    if SITIO.exists():
        shutil.rmtree(SITIO)
    shutil.copytree(WEB, SITIO)
    # GitHub Pages sirve el HTML tal cual: se le agrega la cabecera estándar
    idx = SITIO / "index.html"
    idx.write_text('<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n' + idx.read_text(encoding="utf-8"),
                   encoding="utf-8")

    resumen, era5_hasta = [], None
    for p in cargar_puntos(cfg):
        ruta = DATOS / "openmeteo_historico" / f"{p['id']}.parquet"
        hist = pd.read_parquet(ruta) if ruta.exists() else None
        if hist is None or len(hist) < MIN_DIAS_HISTORIA:
            # aún sin historia suficiente para saber qué es "normal": se muestra el lugar y su "Hoy"
            anios = 0 if hist is None else len(hist) / 365.25
            ev = {k: p.get(k) for k in ("id", "distrito", "provincia", "departamento", "lat", "lon")}
            ev.update(nombre=p.get("ciudad") or p.get("distrito") or p.get("provincia"), nivel=None, dias=[], criterios=[],
                      veredicto=f"Preparando este lugar: se están descargando sus datos históricos "
                                f"({anios:.0f} de {pd.Timestamp.today().year - 1979} años). El nivel de riesgo "
                                f"aparecerá cuando haya al menos {MIN_DIAS_HISTORIA // 365} años.",
                      acciones=criterios.ACCIONES[0])
            ev["lluvia_7d_mm"] = semana.get(p["id"])
            ev["hoy"] = hoy_mod.resumir(ahora_h.get(p["id"]), ahora_c.get(p["id"]))
            ev["campo"] = {"horario": campo.get(p["id"]), "et0": et0.get(p["id"], {})}
            _json(SITIO / "data" / "puntos" / f"{p['id']}.json", ev)
            resumen.append({k: ev.get(k) for k in ("id", "nombre", "provincia", "departamento", "lat", "lon",
                                                    "nivel", "veredicto", "lluvia_7d_mm")})
            if ev["hoy"]:
                resumen[-1]["hoy"] = {k: ev["hoy"][k] for k in ("estado", "hasta_ahora_mm", "resto_mm", "descripcion")}
            continue
        era5_hasta = max(era5_hasta or hist.fecha.max(), hist.fecha.max())
        clim = criterios.climatologia(hist)
        ev = criterios.evaluar(p, hist, pron[pron.punto_id == p["id"]] if len(pron) else None, clim, mar, hoy,
                                matrices.get(p["id"]))
        ev["hoy"] = hoy_mod.resumir(ahora_h.get(p["id"]), ahora_c.get(p["id"]))
        ev["campo"] = {"horario": campo.get(p["id"]), "et0": et0.get(p["id"], {})}
        _json(SITIO / "data" / "puntos" / f"{p['id']}.json", ev)
        resumen.append({k: ev.get(k) for k in ("id", "nombre", "provincia", "departamento", "lat", "lon",
                                                "nivel", "veredicto", "cuando", "lluvia_7d_mm")})
        if ev["hoy"]:
            resumen[-1]["hoy"] = {k: ev["hoy"][k] for k in ("estado", "hasta_ahora_mm", "resto_mm", "descripcion")}

    chirps = DATOS / "chirps" / "chirps_puntos.parquet"
    _json(SITIO / "data" / "resumen.json", {
        "generado": pd.Timestamp.now(tz="America/Lima").isoformat(timespec="minutes"),
        "demo": demo,
        "niveles": criterios.NIVELES,
        "fechas": {"era5_hasta": f"{era5_hasta:%Y-%m-%d}" if era5_hasta is not None else None,
                   "pronostico_emitido": f"{emision:%Y-%m-%d}" if emision is not None else None,
                   "chirps_hasta": f"{pd.read_parquet(chirps, columns=['fecha']).fecha.max():%Y-%m-%d}"
                   if chirps.exists() else None},
        "mar": mar,
        "hoy_consultado": max((c["hora"] for c in ahora_c.values()), default=None),
        "puntos": resumen,
    })
    _json(SITIO / "data" / "departamentos.json", _departamentos())
    try:
        from herramientas import zonas
        _json(SITIO / "data" / "zonas.json", zonas.generar(cfg, cargar_puntos(cfg)))
    except Exception as e:  # el mapa funciona igual sin las zonas de lluvia
        log.warning("No se pudieron generar las zonas de lluvia: %s", e)
    log.info("Sitio generado en %s con %s lugares", SITIO, len(resumen))
