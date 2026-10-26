"""Utilidades compartidas: HTTP con reintentos, guardado incremental en Parquet y puntos."""
import logging
import os
import time
from pathlib import Path

import pandas as pd
import requests
import yaml
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "datos"
log = logging.getLogger("clima")


class LimiteAlcanzado(Exception):
    """El proveedor cortó por límite diario/horario. La próxima corrida retoma donde quedó."""


def cargar_config(ruta=None):
    with open(ruta or RAIZ / "config.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def cargar_puntos(cfg):
    puntos = list(cfg.get("puntos") or [])
    csv = DATOS / "puntos_provincias.csv"
    if cfg.get("usar_puntos_provincias_csv") and not csv.exists():
        from herramientas.puntos import generar
        generar(sesion())
    if cfg.get("usar_puntos_provincias_csv") and csv.exists():
        # una ciudad configurada a mano reemplaza al centro de su provincia
        cubiertas = {(_norm(p.get("provincia")), _norm(p.get("departamento"))) for p in puntos}
        ids = {p["id"] for p in puntos}
        extra = pd.read_csv(csv, dtype={"ubigeo": str}, keep_default_na=False).to_dict("records")
        puntos += [p for p in extra if p["id"] not in ids
                   and (_norm(p["provincia"]), _norm(p["departamento"])) not in cubiertas]
    return puntos


def _norm(t):
    import unicodedata
    return unicodedata.normalize("NFKD", str(t or "")).encode("ascii", "ignore").decode().lower().strip()


def sesion():
    s = requests.Session()
    reintentos = Retry(total=5, backoff_factor=3, status_forcelist=[500, 502, 503, 504],
                       allowed_methods=["GET"])
    s.mount("https://", HTTPAdapter(max_retries=reintentos))
    s.mount("http://", HTTPAdapter(max_retries=reintentos))
    s.headers["User-Agent"] = "clima-nino-peru/0.1 (MVP de investigacion)"
    return s


def get(s, url, params=None, espera_429=65, intentos_429=4, **kw):
    """GET con manejo de límites de uso (HTTP 429)."""
    for i in range(intentos_429):
        r = s.get(url, params=params, timeout=kw.pop("timeout", 180), **kw)
        if r.status_code == 429:
            texto = r.text.lower()
            if "daily" in texto or "hourly" in texto:
                raise LimiteAlcanzado(r.text[:200])
            log.warning("Límite por minuto; espero %ss", espera_429)
            time.sleep(espera_429)
            continue
        if r.status_code == 400:
            raise ValueError(f"Petición rechazada por {url}: {r.text[:300]}")
        r.raise_for_status()
        return r
    raise LimiteAlcanzado(f"Demasiados 429 en {url}")


def guardar(ruta, nuevo, claves):
    """Agrega filas a un Parquet sin duplicar (las filas nuevas reemplazan a las viejas)."""
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    if nuevo is None or nuevo.empty:
        return 0
    if ruta.exists():
        nuevo = pd.concat([pd.read_parquet(ruta), nuevo], ignore_index=True)
    df = nuevo.drop_duplicates(subset=claves, keep="last").sort_values(claves).reset_index(drop=True)
    tmp = ruta.with_name(ruta.name + ".tmp")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, ruta)
    return len(df)


def rangos(desde, hasta, anios):
    """Parte [desde, hasta] en bloques de `anios` años."""
    desde, hasta = pd.Timestamp(desde), pd.Timestamp(hasta)
    while desde <= hasta:
        fin = min(desde + pd.DateOffset(years=anios) - pd.Timedelta(days=1), hasta)
        yield desde, fin
        desde = fin + pd.Timedelta(days=1)
