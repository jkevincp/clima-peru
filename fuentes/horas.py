"""Franjas horarias de lluvia a partir del pronóstico hora por hora.

Para cada día y modelo se busca la ventana más corta de horas que concentra el 75 % de la lluvia
del día, y la hora de mayor intensidad. Es una referencia: los modelos globales ubican bien el día
de la lluvia, pero la hora exacta tiene más error, sobre todo después del tercer día.
"""
import numpy as np
import pandas as pd

FRANJAS = [(0, 6, "madrugada"), (6, 12, "mañana"), (12, 18, "tarde"), (18, 24, "noche")]
MINIMO_DIA_MM = 1.0


def franja(h):
    for a, b, nombre in FRANJAS:
        if a <= h % 24 < b:
            return nombre
    return ""


def ventana(valores, cuota=0.75):
    """Ventana más corta (horas inicio..fin) que reúne `cuota` de la lluvia del día."""
    v = np.nan_to_num(np.asarray(valores, dtype=float))
    total = v.sum()
    if total < MINIMO_DIA_MM:
        return None
    meta = cuota * total
    mejor = None
    for i in range(len(v)):
        acum = 0.0
        for j in range(i, len(v)):
            acum += v[j]
            if acum >= meta:
                if mejor is None or j - i < mejor[1] - mejor[0]:
                    mejor = (i, j)
                break
    i, j = mejor
    pico = int(v.argmax())
    return {"inicio": i, "fin": j + 1, "pico": pico, "mm_pico": round(float(v[pico]), 1), "mm_dia": round(float(total), 1)}


def a_matriz(horario):
    """horario (punto_id, modelo, hora, precipitation) → {(punto, modelo, fecha): array de 24 valores}"""
    h = horario.copy()
    h["fecha"] = h["hora"].dt.normalize()
    h["h"] = h["hora"].dt.hour
    out = {}
    for (p, m, f), g in h.groupby(["punto_id", "modelo", "fecha"]):
        arr = np.zeros(24)
        arr[g["h"].values] = g["precipitation"].fillna(0).values
        out[(p, m, f)] = arr
    return out


def ventanas_df(horario):
    filas = []
    for (p, m, f), arr in a_matriz(horario).items():
        w = ventana(arr)
        if w:
            filas.append({"punto_id": p, "modelo": m, "fecha_objetivo": f, **w})
    return pd.DataFrame(filas)


def _hora(h):
    return "medianoche" if h in (0, 24) else f"{h}:00"


def certeza(plazo):
    return "alta" if plazo <= 2 else "media" if plazo <= 4 else "baja"


def combinar(por_modelo, plazo):
    """Une las ventanas de varios modelos en una referencia para el usuario."""
    ws = {m: w for m, w in por_modelo.items() if w}
    if not ws:
        return None
    inicio = min(w["inicio"] for w in ws.values())
    fin = max(w["fin"] for w in ws.values())
    if len(ws) > 1:
        acuerdo = max(w["inicio"] for w in ws.values()) < min(w["fin"] for w in ws.values())
    else:
        acuerdo = None
    principal = max(ws.values(), key=lambda w: w["mm_dia"])
    pico = int(round(np.mean([w["pico"] for w in ws.values()]))) if acuerdo else principal["pico"]
    franjas = []
    for a, b, nombre in FRANJAS:
        if inicio < b and fin > a:
            franjas.append(nombre)
    texto = f"entre las {_hora(inicio)} y las {_hora(fin)}" if fin - inicio > 1 else f"cerca de las {_hora(inicio)}"
    return {"inicio": inicio, "fin": fin, "pico": pico, "franja": " y ".join(franjas[:2]) if len(franjas) <= 2 else "casi todo el día",
            "texto": texto, "corto": f"{inicio}–{fin} h", "acuerdo": acuerdo, "certeza": certeza(plazo),
            "por_modelo": {m: {"inicio": w["inicio"], "fin": w["fin"], "pico": w["pico"]} for m, w in ws.items()}}
