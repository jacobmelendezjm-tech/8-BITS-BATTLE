// ============================================================
//  8 BITS RACING - Cliente
//  Cada jugador simula su propio coche y manda su posición al
//  servidor; los coches de los demás se dibujan con la última
//  posición recibida (suavizada).
//  Controles: W acelerar · S frenar/marcha atrás · A/D girar
// ============================================================
'use strict';

// ---------- Conexión: LAN (mismo host) u online (Vercel -> Render) ----------
const VERCEL_HOSTS = ['8bits-battle.vercel.app'];
const RENDER_WS_URL = 'wss://eightbits-battle.onrender.com';
const ONLINE = VERCEL_HOSTS.includes(location.hostname);
const WS_URL = ONLINE ? RENDER_WS_URL : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

let LAPS = 4;
let HOST_PICK_MAX = 2;
const STEP_MS = 1000 / 60;         // física a 60 pasos por segundo
const VIEW_W = 960, VIEW_H = 640;
const CAR_R = 13;                  // radio de choque entre coches
const CURB = 10;                   // ancho del piano rojo/blanco

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const built = TRACKS.map(buildTrack);
const trackById = id => built.find(t => t.def.id === id);

// ---------- Utilidades ----------
function fmtMs(ms) {
  if (ms == null) return '--:--.--';
  const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60, c = Math.floor(ms / 10) % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
const fmtFrames = f => (f == null ? fmtMs(null) : fmtMs(f * STEP_MS));

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Color oscuro para la carrocería a partir del color del jugador
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) * 0.45, g = ((n >> 8) & 255) * 0.45, b = (n & 255) * 0.45;
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const bestKey = id => `8bits-racing.best.${id}`;

// ---------- Sonido (WebAudio, muy simple) ----------
const sound = {
  ctx: null, engine: null, engineGain: null, muted: store.get('8bits-racing.mute') === '1',
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.engine = this.ctx.createOscillator();
      this.engine.type = 'sawtooth';
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      this.engine.connect(lp).connect(this.engineGain).connect(this.ctx.destination);
      this.engine.start();
    } catch { this.ctx = null; }
  },
  setEngine(speed, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.frequency.setTargetAtTime(55 + Math.abs(speed) * 22, t, 0.05);
    this.engineGain.gain.setTargetAtTime(on && !this.muted ? 0.05 : 0, t, 0.08);
  },
  beep(freq, dur = 0.15, type = 'square', vol = 0.12) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  },
  bump() { this.beep(90, 0.12, 'square', 0.1); },
  toggle() {
    this.muted = !this.muted;
    store.set('8bits-racing.mute', this.muted ? '1' : '0');
  },
};
addEventListener('pointerdown', () => sound.init());

// ---------- Entrada (W A S D) ----------
const keys = { w: false, a: false, s: false, d: false };
const KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  sound.init();
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  if (e.code === 'KeyM') sound.toggle();
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});
addEventListener('blur', () => { keys.w = keys.a = keys.s = keys.d = false; });

// ---------- Render de la pista (una vez por carrera) ----------
const MARGIN = RUNOFF + 260;

function tracePath(c, t, ox, oy, scale = 1) {
  c.beginPath();
  c.moveTo((t.xs[0] - ox) * scale, (t.ys[0] - oy) * scale);
  for (let i = 1; i < t.N; i++) c.lineTo((t.xs[i] - ox) * scale, (t.ys[i] - oy) * scale);
  c.closePath();
}

function gridSlot(t, g) {
  // Parrilla de 2 columnas detrás de la línea de meta
  const row = Math.floor(g / 2), col = g % 2;
  return {
    idx: ((t.N - 7 - row * 10 - col * 4) % t.N + t.N) % t.N,
    back: 7 + row * 10 + col * 4,
    lat: (col === 0 ? -1 : 1) * t.def.width * 0.22,
  };
}

