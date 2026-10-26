"""Resumen de qué datos hay, de qué fechas y con cuántos huecos."""
import pandas as pd

from fuentes.comun import DATOS


def _linea(nombre, df, col="fecha"):
    if df is None or df.empty:
        return f"  {nombre:<34} sin datos"
    f = pd.to_datetime(df[col])
    return f"  {nombre:<34} {f.min():%Y-%m-%d} → {f.max():%Y-%m-%d}  ({len(df):,} filas)"


def resumen():
    print("\nESTADO DE LOS DATOS")
    hist = sorted((DATOS / "openmeteo_historico").glob("*.parquet"))
    print(f"\nOpen-Meteo histórico (ERA5) — {len(hist)} puntos")
    for r in hist:
        df = pd.read_parquet(r)
        esperado = (df.fecha.max() - df.fecha.min()).days + 1
        huecos = esperado - df.fecha.nunique()
        nulos = df["precipitation_sum"].isna().sum() if "precipitation_sum" in df else 0
        print(_linea(r.stem, df) + (f"  ⚠ {huecos} días faltantes" if huecos else "")
              + (f"  ⚠ {nulos} lluvias nulas" if nulos else ""))

    pron = sorted((DATOS / "openmeteo_pronosticos").glob("*.parquet"))
    print("\nOpen-Meteo pronósticos guardados")
    if pron:
        df = pd.concat(pd.read_parquet(r) for r in pron)
        print(_linea(f"{df.fecha_emision.nunique()} emisiones, {df.modelo.nunique()} modelos", df, "fecha_emision"))
    else:
        print("  sin datos")

    print("\nNOAA índices Niño")
    for nombre in ["nino_mensual", "nino_semanal"]:
        r = DATOS / "enso" / f"{nombre}.parquet"
        df = pd.read_parquet(r) if r.exists() else None
        print(_linea(nombre, df))
        if nombre == "nino_mensual" and df is not None:
            u = df.dropna(subset=["icen_aprox"]).iloc[-1]
            print(f"  {'último ICEN aprox':<34} {u.fecha:%Y-%m}: {u.icen_aprox:+.2f} ({u.icen_categoria})")

    r = DATOS / "chirps" / "chirps_puntos.parquet"
    print("\nCHIRPS")
    print(_linea("lluvia diaria por punto", pd.read_parquet(r) if r.exists() else None))
    print()
