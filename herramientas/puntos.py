"""Genera un punto (centroide) por cada provincia del Perú a partir de límites públicos (GeoJSON).
Salida: datos/puntos_provincias.csv con ubigeo, provincia, departamento, lat, lon."""
import unicodedata

import pandas as pd

from fuentes.comun import DATOS, get, log

URL = "https://raw.githubusercontent.com/juaneladio/peru-geojson/master/peru_provincial_simple.geojson"


def _slug(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return "".join(ch if ch.isalnum() else "_" for ch in t).strip("_")


def _centroide(anillo):
    """Centroide de un polígono (fórmula del área con signo)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(anillo, anillo[1:] + anillo[:1]):
        cruz = x0 * y1 - x1 * y0
        a += cruz
        cx += (x0 + x1) * cruz
        cy += (y0 + y1) * cruz
    if abs(a) < 1e-12:
        xs, ys = zip(*anillo)
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (3 * a), cy / (3 * a), abs(a) / 2


def generar(s):
    gj = get(s, URL).json()
    filas = []
    for f in gj["features"]:
        g, pr = f["geometry"], f["properties"]
        poligonos = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        # el centroide del polígono más grande (evita islas)
        lon, lat, _ = max((_centroide([tuple(c[:2]) for c in pol[0]]) for pol in poligonos), key=lambda t: t[2])
        prov, dep = pr["NOMBPROV"].title(), pr["FIRST_NOMB"].title()
        filas.append({"id": f"prov_{pr['FIRST_IDPR']}_{_slug(prov)}", "ubigeo": pr["FIRST_IDPR"],
                      "ciudad": "", "provincia": prov, "departamento": dep,
                      "lat": round(lat, 4), "lon": round(lon, 4)})
    df = pd.DataFrame(filas).drop_duplicates("ubigeo").sort_values("ubigeo")
    DATOS.mkdir(exist_ok=True)
    df.to_csv(DATOS / "puntos_provincias.csv", index=False)
    log.info("Generados %s puntos de provincia en datos/puntos_provincias.csv", len(df))
    return df
