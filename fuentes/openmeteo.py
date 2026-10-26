"""Open-Meteo: histórico ERA5 diario y pronósticos a 7 días (ECMWF, GFS)."""
import os
import time

import pandas as pd

from . import horas
from .comun import DATOS, get, guardar, log, rangos

URL_ARCHIVO = "https://archive-api.open-meteo.com/v1/archive"
URL_PRONOSTICO = "https://api.open-meteo.com/v1/forecast"
# Con plan pagado de Open-Meteo: define la variable de entorno OPENMETEO_API_KEY
# (en GitHub: Settings → Secrets and variables → Actions). Sin clave se usa la API gratuita.
CLAVE = os.environ.get("OPENMETEO_API_KEY", "").strip()
if CLAVE:
    URL_ARCHIVO = URL_ARCHIVO.replace("://", "://customer-")
    URL_PRONOSTICO = URL_PRONOSTICO.replace("://", "://customer-")


def _con_clave(params):
    return {**params, "apikey": CLAVE} if CLAVE else params


DIR_HIST = DATOS / "openmeteo_historico"
DIR_PRON = DATOS / "openmeteo_pronosticos"
DIR_HORAS = DATOS / "openmeteo_pronosticos_horas"
HORARIO_ULTIMO = DATOS / "openmeteo_horario" / "ultimo.parquet"


def _diario_a_df(js):
    df = pd.DataFrame(js["daily"]).rename(columns={"time": "fecha"})
    df["fecha"] = pd.to_datetime(df["fecha"])
    return df


def _faltantes(ruta, inicio, fin, solape):
    """Rangos que faltan descargar para un punto (el inicio del histórico y lo más reciente)."""
    if not ruta.exists():
        return [(inicio, fin)]
    fechas = pd.read_parquet(ruta, columns=["fecha"])["fecha"]
    out = []
    if fechas.min() > inicio:
        out.append((inicio, fechas.min() - pd.Timedelta(days=1)))
    desde = max(inicio, fechas.max() - pd.Timedelta(days=solape))
    if desde <= fin:
        out.append((desde, fin))
    return out


def _peso(dias, n_vars):
    """Open-Meteo cuenta como varias consultas los pedidos de más de 2 semanas o más de 10 variables."""
    return max(1.0, dias / 14) * max(1.0, n_vars / 10)


def historico(cfg, puntos, s):
    """Baja el histórico de lo más reciente hacia atrás, con un tope de consultas por corrida para no
    gastar el cupo diario que necesitan el pronóstico y "Hoy". Lo que falte sigue en la próxima corrida."""
    c = cfg["openmeteo"]
    inicio = pd.Timestamp(cfg["fecha_inicio"])
    fin = pd.Timestamp.today().normalize() - pd.Timedelta(days=c["retraso_archivo_dias"])
    presupuesto = float(c.get("presupuesto_historico", 4000))
    gastado = 0.0
    # Por turnos: cada lugar recibe su bloque más reciente pendiente, luego el siguiente, etc.
    # Así todos llegan pronto a los 10 años que hacen falta para calcular el nivel de riesgo.
    colas = {}
    for p in puntos:
        ruta = DIR_HIST / f"{p['id']}.parquet"
        bloques = [blq for a, b in _faltantes(ruta, inicio, fin, c["solape_dias"])
                   for blq in rangos(a, b, c["bloque_anios"])]
        if bloques:
            colas[p["id"]] = (p, ruta, sorted(bloques, reverse=True))  # lo más reciente primero
    while colas:
        for pid in list(colas):
            p, ruta, bloques = colas[pid]
            d, h = bloques.pop(0)
            if not bloques:
                del colas[pid]
            peso = _peso((h - d).days + 1, len(c["variables_diarias"]))
            if gastado + peso > presupuesto:
                log.info("Histórico: tope de %.0f consultas de esta corrida alcanzado; sigue en la próxima", presupuesto)
                return
            js = get(s, URL_ARCHIVO, params=_con_clave({
                "latitude": p["lat"], "longitude": p["lon"],
                "start_date": d.date().isoformat(), "end_date": h.date().isoformat(),
                "daily": ",".join(c["variables_diarias"]),
                "timezone": cfg["zona_horaria"],
            })).json()
            gastado += peso
            df = _diario_a_df(js)
            df.insert(0, "punto_id", p["id"])
            n = guardar(ruta, df, ["punto_id", "fecha"])
            log.info("Open-Meteo histórico %s %s→%s (%s filas en total, ~%.0f consultas usadas)",
                     p["id"], d.date(), h.date(), n, gastado)
            # límite por minuto (600): espaciar según el peso del pedido
            time.sleep(max(c["pausa_seg"], peso * 60 / 550))