function renderTrack(t, gridCount) {
  const th = t.def.theme;
  const ox = t.bounds.minX - MARGIN, oy = t.bounds.minY - MARGIN;
  const w = Math.max(VIEW_W, Math.ceil(t.bounds.maxX - t.bounds.minX + 2 * MARGIN));
  const h = Math.max(VIEW_H, Math.ceil(t.bounds.maxY - t.bounds.minY + 2 * MARGIN));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const W = t.def.width;

  // Fondo
  c.fillStyle = th.out;
  c.fillRect(0, 0, w, h);
  const r = rng(t.N * 7919);
  for (let i = 0; i < w * h / 900; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.05)';
    c.fillRect(Math.floor(r() * w / 4) * 4, Math.floor(r() * h / 4) * 4, 4, 4);
  }

  c.lineJoin = 'round';
  c.lineCap = 'round';
  const stroke = (width, color, dash) => {
    c.setLineDash(dash || []);
    c.lineWidth = width;
    c.strokeStyle = color;
    tracePath(c, t, ox, oy);
    c.stroke();
  };

  // Muro de neumáticos, escapatoria, pianos y asfalto
  stroke(W + 2 * RUNOFF + 14, '#fff1e8');
  stroke(W + 2 * RUNOFF + 14, '#ff004d', [14, 14]);
  stroke(W + 2 * RUNOFF, th.runoff);
  stroke(W + 2 * CURB, '#ff004d');
  stroke(W + 2 * CURB, '#fff1e8', [16, 16]);
  stroke(W, th.asphalt);
  // Grano del asfalto
  for (let i = 0; i < t.N; i++) {
    for (let k = 0; k < 3; k++) {
      const off = (r() - 0.5) * (W - 8);
      c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.05)';
      c.fillRect(Math.round(t.xs[i] + t.nx[i] * off - ox), Math.round(t.ys[i] + t.ny[i] * off - oy), 3, 3);
    }
  }
  stroke(3, 'rgba(255,241,232,.45)', [26, 26]);

  // Decoración fuera de la pista (árboles / rocas), lejos del muro
  const minD = W / 2 + RUNOFF + 40;
  for (let n = 0; n < 700; n++) {
    const x = ox + r() * w, y = oy + r() * h;
    let near = Infinity;
    for (let i = 0; i < t.N; i += 3) {
      const d = Math.hypot(t.xs[i] - x, t.ys[i] - y);
      if (d < near) near = d;
      if (near < minD) break;
    }
    if (near < minD) continue;
    const s = 3 + Math.floor(r() * 3);
    const px = Math.round(x - ox), py = Math.round(y - oy);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(px - s * 2 + 4, py - s * 2 + 4, s * 4, s * 4);
    c.fillStyle = th.deco[Math.floor(r() * th.deco.length)];
    c.fillRect(px - s * 2, py - s * 2, s * 4, s * 4);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillRect(px - s * 2, py - s * 2, s * 2, s * 2);
  }

  // Línea de meta (cuadros) y casillas de la parrilla
  drawCheckers(c, t, ox, oy);
  for (let g = 0; g < gridCount; g++) {
    const s = gridSlot(t, g), i = s.idx;
    c.save();
    c.translate(t.xs[i] + t.nx[i] * s.lat - ox, t.ys[i] + t.ny[i] * s.lat - oy);
    c.rotate(t.dir[i]);
    c.strokeStyle = 'rgba(255,241,232,.7)';
    c.lineWidth = 3;
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(8, -16); c.lineTo(24, -16); c.lineTo(24, 16); c.lineTo(8, 16);
    c.stroke();
    c.restore();
  }

  return { canvas: cv, ctx: c, ox, oy, w, h };
}

function drawCheckers(c, t, ox, oy) {
  const W = t.def.width, sq = 10;
  c.save();
  c.translate(t.xs[0] - ox, t.ys[0] - oy);
  c.rotate(t.dir[0]);
  const cells = Math.ceil(W / sq);
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < cells; k++) {
      c.fillStyle = (row + k) % 2 ? '#000' : '#fff1e8';
      c.fillRect(-sq + row * sq, -W / 2 + k * sq, sq, Math.min(sq, W - k * sq));
    }
  }
  c.restore();
}

function renderMinimap(t, maxW, maxH) {
  const bw = t.bounds.maxX - t.bounds.minX, bh = t.bounds.maxY - t.bounds.minY;
  const pad = 10;
  const scale = Math.min((maxW - 2 * pad) / bw, (maxH - 2 * pad) / bh);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(bw * scale + 2 * pad);
  cv.height = Math.ceil(bh * scale + 2 * pad);
  const c = cv.getContext('2d');
  const ox = t.bounds.minX - pad / scale, oy = t.bounds.minY - pad / scale;
  c.lineJoin = c.lineCap = 'round';
  c.lineWidth = Math.max(4, t.def.width * scale + 3);
  c.strokeStyle = '#000';
  tracePath(c, t, ox, oy, scale); c.stroke();
  c.lineWidth = Math.max(2, t.def.width * scale);
  c.strokeStyle = '#c2c3c7';
  tracePath(c, t, ox, oy, scale); c.stroke();
  c.fillStyle = '#fff1e8';
  c.fillRect((t.xs[0] - ox) * scale - 2, (t.ys[0] - oy) * scale - 4, 4, 8);
  return { canvas: cv, scale, ox, oy };
}

// ---------- Física de mi coche ----------
function makeCar(t, g, color) {
  const s = gridSlot(t, g), i = s.idx;
  return {
    color, dark: darken(color),
    x: t.xs[i] + t.nx[i] * s.lat, y: t.ys[i] + t.ny[i] * s.lat,
    angle: t.dir[i], vx: 0, vy: 0, fwd: 0, lat: 0,
    idx: i, dist: Math.abs(s.lat), surface: 0,
    progress: -s.back,             // muestras recorridas (negativo = detrás de la meta)
    lapsDone: 0, lapStart: 0, lapTimes: [], bestLap: null,
    finished: false, finishFrame: null, wrongWay: 0, bumpCd: 0,
  };
}

