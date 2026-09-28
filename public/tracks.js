// ============================================================
//  8 BITS RACING - Pistas
//  Cada pista es una lista de puntos de control; se suaviza con
//  una spline Catmull-Rom cerrada y se remuestrea cada SAMPLE_DS px.
//  La dificultad sube con el número de curvas, lo cerradas que son
//  y lo estrecha que es la pista.
// ============================================================
'use strict';

const SAMPLE_DS = 8;       // separación entre muestras de la pista (px)
const RUNOFF = 42;         // zona de hierba/tierra antes del muro

// Física compartida (px por frame a 60 fps). La usa la IA para saber
// a qué velocidad puede tomar cada curva.
const PHYS = {
  accel: 0.16,
  brake: 0.32,
  maxSpeed: 9,
  reverseMax: 2.6,
  turn: 0.06,
  grassMax: 3.6,
};

// Fórmula 1 (pistas reales a escala, 5 px = 1 m): punta de 500 km/h en rectas
// largas, frenada y agarre de F1. En curva manda la fuerza lateral (~6 g):
// cuanto más rápido, más abierta tiene que ser la curva.
const PX_PER_M = 5;
const F1 = {
  accel: 0.036,          // aceleración (px/frame²); cae al acercarse a la punta (falloff)
  falloff: 0.6,
  brake: 0.12,           // ~5 g de frenada
  maxSpeed: 11.6,        // 500 km/h
  reverseMax: 2.2,
  turn: 0.075,           // giro máximo a baja velocidad
  latAcc: 0.08,          // agarre lateral (~6 g)
  grassMax: 3,
  grip: 0.7,             // derrapa menos que un kart
  drag: 0.999,
  kmh: 60 * 3.6 / PX_PER_M,   // px/frame -> km/h reales (43,2)
  turboSpeed: 1.08,      // el turbo del último no pasa de ~540 km/h
};
PHYS.kmh = 30;           // en los karts el marcador es "de juego" (9 px/frame = 270 km/h)

function turnRateFor(P, v) {
  const s = Math.abs(v);
  if (P.latAcc) return Math.min(P.turn * Math.min(1, s / 1.2), P.latAcc / Math.max(s, 0.1));
  return P.turn * Math.min(1, s / 2.5) * (1 - 0.35 * Math.min(1, s / P.maxSpeed));
}
function turnRate(v) { return turnRateFor(PHYS, v); }
const carPhys = def => (def.car === 'f1' ? F1 : PHYS);

// ============================================================
//  COCHES ELEGIBLES (pistas inventadas y arena; en las pistas reales
//  a escala se corre con F1). Multiplicadores sobre la física base de
//  los karts (PHYS). Diferencias moderadas: cada coche gana en algo y
//  pierde en otra cosa. grip = cuánto derrapa (más bajo = más agarre).
//  stats = barras que se enseñan en la pantalla de selección (1-5).
// ============================================================
const CARS = [
  { id: 'r34', name: 'NISSAN SKYLINE GT-R R34', short: 'GT-R R34', desc: 'EQUILIBRADO · TRACCIÓN TOTAL',
    speed: 1.0, accel: 1.05, turn: 1.0, grip: 0.78, weight: 1.1, len: 38, stats: [4, 4, 4, 3] },
  { id: 'wrc', name: 'SUBARU IMPREZA WRC', short: 'IMPREZA WRC', desc: 'RALLY · EL MEJOR FUERA DEL ASFALTO',
    speed: 0.96, accel: 1.08, turn: 1.06, grip: 0.78, weight: 1.0, offroad: true, len: 36, stats: [3, 5, 4, 3] },
  { id: 'challenger', name: 'DODGE CHALLENGER HELLCAT', short: 'CHALLENGER', desc: 'MUSCLE CAR · EL MÁS RÁPIDO, PERO DERRAPA',
    speed: 1.06, accel: 1.12, turn: 0.9, grip: 0.86, weight: 1.35, len: 42, stats: [5, 5, 2, 5] },
  { id: 'supra', name: 'TOYOTA SUPRA MK4', short: 'SUPRA MK4', desc: 'RÁPIDO Y ESTABLE',
    speed: 1.04, accel: 1.0, turn: 0.97, grip: 0.8, weight: 1.05, len: 38, stats: [5, 3, 3, 3] },
  { id: 'golf', name: 'VOLKSWAGEN GOLF GTI TCR', short: 'GOLF GTI', desc: 'LIGERO · EL QUE MEJOR GIRA',
    speed: 0.94, accel: 1.0, turn: 1.12, grip: 0.75, weight: 0.85, len: 32, stats: [2, 3, 5, 1] },
];
const CAR_STATS = ['VELOCIDAD', 'ACELERACIÓN', 'MANEJO', 'PESO'];

function carPhysFor(id) {
  const m = CARS.find(c => c.id === id) || CARS[0];
  return {
    ...PHYS, model: m.id,
    maxSpeed: PHYS.maxSpeed * m.speed, accel: PHYS.accel * m.accel, turn: PHYS.turn * m.turn,
    grip: m.grip, weight: m.weight,
    // el de rally pierde mucho menos al salirse a la hierba o la tierra
    grassMax: PHYS.grassMax * (m.offroad ? 1.35 : 1), grassAccel: m.offroad ? 0.85 : 0.55, grassDrag: m.offroad ? 0.985 : 0.975,
  };
}

