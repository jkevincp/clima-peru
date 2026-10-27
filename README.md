# Ingesta automática de datos climáticos — MVP Fenómeno El Niño Perú

Un solo comando baja y mantiene al día todo lo necesario para el modelo, desde 1980:

```
python run.py actualizar
```

La primera vez descarga el histórico completo. Las siguientes solo baja lo nuevo. Si una fuente corta por límite de uso o se cae, lo ya descargado queda guardado y la próxima corrida continúa desde ahí.

## Qué descarga

| Fuente | Datos | Desde | Frecuencia | Archivo |
|---|---|---|---|---|
| Open-Meteo (ERA5) | Temperatura máx/mín/media, lluvia, viento, radiación, evapotranspiración, por punto | 1980 | Diaria (≈5 días de retraso) | `datos/openmeteo_historico/<punto>.parquet` |
| Open-Meteo (ECMWF y GFS) | Pronóstico a 7 días, guardado con su fecha de emisión | Hoy en adelante | Diaria | `datos/openmeteo_pronosticos/<AAAA-MM>.parquet` |
| NOAA CPC | Temperatura del mar y anomalía en Niño 1+2, 3, 4 y 3.4 + **ICEN aproximado** con su categoría ENFEN | 1950 (mensual), 1990 (semanal) | Mensual y semanal | `datos/enso/` |
| CHIRPS v2 | Lluvia diaria en grilla, extraída por punto | 1981 | ~3 semanas de retraso | `datos/chirps/chirps_puntos.parquet` |

Ninguna fuente pide registro ni clave.

**Importante:** los pronósticos guardados son la materia prima del modelo a 7 días. Se corrige el pronóstico de ECMWF o GFS con lo que realmente pasó en cada lugar. Ese archivo solo se llena día a día, así que conviene dejar la tarea automática corriendo desde ya.

## Instalación (una vez)

Necesitas Python 3.10 o superior.

**Windows (PowerShell):**
```
cd clima-nino-peru
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py actualizar
```

**Linux / Mac:**
```
cd clima-nino-peru
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py actualizar
```

La primera descarga tarda (CHIRPS baja ~46 archivos anuales de 50–100 MB, uno por uno, y los borra después). Si el plan gratuito de Open-Meteo corta por límite diario, vuelve a correr el comando al día siguiente y continúa.

Cuando termine, revisa:
```
python run.py estado          # qué hay, desde cuándo y si hay huecos
python run.py reporte piura   # gráfico de control en datos/reportes/
```

En el gráfico, los picos de lluvia en Piura deben coincidir con 1983, 1998, 2017 y 2023. Si no coinciden, algo salió mal.

## El mapa (Vigía Niño)

`python run.py web` genera en `sitio/` una página con:

- Mapa del Perú con cada lugar coloreado por nivel (Sin señales, Vigilar, Prepararse, Actuar) y los departamentos teñidos según su peor lugar.
- Al tocar un lugar: una frase con lo que viene, la lluvia y la temperatura de los próximos 7 días, **por qué** tiene ese nivel (criterio por criterio), **qué hacer** en casa y en el campo, la lluvia de los últimos 60 días y cuánto llovió ahí en los Niños de 1983, 1998, 2017 y 2023.
- El estado del mar frente a la costa (Niño 1+2) y el ICEN aproximado.

- **Hoy**: si está lloviendo, si llovió o si lloverá más tarde, cuánto lleva y cuánto falta, con un gráfico hora a hora. En el mapa, un anillo azul marca dónde llueve o llovió hoy (punteado: lloverá más tarde). Se actualiza cada hora, y la página abierta aplica los datos nuevos sola (revisa cada 5 minutos), sin perder el lugar que estás viendo. Es lo que estiman los modelos, no una estación: una llovizna muy local puede no aparecer.
- Las lluvias ligeras se mencionan aunque no suban el nivel de riesgo (el nivel solo sube con lluvias fuera de lo normal para la zona).
- Nombres de departamento en el mapa: al tocarlos, el panel muestra lo más importante de ese departamento y la lista de sus lugares.
- Horarios de referencia: para cada día con lluvia, la franja que concentra el 75 % de la lluvia, la hora más intensa, si ECMWF y GFS coinciden y la certeza según el plazo (alta a 1–2 días, media a 3–4, baja a 5–7).