function stepCar(car, ctl) {
  // 1) Girar (más lento a baja y a muy alta velocidad)
  const dirSign = car.fwd >= 0 ? 1 : -1;
  car.angle += ctl.steer * turnRate(car.fwd) * dirSign;

  // 2) Descomponer la velocidad respecto al nuevo rumbo (así aparece el derrape)
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let f = car.vx * fx + car.vy * fy;
  let l = -car.vx * fy + car.vy * fx;

  const grass = car.surface === 2;
  if (ctl.throttle) f += PHYS.accel * (grass ? 0.55 : 1) * ctl.throttle;
  if (ctl.brake) {
    if (f > 0.15) f = Math.max(0, f - PHYS.brake);
    else f -= PHYS.accel * 0.6;
  }
  if (!ctl.throttle && !ctl.brake) f *= 0.985;
  f *= grass ? 0.975 : car.surface === 1 ? 0.994 : 0.997;
  f = Math.max(-PHYS.reverseMax, Math.min(PHYS.maxSpeed, f));
  if (grass && f > PHYS.grassMax) f = Math.max(PHYS.grassMax, f * 0.94);
  l *= grass ? 0.9 : 0.8;

  car.vx = f * fx - l * fy;
  car.vy = f * fy + l * fx;
  car.fwd = f;
  car.lat = l;
  car.x += car.vx;
  car.y += car.vy;
}

function updateTrackPos(car, t) {
  const loc = locate(t, car.x, car.y, car.idx);
  const limit = t.half + RUNOFF - CAR_R * 0.6;
  // Muro: si te sales de la escapatoria, te devuelve y pierdes velocidad
  if (loc.dist > limit) {
    const i = loc.idx;
    const nx = (car.x - t.xs[i]) / loc.dist, ny = (car.y - t.ys[i]) / loc.dist;
    car.x = t.xs[i] + nx * limit;
    car.y = t.ys[i] + ny * limit;
    const vn = car.vx * nx + car.vy * ny;
    if (vn > 0) {
      car.vx -= 1.6 * vn * nx;
      car.vy -= 1.6 * vn * ny;
    }
    car.vx *= 0.6; car.vy *= 0.6;
    if (car.bumpCd <= 0 && vn > 1) { sound.bump(); car.bumpCd = 15; shake = Math.min(8, vn * 1.5); }
    loc.dist = limit;
  }
  if (car.bumpCd > 0) car.bumpCd--;

  let delta = loc.idx - car.idx;
  if (delta > t.N / 2) delta -= t.N;
  if (delta < -t.N / 2) delta += t.N;
  car.progress += delta;
  car.idx = loc.idx;
  car.dist = loc.dist;
  car.surface = loc.dist < t.half ? 0 : loc.dist < t.half + CURB ? 1 : 2;

  // Sentido contrario
  const along = Math.cos(car.angle - t.dir[car.idx]);
  car.wrongWay = along < -0.4 && Math.abs(car.fwd) > 1 ? car.wrongWay + 1 : 0;
}

// Piloto automático tras cruzar la meta: sigue la pista despacio
function autopilot(car, t) {
  const ti = (car.idx + Math.round(5 + Math.abs(car.fwd) * 1.7)) % t.N;
  const want = Math.atan2(t.ys[ti] - car.y, t.xs[ti] - car.x);
  const vt = t.speed[(car.idx + 6) % t.N] * 0.55;
  return {
    steer: Math.max(-1, Math.min(1, angDiff(want, car.angle) * 3)),
    throttle: car.fwd < vt ? 1 : 0,
    brake: car.fwd > vt + 0.4 ? 1 : 0,
  };
}

// Choques con los coches de los demás (solo se mueve el mío)
function collideRemote(car, others) {
  for (const o of others) {
    const dx = car.x - o.x, dy = car.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= CAR_R * 2 || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    car.x += nx * (CAR_R * 2 - d);
    car.y += ny * (CAR_R * 2 - d);
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      car.vx -= 1.3 * vn * nx;
      car.vy -= 1.3 * vn * ny;
      if (-vn > 1.5) sound.bump();
    }
  }
}

// ---------- Estado ----------
let ws = null;
let myId = null;
let isHost = false;
let joined = false;
let myName = '';
let ips = [], port = 3000;
let snap = null;           // último estado recibido del servidor
let race = null;           // carrera local
let shake = 0;
let myVote = null;

function send(m) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
}

// Crea la carrera local cuando el servidor empieza una nueva
function setupRace(s) {
  const t = trackById(s.tr);
  if (!t) return;
  const me = s.p.find(p => p.id === myId && p.ig);
  const racersCount = s.p.filter(p => p.ig).length;
  race = {
    rid: s.rid, t,
    gfx: renderTrack(t, Math.max(racersCount, 2)),
    mini: renderMinimap(t, 190, 150),
    car: me ? makeCar(t, me.g, me.c) : null,
    remotes: new Map(),
    state: 'countdown', frame: 0, raceFrame: 0,
    banner: null, cam: { x: 0, y: 0 }, lastBeep: 99,
    newRecord: false, order: [],
  };
  if (race.car) { race.cam.x = race.car.x; race.cam.y = race.car.y; }
  else { race.cam.x = t.xs[0]; race.cam.y = t.ys[0]; }
  shake = 0;
  $('results').hidden = true;
  myVote = null;
}

