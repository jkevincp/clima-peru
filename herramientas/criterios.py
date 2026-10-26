"""Convierte los datos de un punto en un nivel de riesgo a 7 días, con criterios explicables.

Reglas del MVP (antes de entrenar modelos de machine learning):
- Lluvia: se compara el pronóstico diario con lo normal *para ese lugar y esa época del año*
  (percentiles 90/95/99 de los días con lluvia en 1991-2020, como hace SENAMHI).
- Si solo uno de los dos modelos (ECMWF, GFS) muestra la lluvia fuerte, baja un nivel.
- Lluvia acumulada de 7 días muy por encima de lo normal sube el nivel.
- Suelo ya húmedo (últimos 15 días) y mar cálido frente a la costa norte suben un nivel.
- Calor: temperatura máxima más de 2 desviaciones sobre lo normal.
Niveles: 0 Sin señales · 1 Vigilar · 2 Prepararse · 3 Actuar.
"""
import numpy as np
import pandas as pd

from fuentes import horas as H

NIVELES = ["Sin señales", "Vigilar", "Prepararse", "Actuar"]
DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
DIAS_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
INTENSIDAD = {1: "más fuerte de lo normal", 2: "muy fuerte para la zona", 3: "extrema para la zona"}
EVENTOS = {1983: "Niño 1982-83", 1998: "Niño 1997-98", 2017: "Niño costero 2017", 2023: "Niño costero 2023"}
MINIMO_MM = 5.0  # por debajo de esto no se alerta, aunque sea raro para la zona
LIGERA_MM = 0.5  # desde aquí se menciona como lluvia ligera, sin subir el nivel
CONSEJO_FLORACION = ("Si tu cultivo está en floración, la humedad favorece oídio y antracnosis: "
                     "revisa tu plan sanitario y evita aplicar justo antes de la lluvia.")

ACCIONES = {
    0: {"general": ["Revisa este panel cada mañana: se actualiza a diario.",
                    "Mantén limpios techos, canaletas y desagües."],
        "campo": ["Aprovecha los días secos para labores de campo.",
                  "Revisa drenes y canales antes de la temporada de lluvias (diciembre a abril)."]},
    1: {"general": ["Sigue los avisos de SENAMHI para tu provincia.",
                    "Ten a mano linterna, agua y documentos en una bolsa impermeable."],
        "campo": ["No apliques fertilizantes ni fitosanitarios el día antes de la lluvia: el agua los lava.",
                  "Despeja drenes y salidas de agua de las parcelas.",
                  "Adelanta la cosecha de lo que ya está listo."]},
    2: {"general": ["Identifica rutas de evacuación y zonas altas cercanas.",
                    "No te quedes ni estaciones vehículos en el cauce de quebradas secas.",
                    "Coordina con tu municipalidad o Defensa Civil."],
        "campo": ["Cosecha la fruta madura y protégela de la humedad.",
                  "Refuerza bordos y limpia los canales de evacuación.",
                  "Sube a zonas altas abonos, insumos y equipos."]},
    3: {"general": ["Sigue las indicaciones de INDECI y de tu municipalidad.",
                    "Aléjate de quebradas, ríos y laderas durante y después de la lluvia.",
                    "No cruces calles ni caminos inundados."],
        "campo": ["La seguridad de las personas va antes que el cultivo.",
                  "Pon a salvo animales, maquinaria e insumos en zonas altas.",
                  "Registra los daños con fotos y fechas para reportes y seguros."]},
}
ACCIONES_CALOR = {"general": ["Hidrátate y evita el sol entre las 11 y las 15 horas."],
                  "campo": ["Riega temprano o al final de la tarde.",
                            "Vigila el estrés por calor en plantas jóvenes y recién trasplantadas."]}


def _ventana(doy, d, ancho=15):
    dist = np.abs(doy - d)
    return np.minimum(dist, 366 - dist) <= ancho


def climatologia(hist):
    """Umbrales normales por día del año (ventana de ±15 días), base 1991-2020."""
    h = hist.set_index("fecha").sort_index()
    base = h.loc["1991":"2020"]
    if len(base) < 3650:
        base = h
    pr = base["precipitation_sum"]
    s7 = pr.rolling(7).sum()
    s15 = pr.rolling(15).sum()
    tx = base["temperature_2m_max"]
    doy = base.index.dayofyear.values
    filas = []
    for d in range(1, 367):
        m = _ventana(doy, d)
        hum = pr.values[m]
        hum = hum[hum >= 1.0]
        if len(hum) >= 20:
            p90, p95, p99 = np.percentile(hum, [90, 95, 99])
        else:  # zonas y meses casi sin lluvia: umbrales fijos
            p90, p95, p99 = 5.0, 10.0, 20.0
        t1 = max(p90, MINIMO_MM)
        t2 = max(p95, t1)
        t3 = max(p99, t2)
        v7, v15 = s7.values[m], s15.values[m]
        filas.append({"doy": d, "t1": t1, "t2": t2, "t3": t3,
                      "p50_7d": np.nanmedian(v7), "p95_7d": np.nanpercentile(v7, 95),
                      "p50_15d": np.nanmedian(v15),
                      "tx_media": np.nanmean(tx.values[m]), "tx_desv": max(np.nanstd(tx.values[m]), 0.5)})
    return pd.DataFrame(filas).set_index("doy")


