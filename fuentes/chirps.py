"""CHIRPS v2: lluvia diaria en grilla (desde 1981). Se baja un archivo por año, se extraen
los puntos configurados y se borra el archivo para no ocupar disco."""
import numpy as np
import pandas as pd

from .comun import DATOS, get, guardar, log

URL = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/netcdf/{res}/chirps-v2.0.{anio}.days_{res}.nc"
RUTA = DATOS / "chirps" / "chirps_puntos.parquet"
TMP = DATOS / "_tmp"


def _celda_valida(da, lat, lon, radio=0.6):
    """Celda más cercana con datos (en la costa la celda más cercana puede caer en el mar)."""
    sub = da.sel(latitude=slice(lat - radio, lat + radio), longitude=slice(lon - radio, lon + radio))
    if sub.latitude.size == 0:  # algunos archivos tienen la latitud en orden descendente
        sub = da.sel(latitude=slice(lat + radio, lat - radio), longitude=slice(lon - radio, lon + radio))
    valido = sub.notnull().any("time").values
    la, lo = np.meshgrid(sub.latitude.values, sub.longitude.values, indexing="ij")
    dist = np.where(valido, (la - lat) ** 2 + (lo - lon) ** 2, np.inf)
    if not np.isfinite(dist).any():
        return None
    i, j = np.unravel_index(np.argmin(dist), dist.shape)
    return sub.isel(latitude=i, longitude=j)


def extraer(ruta_nc, puntos):
    import xarray as xr
    with xr.open_dataset(ruta_nc) as ds:
        da = ds["precip"].load()
    filas = []
    for p in puntos:
        serie = _celda_valida(da, p["lat"], p["lon"])
        if serie is None:
            log.warning("CHIRPS sin datos cerca de %s", p["id"])
            continue
        df = serie.to_dataframe(name="precip_mm").reset_index()[["time", "precip_mm"]]
        df = df.rename(columns={"time": "fecha"})
        df.insert(0, "punto_id", p["id"])
        filas.append(df)
    return pd.concat(filas, ignore_index=True) if filas else pd.DataFrame()


def _anios_completos(puntos):
    if not RUTA.exists():
        return set()
    df = pd.read_parquet(RUTA)
    df = df[df["punto_id"].isin([p["id"] for p in puntos])]
    conteo = df.groupby([df["fecha"].dt.year, "punto_id"]).size().unstack()
    return {int(a) for a, fila in conteo.iterrows()
            if fila.reindex([p["id"] for p in puntos]).min() >= 365}


def actualizar(cfg, puntos, s, forzar=False):
    c = cfg["chirps"]
    hoy = pd.Timestamp.today()
    hechos = _anios_completos(puntos)
    pendientes = [a for a in range(max(1981, pd.Timestamp(cfg["fecha_inicio"]).year), hoy.year + 1)
                  if a not in hechos]
    # El año en curso solo se refresca un día por semana (el archivo pesa y cambia ~1 vez al mes)
    if hoy.year in pendientes and len(pendientes) == 1 and hoy.weekday() != c["dia_actualizacion"] and not forzar:
        log.info("CHIRPS al día; el año en curso se refresca los días %s", c["dia_actualizacion"])
        return
    TMP.mkdir(parents=True, exist_ok=True)
    for anio in pendientes:
        url = URL.format(res=c["resolucion"], anio=anio)
        destino = TMP / f"chirps_{anio}.nc"
        try:
            with get(s, url, stream=True, timeout=600) as r, open(destino, "wb") as f:
                for trozo in r.iter_content(1 << 20):
                    f.write(trozo)
        except Exception as e:  # el año en curso puede no existir aún en enero
            log.warning("CHIRPS %s no disponible (%s)", anio, e)
            destino.unlink(missing_ok=True)
            continue
        try:
            df = extraer(destino, puntos)
            n = guardar(RUTA, df, ["punto_id", "fecha"])
            log.info("CHIRPS %s: %s filas nuevas (%s en total)", anio, len(df), n)
        finally:
            destino.unlink(missing_ok=True)