function banner(text, color = '#ffec27', frames = 120) {
  race.banner = { text, color, until: race.frame + frames };
}

// Un paso de física (60 por segundo)
function update() {
  const r = race, t = r.t, car = r.car;
  r.frame++;

  if (r.state === 'countdown') {
    if (snap.ph === 'playing') {
      r.state = 'racing';
      r.raceFrame = Math.round(snap.rt / STEP_MS);
      sound.beep(880, 0.4);
      banner('¡YA!', '#00e436', 50);
    } else if (snap.ph === 'countdown') {
      const n = Math.ceil(snap.left / 1000);
      if (n <= 3 && n < r.lastBeep) { sound.beep(440, 0.18); r.lastBeep = n; }
    }
  } else if (r.state === 'racing') {
    r.raceFrame++;
  }

  if (car && r.state === 'racing') {
    const ctl = car.finished
      ? autopilot(car, t)
      : { steer: (keys.d ? 1 : 0) - (keys.a ? 1 : 0), throttle: keys.w ? 1 : 0, brake: keys.s ? 1 : 0 };
    stepCar(car, ctl);
    collideRemote(car, r.remotes.values());
    updateTrackPos(car, t);
    checkLap(car);
    addSkid(car);
  }

  // Coches remotos: se acercan suavemente a la última posición recibida
  for (const o of r.remotes.values()) {
    o.x += (o.tx - o.x) * 0.3;
    o.y += (o.ty - o.y) * 0.3;
    o.angle += angDiff(o.ta, o.angle) * 0.3;
  }

  // Posiciones
  const list = [];
  for (const p of snap.p) {
    if (!p.ig) continue;
    const mine = car && p.id === myId;
    list.push({
      id: p.id, name: p.n, color: p.c, me: mine,
      progress: mine ? car.progress : p.pg,
      fin: mine ? (car.finished || p.fin) : p.fin,
      pl: p.pl || 0,
      lp: mine ? car.lapsDone : p.lp,
    });
  }
  list.sort((a, b) => {
    if (a.fin && b.fin) return (a.pl || 99) - (b.pl || 99);
    if (a.fin) return -1;
    if (b.fin) return 1;
    return b.progress - a.progress;
  });
  r.order = list;

  // Cámara: mi coche o, si miro, el que va primero
  let target = car;
  if (!car && list.length) target = r.remotes.get(list[0].id);
  if (target) {
    const tx = target.x + (target.vx || 0) * 14, ty = target.y + (target.vy || 0) * 14;
    r.cam.x += (tx - r.cam.x) * 0.12;
    r.cam.y += (ty - r.cam.y) * 0.12;
  }
  if (shake > 0) shake *= 0.85;
  if (shake < 0.2) shake = 0;

  sound.setEngine(car ? car.fwd : 0, !!car && snap.ph !== 'ended');

  // Enviar mi posición (30 veces por segundo)
  if (car && r.frame % 2 === 0 && (snap.ph === 'countdown' || snap.ph === 'playing')) {
    send({
      t: 'st', rid: r.rid, x: car.x, y: car.y, a: car.angle,
      pg: car.progress, lp: car.lapsDone,
      best: car.bestLap != null ? car.bestLap * STEP_MS : null,
    });
  }
}

function checkLap(car) {
  const r = race, N = r.t.N;
  if (car.finished) return;
  const laps = Math.max(0, Math.floor(car.progress / N));
  if (laps <= car.lapsDone) return;
  car.lapsDone = laps;
  const lapTime = r.raceFrame - car.lapStart;
  car.lapStart = r.raceFrame;
  car.lapTimes.push(lapTime);
  if (car.bestLap == null || lapTime < car.bestLap) car.bestLap = lapTime;

  if (car.lapsDone >= LAPS) {
    car.finished = true;
    car.finishFrame = r.raceFrame;
    send({ t: 'fin', rid: r.rid, best: car.bestLap * STEP_MS });
    banner('¡META!', '#ffec27', 150);
    sound.beep(1046, 0.5);
    const prev = Number(store.get(bestKey(r.t.def.id)));
    if (!prev || car.finishFrame < prev) {
      store.set(bestKey(r.t.def.id), String(car.finishFrame));
      r.newRecord = true;
    }
    return;
  }
  if (car.lapsDone === LAPS - 1) banner('¡ÚLTIMA VUELTA!', '#ff004d', 150);
  else banner(`VUELTA ${car.lapsDone + 1}/${LAPS}`, '#29adff', 100);
  sound.beep(660, 0.12);
}

// Marcas de derrape pintadas directamente sobre la pista pre-renderizada
function addSkid(car) {
  if (car.surface === 2 || Math.abs(car.lat) < 1.3) return;
  const g = race.gfx, c = g.ctx;
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  c.fillStyle = 'rgba(20,18,24,.35)';
  for (const side of [-7, 7]) {
    const x = car.x - ca * 12 - sa * side - g.ox;
    const y = car.y - sa * 12 + ca * side - g.oy;
    c.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
  }
}

