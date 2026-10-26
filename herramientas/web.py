"""Exporta los datos al sitio web estático (carpeta sitio/), listo para GitHub Pages."""
import json
import shutil

import numpy as np
import pandas as pd

from fuentes.comun import DATOS, RAIZ, cargar_puntos, get, log, sesion
from fuentes import horas
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
        u = m.iloc[-1]
        out["icen"] = {"mes": f"{u.fecha:%Y-%m}", "valor": float(u.icen_aprox), "categoria": u.icen_categoria}
    return out


def _ultimo_pronostico():
    archivos = sorted((DATOS / "openmeteo_pronosticos").glob("*.parquet"))[-2:]
    if not archivos:
        return pd.DataFrame(), None
    df = pd.concat(pd.read_parquet(a) for a in archivos)
    emision = df.fecha_emision.max()
    return df[df.fecha_emision == emision], emision


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
            ev = {k: p.get(k) for k in ("id", "provincia", "departamento", "lat", "lon")}
            ev.update(nombre=p.get("ciudad") or p.get("provincia"), nivel=None, dias=[], criterios=[],
                      veredicto=f"Preparando este lugar: se están descargando sus datos históricos "
                                f"({anios:.0f} de {pd.Timestamp.today().year - 1979} años). El nivel de riesgo "
                                f"aparecerá cuando haya al menos {MIN_DIAS_HISTORIA // 365} años.",
                      acciones=criterios.ACCIONES[0])
            ev["hoy"] = hoy_mod.resumir(ahora_h.get(p["id"]), ahora_c.get(p["id"]))
            _json(SITIO / "data" / "puntos" / f"{p['id']}.json", ev)
            resumen.append({k: ev.get(k) for k in ("id", "nombre", "provincia", "departamento", "lat", "lon",
                                                    "nivel", "veredicto")})
            if ev["hoy"]:
                resumen[-1]["hoy"] = {k: ev["hoy"][k] for k in ("estado", "hasta_ahora_mm", "resto_mm", "descripcion")}
            continue
        era5_hasta = max(era5_hasta or hist.fecha.max(), hist.fecha.max())
        clim = criterios.climatologia(hist)
        ev = criterios.evaluar(p, hist, pron[pron.punto_id == p["id"]] if len(pron) else None, clim, mar, hoy,
                                matrices.get(p["id"]))
        ev["hoy"] = hoy_mod.resumir(ahora_h.get(p["id"]), ahora_c.get(p["id"]))
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
    log.info("Sitio generado en %s con %s lugares", SITIO, len(resumen))