const TRACKS = [
  {
    id: 'normal',
    name: 'VALLE VERDE',
    diff: 'NORMAL',
    color: '#00e436',
    width: 170,
    aiSkill: [0.84, 0.88, 0.91],
    theme: { out: '#1e5a2a', runoff: '#3f9a3a', asphalt: '#55535e', deco: ['#0f3d1a', '#2d7a33', '#14502a'] },
    // Un 8 suave: se cruza en el centro (el segundo paso va por el puente)
    points: [
      [400, 500], [900, 380], [1400, 800], [1900, 1300], [2400, 1350], [2700, 1150],
      [2700, 450], [2400, 250], [1900, 300], [1400, 800], [900, 1250], [350, 1200], [150, 800],
    ],
    over: 9,
    start: [5, 0.9],
  },
  {
    id: 'dificil',
    name: 'COSTA SERPIENTE',
    diff: 'DIFÍCIL',
    color: '#ffa300',
    width: 140,
    aiSkill: [0.88, 0.92, 0.95],
    theme: { out: '#b0823e', runoff: '#dcbc74', asphalt: '#4f4d58', deco: ['#7a5a26', '#2d7a33', '#96702f'] },
    // Bucle que vuelve a pasar por encima de su propio tramo (puente)
    points: [
      [600, 380], [1400, 380], [1850, 560], [1750, 1000], [2200, 1250],
      [2650, 900], [3050, 1100], [2950, 1700], [2350, 1900], [1650, 1680],
      [1200, 1480], [1050, 1150], [1400, 1100], [1350, 1850],
      [1150, 2000], [550, 1900], [380, 1450], [640, 1120], [380, 790],
    ],
    over: 12,
    start: [0, 0.85],            // en la recta de arriba (la del bucle pasa bajo el puente)
  },
  {
    id: 'extremo',
    name: 'INFIERNO',
    diff: 'EXTREMO',
    color: '#ff004d',
    width: 115,
    aiSkill: [0.93, 0.97, 1.0],
    theme: { out: '#2a1a2e', runoff: '#6b4a36', asphalt: '#46444f', deco: ['#ff004d', '#7e2553', '#ffa300'] },
    // Bucle que cruza por encima de la recta de abajo (puente)
    points: [
      [600, 300], [1350, 300], [1800, 430], [1780, 820], [1300, 860],
      [1150, 1150], [1500, 1330], [2000, 1270], [2250, 1500], [1900, 1700], [1700, 1550], [1700, 1110],
      [2250, 900], [2450, 400],
      [2900, 330], [3150, 700], [2800, 1100], [3150, 1500], [2950, 1950],
      [2350, 1850], [1900, 2150], [1300, 1920], [900, 2200], [380, 2050],
      [620, 1650], [300, 1330], [660, 1010], [300, 700],
    ],
    over: 10,
  },
  {
    id: 'demencia',
    name: 'DEMENCIA',
    diff: 'DEMENCIAL',
    color: '#c02cff',
    width: 100,
    theme: { out: '#221536', runoff: '#3b2a4a', asphalt: '#3d3a48', deco: ['#7e2553', '#83769c', '#ff004d'] },
    // Rectas y curvas circulares: [x, y, radio]. Las horquillas son semicírculos
    // de radio 120 (dos esquinas de 90° separadas 240 px), como en un circuito real.
    corners: [
      [150, 300, 160], [1450, 300, 120],                          // recta de arriba
      [1450, 900, 120], [1690, 900, 120],                         // peine de horquillas (arriba)
      [1690, 480, 120], [1930, 480, 120],
      [1930, 900, 120], [2170, 900, 120],
      [2170, 300, 150], [3000, 300, 180],
      [3000, 800, 120], [2450, 800, 120],                         // eses a la derecha
      [2450, 1040, 120], [3000, 1040, 120],
      [3000, 1280, 120], [2450, 1280, 120],
      [2450, 1520, 120], [3000, 1520, 150],
      [3000, 2200, 180], [2300, 2200, 120],                       // peine de horquillas (abajo)
      [2300, 1800, 120], [2060, 1800, 120],
      [2060, 2200, 120], [1820, 2200, 120],
      [1820, 1800, 120], [1580, 1800, 120],
      [1580, 2200, 160], [700, 2200, 160],
      [700, 1900, 120], [1200, 1900, 120],                        // eses a la izquierda
      [1200, 1660, 120], [500, 1660, 120],
      [500, 1420, 120], [1200, 1420, 120],
      [1200, 1180, 120], [400, 1180, 160],
      [400, 500, 120], [800, 500, 120],                           // espiral: cruza por encima de la subida
      [800, 820, 120], [150, 820, 120],
    ],
    over: 38,
    // Peligros. Se colocan con el índice de la esquina y la fracción del camino
    // hasta la siguiente, así no dependen de dónde quede la meta.
    // Acantilados: [desde, hasta, lado] (L izquierda, R derecha, B ambos = puente)
    cliffs: [[0, 1, 'L'], [6, 7, 'R'], [9, 10, 'L'], [13, 14, 'L'], [18, 19, 'B'], [32, 33, 'B']],
    // Aceite: [esquina, fracción, lado (-1 izquierda .. 1 derecha)]
    oil: [[1, 0.5, 0.3], [5, 0.5, -0.3], [8, 0.3, 0.3], [12, 0.5, -0.35], [17, 0.5, 0.3], [23, 0.5, 0.3], [30, 0.5, -0.3]],
    // Barro: [esquina, fracción, lado, largo en px]
    mud: [[3, 0.5, 0, 90], [14, 0.5, 0.4, 70], [21, 0.5, -0.4, 80], [34, 0.5, 0, 70]],
    // Bloques que van de lado a lado: [esquina, fracción, periodo en ms]
    pistons: [[37, 0.5, 2600], [8, 0.6, 2200], [10, 0.5, 2400], [16, 0.5, 2000], [26, 0.5, 2300], [28, 0.5, 2100]],
  },
];

