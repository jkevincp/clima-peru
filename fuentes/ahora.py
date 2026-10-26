"""Condiciones de hoy: lluvia de ayer y de hoy hora por hora, y el estado actual.

Es lo que estiman los modelos (best match de Open-Meteo, actualizado cada hora), no una estación.
Se consulta varias veces al día y no se guarda en el historial: solo sirve para la sección "Hoy" del mapa.
"""
import time

import pandas as pd

from .comun import DATOS, get, log
from .openmeteo import URL_PRONOSTICO, _con_clave

DIR = DATOS / "ahora"


def actualizar(cfg, puntos, s):
    horarias, actuales = [], []
    for i in range(0, len(puntos), 50):
        lote = puntos[i:i + 50]
        js = get(s, URL_PRONOSTICO, params=_con_clave({
            "latitude": ",".join(str(p["lat"]) for p in lote),
            "longitude": ",".join(str(p["lon"]) for p in lote),
            "current": "precipitation,rain,showers,weather_code,temperature_2m",
            "hourly": "precipitation,weather_code",
            "past_days": 1,
            "forecast_days": 2,
            "timezone": cfg["zona_horaria"],
        })).json()
        respuestas = js if isinstance(js, list) else [js]
        for p, r in zip(lote, respuestas):
            hh = pd.DataFrame(r["hourly"]).rename(columns={"time": "hora"})
            hh["hora"] = pd.to_datetime(hh["hora"])
            hh.insert(0, "punto_id", p["id"])
            horarias.append(hh)
            c = dict(r.get("current", {}))
            c["hora"] = pd.to_datetime(c.pop("time")) if "time" in c else pd.NaT
            c.pop("interval", None)
            c["punto_id"] = p["id"]
            actuales.append(c)
        time.sleep(cfg["openmeteo"]["pausa_seg"])
    DIR.mkdir(parents=True, exist_ok=True)
    pd.concat(horarias, ignore_index=True).to_parquet(DIR / "horario.parquet", index=False)
    pd.DataFrame(actuales).to_parquet(DIR / "actual.parquet", index=False)
    lloviendo = sum(1 for c in actuales if (c.get("precipitation") or 0) > 0)
    log.info("Condiciones actuales: %s lugares, %s con lluvia en este momento", len(actuales), lloviendo)