- **Mi cultivo** (botón en la cabecera): el usuario elige su cultivo y su etapa, y cada lugar muestra el agua que necesitará esta semana (Kc × ET0 − lluvia útil, en mm y m³/ha), el riesgo de hongos, las ventanas para aplicar, el frío para inducir floración, y el calor o frío que dañan en esa etapa. Los valores de referencia y sus fuentes están en `web/cultivos.js`; donde no hay una fuente confiable el valor queda vacío. En "Avanzado" el técnico puede poner sus propios valores. Se guarda en el navegador de cada persona (sin cuentas ni servidor). Para agregar un cultivo, copia un bloque en `web/cultivos.js`.

Las reglas que deciden cada nivel están explicadas al inicio de `herramientas/criterios.py`, y las de los horarios en `fuentes/horas.py`. Son ajustables y son el punto de partida antes de entrenar modelos.

## ¿Qué modelo predice?

Hoy no hay un modelo de machine learning entrenado. El pronóstico viene de dos modelos numéricos del tiempo (ECMWF y GFS), que simulan la física de la atmósfera. El sistema compara ese pronóstico con lo normal de cada lugar (ERA5, 1991–2020) con reglas explicables.

El paso siguiente, cuando se hayan acumulado unos meses de pronósticos en `datos/openmeteo_pronosticos/` y `datos/openmeteo_pronosticos_horas/`, es entrenar un modelo que corrija a ECMWF y GFS con lo que realmente llovió en cada lugar (post-procesamiento estadístico). Ese modelo aprende, por ejemplo, que en un lugar GFS exagera la lluvia o la adelanta unas horas.

Para verlo en tu computadora, sin GitHub:
```
python run.py web
cd sitio
python -m http.server 8000
```
y abre http://localhost:8000 (con doble clic sobre el archivo no carga los datos).

## Automatizar la corrida diaria (elige una)

### Opción A — GitHub (recomendada: datos y mapa sin tu computadora)

Paso a paso, todo desde el navegador (no hace falta saber git):

1. **Crea el repositorio.** En github.com: botón **+ → New repository**. Nombre, por ejemplo, `vigia-nino`. Marca **Public** (GitHub Pages es gratis solo en repositorios públicos; aquí no hay claves ni datos privados). No marques "Add a README". Pulsa **Create repository**.
2. **Sube los archivos.** En la página del repositorio vacío, pulsa el enlace **uploading an existing file**. Descomprime el zip y arrastra **el contenido** de la carpeta `clima-nino-peru` (no la carpeta misma): `run.py`, `config.yaml`, `fuentes/`, `herramientas/`, `web/`, `.github/`, etc. Pulsa **Commit changes**.
   - La carpeta `.github` es oculta en Mac (en Finder, `Cmd + Shift + .` la muestra). Revisa que en el repositorio exista `.github/workflows/actualizar.yml`. Si no está: **Add file → Create new file**, escribe como nombre `.github/workflows/actualizar.yml`, pega el contenido del archivo y pulsa **Commit changes**.
3. **Activa Pages.** **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Permite que el robot guarde datos.** **Settings → Actions → General → Workflow permissions → Read and write permissions → Save**.
5. **Primera corrida.** Pestaña **Actions → Actualizar datos y mapa → Run workflow → Run workflow**. Tarda entre 10 y 20 minutos. Al terminar aparece un check verde.
6. **Abre el mapa.** En **Settings → Pages** aparece la dirección: `https://<tu-usuario>.github.io/vigia-nino/`. También se ve en la corrida, en el paso de publicación.

Desde ahí todo es automático: la corrida completa cada mañana a las 07:17 de Lima y "Hoy" cada hora. GitHub puede retrasar unos minutos las tareas programadas.

Qué esperar los primeros días:
- **Día 1:** el mapa con los 8 lugares de Piura, "Hoy" y el pronóstico. Cada lugar recibe primero sus 10 años más recientes, suficientes para calcular el nivel de riesgo.
- **Días 2 a 4:** se completa el histórico hasta 1980 (el plan gratuito de Open-Meteo cuenta cada bloque de 5 años de histórico como ~130 consultas, y cada corrida usa como máximo 4 000 para no dejar sin cupo a "Hoy").
- Mientras un lugar no tiene 10 años de historia aparece en gris, "En preparación", con su sección "Hoy" funcionando.