// ============================================================
//  PISTAS REALES A ESCALA (Fórmula 1)
//  Trazados calcados de los mapas oficiales de la F1 (coordenadas de la
//  imagen) y escalados para que la vuelta mida lo mismo que la real, a
//  PX_PER_M = 5 px por metro. Ancho de pista en metros. Se corren a 2 vueltas.
//  La salida (start: 0) es el primer punto: la línea de meta real, en el
//  sentido real de carrera. Suzuka tiene su cruce real (puente) y en todas
//  hay 2 pasarelas sobre la pista (gantries).
// ============================================================
const REAL_LAPS = 2;
const REAL_TRACKS = [
  {
    id: 'monza', real: true, car: 'f1',
    name: 'MONZA', country: 'ITALIA', diff: 'FÁCIL', stars: 1, color: '#00e436',
    lengthM: 5793, widthM: 14, runoff: 70, turns: 11, start: 0,
    gantries: 2,
    theme: { out: '#2d6b2f', runoff: '#b8a06a', asphalt: '#4a4855', deco: ['#1f4f22', '#2d7a33', '#3f9a3a'] },
    points: [
      [600.8, 338.9], [588.4, 340.1], [566.8, 339.8], [541.9, 340.2], [500.1, 338.8], [422, 338.1],
      [365.3, 338], [342.3, 338.7], [321.9, 337.9], [315.2, 335.5], [309.4, 330.4], [302.8, 328.3],
      [295.5, 330], [281, 334.8], [273, 336.9], [264.6, 337.6], [256.2, 337.4], [239.6, 338.2],
      [231.3, 337.3], [214.5, 337.3], [206, 335.8], [197.6, 333.2], [189.9, 329.9], [177.2, 322],
      [172.3, 317.8], [164.3, 309.4], [160.7, 305], [154.2, 294.5], [148.2, 282.5], [145.5, 276],
      [141.2, 261.8], [138.4, 246.4], [124.8, 159.6], [122.7, 152.9], [118.2, 148.2], [113.1, 144.5],
      [109.8, 138.9], [101.2, 117.7], [94.2, 94.8], [82.5, 70.2], [80.3, 60.9], [82.6, 51.5],
      [88.7, 44.3], [96.3, 40.5], [139.9, 31.6], [154.4, 30], [161.5, 31.1], [167.8, 35.2],
      [173.9, 40.6], [179.2, 46.6], [220.9, 109.1], [230.5, 121.5], [241.1, 132.6], [331.4, 220],
      [353.1, 240.4], [358.9, 244.9], [365.6, 247.1], [379.2, 245.8], [385.8, 246.4], [392.3, 248.9],
      [404.6, 257.6], [411.2, 261.3], [418.5, 262.9], [425.6, 263.7], [439.6, 263.4], [471.6, 264.7],
      [487.5, 264.4], [510.8, 265.9], [543.3, 265.7], [559.7, 264.1], [567.7, 264.1], [583.7, 266.1],
      [600.5, 267], [633.1, 268.1], [654.2, 267.5], [675.6, 268.6], [682.5, 269.9], [688.2, 273.2],
      [692.4, 278.3], [695.5, 284.2], [697, 290.3], [696.3, 296.4], [694.3, 302.5], [691.3, 308.6],
      [687.1, 314.3], [681.7, 319.4], [675.6, 324.2], [668.6, 328.3], [661, 331.3], [653.1, 333.7],
      [628.4, 337.6],
    ],
  },
  {
    id: 'barcelona', real: true, car: 'f1',
    name: 'BARCELONA', country: 'ESPAÑA', diff: 'NORMAL', stars: 2, color: '#ffa300',
    lengthM: 4675, widthM: 13, runoff: 60, turns: 16, start: 0,
    gantries: 2,
    theme: { out: '#8a9a4a', runoff: '#d6c08a', asphalt: '#4a4855', deco: ['#5a6a2a', '#b09a5a', '#3f7a33'] },
    points: [
      [530.6, 317.3], [483.1, 318], [320.9, 318], [289.7, 318.8], [274.6, 318.4], [234.3, 319.2],
      [208.7, 318.8], [165.1, 319.2], [158.4, 319], [151.2, 317.8], [144.7, 314.6], [139.5, 309.5],
      [136.4, 303.2], [135.1, 296.6], [134.7, 282.9], [132.8, 274.9], [128.2, 267.1], [121.2, 260.8],
      [113.3, 256.3], [89.9, 246.5], [82.6, 242.5], [68.6, 233], [55.3, 222.8], [50, 216.9],
      [47.4, 209.7], [45.2, 195.3], [45.7, 181.8], [47.3, 175.1], [53.2, 161.4], [57.3, 155],
      [62.2, 149.1], [67.9, 143.6], [74.3, 138.6], [89, 130.2], [97.1, 126.7], [113.9, 121.3],
      [130.8, 118.6], [148, 117.9], [196.7, 118.2], [229, 117.5], [254.2, 118.3], [261.9, 119.6],
      [268.5, 122.8], [273.2, 127.1], [276.3, 131.2], [278.4, 135.1], [279.8, 139.5], [280.3, 144.5],
      [278.9, 155.3], [277, 161.1], [273.6, 167.4], [268.2, 173.6], [261.5, 179.2], [254.1, 183.9],
      [246.3, 187.3], [238, 189.5], [229.6, 190.6], [221.2, 191], [151, 190.9], [141.7, 191.5],
      [133.2, 194], [126.8, 199.5], [124, 207.1], [124.9, 215], [129.2, 221.6], [135.4, 226.7],
      [176.8, 254.5], [183.9, 258.9], [198.8, 266.9], [214.5, 273.4], [222.9, 275.2], [240.1, 276.7],
      [291.7, 277], [299.2, 274.9], [304.9, 270.1], [308.3, 263.9], [309.8, 257.4], [309.6, 243.6],
      [310.6, 235.7], [313.3, 227.5], [317.4, 219.4], [336.5, 190.4], [346.7, 177.9], [359.4, 157.1],
      [369.8, 143.4], [375.6, 137.6], [381.6, 133.1], [387.2, 130.4], [396.7, 127.9], [402.3, 127.4],
      [408.9, 127.9], [416.2, 129.4], [423.6, 132], [430.7, 135.5], [579.3, 222.9], [627.4, 251.8],
      [640.6, 258.3], [647.1, 258.8], [652, 255.7], [654.2, 250.9], [653.6, 245.2], [636.7, 200.4],
      [632, 194.6], [625.1, 190.3], [609.2, 183.6], [602.8, 179.3], [598.1, 173.8], [594.8, 166.8],
      [593.6, 158.7], [594.4, 150.9], [596.9, 144.3], [600.7, 139], [605.6, 134.7], [611.6, 131.3],
      [618.5, 129.8], [626, 130.3], [649.6, 134.1], [657.4, 136.3], [673.2, 142.5], [681.4, 142.1],
      [688.6, 138.9], [692, 140.4], [692.8, 146.1], [695.3, 150.8], [699.3, 153.7], [703.4, 157.6],
      [706.3, 164.1], [706.9, 172.6], [704.2, 211.1], [705.6, 219.1], [711.4, 225.2], [719.2, 228.7],
      [724.4, 232.7], [726, 238.6], [726.1, 260.6], [725.1, 277.8], [723.4, 286.1], [720.6, 293.3],
      [716.9, 299.2], [712.6, 303.7], [703.3, 310.7], [697.4, 313.4], [690.7, 315.5], [683.8, 316.5],
    ],
  },
  {
    id: 'spa', real: true, car: 'f1',
    name: 'SPA-FRANCORCHAMPS', country: 'BÉLGICA', diff: 'DIFÍCIL', stars: 3, color: '#29adff',
    lengthM: 7004, widthM: 12, runoff: 55, turns: 19, start: 0,
    gantries: 2,
    theme: { out: '#1e4d24', runoff: '#4f9a45', asphalt: '#4a4855', deco: ['#0f3d1a', '#14502a', '#2d6b2f'] },
    points: [
      [232.5, 317.1], [136, 391.2], [129.9, 395.7], [124, 397.3], [120.7, 393.3], [121, 387.1],
      [132.4, 353.3], [135.1, 346], [141.5, 331.9], [145.2, 324.8], [154.3, 311.2], [164.6, 298.1],
      [185.7, 274.1], [194.8, 261.2], [200.2, 254.9], [212.5, 243.2], [217.8, 236.9], [222.8, 230.3],
      [230.8, 215.9], [235.7, 208.9], [242, 203.2], [249.2, 199.1], [265.3, 193.3], [273.5, 189.5],
      [280.9, 184.5], [299.3, 169.9], [321.1, 150.5], [339.5, 135.3], [346, 130.6], [353, 126.6],
      [382.3, 113.1], [553.7, 38.3], [562.2, 34.8], [571.4, 33.8], [579.5, 36.8], [586.1, 41.9],
      [592.7, 45.5], [600, 45.9], [607.1, 44.1], [620.6, 38.7], [627.8, 36.4], [635.6, 36],
      [643, 39.1], [649.4, 44.7], [661.4, 57.4], [700.8, 100.9], [705.7, 107.6], [708.1, 115.2],
      [706.6, 122.4], [701.8, 127.6], [695.5, 130], [689, 129.1], [683.3, 125.8], [678.4, 121],
      [663.4, 102.4], [657.2, 96.2], [649.5, 92.9], [641.2, 93.6], [633.5, 96.6], [603.4, 111.1],
      [587.9, 117.6], [515.9, 141.3], [509.4, 144.8], [503.8, 149.5], [499.5, 155.5], [497.1, 162.7],
      [496.4, 171], [496.7, 180], [497.7, 189.7], [500.2, 199.2], [504.7, 207.4], [510.5, 214.2],
      [517, 219.8], [524.5, 224.1], [532.5, 226.9], [548.6, 230.8], [564.9, 232.5], [572.8, 234.3],
      [580.3, 237.2], [595.3, 244.2], [603.7, 246.4], [612.7, 247.8], [621.5, 250.2], [629, 254.7],
      [634.4, 261.4], [636.5, 270.8], [632.5, 295], [633.9, 305.7], [638.8, 313.3], [645.6, 318.2],
      [694, 340.7], [699, 344.6], [702.7, 349.4], [704, 355.3], [702.4, 362.4], [696.8, 378.1],
      [684, 396.3], [678.9, 401.5], [671.3, 405.7], [662.1, 407.8], [652.4, 407.2], [634.1, 403],
      [625.3, 400.2], [616.9, 396.4], [609.1, 392.1], [581.8, 373.3], [575.5, 368.2], [564, 357.4],
      [559.1, 351.4], [535.9, 318.5], [519.5, 296.5], [513.1, 290.1], [506.2, 284.6], [498.6, 280.5],
      [490.7, 277.5], [475.8, 269.6], [467.5, 267.5], [450, 264.5], [442.3, 262.4], [435.5, 259.2],
      [428.4, 257.2], [421, 257.5], [413.8, 259.2], [407, 262.1], [351.8, 291.4], [336.1, 298.4],
      [327.9, 301], [302.9, 306.9], [275.2, 312], [267.8, 309.1], [262.7, 302.2], [256.8, 299.8],
      [250.3, 303.1],
    ],
  },
  {
    id: 'suzuka', real: true, car: 'f1',
    name: 'SUZUKA', country: 'JAPÓN', diff: 'MUY DIFÍCIL', stars: 4, color: '#ff77a8',
    lengthM: 5807, widthM: 11, runoff: 45, turns: 18, start: 0,
    over: 118,
    gantries: 2,
    theme: { out: '#2a6b35', runoff: '#c9b37c', asphalt: '#4a4855', deco: ['#ff77a8', '#1f5a2a', '#3f9a3a'] },
    points: [
      [569.3, 175.1], [691.6, 324.5], [709.7, 347.1], [713.2, 352.8], [715.6, 359.2], [716.6, 366.3],
      [715.7, 373.8], [713.4, 381.9], [709.9, 390.3], [704, 397.3], [695.8, 401.3], [686.7, 401],
      [678.6, 396.3], [673, 388.5], [669, 379.9], [664.1, 372.1], [654, 357.6], [648.8, 350.9],
      [643, 344.6], [636.1, 339.8], [628.1, 337.5], [611.4, 335.4], [603.9, 332.1], [598, 326.1],
      [594.1, 318.2], [588.7, 300.8], [585.6, 292.7], [580.9, 285.8], [574.5, 280.7], [566.9, 277.5],
      [541.8, 274.5], [534.2, 271.5], [527.7, 266], [522.9, 258.5], [520.9, 249.8], [521.4, 241.2],
      [528, 219.8], [529.5, 212.4], [529.3, 204.5], [526.5, 196.6], [521.1, 189.6], [513.8, 184.3],
      [498.1, 176.7], [490.6, 174.2], [483.5, 172.7], [476.6, 172.1], [469.6, 172.1], [462.2, 172.9],
      [454.5, 174.8], [439.5, 181.2], [432.4, 185.2], [425.9, 190.2], [414.7, 201.7], [390, 231.4],
      [384.7, 236.5], [378.1, 239.4], [354.3, 241.8], [338.1, 242.6], [331.4, 241], [327.2, 236.3],
      [325.1, 229.6], [311.3, 158.3], [312.6, 149.3], [317, 141.3], [317.6, 133.6], [314.5, 125.4],
      [315.1, 116.7], [319, 108.3], [321.6, 100.3], [319.8, 93.8], [314, 92.3], [308, 96.6],
      [285.1, 132.1], [280, 138.3], [268.7, 148.4], [262.3, 152.2], [255.2, 154.8], [247.7, 156.7],
      [232.4, 158], [217.1, 157.6], [209.2, 156.2], [192.5, 151.8], [177.4, 145.9], [164.2, 138.6],
      [157.6, 134.1], [151.3, 128.7], [145.4, 122.3], [140, 115.3], [135.2, 107.7], [127.3, 91.4],
      [121.1, 76.1], [112.2, 56.4], [107.9, 50.8], [102.1, 46.9], [95, 45.3], [87.4, 45],
      [79.9, 45.5], [72.8, 47], [66.4, 49.2], [61, 52.6], [57.3, 57.2], [55.1, 63],
      [54.7, 69.4], [56.2, 76.3], [59.4, 83], [64.2, 89.1], [87.6, 109.4], [94.3, 113.8],
      [109.7, 121.2], [117.1, 126], [130.4, 136.4], [137.1, 140.8], [158.4, 151.8], [189.1, 164],
      [221, 175.1], [246, 181.7], [254.1, 184.5], [292.4, 201.1], [330.2, 214.1], [337.5, 215.5],
      [345.1, 214.8], [352.8, 212.9], [360.9, 210.2], [368.9, 206.6], [383.8, 198.5], [390.4, 193.7],
      [402.4, 183.4], [420, 167.2], [431.3, 156], [437.4, 150.7], [444.3, 145.9], [451.2, 142.5],
      [457.8, 142.8], [464.5, 146], [471.8, 147.2], [479.5, 144], [487, 139.2], [494.5, 135.5],
      [502.2, 133.9], [510.1, 134.1], [518.2, 135.5], [526.2, 138], [533.8, 141.6], [540.6, 145.8],
      [546.9, 150.5], [552.9, 156],
    ],
  },
  {
    id: 'baku', real: true, car: 'f1',
    name: 'BAKÚ', country: 'AZERBAIYÁN', diff: 'EXTREMO', stars: 5, color: '#ff004d',
    lengthM: 6003, widthM: 9, runoff: 8, turns: 20, start: 0,
    walls: true,
    gantries: 2,
    theme: { out: '#a39583', runoff: '#8c8c94', asphalt: '#44424d', deco: ['#c2b59b', '#8f7f66', '#d9ccb0'] },
    points: [
      [627.8, 410.9], [633.3, 414.5], [645.6, 421], [731.7, 470], [739.1, 473.8], [746.6, 474.8],
      [753, 470.8], [757.9, 464.4], [770.2, 444.1], [797, 395.2], [799.8, 387.9], [799.4, 379.8],
      [794.2, 372.9], [787.3, 368], [711.5, 320.2], [566.7, 240.2], [559.9, 237.6], [554.4, 238.6],
      [545.9, 248.9], [534.8, 260.8], [529.5, 268.7], [524.2, 278.5], [516.1, 287.6], [504.5, 290.9],
      [492.6, 287.3], [459.4, 269.1], [426.2, 256], [419.3, 254.2], [412.6, 255.3], [400, 259],
      [392, 258], [384, 256], [360, 252], [336.3, 252], [295.9, 240.5], [288.6, 236],
      [284.8, 228.1], [284.5, 219.1], [287.9, 210.9], [304.8, 185.9], [305.5, 179.9], [304.9, 173],
      [305.6, 166.1], [304.7, 159.8], [301.5, 153.5], [300, 146.4], [304.7, 131.1], [302.5, 125],
      [297.3, 120.4], [286.6, 112.5], [274.4, 105.9], [262, 97.1], [255.2, 93.1], [205.1, 71.4],
      [199.1, 69.2], [193.1, 68.2], [187.1, 68.6], [181, 70], [135.5, 86.1], [127.6, 89.6],
      [120.6, 94.2], [114, 99.4], [83, 126.3], [71.3, 133.9], [66.9, 138.2], [65.4, 144.2],
      [66, 151.2], [81, 241.8], [83.3, 248], [87.7, 252.7], [95, 254.3], [103.5, 253.7],
      [119.9, 249.9], [150.1, 246.1], [157.8, 246.1], [165.5, 247.6], [181.1, 252.4], [189.3, 254.2],
      [205.9, 255.3], [222.2, 257.7], [230, 258.2], [237.5, 257], [266.6, 247.4], [274.7, 245.4],
      [283.2, 245.4], [291.8, 247], [317.8, 254.4], [343.1, 260.8], [368, 271], [377, 271.5],
      [386, 272.5], [394, 274], [400.6, 276], [405, 281], [411.1, 283.4], [418.3, 287.2],
      [432.1, 296.4], [446.6, 304.3], [460.3, 313.4], [475, 321.9], [505.4, 337.2], [525.9, 350.8],
      [574.4, 378.3], [594.8, 391.1], [622.1, 406.7],
    ],
  },
];