// ---------- Dibujo ----------
function drawCar(c, car) {
  c.save();
  c.translate(Math.round(car.x), Math.round(car.y));
  c.rotate(car.angle);
  c.fillStyle = 'rgba(0,0,0,.35)';            // sombra
  c.fillRect(-16, -8, 34, 20);
  c.fillStyle = '#111';                       // ruedas
  c.fillRect(-14, -12, 9, 5); c.fillRect(-14, 7, 9, 5);
  c.fillRect(7, -12, 9, 5); c.fillRect(7, 7, 9, 5);
  c.fillStyle = car.dark;                     // carrocería
  c.fillRect(-17, -9, 34, 18);
  c.fillStyle = car.color;
  c.fillRect(-16, -8, 32, 16);
  c.fillStyle = 'rgba(255,255,255,.55)';      // franja
  c.fillRect(-16, -2, 32, 4);
  c.fillStyle = '#1d2b53';                    // cabina
  c.fillRect(-4, -6, 10, 12);
  c.fillStyle = '#29adff';
  c.fillRect(3, -5, 3, 10);
  c.fillStyle = car.dark;                     // alerón
  c.fillRect(-19, -10, 4, 20);
  c.fillStyle = '#fff1e8';                    // faros
  c.fillRect(15, -7, 2, 4); c.fillRect(15, 3, 2, 4);
  c.restore();
}

function box(x, y, w, h) {
  ctx.fillStyle = 'rgba(29,43,83,.88)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#29adff';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
}