def _clase(v, u):
    if pd.isna(v) or v < u.t1:
        return 0
    return 3 if v >= u.t3 else 2 if v >= u.t2 else 1


def _mm(v):
    return "casi nada" if v < 1 else f"{v:.0f} mm"


def _dia(f, corto=False):
    return f"{(DIAS_CORTO if corto else DIAS)[f.weekday()]} {f.day}"


def temporadas(hist, hoy):
    """Lluvia de la temporada dic–may en cada año, normal 1991-2020 y la temporada actual."""
    pr = hist.set_index("fecha")["precipitation_sum"]
    temp = pr[pr.index.month.isin([12, 1, 2, 3, 4, 5])]
    anio_t = np.where(temp.index.month == 12, temp.index.year + 1, temp.index.year)
    tot = temp.groupby(anio_t).agg(["sum", "count"])
    tot = tot[tot["count"] >= 175]["sum"]
    normal = tot.loc[1991:2020].median() if len(tot.loc[1991:2020]) >= 10 else tot.median()
    out = {"normal_mm": round(float(normal), 1) if pd.notna(normal) else None,
           "eventos": [{"anio": a, "nombre": n, "mm": round(float(tot[a]), 1)}
                       for a, n in EVENTOS.items() if a in tot.index],
           "actual": None}
    ultimo = pr.index.max()
    if ultimo.month in (12, 1, 2, 3, 4, 5):
        inicio = pd.Timestamp(ultimo.year - (0 if ultimo.month == 12 else 1), 12, 1)
        dias = (ultimo - inicio).days
        acum = float(pr.loc[inicio:ultimo].sum())
        # lo normal a esta misma altura de la temporada
        previos = [pr.loc[pd.Timestamp(a - 1, 12, 1):pd.Timestamp(a - 1, 12, 1) + pd.Timedelta(days=dias)].sum()
                   for a in range(1991, 2021)]
        out["actual"] = {"desde": f"{inicio:%Y-%m-%d}", "hasta": f"{ultimo:%Y-%m-%d}", "mm": round(acum, 1),
                         "normal_a_la_fecha_mm": round(float(np.median(previos)), 1)}
    return out


def _cuando_texto(v):
    """'tarde' -> 'por la tarde'; 'tarde y noche' -> 'entre la tarde y la noche'."""
    if not v:
        return ""
    f = v["franja"]
    if f == "casi todo el día":
        return "durante casi todo el día"
    partes = f.split(" y ")
    if len(partes) == 2:
        return f"entre la {partes[0]} y la {partes[1]}"
    return {"madrugada": "de madrugada", "mañana": "en la mañana", "tarde": "por la tarde", "noche": "por la noche"}[f]