// ---------- Geometría ----------
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Catmull-Rom centrípeta (no hace bucles aunque los puntos estén a distinta distancia)
function crPoint(p0, p1, p2, p3, t) {
  const d = (p, q) => Math.pow(Math.hypot(q[0] - p[0], q[1] - p[1]), 0.5) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (p, q, ta, tb) => {
    const w = (tt - ta) / (tb - ta);
    return [p[0] + (q[0] - p[0]) * w, p[1] + (q[1] - p[1]) * w];
  };
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

// Trazado con rectas y curvas circulares de verdad: cada esquina [x, y, radio]
// se redondea con un arco tangente a los dos tramos (como un circuito real).
// Dos esquinas de 90° separadas 2·radio forman una horquilla semicircular.
function filletPath(C) {
  const n = C.length, out = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = C[(i - 1 + n) % n], [cx, cy, r] = C[i], [qx, qy] = C[(i + 1) % n];
    const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(qx - cx, qy - cy);
    const u1 = [(cx - px) / l1, (cy - py) / l1], u2 = [(qx - cx) / l2, (qy - cy) / l2];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const phi = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));   // ángulo de giro
    if (phi < 1e-3 || !r) { out.push([cx, cy]); continue; }
    const tan = Math.min(r * Math.tan(phi / 2), l1 / 2, l2 / 2);                     // de la esquina al inicio del arco
    const rad = tan / Math.tan(phi / 2);
    const ax = cx - u1[0] * tan, ay = cy - u1[1] * tan;
    const s = cross > 0 ? 1 : -1;                                                     // 1 = gira a la derecha
    const ox = ax - u1[1] * rad * s, oy = ay + u1[0] * rad * s;                      // centro del arco
    const a0 = Math.atan2(ay - oy, ax - ox);
    const steps = Math.max(2, Math.ceil(phi * rad / 4));
    for (let k = 0; k <= steps; k++) {
      const a = a0 + s * phi * k / steps;
      out.push([ox + Math.cos(a) * rad, oy + Math.sin(a) * rad]);
    }
  }
  return out;
}

