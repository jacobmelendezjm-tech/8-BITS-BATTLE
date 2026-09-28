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

function turnRate(v) {
  const s = Math.abs(v);
  return PHYS.turn * Math.min(1, s / 2.5) * (1 - 0.35 * Math.min(1, s / PHYS.maxSpeed));
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
    points: [
      [600, 400], [1500, 360], [2200, 480], [2450, 950], [2200, 1450],
      [1550, 1600], [1050, 1420], [620, 1500], [300, 1080], [330, 600],
    ],
  },
  {
    id: 'dificil',
    name: 'COSTA SERPIENTE',
    diff: 'DIFÍCIL',
    color: '#ffa300',
    width: 140,
    aiSkill: [0.88, 0.92, 0.95],
    theme: { out: '#b0823e', runoff: '#dcbc74', asphalt: '#4f4d58', deco: ['#7a5a26', '#2d7a33', '#96702f'] },
    points: [
      [600, 380], [1400, 380], [1850, 560], [1750, 1000], [2200, 1250],
      [2650, 900], [3050, 1100], [2950, 1700], [2350, 1900], [1650, 1680],
      [1150, 2000], [550, 1900], [380, 1450], [640, 1120], [380, 790],
    ],
  },
  {
    id: 'extremo',
    name: 'INFIERNO',
    diff: 'EXTREMO',
    color: '#ff004d',
    width: 115,
    aiSkill: [0.93, 0.97, 1.0],
    theme: { out: '#2a1a2e', runoff: '#6b4a36', asphalt: '#46444f', deco: ['#ff004d', '#7e2553', '#ffa300'] },
    points: [
      [600, 300], [1350, 300], [1800, 430], [1780, 820], [1300, 860],
      [1150, 1150], [1500, 1330], [2000, 1270], [2250, 900], [2450, 400],
      [2900, 330], [3150, 700], [2800, 1100], [3150, 1500], [2950, 1950],
      [2350, 1850], [1900, 2150], [1300, 1920], [900, 2200], [380, 2050],
      [620, 1650], [300, 1330], [660, 1010], [300, 700],
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

function buildTrack(def) {
  const P = def.points, n = P.length;

  // 1) Spline densa
  const dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    for (let s = 0; s < 60; s++) dense.push(crPoint(p0, p1, p2, p3, s / 60));
  }
  dense.push(dense[0]);

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

  // 2b) La salida va en el tramo más recto: la parrilla (hasta 12 coches,
  //     ~60 muestras detrás de la meta) y el arranque deben ser rectos.
  {
    const head = i => Math.atan2(ys[(i + 1) % N] - ys[i % N], xs[(i + 1) % N] - xs[i % N]);
    const turn = new Float32Array(N);
    for (let i = 0; i < N; i++) turn[i] = Math.abs(angDiff(head(i + 1), head(i)));
    const BEFORE = 75, AFTER = 25;
    let best = 0, bestScore = Infinity;
    for (let s = 0; s < N; s++) {
      let score = 0;
      for (let k = -BEFORE; k <= AFTER; k++) score += turn[(s + k + N) % N];
      if (score < bestScore - 1e-6) { bestScore = score; best = s; }
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
    let v = PHYS.maxSpeed;
    while (v > 2.2 && v / turnRate(v) > r * 0.72) v -= 0.05;
    speed[i] = v;
  }
  const DECEL = 0.17;
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

  let length = N * SAMPLE_DS;
  return {
    def, N, xs, ys, dir, nx, ny, curv, speed, curves, hairpins, length,
    half: def.width / 2,
    bounds: { minX, minY, maxX, maxY },
  };
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
  START_HP: 100,
  HIT_SOFT: 5,           // golpe corto, sin carrerilla
  HIT_HARD: 20,          // golpe desde lejos / con mucha velocidad
  SOFT_MIN: 1.2,         // velocidad de embestida (px/frame) mínima para hacer daño
  HARD_MIN: 5.5,         // a partir de aquí el golpe es fuerte (≈ 165 km/h en el marcador)
  HEAL: 20,              // un botiquín recupera 20%
  HEAL_EVERY: 30000,     // aparecen botiquines cada 30 s
  SHIELD_EVERY: 40000,   // aparecen escudos cada 40 s
  SHIELD_MS: 10000,      // un escudo da 10 s de inmunidad
  PER_PLAYERS: 2,        // 1 botiquín / escudo por cada 2 jugadores vivos (mínimo 1)
  TIME: 180000,          // límite de 3 minutos para que la partida siempre acabe
  PICK_R: 38,            // distancia para recoger un objeto
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
    TRACKS, PHYS, SAMPLE_DS, RUNOFF, buildTrack, locate, angDiff, turnRate,
    DERBY, ARENAS, arenaBounds, arenaSpawn, arenaCollide, arenaInside,
  };
}