def evaluar(p, hist, pron, clim, mar, hoy, matriz=None):
    """Evalúa un punto. `pron`: filas del último pronóstico para este punto (formato largo).
    `matriz`: {(modelo, fecha): 24 valores horarios de lluvia} del mismo pronóstico (opcional)."""
    matriz = matriz or {}
    hoy = pd.Timestamp(hoy).normalize()
    h = hist.set_index("fecha").sort_index()
    salida = {k: p.get(k) for k in ("id", "provincia", "departamento", "lat", "lon")}
    salida["nombre"] = p.get("ciudad") or p.get("provincia")
    salida["temporadas"] = temporadas(hist, hoy)

    # --- Serie de los últimos 60 días observados ---
    obs = h["precipitation_sum"].loc[h.index.max() - pd.Timedelta(days=59):]

    if pron is None or pron.empty:
        salida.update(nivel=None, veredicto="Aún no hay pronóstico para este lugar.", dias=[], criterios=[],
                      acciones=ACCIONES[0])
        salida["serie"] = _serie(obs, pd.Series(dtype=float), clim)
        return salida

    pron = pron[pron["plazo_dias"].between(1, 7)]
    lluvia = pron[pron.variable == "precipitation_sum"].pivot_table(
        index="fecha_objetivo", columns="modelo", values="valor")
    tmax = pron[pron.variable == "temperature_2m_max"].pivot_table(
        index="fecha_objetivo", columns="modelo", values="valor").mean(axis=1)
    modelos = list(lluvia.columns)
    media = lluvia.mean(axis=1)

    # --- Lluvia día a día ---
    dias, mejor = [], None
    for f, fila in lluvia.iterrows():
        u = clim.loc[f.dayofyear]
        clases = {m: _clase(fila[m], u) for m in modelos}
        cmax, cmin = max(clases.values()), min(clases.values())
        puntaje = cmax if cmin >= cmax - 1 else cmax - 1  # un solo modelo con lluvia fuerte: baja un nivel
        tx = tmax.get(f, np.nan)
        z = (tx - u.tx_media) / u.tx_desv if pd.notna(tx) else 0
        plazo = int((f - hoy).days)
        horas_dia = {m: H.ventana(matriz[(m, f)]) for m in modelos if (m, f) in matriz}
        cuando = H.combinar(horas_dia, plazo) if horas_dia else None
        dias.append({"fecha": f"{f:%Y-%m-%d}", "dia": _dia(f, True), "lluvia_mm": round(float(media[f]), 1),
                     "modelos": {m: round(float(fila[m]), 1) for m in modelos}, "clase": puntaje,
                     "umbral_fuerte_mm": round(float(u.t2), 1),
                     "tmax": round(float(tx), 1) if pd.notna(tx) else None, "tmax_z": round(float(z), 1),
                     "plazo": plazo, "horas": cuando})
        clave = (puntaje, fila.max())
        if mejor is None or clave > mejor[0]:
            mejor = (clave, f, clases, fila, u)
    (puntaje_lluvia, _), f_clave, clases_clave, fila_clave, u_clave = mejor

    # --- Acumulado 7 días ---
    acum = float(media.sum())
    u0 = clim.loc[(hoy + pd.Timedelta(days=4)).dayofyear]
    if acum >= max(u0.p95_7d, 20):
        est_acum = 2
    elif acum >= max(2 * u0.p50_7d, 10):
        est_acum = 1
    else:
        est_acum = 0
    nivel_lluvia = max(puntaje_lluvia, est_acum)

    # --- Suelo: últimos 15 días observados ---
    obs15 = float(h["precipitation_sum"].iloc[-15:].sum())
    norm15 = float(clim.loc[h.index.max().dayofyear].p50_15d)
    suelo_humedo = obs15 >= max(3 * norm15, 30)

    # --- Mar frente a la costa norte (Niño 1+2) ---
    influye_mar = p["lat"] > -9.5 and p["lon"] < -78.8  # costa norte y vertiente occidental
    anom = mar.get("anom")
    est_mar = 0 if anom is None else 3 if anom >= 1.7 else 2 if anom >= 1.0 else 1 if anom >= 0.4 else 0

    factores = []
    nivel = nivel_lluvia
    if nivel_lluvia >= 1 and suelo_humedo:
        nivel += 1
        factores.append("suelo ya húmedo")
    if nivel_lluvia >= 1 and influye_mar and est_mar >= 1:
        nivel += 1
        factores.append("mar cálido frente a la costa")
    nivel = min(nivel, 3)

    # --- Calor ---
    zmax = max((d["tmax_z"] for d in dias), default=0)
    d_calor = max(dias, key=lambda d: d["tmax_z"]) if dias else None
    est_calor = 2 if zmax >= 3 else 1 if zmax >= 2 else 0
    nivel_final = max(nivel, est_calor)

    # --- Veredicto en una frase ---
    ligeras = [d for d in dias if d["clase"] == 0 and d["lluvia_mm"] >= LIGERA_MM]
    if nivel_final == 0:
        veredicto = "No se esperan lluvias ni calor fuera de lo normal en los próximos 7 días."
        if ligeras:
            dias_txt = " y ".join(d["dia"] for d in ligeras[:2]) + (" y otros días" if len(ligeras) > 2 else "")
            mm = sum(d["lluvia_mm"] for d in ligeras)
            veredicto = (f"Lluvia{'s' if len(ligeras) > 1 else ''} ligera{'s' if len(ligeras) > 1 else ''} "
                         f"el {dias_txt} (~{max(mm, 1):.0f} mm), dentro de lo esperable. Nada fuera de lo normal en 7 días.")
    elif nivel >= est_calor and nivel_lluvia >= 1:
        if puntaje_lluvia >= 1:
            mm = float(fila_clave.mean())
            v_clave = next((d["horas"] for d in dias if d["fecha"] == f"{f_clave:%Y-%m-%d}"), None)
            cuando_txt = (" " + _cuando_texto(v_clave)) if v_clave else ""
            veredicto = f"Lluvia {INTENSIDAD[puntaje_lluvia]} el {_dia(f_clave)}{cuando_txt} (~{mm:.0f} mm)"
        else:
            veredicto = f"Varios días de lluvia: ~{acum:.0f} mm en la semana, muy por encima de lo normal"
        if factores:
            veredicto += ", con " + " y ".join(factores)
        veredicto += "."
    else:
        f = pd.Timestamp(d_calor["fecha"])
        veredicto = f"Calor inusual el {_dia(f)}: máxima de {d_calor['tmax']:.0f} °C."

    # --- Criterios explicables ---
    acuerdo = (" · ".join(f"{_nombre_modelo(m)} {fila_clave[m]:.0f} mm" for m in modelos))
    if len(modelos) > 1 and puntaje_lluvia >= 1:
        coinciden = min(clases_clave.values()) >= 1
        acuerdo += ". " + ("Ambos modelos la muestran." if coinciden else "Solo un modelo la muestra; menos certeza.")
    criterios = [
        {"titulo": "Día más lluvioso", "estado": int(puntaje_lluvia),
         "valor": f"{fila_clave.mean():.0f} mm el {_dia(f_clave, True)}",
         "detalle": f"Aquí, en esta época, más de {u_clave.t2:.0f} mm en un día es muy fuerte. {acuerdo}"},
        {"titulo": "Lluvia de la semana", "estado": int(est_acum), "valor": f"{acum:.0f} mm",
         "detalle": f"Lo normal en estos 7 días: {_mm(u0.p50_7d)}."},
        {"titulo": "Suelo en los últimos 15 días", "estado": 1 if suelo_humedo else 0, "valor": f"{obs15:.0f} mm",
         "detalle": f"Lo normal: {_mm(norm15)}. Con el suelo húmedo, la lluvia escurre más y sube el riesgo de huaicos e inundaciones."},
        {"titulo": "Temperatura máxima", "estado": int(est_calor),
         "valor": f"{d_calor['tmax']:.0f} °C el {d_calor['dia']}" if d_calor and d_calor["tmax"] else "—",
         "detalle": f"Lo normal: {clim.loc[hoy.dayofyear].tx_media:.0f} °C."},
        {"titulo": "Mar frente a la costa (Niño 1+2)", "estado": int(est_mar) if influye_mar else 0,
         "valor": "—" if anom is None else f"{anom:+.1f} °C",
         "detalle": ("Sobre +0.4 °C sostenido se considera condición cálida. En la costa norte, el mar cálido "
                     "favorece lluvias más intensas." if influye_mar else
                     "En esta zona el mar influye poco en la lluvia de corto plazo; se muestra como contexto.")},
    ]

    acciones = {k: list(v) for k, v in ACCIONES[nivel].items()}
    if ligeras or nivel_lluvia >= 1:
        acciones["campo"].insert(0, CONSEJO_FLORACION)
    if est_calor:
        for k in acciones:
            acciones[k] = ACCIONES_CALOR[k] + acciones[k]

    # Resumen corto del momento clave (para la lista y el mapa)
    clave = next((d for d in dias if d["fecha"] == f"{f_clave:%Y-%m-%d}"), None)
    cuando = None
    if nivel_final >= 1 and puntaje_lluvia >= 1 and clave:
        cuando = clave["dia"] + (f" · {clave['horas']['corto']}" if clave["horas"] else "")
    elif est_calor and d_calor:
        cuando = d_calor["dia"]
    # Lluvia hora a hora de los días con lluvia (para el gráfico de 24 h)
    horario = []
    for d in dias:
        if d["horas"]:
            f = pd.Timestamp(d["fecha"])
            horario.append({"fecha": d["fecha"], "modelos": {m: [round(float(x), 1) for x in matriz[(m, f)]]
                                                             for m in modelos if (m, f) in matriz}})
    salida.update(nivel=int(nivel_final), nivel_nombre=NIVELES[nivel_final], veredicto=veredicto, dias=dias,
                  cuando=cuando, horario=horario,
                  lluvia_ligera=[{"dia": d["dia"], "mm": d["lluvia_mm"]} for d in ligeras],
                  lluvia_7d_mm=round(acum, 1), criterios=criterios, acciones=acciones)
    salida["serie"] = _serie(obs, media, clim)
    return salida


def _nombre_modelo(m):
    return {"ecmwf_ifs025": "ECMWF", "gfs_seamless": "GFS"}.get(m, m.split("_")[0].upper())


def _serie(obs, pron, clim):
    fechas = list(obs.index) + [f for f in pron.index if f > (obs.index.max() if len(obs) else pd.Timestamp.min)]
    return {"fechas": [f"{f:%Y-%m-%d}" for f in fechas],
            "obs": [round(float(obs[f]), 1) if f in obs.index and pd.notna(obs[f]) else None for f in fechas],
            "pron": [round(float(pron[f]), 1) if f in pron.index else None for f in fechas],
            "umbral": [round(float(clim.loc[f.dayofyear].t2), 1) for f in fechas]}