function buildTrack(def, physOverride) {
  let P = def.corners ? def.corners.map(([x, y]) => [x, y]) : def.points;
  const n = P.length;
  const CP = physOverride || carPhys(def);
  if (def.widthM) def.width = def.widthM * PX_PER_M;
  const runoff = def.runoff ?? RUNOFF;

  // 1) Trazado denso: rectas + arcos (corners) o spline suave (points)
  let dense = [];
  if (def.corners) {
    dense = filletPath(def.corners);
  } else {
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let s = 0; s < 60; s++) dense.push(crPoint(p0, p1, p2, p3, s / 60));
    }
  }
  dense.push(dense[0]);

  // 1b) Pistas reales: se escalan para que la vuelta mida exactamente lo real
  if (def.lengthM) {
    let L = 0;
    for (let i = 1; i < dense.length; i++) L += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    const k = def.lengthM * PX_PER_M / L;
    dense = dense.map(([x, y]) => [x * k, y * k]);
    P = P.map(([x, y]) => [x * k, y * k]);
  }

  // 2) Remuestreo a distancia fija
  const xs = [dense[0][0]], ys = [dense[0][1]];
  let carry = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, ay] = dense[i - 1], [bx, by] = dense[i];
    const seg = Math.hypot(bx - ax, by - ay);
    let pos = SAMPLE_DS - carry;
    while (pos <= seg) {
      xs.push(ax + (bx - ax) * pos / seg);
      ys.push(ay + (by - ay) * pos / seg);
      pos += SAMPLE_DS;
    }
    carry = seg - (pos - SAMPLE_DS);
  }
  // El último punto puede quedar pegado al primero
  if (Math.hypot(xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0]) < SAMPLE_DS * 0.5) { xs.pop(); ys.pop(); }
  const N = xs.length;

  // 2a) Pistas reales: ninguna curva más cerrada que minRadius (12 m); los
  //     picos que deja el calco se suavizan poco a poco hasta cumplirlo
  if (def.real) {
    const minR = 12 * PX_PER_M, W = 3;
    for (let iter = 0; iter < 60; iter++) {
      let changed = false;
      for (let i = 0; i < N; i++) {
        const a = (i - W + N) % N, b = (i + W) % N, pa = (i - 1 + N) % N, pb = (i + 1) % N;
        const h1 = Math.atan2(ys[i] - ys[a], xs[i] - xs[a]), h2 = Math.atan2(ys[b] - ys[i], xs[b] - xs[i]);
        const r = (W * SAMPLE_DS) / Math.max(Math.abs(angDiff(h2, h1)), 1e-6);
        if (r < minR) {
          xs[i] = 0.5 * xs[i] + 0.25 * (xs[pa] + xs[pb]);
          ys[i] = 0.5 * ys[i] + 0.25 * (ys[pa] + ys[pb]);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // 2b) La salida: donde diga la pista (start: [punto, fracción]) o, si no,
  //     en el tramo más recto: la parrilla (hasta 12 coches, ~60 muestras
  //     detrás de la meta) y el arranque deben ser rectos.
  {
    const near0 = (x, y) => {
      let b = 0, bd = Infinity;
      for (let i = 0; i < N; i++) { const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2; if (d < bd) { bd = d; b = i; } }
      return b;
    };
    let best = 0;
    if (def.start != null) {
      const [a, fr] = Array.isArray(def.start) ? def.start : [def.start, 0];
      const s0 = near0(P[a][0], P[a][1]), s1 = near0(P[(a + 1) % n][0], P[(a + 1) % n][1]);
      best = (s0 + Math.round(((s1 - s0 + N) % N) * fr)) % N;
    } else {
      const head = i => Math.atan2(ys[(i + 1) % N] - ys[i % N], xs[(i + 1) % N] - xs[i % N]);
      const turn = new Float32Array(N);
      for (let i = 0; i < N; i++) turn[i] = Math.abs(angDiff(head(i + 1), head(i)));
      const BEFORE = 75, AFTER = 25;
      let bestScore = Infinity;
      for (let s = 0; s < N; s++) {
        let score = 0;
        for (let k = -BEFORE; k <= AFTER; k++) score += turn[(s + k + N) % N];
        if (score < bestScore - 1e-6) { bestScore = score; best = s; }
      }
    }
    const rx = xs.slice(best).concat(xs.slice(0, best));
    const ry = ys.slice(best).concat(ys.slice(0, best));
    xs.splice(0, N, ...rx);
    ys.splice(0, N, ...ry);
  }

  // 3) Dirección, normal y curvatura de cada muestra
  const dir = new Float32Array(N), nx = new Float32Array(N), ny = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    dir[i] = Math.atan2(ys[j] - ys[i], xs[j] - xs[i]);
    nx[i] = -Math.sin(dir[i]);
    ny[i] = Math.cos(dir[i]);
  }
  const K = 4;
  const curv = new Float32Array(N);   // 1/radio con signo
  for (let i = 0; i < N; i++) {
    curv[i] = angDiff(dir[(i + K) % N], dir[(i - K + N) % N]) / (2 * K * SAMPLE_DS);
  }

  // 4) Velocidad objetivo de la IA: la máxima a la que se puede girar
  //    con ese radio, y luego se "frena" hacia atrás antes de cada curva.
  const speed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = 1 / Math.max(Math.abs(curv[i]), 1e-5);
    let v = CP.maxSpeed;
    while (v > 2.2 && v / turnRateFor(CP, v) > r * 0.72) v -= 0.05;
    speed[i] = v;
  }
  const DECEL = CP === PHYS ? 0.17 : CP.brake * 0.5;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const nxt = speed[(i + 1) % N];
      speed[i] = Math.min(speed[i], Math.sqrt(nxt * nxt + 2 * DECEL * SAMPLE_DS));
    }
  }

  // 5) Contar curvas (tramos con giro apreciable)
  let curves = 0, hairpins = 0, acc = 0, minR = Infinity;
  const THRESH = 1 / 650;
  for (let i = 0; i <= N; i++) {
    const c = curv[i % N];
    const inCurve = i < N && Math.abs(c) > THRESH;
    if (inCurve) {
      acc += Math.abs(angDiff(dir[(i + 1) % N], dir[i % N]));
      minR = Math.min(minR, 1 / Math.abs(c));
    } else if (acc > 0) {
      if (acc > 0.35) {
        curves++;
        if (acc > 2.1 || minR < 150) hairpins++;
      }
      acc = 0; minR = Infinity;
    }
  }

  // 6) Límites
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }

  // 7) Peligros (solo algunas pistas): acantilados y trampas
  const half = def.width / 2;
  const nearest = (x, y) => {
    let b = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
      if (d < bd) { bd = d; b = i; }
    }
    return b;
  };
  const ptIdx = P.map(([x, y]) => nearest(x, y));
  const along = (a, frac) => {                 // muestra a "frac" del camino entre el punto a y el siguiente
    const s0 = ptIdx[a % n], len = (ptIdx[(a + 1) % n] - s0 + N) % N;
    return (s0 + Math.round(len * frac)) % N;
  };
  const cliff = new Int8Array(N);              // 0 nada, -1 izquierda, 1 derecha, 2 ambos lados
  for (const [a, b, side] of def.cliffs || []) {
    const s0 = ptIdx[a % n], len = (ptIdx[b % n] - s0 + N) % N;
    const v = side === 'L' ? -1 : side === 'R' ? 1 : 2;
    for (let k = 0; k <= len; k++) {
      const i = (s0 + k) % N;
      cliff[i] = cliff[i] && cliff[i] !== v ? 2 : v;
    }
  }
  const spot = (a, frac, lat) => {
    const i = along(a, frac);
    return { idx: i, x: xs[i] + nx[i] * lat * half, y: ys[i] + ny[i] * lat * half, ang: dir[i] };
  };
  const oil = (def.oil || []).map(([a, fr, lat]) => ({ ...spot(a, fr, lat), r: 24 }));
  const mud = (def.mud || []).map(([a, fr, lat, len]) => ({ ...spot(a, fr, lat), rx: len / 2, ry: half * 0.55 }));
  const pistons = (def.pistons || []).map(([a, fr, period]) => {
    const i = along(a, fr);
    return { idx: i, x: xs[i], y: ys[i], nx: nx[i], ny: ny[i], ang: dir[i], range: half - 26, period, r: 24, phase: i * 0.37 };
  });

  // 8) Cruces con puente: dos tramos lejanos en la vuelta cuyos ejes se cortan.
  //    "up" es la muestra del tramo que va por arriba (def.over = índice de un
  //    punto de ese tramo); B = cuántas muestras a cada lado ocupa el puente.
  const crossings = [];
  {
    const cell = 32, grid = new Map();
    for (let i = 0; i < N; i++) {
      const k = Math.floor(xs[i] / cell) + ',' + Math.floor(ys[i] / cell);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const pairs = [];
    for (let i = 0; i < N; i++) {
      const gx = Math.floor(xs[i] / cell), gy = Math.floor(ys[i] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get((gx + dx) + ',' + (gy + dy)) || []) {
          if (j <= i || Math.min(j - i, N - (j - i)) < 60) continue;
          const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
          if (d < SAMPLE_DS * 0.8) pairs.push([i, j, d]);
        }
      }
    }
    pairs.sort((a, b) => a[2] - b[2]);
    const circ = (a, b) => Math.min(Math.abs(a - b), N - Math.abs(a - b));
    const overIdx = def.over != null ? nearest(P[def.over][0], P[def.over][1]) : null;
    for (const [i, j] of pairs) {
      if (crossings.some(c => (circ(c.a, i) < 40 && circ(c.b, j) < 40) || (circ(c.a, j) < 40 && circ(c.b, i) < 40))) continue;
      let up = j, low = i;
      if (overIdx != null && circ(overIdx, i) < circ(overIdx, j)) { up = i; low = j; }
      const sin = Math.abs(Math.sin(angDiff(dir[i], dir[j])));
      const B = Math.ceil((half + runoff + 24) / Math.max(0.4, sin) / SAMPLE_DS) + 2;
      crossings.push({ a: i, b: j, up, low, B });
    }
  }

  // 9) Pasarelas sobre la pista (pistas reales): en los 2 tramos más rectos,
  //    lejos de la salida y de los cruces
  const gantries = [];
  if (def.gantries) {
    const circ = (a, b) => Math.min(Math.abs(a - b), N - Math.abs(a - b));
    const straight = i => { let sum = 0; for (let k = -12; k <= 12; k++) sum += Math.abs(curv[(i + k + N) % N]); return sum; };
    for (const [lo, hi] of [[0.08, 0.48], [0.52, 0.9]]) {
      let best = -1, bs = Infinity;
      for (let i = Math.floor(N * lo); i < Math.floor(N * hi); i++) {
        if (crossings.some(c => circ(c.a, i) < 60 || circ(c.b, i) < 60)) continue;
        const sc = straight(i);
        if (sc < bs) { bs = sc; best = i; }
      }
      if (best >= 0) gantries.push(best);
    }
  }

  let length = N * SAMPLE_DS;
  return {
    def, N, xs, ys, dir, nx, ny, curv, speed, curves, hairpins, length,
    half, runoff, phys: CP,
    bounds: { minX, minY, maxX, maxY },
    cliff, oil, mud, pistons,
    cliffZones: (def.cliffs || []).length,
    traps: oil.length + mud.length + pistons.length,
    crossings, gantries,
  };
}