function text(str, x, y, size, color = '#fff1e8', align = 'left') {
  ctx.font = `${size}px 'Press Start 2P', monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + Math.max(2, size / 8), y + Math.max(2, size / 8));
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function draw() {
  const r = race, g = r.gfx;

  // Cámara limitada al mapa
  const clampX = v => Math.round(Math.max(0, Math.min(g.w - VIEW_W, v)));
  const clampY = v => Math.round(Math.max(0, Math.min(g.h - VIEW_H, v)));
  let cx = r.cam.x - VIEW_W / 2 - g.ox, cy = r.cam.y - VIEW_H / 2 - g.oy;
  if (shake) { cx += (Math.random() - 0.5) * shake; cy += (Math.random() - 0.5) * shake; }
  cx = clampX(cx); cy = clampY(cy);

  ctx.drawImage(g.canvas, cx, cy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

  ctx.save();
  ctx.translate(-cx - g.ox, -cy - g.oy);
  for (const o of r.remotes.values()) drawCar(ctx, o);
  if (r.car) drawCar(ctx, r.car);                // el mío encima
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  for (const o of r.remotes.values()) {
    ctx.fillStyle = '#000';
    ctx.fillText(o.name, Math.round(o.x) + 1, Math.round(o.y) - 20);
    ctx.fillStyle = o.color;
    ctx.fillText(o.name, Math.round(o.x), Math.round(o.y) - 21);
  }
  ctx.restore();

  drawHud(r);
}

function drawHud(r) {
  const car = r.car;

  if (car) {
    const me = r.order.findIndex(o => o.me) + 1;
    // Vuelta y posición
    box(12, 12, 240, 78);
    text('VUELTA', 26, 26, 10, '#ffec27');
    text(`${Math.min(LAPS, car.lapsDone + 1)}/${LAPS}`, 26, 46, 22);
    text('POS', 160, 26, 10, '#ffec27');
    text(`${me}º`, 160, 46, 22, me === 1 ? '#00e436' : '#fff1e8');

    // Tiempos
    box(VIEW_W - 262, 12, 250, 92);
    const cur = r.state === 'countdown' ? 0 : r.raceFrame;
    text('TOTAL', VIEW_W - 248, 26, 10, '#ffec27');
    text(fmtFrames(car.finished ? car.finishFrame : cur), VIEW_W - 26, 26, 10, '#fff1e8', 'right');
    text('VUELTA', VIEW_W - 248, 50, 10, '#ffec27');
    text(fmtFrames(car.finished ? car.lapTimes[car.lapTimes.length - 1] : cur - car.lapStart), VIEW_W - 26, 50, 10, '#fff1e8', 'right');
    text('MEJOR', VIEW_W - 248, 74, 10, '#ffec27');
    text(fmtFrames(car.bestLap), VIEW_W - 26, 74, 10, '#00e436', 'right');

    // Velocímetro
    box(12, VIEW_H - 70, 200, 58);
    const kmh = Math.round(Math.abs(car.fwd) * 30);
    text(String(kmh).padStart(3, '0'), 26, VIEW_H - 54, 22, car.surface === 2 ? '#ffa300' : '#fff1e8');
    text('KM/H', 130, VIEW_H - 46, 10, '#ffec27');
    ctx.fillStyle = '#000'; ctx.fillRect(26, VIEW_H - 24, 172, 6);
    ctx.fillStyle = kmh > 240 ? '#ff004d' : '#00e436';
    ctx.fillRect(26, VIEW_H - 24, Math.round(172 * Math.min(1, Math.abs(car.fwd) / PHYS.maxSpeed)), 6);
  } else {
    box(12, 12, 300, 44);
    text('MODO ESPECTADOR', 26, 28, 10, '#ffec27');
  }

  // Minimapa
  const m = r.mini;
  const mx = VIEW_W - m.canvas.width - 12, my = VIEW_H - m.canvas.height - 12;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(mx, my, m.canvas.width, m.canvas.height);
  ctx.drawImage(m.canvas, mx, my);
  const dots = [...r.remotes.values()];
  if (car) dots.push(car);
  for (const o of dots) {
    const x = mx + (o.x - m.ox) * m.scale, y = my + (o.y - m.oy) * m.scale;
    const s = o === car ? 8 : 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(x - s / 2) - 1, Math.round(y - s / 2) - 1, s + 2, s + 2);
    ctx.fillStyle = o.color;
    ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }

  // Clasificación en directo
  const ly = car ? 104 : 68, rows = r.order.slice(0, 12);
  box(12, ly, 220, 16 + rows.length * 18);
  rows.forEach((o, i) => {
    ctx.fillStyle = o.color;
    ctx.fillRect(24, ly + 12 + i * 18, 8, 8);
    text(`${i + 1} ${o.name}`, 40, ly + 11 + i * 18, 8, o.me ? '#ffec27' : '#fff1e8');
    text(o.fin ? 'META' : `V${Math.min(LAPS, o.lp + 1)}`, 220, ly + 11 + i * 18, 8, o.fin ? '#00e436' : '#83769c', 'right');
  });

  // Cuenta atrás
  if (r.state === 'countdown' && snap.ph === 'countdown') {
    const n = Math.ceil(snap.left / 1000);
    if (n > 3) {
      text(r.t.def.name, VIEW_W / 2, VIEW_H / 2 - 70, 28, r.t.def.color, 'center');
      text(`DIFICULTAD ${r.t.def.diff} · ${LAPS} VUELTAS`, VIEW_W / 2, VIEW_H / 2 - 20, 12, '#fff1e8', 'center');
    } else if (n > 0) {
      text(String(n), VIEW_W / 2, VIEW_H / 2 - 60, 72, n === 1 ? '#ffa300' : '#ff004d', 'center');
    }
    if (car) text('W ACELERAR  S FRENAR  A/D GIRAR', VIEW_W / 2, VIEW_H - 110, 10, '#fff1e8', 'center');
  }

  // Mensajes
  if (r.banner && r.frame < r.banner.until) {
    text(r.banner.text, VIEW_W / 2, 150, 28, r.banner.color, 'center');
  }
  if (car && car.wrongWay > 40 && !car.finished && Math.floor(r.frame / 20) % 2 === 0) {
    text('¡SENTIDO CONTRARIO!', VIEW_W / 2, VIEW_H / 2 + 40, 18, '#ff004d', 'center');
  }
  if (snap.ph === 'playing' && snap.left > 0) {
    text(`FIN DE CARRERA EN ${Math.ceil(snap.left / 1000)}s`, VIEW_W / 2, 110, 10, '#ffa300', 'center');
  }
}

// ---------- Resultados ----------
function showResults(s) {
  const body = $('resultsBody');
  body.innerHTML = '';
  for (const p of s.res || []) {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'me';
    const time = p.fin ? fmtMs(p.t) : `VUELTA ${Math.min(LAPS, p.lp + 1)}/${LAPS}`;
    tr.innerHTML = `<td>${p.pos}º</td><td><span class="dot" style="background:${esc(p.c)}"></span>${esc(p.n)}</td>` +
      `<td>${time}</td><td>${fmtMs(p.best)}</td>`;
    body.appendChild(tr);
  }
  const mine = (s.res || []).find(p => p.id === myId);
  const winner = (s.res || [])[0];
  if (mine) {
    $('resultsTitle').textContent = mine.pos === 1 ? '¡HAS GANADO!' : `HAS QUEDADO ${mine.pos}º`;
    $('resultsTitle').style.color = mine.pos === 1 ? '#ffec27' : '#fff1e8';
  } else {
    $('resultsTitle').textContent = winner ? `¡GANA ${winner.n}!` : 'RESULTADOS';
    $('resultsTitle').style.color = '#ffec27';
  }
  const t = race && race.t;
  $('resultsTrack').textContent = t ? `${t.def.name} · ${t.def.diff}` : '';
  $('resultsRecord').hidden = !(race && race.newRecord);
  $('results').hidden = false;
}

// ---------- Sala: tarjetas de pista ----------
const cards = new Map();   // id -> { btn, votes }

function drawPreview(cv, t) {
  const c = cv.getContext('2d');
  const bw = t.bounds.maxX - t.bounds.minX, bh = t.bounds.maxY - t.bounds.minY;
  const pad = 14;
  const scale = Math.min((cv.width - 2 * pad) / bw, (cv.height - 2 * pad) / bh);
  const ox = t.bounds.minX - (cv.width / scale - bw) / 2;
  const oy = t.bounds.minY - (cv.height / scale - bh) / 2;
  c.fillStyle = t.def.theme.out;
  c.fillRect(0, 0, cv.width, cv.height);
  c.lineJoin = c.lineCap = 'round';
  c.lineWidth = t.def.width * scale + 6;
  c.strokeStyle = t.def.theme.runoff;
  tracePath(c, t, ox, oy, scale); c.stroke();
  c.lineWidth = t.def.width * scale;
  c.strokeStyle = t.def.theme.asphalt;
  tracePath(c, t, ox, oy, scale); c.stroke();
  c.fillStyle = '#fff1e8';
  c.save();
  c.translate((t.xs[0] - ox) * scale, (t.ys[0] - oy) * scale);
  c.rotate(t.dir[0]);
  c.fillRect(-2, -t.def.width * scale / 2, 4, t.def.width * scale);
  c.restore();
}

function buildCards() {
  const list = $('trackList');
  list.innerHTML = '';
  cards.clear();
  built.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'track';
    btn.style.setProperty('--c', t.def.color);
    const stars = '★'.repeat(i + 1) + '☆'.repeat(Math.max(0, 2 - i));
    btn.innerHTML = `
      <span class="diff">${t.def.diff} <span class="stars">${stars}</span></span>
      <canvas width="260" height="170"></canvas>
      <span class="tname">${t.def.name}</span>
      <span class="stat">CURVAS: <b>${t.curves}</b> · CERRADAS: <b>${t.hairpins}</b></span>
      <span class="stat">LONGITUD: <b>${(t.length / 1000).toFixed(1)} KM</b> · ANCHO: <b>${t.def.width >= 160 ? 'AMPLIO' : t.def.width >= 135 ? 'MEDIO' : 'ESTRECHO'}</b></span>
      <span class="stat record">TU RÉCORD: <b></b></span>
      <span class="votes" hidden></span>`;
    drawPreview(btn.querySelector('canvas'), t);
    btn.addEventListener('click', () => onCardClick(t.def.id));
    list.appendChild(btn);
    cards.set(t.def.id, { btn, votes: btn.querySelector('.votes'), record: btn.querySelector('.record b') });
  });
}

function onCardClick(id) {
  if (!snap) return;
  const n = snap.p.length;
  if (snap.ph === 'lobby' && isHost && n >= 1 && n <= HOST_PICK_MAX) send({ t: 'pick', track: id });
  else if (snap.ph === 'voting' && joined) { myVote = id; send({ t: 'vote', track: id }); renderLobby(); }
}

function renderLobby() {
  const s = snap;
  const n = s.p.length;
  const voting = s.ph === 'voting';
  const hostPicks = s.ph === 'lobby' && isHost && n >= 1 && n <= HOST_PICK_MAX;
  const canVote = voting && joined;

  let msg, sub = '';
  if (voting) {
    const secs = Math.ceil(s.left / 1000);
    const done = s.p.filter(p => p.v).length;
    msg = joined ? (myVote ? '¡VOTO REGISTRADO! PUEDES CAMBIARLO' : '¡VOTA LA PISTA!') : 'VOTACIÓN EN CURSO';
    sub = `QUEDAN ${secs}s · HAN VOTADO ${done}/${n}`;
  } else if (n === 0) {
    msg = 'ESPERANDO PILOTOS...';
    sub = isHost ? 'PUEDES JUGAR TAMBIÉN DESDE EL PANEL DEL HOST' : '';
  } else if (n <= HOST_PICK_MAX) {
    msg = isHost ? 'ELIGE LA PISTA PARA EMPEZAR' : 'EL HOST ESTÁ ELIGIENDO LA PISTA...';
    sub = `${n} PILOTO${n > 1 ? 'S' : ''}: CON ${HOST_PICK_MAX} O MENOS ELIGE EL HOST`;
  } else {
    msg = isHost ? 'ABRE LA VOTACIÓN PARA ELEGIR PISTA' : 'ESPERANDO A QUE EL HOST ABRA LA VOTACIÓN...';
    sub = `${n} PILOTOS: LA PISTA SE ELIGE POR VOTACIÓN`;
  }
  $('lobbyMsg').textContent = msg;
  $('lobbySub').textContent = sub;
  $('btnVote').hidden = !(isHost && s.ph === 'lobby' && n > HOST_PICK_MAX);

  for (const [id, c] of cards) {
    const clickable = hostPicks || canVote;
    c.btn.disabled = !clickable;
    c.btn.classList.toggle('picked', voting && myVote === id);
    if (voting) {
      const v = s.votes ? s.votes[id] : 0;
      c.votes.hidden = false;
      c.votes.textContent = `${v} VOTO${v === 1 ? '' : 'S'}`;
    } else c.votes.hidden = true;
    const best = Number(store.get(bestKey(id)));
    c.record.textContent = best ? fmtFrames(best) : '--:--.--';
  }

  // Lista de pilotos
  $('playerCount').textContent = `(${n})`;
  const ul = $('playerList');
  ul.innerHTML = '';
  for (const p of s.p) {
    const li = document.createElement('li');
    if (p.id === myId) li.className = 'me';
    li.innerHTML = `<span><span class="dot" style="background:${esc(p.c)}"></span><span class="pname">${esc(p.n)}</span></span>` +
      `<span>${p.h ? '<span class="tag">HOST</span>' : ''}${voting ? (p.v ? ' ✔' : ' …') : ''}</span>`;
    ul.appendChild(li);
  }

  $('hostPanel').hidden = !isHost;
  $('hostJoinForm').hidden = joined;
}

function renderAddresses() {
  const list = $('addrList');
  list.innerHTML = '';
  const urls = ONLINE || location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
    ? [location.origin]
    : ips.map(ip => `http://${ip}:${port}`);
  if (!urls.length) urls.push(location.origin);
  for (const u of urls) {
    const d = document.createElement('div');
    d.textContent = u;
    list.appendChild(d);
  }
}

