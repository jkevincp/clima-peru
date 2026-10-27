"""Zonas para colorear el mapa de lluvia: distritos en los departamentos elegidos (distritos_de) y
provincias en el resto del país. Cada zona sabe qué lugares vigilados caen dentro (punto en polígono);
si no tiene ninguno, toma el más cercano del mismo departamento."""
import json
import math

from fuentes.comun import DATOS, get, log, sesion
from herramientas.puntos import URL as URL_PROV, URL_DISTRITOS, _centroide, _slug

TOLERANCIA = 0.006  # grados (~650 m): simplificación de bordes para que el archivo pese poco


def _geo(nombre, url):
    ruta = DATOS / "geo" / nombre
    if not ruta.exists():
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(get(sesion(), url).content)
    return json.loads(ruta.read_text(encoding="utf-8"))


def _rdp(pts, tol):
    """Simplificación Ramer-Douglas-Peucker."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norma = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / norma
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return _rdp(pts[:idx + 1], tol)[:-1] + _rdp(pts[idx:], tol)
    return [pts[0], pts[-1]]


def _simplificar(geom):
    polis = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    out = []
    for pol in polis:
        anillos = []
        for k, anillo in enumerate(pol):
            pts = [(c[0], c[1]) for c in anillo]
            if len(pts) > 4 and pts[0] == pts[-1]:  # anillo cerrado: se simplifica en dos mitades
                m = len(pts) // 2
                a = _rdp(pts[:m + 1], TOLERANCIA) + _rdp(pts[m:], TOLERANCIA)[1:]
            else:
                a = _rdp(pts, TOLERANCIA)
            if a[0] != a[-1]:
                a.append(a[0])
            a = [[round(x, 3), round(y, 3)] for x, y in a]
            if len(a) >= 4:
                anillos.append(a)
            elif k == 0:
                break
        if anillos:
            out.append(anillos)
    return {"type": "MultiPolygon", "coordinates": out} if out else None


def _dentro(lon, lat, geom):
    polis = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for pol in polis:
        if _en_anillo(lon, lat, pol[0]) and not any(_en_anillo(lon, lat, h) for h in pol[1:]):
            return True
    return False


def _en_anillo(x, y, anillo):
    dentro = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        xi, yi = anillo[i][0], anillo[i][1]
        xj, yj = anillo[j][0], anillo[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def generar(cfg, puntos):
    deps_dist = {_slug(d) for d in (cfg.get("distritos_de") or []) if d}
    zonas = []
    if deps_dist:
        for f in _geo("distritos.geojson", URL_DISTRITOS)["features"]:
            pr, g = f["properties"], f["geometry"]
            if g and _slug(pr.get("NOMBDEP", "")) in deps_dist:
                zonas.append({"id": "d" + pr["IDDIST"], "nombre": pr["NOMBDIST"].title(), "tipo": "distrito",
                              "provincia": pr["NOMBPROV"].title(), "departamento": pr["NOMBDEP"].title(), "geom": g})
    # provincias: solo si se vigilan las provincias del país, o las de los departamentos con lugares
    deps_con_puntos = {_slug(p["departamento"]) for p in puntos}
    for f in _geo("provincias.geojson", URL_PROV)["features"]:
        pr, g = f["properties"], f["geometry"]
        dep = _slug(pr.get("FIRST_NOMB", ""))
        if g and dep not in deps_dist and dep in deps_con_puntos:
            zonas.append({"id": "p" + pr["FIRST_IDPR"], "nombre": pr["NOMBPROV"].title(), "tipo": "provincia",
                          "provincia": pr["NOMBPROV"].title(), "departamento": pr["FIRST_NOMB"].title(), "geom": g})
    # asignar lugares
    for z in zonas:
        z["puntos"] = [p["id"] for p in puntos if _dentro(p["lon"], p["lat"], z["geom"])]
    for z in zonas:
        if not z["puntos"]:
            g = z["geom"]
            polis = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            cx, cy, _ = max((_centroide([tuple(c[:2]) for c in pol[0]]) for pol in polis), key=lambda t: t[2])
            mismos = [p for p in puntos if _slug(p["departamento"]) == _slug(z["departamento"])] or puntos
            cerca = min(mismos, key=lambda p: (p["lon"] - cx) ** 2 + (p["lat"] - cy) ** 2)
            z["puntos"] = [cerca["id"]]
            z["aproximada"] = True
    feats = []
    for z in zonas:
        g = _simplificar(z.pop("geom"))
        if g:
            feats.append({"type": "Feature", "properties": z, "geometry": g})
    log.info("Zonas de lluvia: %s (%s distritos, %s provincias)", len(feats),
             sum(f["properties"]["tipo"] == "distrito" for f in feats), sum(f["properties"]["tipo"] == "provincia" for f in feats))
    return {"type": "FeatureCollection", "features": feats}