Si una corrida sale en rojo, ábrela y mira el paso que falló:
- "Get Pages site failed" o similar: falta el paso 3.
- "Permission denied" o error 403 al guardar: falta el paso 4.
- Avisos de "límite de uso alcanzado": es normal; la corrida siguiente continúa donde quedó.

Si prefieres la línea de comandos (con git instalado):
```
cd clima-nino-peru
git init -b main
git add .
git commit -m "Vigía Niño: primera versión"
git remote add origin https://github.com/<tu-usuario>/vigia-nino.git
git push -u origin main
```
y luego los pasos 3 a 6.

Lo que conviene saber:
- Si pasas a plan pagado de Open-Meteo, guarda la clave como secreto `OPENMETEO_API_KEY` (Settings → Secrets and variables → Actions) y sube `presupuesto_historico` en `config.yaml`.
- "Hoy" se actualiza cada hora. Con las 195 provincias son unas 4 700 consultas al día a Open-Meteo, cerca de la mitad del límite gratuito (10 000 al día, según su documentación). Para bajarlo, cambia en `.github/workflows/actualizar.yml` la línea `"47 * * * *"` por `"47 */2 * * *"` (cada 2 horas).
- GitHub te avisa por correo si una corrida falla.

### Opción B — Programador de tareas de Windows
Crea una tarea diaria con:
- Programa: `C:\ruta\clima-nino-peru\.venv\Scripts\python.exe`
- Argumentos: `run.py actualizar`
- Iniciar en: `C:\ruta\clima-nino-peru`

### Opción C — cron (Linux/Mac)
```
17 7 * * * cd /ruta/clima-nino-peru && .venv/bin/python run.py actualizar
```

Los registros de cada corrida quedan en `datos/logs/`.

## Agregar más lugares

- **Una ciudad o un fundo específico:** agrega una línea en `puntos:` de `config.yaml` con su latitud y longitud.
- **Todo el Perú:** pon `usar_puntos_provincias_csv: true` en `config.yaml` (en GitHub: abre el archivo, lápiz para editar, **Commit changes**). La próxima corrida agrega un punto en el centro de cada una de las 195 provincias. Las ciudades que ya configuraste reemplazan al centro de su provincia.
  - Con el plan gratuito, los 195 lugares tardan unas 2 semanas en tener sus 10 años de historia (nivel de riesgo) y cerca de 2 meses en completar desde 1980. Mientras tanto aparecen en gris con "Hoy" funcionando. Con clave pagada de Open-Meteo es cuestión de horas.

## Notas sobre las fuentes

- **ICEN aproximado:** media móvil de 3 meses de la anomalía ERSST Niño 1+2, con los umbrales del ENFEN. El oficial usa otro periodo base, así que puede diferir unas décimas. Para decisiones, contrasta con el comunicado oficial del ENFEN.
- **ERA5** es un reanálisis de ~25 km. Subestima lluvias muy locales e intensas; por eso se cruza con CHIRPS.
- **CHIRPS** en la costa: si la celda más cercana cae en el mar, se toma la celda válida más cercana.
- **Uso comercial:** la API gratuita de Open-Meteo es para uso no comercial. Si el producto se comercializa, hay que pasar a su plan pagado.
- **SENAMHI (estaciones y PISCO):** no tiene una API pública estable, así que no está automatizado aquí. Es el siguiente paso para validar contra observación real en Piura.

## Estructura

```
run.py                  comando principal
config.yaml             puntos, fechas, variables, fuentes
fuentes/                un módulo por proveedor (openmeteo, noaa_enso, chirps)
herramientas/           criterios de riesgo, exportación del mapa, estado, reporte, puntos
web/                    la página del mapa (HTML, CSS, JS)
.github/workflows/      corrida diaria y publicación del mapa en GitHub
datos/                  se crea solo (Parquet: se abre con pandas, DuckDB, Power BI o Excel con complemento)
```