// ---------- Pantallas ----------
let currentScreen = null;
function showScreen(id) {
  if (currentScreen === id) return;
  currentScreen = id;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id !== 'game') sound.setEngine(0, false);
  if (id === 'join') setTimeout(() => $('nameInput').focus(), 0);
}

function onSnapshot(s) {
  snap = s;
  const inRace = s.ph === 'countdown' || s.ph === 'playing' || s.ph === 'ended';

  if (inRace && (!race || race.rid !== s.rid)) setupRace(s);
  if (!inRace) {
    race = null;
    $('results').hidden = true;
  }
  if (s.ph !== 'voting') myVote = null;

  // Eventos
  for (const e of s.e || []) {
    if (e.k === 'voted' && race) {
      banner(e.tie ? 'EMPATE: PISTA SORTEADA' : 'PISTA MÁS VOTADA', '#29adff', 70);
    }
    if (e.k === 'fin' && race && race.car && e.n !== myName) {
      if (!race.banner || race.frame > race.banner.until) banner(`${e.n} LLEGA ${e.pl}º`, e.c, 120);
    }
  }

  // Coches remotos
  if (race) {
    const seen = new Set();
    for (const p of s.p) {
      if (!p.ig || (race.car && p.id === myId) || p.pg < -1e8) continue;
      seen.add(p.id);
      let o = race.remotes.get(p.id);
      if (!o) {
        o = { x: p.x, y: p.y, angle: p.a, color: p.c, dark: darken(p.c), name: p.n, vx: 0, vy: 0 };
        race.remotes.set(p.id, o);
      }
      o.vx = (p.x - (o.tx ?? p.x)) / 2;
      o.vy = (p.y - (o.ty ?? p.y)) / 2;
      o.tx = p.x; o.ty = p.y; o.ta = p.a;
    }
    for (const id of race.remotes.keys()) if (!seen.has(id)) race.remotes.delete(id);
  }

  if (!joined && !isHost) showScreen('join');
  else if (inRace) showScreen('game');
  else showScreen('lobby');

  if (currentScreen === 'lobby') renderLobby();
  if (currentScreen === 'game') {
    if (s.ph === 'ended' && $('results').hidden) showResults(s);
    if (s.ph === 'ended') $('resultsBack').textContent = `VOLVIENDO A LA SALA EN ${Math.ceil(s.left / 1000)}s`;
    $('btnStop').hidden = !isHost;
    $('gameInfo').textContent = race ? `${race.t.def.name} · ${race.t.def.diff} · M: SONIDO` : '';
  }
}

