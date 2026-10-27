/* Valores de referencia por cultivo para "Mi cultivo".
 *
 * Regla: cada número lleva su fuente. Si no se encontró una fuente confiable, el valor queda en null
 * y la interfaz muestra "sin referencia" (el usuario puede ingresarlo en "Avanzado").
 * Son valores generales: varían según variedad, zona y manejo. Para agregar un cultivo, copia un bloque.
 *
 * kc        coeficiente de cultivo por etapa (agua que usa el cultivo = Kc × ET0)
 * base      temperatura base para grados-día (°C)
 * induccion inducción floral por frío: cuenta días con temperatura {min|media} ≤ umbral, en las etapas indicadas
 * calor     horas con temperatura ≥ umbral que dañan, en las etapas indicadas
 * frio      temperatura {hora|media} ≤ umbral que daña, en las etapas indicadas
 */
(function () {
  "use strict";

  var F = {
    fao56: { texto: "FAO, Estudio de Riego y Drenaje 56 (Allen et al., 1998), cuadro 12", url: "https://www.fao.org/3/x0490e/x0490e0b.htm" },
    mango: { texto: "Revisión sobre floración del mango (National Mango Board), que cita a Davenport 2007 y Sukhvibul et al. 2000", url: "https://www.mango.org/es/mango-flowering-review_italo-cavalcante-atual-2" },
    mangoBase: { texto: "Lemos et al. 2018 (cv. Ubá), citado en la revisión del National Mango Board", url: "https://www.mango.org/es/mango-flowering-review_italo-cavalcante-atual-2" },
    citrico: { texto: "Chica, 2013. Cool temperature and water deficit interact during floral induction in citrus", url: "https://redi.cedia.edu.ec/document/97629" },
    palta: { texto: "Davenport, 1986. Avocado flowering. Horticultural Reviews 8 (cita a Buttrose y Alexander 1978; Sedgley 1977; Hodgson 1935)", url: "https://mail.growables.org/information/TropicalFruit/documents/AvocadoFlowUF.pdf" },
    arroz: { texto: "Chakrabarti et al. Impact of high temperature on pollen germination and spikelet sterility in rice", url: "https://ccafs.cgiar.org/es/node/110370" },
    banano: { texto: "Chang et al., 2022. Frontiers in Plant Science 13:966789 (umbral de daño por frío de la fruta)", url: "https://www.frontiersin.org/articles/10.3389/fpls.2022.966789/full" },
    uvaBase: { texto: "Índice de Winkler (Amerine y Winkler, 1944; Winkler et al., General Viticulture)", url: null },
  };

  var FRUTAL = ["Reposo e inducción floral", "Brotación", "Floración", "Cuajado y crecimiento del fruto", "Cosecha"];
  var SENSIBLES_FRUTAL = ["Floración", "Cuajado y crecimiento del fruto", "Cosecha"];
  // Etapas cuyo Kc no está en la tabla FAO-56 sino interpolado entre la etapa inicial y la media (método FAO-56)
  var INTERPOLADAS = { "Floración": true, "Macollaje": true };
  function kcFrutal(ini, mid, end) {  // etapas de frutales → inicial, media y final de FAO-56 (aproximado)
    return { "Reposo e inducción floral": ini, "Brotación": ini, "Floración": +((ini + mid) / 2).toFixed(2), "Cuajado y crecimiento del fruto": mid, "Cosecha": end };
  }

  window.CULTIVOS = [
    {
      id: "mango", nombre: "Mango", etapas: FRUTAL, sensibles: SENSIBLES_FRUTAL,
      kc: null, fuenteKc: null,
      base: 10, fuenteBase: F.mangoBase,
      induccion: { variable: "min", umbral: 15, etapas: ["Reposo e inducción floral"], fuente: F.mango,
        nota: "Las noches de 10 a 15 °C favorecen la inducción floral; las noches cálidas la retrasan." },
      calor: null, frio: null,
    },
    {
      id: "limon", nombre: "Limón y cítricos", etapas: FRUTAL, sensibles: SENSIBLES_FRUTAL,
      kc: kcFrutal(0.65, 0.60, 0.65), fuenteKc: F.fao56, notaKc: "Cítricos sin cobertura, 50 % de copa.",
      base: null, fuenteBase: null,
      induccion: { variable: "media", umbral: 20, etapas: ["Reposo e inducción floral"], fuente: F.citrico,
        nota: "Las temperaturas frescas (menos de 20 °C) inducen la floración, junto con el déficit de agua." },
      calor: null, frio: null,
    },
    {
      id: "uva", nombre: "Uva", etapas: FRUTAL, sensibles: SENSIBLES_FRUTAL,
      kc: kcFrutal(0.30, 0.85, 0.45), fuenteKc: F.fao56, notaKc: "Uva de mesa o pasa.",
      base: 10, fuenteBase: F.uvaBase,
      induccion: null, calor: null, frio: null,
    },
    {
      id: "palta", nombre: "Palta", etapas: FRUTAL, sensibles: SENSIBLES_FRUTAL,
      kc: kcFrutal(0.60, 0.85, 0.75), fuenteKc: F.fao56, notaKc: "Palto sin cobertura de suelo.",
      base: null, fuenteBase: null,
      induccion: { variable: "min", umbral: 15, etapas: ["Reposo e inducción floral"], fuente: F.palta,
        nota: "Días de unos 20 °C y noches de 5 a 15 °C favorecen la inducción; días de 25 a 30 °C la inhiben." },
      calor: { umbral: 33, etapas: ["Floración", "Cuajado y crecimiento del fruto"], fuente: F.palta,
        nota: "Con 33 °C de día se detiene el desarrollo de la flor y caen flores y frutos pequeños." },
      frio: { variable: "media", umbral: 15, etapas: ["Floración", "Cuajado y crecimiento del fruto"], fuente: F.palta,
        nota: "Con temperatura media menor de 15 °C baja el cuajado." },
    },
    {
      id: "cana", nombre: "Caña de azúcar",
      etapas: ["Brotación y macollaje", "Gran crecimiento", "Maduración", "Cosecha"], sensibles: [],
      kc: { "Brotación y macollaje": 0.40, "Gran crecimiento": 1.25, "Maduración": 0.75, "Cosecha": 0.75 }, fuenteKc: F.fao56,
      base: null, fuenteBase: null, induccion: null, calor: null, frio: null,
    },
    {
      id: "arroz", nombre: "Arroz",
      etapas: ["Almácigo y trasplante", "Macollaje", "Floración", "Llenado de grano", "Maduración"], sensibles: ["Floración", "Llenado de grano"],
      kc: { "Almácigo y trasplante": 1.05, "Macollaje": 1.10, "Floración": 1.20, "Llenado de grano": 1.20, "Maduración": 0.90 }, fuenteKc: F.fao56,
      base: null, fuenteBase: null, induccion: null,
      calor: { umbral: 33, etapas: ["Floración"], fuente: F.arroz, nota: "Sobre 33 °C en floración aumenta la esterilidad del polen." },
      frio: null,
    },
    {
      id: "banano", nombre: "Banano",
      etapas: ["Planta joven", "Floración (parición)", "Llenado del racimo", "Cosecha"], sensibles: ["Floración (parición)", "Llenado del racimo", "Cosecha"],
      kc: { "Planta joven": 0.50, "Floración (parición)": 1.20, "Llenado del racimo": 1.20, "Cosecha": 1.10 }, fuenteKc: F.fao56,
      notaKc: "Planta joven: primer año; las demás etapas, segundo año en adelante.",
      base: null, fuenteBase: null, induccion: null, calor: null,
      frio: { variable: "hora", umbral: 14, etapas: ["Llenado del racimo", "Cosecha"], fuente: F.banano,
        nota: "Bajo 14 °C la fruta puede sufrir daño por frío (referencia de poscosecha)." },
    },
    {
      id: "otro", nombre: "Otro cultivo", otro: true,
      etapas: ["Reposo", "Crecimiento", "Floración", "Desarrollo del fruto o grano", "Cosecha"], sensibles: ["Floración", "Desarrollo del fruto o grano", "Cosecha"],
      kc: null, fuenteKc: null, base: null, fuenteBase: null, induccion: null, calor: null, frio: null,
    },
  ];

  // Valores generales (no dependen del cultivo)
  window.KC_INTERPOLADO = INTERPOLADAS;
  window.CAMPO_GENERAL = {
    humedad: { umbral: 90, fuente: { texto: "Humedad relativa ≥ 90 % como aproximación de hoja mojada (Sentelhas et al., 2008)", url: null } },
    viento: { umbral: 15, fuente: { texto: "Buena práctica general de aplicación: viento menor de 15 km/h; revisa siempre la etiqueta del producto", url: null } },
  };
})();
