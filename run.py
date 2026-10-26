"""Punto de entrada.

  python run.py actualizar            # baja todo lo que falta (la 1ra vez: desde 1980) + pronóstico de hoy
  python run.py actualizar --solo ahora   # solo las condiciones de hoy (rápido; para correr cada pocas horas)
  python run.py actualizar --solo noaa,openmeteo
  python run.py estado                # qué datos hay y si hay huecos
  python run.py reporte [punto]       # gráfico de control lluvia vs. Niño 1+2
  python run.py puntos                # genera un punto por cada provincia del Perú
  python run.py web                   # genera el sitio con el mapa en sitio/ (ábrelo con un servidor local)

Se puede correr todas las veces que quieras: solo descarga lo que falta.
"""
import argparse
import logging
import sys
from datetime import date

from fuentes import ahora, chirps, noaa_enso, openmeteo
from fuentes.comun import DATOS, LimiteAlcanzado, cargar_config, cargar_puntos, log, sesion

# Orden de ejecución: primero lo que alimenta el mapa de hoy, al final las descargas largas
FUENTES = ["noaa", "pronostico", "ahora", "openmeteo", "chirps"]


def configurar_logs():
    (DATOS / "logs").mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    for h in (logging.StreamHandler(sys.stdout),
              logging.FileHandler(DATOS / "logs" / f"{date.today():%Y-%m-%d}.log", encoding="utf-8")):
        h.setFormatter(fmt)
        log.addHandler(h)
    log.setLevel(logging.INFO)


def actualizar(cfg, solo, forzar_chirps=False):
    s = sesion()
    puntos = cargar_puntos(cfg)
    log.info("Actualizando %s para %s puntos", ", ".join(solo), len(puntos))
    tareas = {
        "noaa": (cfg["noaa_enso"]["activo"], lambda: noaa_enso.actualizar(cfg, s)),
        "openmeteo": (cfg["openmeteo"]["activo"], lambda: openmeteo.historico(cfg, puntos, s)),
        "pronostico": (cfg["openmeteo"]["activo"] and cfg["openmeteo"]["pronostico"]["activo"],
                       lambda: openmeteo.pronostico(cfg, puntos, s)),
        "chirps": (cfg["chirps"]["activo"], lambda: chirps.actualizar(cfg, puntos, s, forzar_chirps)),
        "ahora": (cfg["openmeteo"]["activo"], lambda: ahora.actualizar(cfg, puntos, s)),
    }
    errores = []
    for nombre in solo:
        activo, tarea = tareas[nombre]
        if not activo:
            continue
        try:
            tarea()
        except LimiteAlcanzado as e:
            log.warning("%s: límite de uso alcanzado (%s). Lo descargado quedó guardado; "
                        "la próxima corrida continúa desde ahí.", nombre, e)
        except Exception as e:  # una fuente caída no debe frenar a las demás
            log.exception("%s falló: %s", nombre, e)
            errores.append(nombre)
    if errores:
        log.error("Terminado con errores en: %s", ", ".join(errores))
        return 1
    log.info("Terminado sin errores")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("comando", choices=["actualizar", "estado", "reporte", "puntos", "web"])
    ap.add_argument("--demo", action="store_true", help="marca el sitio como datos de demostración")
    ap.add_argument("punto", nargs="?", default="piura", help="punto para el reporte")
    ap.add_argument("--solo", default=",".join(FUENTES), help=f"fuentes separadas por coma: {','.join(FUENTES)}")
    ap.add_argument("--forzar-chirps", action="store_true", help="refrescar el año en curso de CHIRPS hoy")
    a = ap.parse_args()
    configurar_logs()
    cfg = cargar_config()
    if a.comando == "actualizar":
        pedidas = {x.strip() for x in a.solo.split(",")}
        solo = [f for f in FUENTES if f in pedidas]
        sys.exit(actualizar(cfg, solo, a.forzar_chirps))
    if a.comando == "estado":
        from herramientas.estado import resumen
        resumen()
    elif a.comando == "reporte":
        from herramientas.reporte import generar
        generar(a.punto)
    elif a.comando == "web":
        from herramientas.web import exportar
        exportar(cfg, demo=a.demo)
    elif a.comando == "puntos":
        from herramientas.puntos import generar
        generar(sesion())


if __name__ == "__main__":
    main()
