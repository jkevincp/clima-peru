"""NOAA CPC: índices de temperatura del mar en las regiones Niño.

Niño 1+2 (0-10°S, 90-80°W) es la región frente a la costa norte del Perú; con ella el ENFEN
calcula el ICEN (Índice Costero El Niño). Aquí se calcula un ICEN *aproximado*: media móvil
de 3 meses de la anomalía ERSST Niño 1+2. El oficial del ENFEN/IGP usa otro periodo base,
así que los valores pueden diferir unas décimas.
"""
import re

import pandas as pd

from .comun import DATOS, get, guardar, log

URL_MENSUAL = "https://www.cpc.ncep.noaa.gov/data/indices/ersst5.nino.mth.91-20.ascii"
URL_SEMANAL = "https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for"

COLS_MENSUAL = ["anio", "mes", "nino12", "nino12_anom", "nino3", "nino3_anom",
                "nino4", "nino4_anom", "nino34", "nino34_anom"]
COLS_SEMANAL = ["nino12", "nino12_anom", "nino3", "nino3_anom",
                "nino34", "nino34_anom", "nino4", "nino4_anom"]


def categoria_icen(v):
    """Umbrales del ENFEN para la condición costera."""
    if pd.isna(v):
        return None
    if v > 3.0:
        return "Cálida extraordinaria"
    if v > 1.7:
        return "Cálida fuerte"
    if v > 1.0:
        return "Cálida moderada"
    if v >= 0.4:
        return "Cálida débil"
    if v >= -1.0:
        return "Neutra"
    if v >= -1.2:
        return "Fría débil"
    if v >= -1.4:
        return "Fría moderada"
    return "Fría fuerte"


def parse_mensual(texto):
    filas = [l.split() for l in texto.splitlines()]
    filas = [f for f in filas if len(f) == 10 and f[0].isdigit()]
    df = pd.DataFrame(filas, columns=COLS_MENSUAL).apply(pd.to_numeric)
    df["fecha"] = pd.to_datetime(dict(year=df.anio, month=df.mes, day=1))
    df["icen_aprox"] = df["nino12_anom"].rolling(3, center=True).mean().round(2)
    df["icen_categoria"] = df["icen_aprox"].map(categoria_icen)
    return df[["fecha"] + COLS_MENSUAL[2:] + ["icen_aprox", "icen_categoria"]]


def parse_semanal(texto):
    filas = []
    for l in texto.splitlines():
        m = re.match(r"^\s*(\d{2}[A-Z]{3}\d{4})(.*)$", l)
        if not m:
            continue
        nums = re.findall(r"-?\d+\.\d", m.group(2))  # "23.4-0.4" -> 23.4, -0.4
        if len(nums) == 8:
            filas.append([pd.to_datetime(m.group(1), format="%d%b%Y")] + [float(x) for x in nums])
    return pd.DataFrame(filas, columns=["fecha"] + COLS_SEMANAL)


def actualizar(cfg, s):
    m = parse_mensual(get(s, URL_MENSUAL).text)
    n = guardar(DATOS / "enso" / "nino_mensual.parquet", m, ["fecha"])
    ult = m.dropna(subset=["icen_aprox"]).iloc[-1]
    log.info("NOAA mensual: %s meses (último ICEN aprox %s: %+.2f, %s)",
             n, f"{ult.fecha:%Y-%m}", ult.icen_aprox, ult.icen_categoria)
    w = parse_semanal(get(s, URL_SEMANAL).text)
    n = guardar(DATOS / "enso" / "nino_semanal.parquet", w, ["fecha"])
    ult = w.iloc[-1]
    log.info("NOAA semanal: %s semanas (Niño 1+2 al %s: %+.1f °C de anomalía)",
             n, ult.fecha.date(), ult.nino12_anom)
