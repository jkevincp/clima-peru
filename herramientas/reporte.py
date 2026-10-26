"""Gráfico de control: lluvia mensual de un punto vs. anomalía del mar en Niño 1+2.
Si la descarga salió bien, los picos de lluvia en la costa norte deben coincidir con
1983, 1998, 2017 y 2023."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from fuentes.comun import DATOS, log

EVENTOS = {"1982-83": ("1982-10", "1983-07"), "1997-98": ("1997-10", "1998-06"),
           "2017 (costero)": ("2017-01", "2017-04"), "2023": ("2023-02", "2023-07")}


def generar(punto="piura"):
    ruta = DATOS / "openmeteo_historico" / f"{punto}.parquet"
    if not ruta.exists():
        raise SystemExit(f"No hay histórico para '{punto}'. Corre primero: python run.py actualizar")
    lluvia = pd.read_parquet(ruta).set_index("fecha")["precipitation_sum"].resample("MS").sum(min_count=20)
    nino = pd.read_parquet(DATOS / "enso" / "nino_mensual.parquet").set_index("fecha")
    nino = nino.loc[lluvia.index.min():]

    fig, (a1, a2) = plt.subplots(2, 1, figsize=(13, 6.5), sharex=True,
                                 gridspec_kw={"height_ratios": [3, 2]})
    a1.bar(lluvia.index, lluvia.values, width=25, color="#2b6cb0")
    a1.set_ylabel("Lluvia mensual (mm)")
    a1.set_title(f"{punto.title()}: lluvia mensual (ERA5) vs. temperatura del mar frente a la costa (Niño 1+2)",
                 loc="left", fontsize=11)
    colores = ["#c53030" if v > 0 else "#2c5282" for v in nino["icen_aprox"].fillna(0)]
    a2.bar(nino.index, nino["icen_aprox"], width=25, color=colores)
    for y, txt in [(0.4, "umbral cálido"), (1.7, "fuerte")]:
        a2.axhline(y, color="#718096", lw=0.8, ls="--")
        a2.text(nino.index.min(), y + 0.08, txt, fontsize=8, color="#4a5568")
    a2.set_ylabel("ICEN aprox (°C)")
    for nombre, (d, h) in EVENTOS.items():
        for ax in (a1, a2):
            ax.axvspan(pd.Timestamp(d), pd.Timestamp(h), color="#f6ad55", alpha=0.25, lw=0)
        a1.text(pd.Timestamp(d), a1.get_ylim()[1] * 0.92, nombre, fontsize=8)
    for ax in (a1, a2):
        ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    salida = DATOS / "reportes" / f"{punto}_lluvia_vs_nino.png"
    salida.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(salida, dpi=130)

    top = lluvia.sort_values(ascending=False).head(10)
    print(f"\nLos 10 meses más lluviosos en {punto} desde {lluvia.index.min():%Y}:")
    for f, v in top.items():
        icen = nino["icen_aprox"].get(f)
        print(f"  {f:%Y-%m}  {v:7.1f} mm   ICEN aprox {icen:+.2f}" if pd.notna(icen) else f"  {f:%Y-%m}  {v:7.1f} mm")
    log.info("Gráfico guardado en %s", salida)
    return salida