// Nivel de una muestra: 1 si está sobre el puente de un cruce, 0 si no
function levelAt(t, idx) {
  for (const c of t.crossings) {
    const d = Math.min(Math.abs(idx - c.up), t.N - Math.abs(idx - c.up));
    if (d <= c.B) return 1;
  }
  return 0;
}

// Posición de un bloque móvil en el instante T (ms de carrera): va de lado a
// lado de la pista. Devuelve también su velocidad (px por frame a 60 fps).
function pistonPos(p, T) {
  const w = 2 * Math.PI / p.period, a = w * T + p.phase;
  const off = Math.sin(a) * p.range, vel = Math.cos(a) * p.range * w * (1000 / 60);
  return { x: p.x + p.nx * off, y: p.y + p.ny * off, vx: p.nx * vel, vy: p.ny * vel };
}

// Muestra más cercana a (x, y) buscando solo alrededor de la anterior,
// para que el coche no "salte" a otro tramo de la pista.
function locate(track, x, y, hint, win = 20) {
  const N = track.N;
  let best = hint, bd = Infinity;
  for (let k = -win; k <= win; k++) {
    const i = (hint + k + N) % N;
    const dx = track.xs[i] - x, dy = track.ys[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return { idx: best, dist: Math.sqrt(bd) };
}

// ============================================================
//  Modo DEMOLICIÓN (estilo Wreckfest)
//  Arena ovalada cerrada. Todos empiezan con 100% de vida; gana el
//  último que quede en pie. El servidor manda sobre la vida, los
//  botiquines y los escudos; cada navegador informa de los golpes
//  que da su propio coche (es el que conoce su velocidad exacta).
// ============================================================
const DERBY = {
  // La vida se cuenta en BARRITAS (pedido del usuario): 5 barritas; un golpe
  // fuerte quita 1 y uno suave, media. Siempre son múltiplos de 0,5.
  START_HP: 5,           // barritas de vida al empezar
  HIT_SOFT: 0.5,         // golpe corto, sin carrerilla: media barrita
  HIT_HARD: 1,           // golpe desde lejos / con mucha velocidad: una barrita
  SOFT_MIN: 1.2,         // velocidad de embestida (px/frame) mínima para hacer daño
  HARD_MIN: 5.5,         // a partir de aquí el golpe es fuerte (≈ 165 km/h en el marcador)
  HEAL: 1,               // un botiquín recupera 1 barrita
  HEAL_EVERY: 30000,     // aparecen botiquines cada 30 s
  SHIELD_EVERY: 40000,   // aparecen escudos cada 40 s
  SHIELD_MS: 10000,      // un escudo da 10 s de inmunidad
  PER_PLAYERS: 2,        // 1 botiquín / escudo por cada 2 jugadores vivos (mínimo 1)
  TIME: 180000,          // límite de 3 minutos para que la partida siempre acabe
  CAR_SCALE: 1.5,        // en la arena los coches son un 50% más grandes (más fácil acertar)
  PICK_R: 46,            // distancia para recoger un objeto (coches grandes)
};

const ARENAS = [
  {
    id: 'arena',
    mode: 'derby',
    name: 'ARENA DEL CAOS',
    diff: 'DEMOLICIÓN',
    color: '#ff77a8',
    cx: 1000, cy: 750, rx: 860, ry: 560,
    // Pilares de neumáticos para cubrirse: [x, y, radio]
    pillars: [[620, 750, 56], [1380, 750, 56], [1000, 480, 44], [1000, 1020, 44]],
    theme: { out: '#1a1420', floor: '#8a6a4a', floor2: '#6f5238', wall: '#ff004d' },
  },
];

function arenaBounds(a) {
  return { minX: a.cx - a.rx, minY: a.cy - a.ry, maxX: a.cx + a.rx, maxY: a.cy + a.ry };
}

// Salida: repartidos por el borde mirando al centro
function ringPoint(a, ang) {
  const x = a.cx + Math.cos(ang) * a.rx * 0.78, y = a.cy + Math.sin(ang) * a.ry * 0.78;
  return { x, y, angle: Math.atan2(a.cy - y, a.cx - x) };
}

// Hueco más pequeño entre el camino recto salida→centro y un pilar
function pathClearance(a, s) {
  const dx = a.cx - s.x, dy = a.cy - s.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  let worst = Infinity;
  for (const [px, py, pr] of a.pillars) {
    const vx = px - s.x, vy = py - s.y, along = vx * ux + vy * uy;
    if (along < 0 || along > L) continue;
    worst = Math.min(worst, Math.abs(vx * uy - vy * ux) - pr);
  }
  return worst;
}

// Giro del anillo de salida que deja el camino al centro lo más libre posible
// (determinista: servidor y navegadores calculan lo mismo)
function ringOffset(a, n) {
  a._ringOff = a._ringOff || {};
  if (a._ringOff[n] != null) return a._ringOff[n];
  let best = 0, bestScore = -Infinity;
  for (let k = 0; k < 90; k++) {
    const off = -Math.PI / 2 + (2 * Math.PI / n) * k / 90;
    let score = Infinity;
    for (let i = 0; i < n; i++) score = Math.min(score, pathClearance(a, ringPoint(a, off + 2 * Math.PI * i / n)));
    if (score > bestScore + 1e-6) { bestScore = score; best = off; }
  }
  return (a._ringOff[n] = best);
}

function arenaSpawn(a, i, n) {
  n = Math.max(1, n);
  return ringPoint(a, ringOffset(a, n) + 2 * Math.PI * i / n);
}

// Mantiene pos ({x, y}) dentro de la arena y fuera de los pilares.
// Devuelve la normal del choque (apuntando hacia el obstáculo) o null.
function arenaCollide(a, pos, r) {
  let hit = null;
  const ex = (pos.x - a.cx) / (a.rx - r), ey = (pos.y - a.cy) / (a.ry - r);
  const q = Math.hypot(ex, ey);
  if (q > 1) {
    pos.x = a.cx + (pos.x - a.cx) / q;
    pos.y = a.cy + (pos.y - a.cy) / q;
    const nx = (pos.x - a.cx) / ((a.rx - r) ** 2), ny = (pos.y - a.cy) / ((a.ry - r) ** 2);
    const l = Math.hypot(nx, ny);
    hit = { nx: nx / l, ny: ny / l };
  }
  for (const [px, py, pr] of a.pillars) {
    const dx = pos.x - px, dy = pos.y - py, d = Math.hypot(dx, dy), min = pr + r;
    if (d < min && d > 0) {
      pos.x = px + dx / d * min;
      pos.y = py + dy / d * min;
      hit = { nx: -dx / d, ny: -dy / d };
    }
  }
  return hit;
}

// ¿Está (x, y) dentro de la arena, con un margen a muros y pilares?
function arenaInside(a, x, y, margin) {
  if (Math.hypot((x - a.cx) / (a.rx - margin), (y - a.cy) / (a.ry - margin)) > 1) return false;
  return a.pillars.every(([px, py, pr]) => Math.hypot(x - px, y - py) > pr + margin);
}

if (typeof module !== 'undefined') {
  module.exports = {
    TRACKS, REAL_TRACKS, REAL_LAPS, PHYS, F1, PX_PER_M, SAMPLE_DS, RUNOFF, buildTrack, locate, angDiff, turnRate,
    turnRateFor, carPhys, levelAt, pistonPos, crPoint, CARS, CAR_STATS, carPhysFor,
    DERBY, ARENAS, arenaBounds, arenaSpawn, arenaCollide, arenaInside,
  };
}