// ---------- Red ----------
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { $('offline').hidden = true; };
  ws.onmessage = ev => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 's') onSnapshot(m);
    else if (m.t === 'welcome') {
      myId = m.id; isHost = m.isHost; ips = m.ips || []; port = m.port;
      LAPS = m.laps || LAPS; HOST_PICK_MAX = m.hostPickMax || HOST_PICK_MAX;
      joined = false;
      race = null;
      renderAddresses();
      if (myName) send({ t: 'join', name: myName });      // reconexión
    } else if (m.t === 'joined') {
      joined = true;
      myName = m.name;
    } else if (m.t === 'host') {
      isHost = true;
    }
  };
  ws.onclose = () => {
    $('offline').hidden = false;
    setTimeout(connect, 1500);
  };
}

$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  sound.init();
  myName = $('nameInput').value.trim();
  send({ t: 'join', name: myName });
});
$('hostJoinForm').addEventListener('submit', e => {
  e.preventDefault();
  sound.init();
  myName = $('hostName').value.trim() || 'HOST';
  send({ t: 'join', name: myName });
});
$('btnVote').addEventListener('click', () => send({ t: 'voteStart' }));
$('btnStop').addEventListener('click', () => send({ t: 'stop' }));

// ---------- Bucle principal ----------
let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(100, now - last);
  last = now;
  if (race && snap && currentScreen === 'game') {
    while (acc >= STEP_MS) { update(); acc -= STEP_MS; }
    draw();
  } else acc = 0;
  requestAnimationFrame(loop);
}

buildCards();
// La fuente pixelada puede tardar en cargar
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (snap && currentScreen === 'lobby') renderLobby(); });
connect();
requestAnimationFrame(loop);
