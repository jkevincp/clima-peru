"""Resume la lluvia de hoy en un lugar: si está lloviendo, cuánto lleva y cuánto falta."""
import numpy as np
import pandas as pd


CODIGOS = {
    0: "Despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
    45: "Neblina", 48: "Neblina", 51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna intensa",
    56: "Llovizna", 57: "Llovizna", 61: "Lluvia ligera", 63: "Lluvia moderada", 65: "Lluvia fuerte",
    66: "Lluvia", 67: "Lluvia fuerte", 71: "Nevada ligera", 73: "Nevada", 75: "Nevada fuerte", 77: "Granizo menudo",
    80: "Chubascos ligeros", 81: "Chubascos", 82: "Chubascos fuertes", 85: "Nevada", 86: "Nevada fuerte",
    95: "Tormenta", 96: "Tormenta con granizo", 99: "Tormenta con granizo",
}
MIN_MM = 0.1  # por debajo, se considera sin lluvia


def intensidad(mm_h):
    return "muy ligera" if mm_h < 0.5 else "ligera" if mm_h < 2.5 else "moderada" if mm_h < 7.6 else "fuerte"


def _horas(h):
    return f"{h}:00"


def _rango(idx):
    """idx: horas con lluvia (el valor de las 15:00 es lo caído entre 14:00 y 15:00)."""
    inicio, fin = max(int(idx[0]) - 1, 0), int(idx[-1])
    return f"entre las {_horas(inicio)} y las {_horas(fin)}" if fin - inicio > 1 else f"cerca de las {_horas(fin)}"


def resumir(horario, actual):
    """horario: filas de un punto (hora, precipitation, weather_code). actual: dict con hora, precipitation, weather_code."""
    if horario is None or horario.empty or actual is None or pd.isna(actual.get("hora")):
        return None
    ahora = pd.Timestamp(actual["hora"])
    dia = ahora.normalize()
    h = horario.set_index("hora").sort_index()
    pr = h["precipitation"].fillna(0)
    cod = h["weather_code"].fillna(0) if "weather_code" in h else pd.Series(0, index=h.index)

    hoy = pr.loc[dia:dia + pd.Timedelta(hours=23)].reindex(pd.date_range(dia, periods=24, freq="h"), fill_value=0)
    cod_hoy = cod.reindex(hoy.index, fill_value=0)
    hora_actual = int(ahora.hour)
    # En Open-Meteo la lluvia de las 14:00 es la caída entre 13:00 y 14:00
    pasado = hoy.iloc[:hora_actual + 1]
    futuro = hoy.iloc[hora_actual + 1:]
    hasta_ahora, resto = float(pasado.sum()), float(futuro.sum())
    ayer = float(pr.loc[dia - pd.Timedelta(days=1):dia - pd.Timedelta(hours=1)].sum())
    ult3 = float(pr.loc[ahora - pd.Timedelta(hours=2):ahora].sum())

    codigo = int(actual.get("weather_code") or 0)
    mm_ahora = float(actual.get("precipitation") or 0)
    lloviendo = mm_ahora >= MIN_MM or codigo >= 51 and codigo not in (71, 73, 75, 77, 85, 86) and ult3 >= MIN_MM
    descripcion = CODIGOS.get(codigo, "")

    partes = []
    if lloviendo:
        estado = "lloviendo"
        partes.append(f"{descripcion or 'Lluvia'} en este momento.")
    elif hasta_ahora >= MIN_MM:
        estado = "llovio"
        idx = np.flatnonzero(pasado.values >= MIN_MM)
        partes.append(f"Llovió hoy {_rango(idx)}.")
    elif resto >= MIN_MM:
        estado = "llovera"
    else:
        estado = "seco"
    if hasta_ahora >= MIN_MM:
        maxh = float(pasado.max())
        partes.append(f"Van {hasta_ahora:.1f} mm, lluvia {intensidad(maxh)}.")
    if resto >= MIN_MM:
        idx = np.flatnonzero(futuro.values >= MIN_MM) + hora_actual + 1
        partes.append(f"{'Se esperan' if estado != 'llovera' else 'Se espera lluvia ' + intensidad(float(futuro.max())) + ':'} "
                      f"{resto:.1f} mm {'más ' if hasta_ahora >= MIN_MM else ''}{_rango(idx)}.")
    elif estado in ("lloviendo", "llovio"):
        partes.append("No se espera más lluvia hoy.")
    if estado == "seco":
        partes.append("Sin lluvia hoy." + (f" Ayer cayeron {ayer:.1f} mm." if ayer >= MIN_MM else ""))

    return {
        "consultado": f"{ahora:%Y-%m-%dT%H:%M}", "fecha": f"{dia:%Y-%m-%d}", "hora_actual": hora_actual,
        "estado": estado, "descripcion": descripcion, "texto": " ".join(partes),
        "hasta_ahora_mm": round(hasta_ahora, 1), "resto_mm": round(resto, 1), "ayer_mm": round(ayer, 1),
        "temperatura": actual.get("temperature_2m"),
        "horas": [round(float(v), 2) for v in hoy.values], "codigos": [int(c) for c in cod_hoy.values],
    }