def pronostico(cfg, puntos, s, hoy=None):
    """Guarda el pronóstico de hoy con su fecha de emisión. Este archivo crece día a día y
    será la base para corregir los modelos globales con datos locales (post-procesamiento)."""
    c = cfg["openmeteo"]
    pc = c["pronostico"]
    hoy = pd.Timestamp(hoy or pd.Timestamp.today().normalize())
    filas, horarias = [], []
    for modelo in pc["modelos"]:
        for i in range(0, len(puntos), 50):  # hasta 50 puntos por llamada
            lote = puntos[i:i + 50]
            js = get(s, URL_PRONOSTICO, params=_con_clave({
                "latitude": ",".join(str(p["lat"]) for p in lote),
                "longitude": ",".join(str(p["lon"]) for p in lote),
                "daily": ",".join(c["variables_diarias"]),
                "hourly": "precipitation",
                "forecast_days": pc["dias"] + 1,
                "models": modelo,
                "timezone": cfg["zona_horaria"],
            })).json()
            respuestas = js if isinstance(js, list) else [js]
            for p, r in zip(lote, respuestas):
                df = _diario_a_df(r).melt(id_vars="fecha", var_name="variable", value_name="valor")
                df["variable"] = df["variable"].str.replace(f"_{modelo}", "", regex=False)
                df.insert(0, "punto_id", p["id"])
                df["modelo"] = modelo
                filas.append(df)
                if "hourly" in r:
                    hh = pd.DataFrame(r["hourly"]).rename(columns={"time": "hora"})
                    hh.columns = [col.replace(f"_{modelo}", "") for col in hh.columns]
                    hh["hora"] = pd.to_datetime(hh["hora"])
                    hh["punto_id"], hh["modelo"] = p["id"], modelo
                    horarias.append(hh[["punto_id", "modelo", "hora", "precipitation"]])
            time.sleep(c["pausa_seg"])
    if not filas:
        return
    df = pd.concat(filas, ignore_index=True).rename(columns={"fecha": "fecha_objetivo"})
    df["fecha_emision"] = hoy
    df["plazo_dias"] = (df["fecha_objetivo"] - hoy).dt.days
    df = df[df["plazo_dias"].between(0, pc["dias"])]
    ruta = DIR_PRON / f"{hoy:%Y-%m}.parquet"  # un archivo por mes
    n = guardar(ruta, df, ["fecha_emision", "punto_id", "modelo", "variable", "fecha_objetivo"])
    log.info("Open-Meteo pronóstico %s: %s puntos x %s modelos (%s filas en %s)",
             hoy.date(), len(puntos), len(pc["modelos"]), n, ruta.name)
    if horarias:
        hh = pd.concat(horarias, ignore_index=True)
        hh["fecha_emision"] = hoy
        HORARIO_ULTIMO.parent.mkdir(parents=True, exist_ok=True)
        hh.to_parquet(HORARIO_ULTIMO, index=False)  # solo el último pronóstico hora a hora (para el mapa)
        v = horas.ventanas_df(hh)  # y un resumen por día que sí se acumula (para entrenar modelos)
        if len(v):
            v["fecha_emision"] = hoy
            v["plazo_dias"] = (v["fecha_objetivo"] - hoy).dt.days
            guardar(DIR_HORAS / f"{hoy:%Y-%m}.parquet", v[v.plazo_dias.between(0, pc["dias"])],
                    ["fecha_emision", "punto_id", "modelo", "fecha_objetivo"])
        log.info("Open-Meteo horario: %s filas; %s días con lluvia ubicados por hora", len(hh), len(v))
