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
const CAR_R = 13;                  // radio de choque entre coches (en la arena, × DERBY.CAR_SCALE)
const carScale = () => (race && race.mode === 'derby' ? DERBY.CAR_SCALE : 1);
const carR = () => CAR_R * carScale();
const CURB = 10;                   // ancho del piano rojo/blanco
const FALL_FRAMES = 70;            // lo que dura la caída por un acantilado (~1,2 s)
// Turbo para el último: más punta y aceleración hasta alcanzar al de delante
// (se activa si va más de TURBO.on muestras por detrás y se apaga a TURBO.off)
const TURBO = { speed: 1.3, accel: 1.5, on: 25, off: 8 };

// En móviles/tablets el juego ocupa toda la pantalla y se maneja con flechas y botones táctiles
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
if (IS_TOUCH) document.body.classList.add('touch');

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// ---------- Pantalla completa ----------
const FS_SUPPORTED = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function enterFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!fn) return;
  try {
    const p = fn.call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
  } catch {}
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!fn) return;
  try {
    const p = fn.call(document);
    if (p && p.catch) p.catch(() => {});
  } catch {}
}
function toggleFullscreen() {
  if (isFullscreen()) exitFullscreen();
  else enterFullscreen();
}

// Tamaño lógico de la vista. En ordenador (ventana normal) es fijo, 3:2. En móvil,
// y en ordenador a pantalla completa, se adapta a la forma de la pantalla: el
// lado corto mide 440-480 px lógicos en móvil (para que el texto se lea) y 640
// en ordenador.
let VIEW_W = 960, VIEW_H = 640;
function resizeView() {
  const fill = IS_TOUCH || isFullscreen();
  document.body.classList.toggle('fill', fill);
  document.body.classList.toggle('is-fs', isFullscreen());
  if (fill) {
    const w = innerWidth, h = innerHeight;
    const short = IS_TOUCH ? (w >= h ? 440 : 480) : 640;
    if (w >= h) { VIEW_H = short; VIEW_W = Math.min(1800, Math.round(short * w / h)); }
    else { VIEW_W = short; VIEW_H = Math.min(1800, Math.round(short * h / w)); }
  } else {
    VIEW_W = 960; VIEW_H = 640;
  }
  if (canvas.width !== VIEW_W || canvas.height !== VIEW_H) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
  }
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', resizeView);
document.addEventListener('fullscreenchange', resizeView);
document.addEventListener('webkitfullscreenchange', resizeView);
resizeView();
const compactHud = () => VIEW_W < 760;

const built = TRACKS.map(buildTrack);
const trackById = id => built.find(t => t.def.id === id);
const arenaById = id => ARENAS.find(a => a.id === id);
const buildArena = a => ({ def: a, arena: a, bounds: arenaBounds(a) });
const hpColor = hp => (hp > 60 ? '#00e436' : hp > 30 ? '#ffec27' : '#ff004d');
function fmtClock(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

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
    music.start();
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
  crash(big) {
    this.beep(big ? 60 : 110, big ? 0.35 : 0.15, 'sawtooth', big ? 0.22 : 0.12);
    if (big) this.beep(45, 0.45, 'square', 0.12);
  },
  toggle() {
    this.muted = !this.muted;
    store.set('8bits-racing.mute', this.muted ? '1' : '0');
    music.apply();
  },
};

// ---------- Música de fondo ----------
// Chiptune ORIGINAL de estilo metal (riff grave en re menor con power chords,
// batería y melodía). Si existe public/music.mp3 se usa ese archivo en su lugar
// (solo con música que se tenga permiso para usar).
const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const BASS = {   // 16 semicorcheas por compás; 0 = silencio
  A1: [38, 0, 38, 38, 0, 38, 0, 41, 38, 0, 38, 38, 0, 43, 0, 41],
  A2: [38, 0, 38, 38, 0, 38, 0, 41, 38, 0, 36, 0, 37, 0, 38, 0],
  B1: [41, 0, 41, 41, 0, 41, 0, 43, 41, 0, 41, 41, 0, 45, 0, 43],
  B2: [43, 0, 43, 43, 0, 43, 0, 45, 46, 0, 45, 0, 43, 0, 41, 0],
};
const LEAD = {
  __: new Array(16).fill(0),
  L1: [62, 0, 0, 0, 65, 0, 0, 0, 69, 0, 67, 0, 65, 0, 62, 0],
  L2: [60, 0, 0, 0, 62, 0, 0, 0, 65, 0, 64, 0, 62, 0, 0, 0],
  M1: [65, 0, 65, 0, 69, 0, 72, 0, 70, 0, 69, 0, 67, 0, 65, 0],
  M2: [67, 0, 67, 0, 70, 0, 74, 0, 72, 0, 70, 0, 69, 0, 67, 0],
  M3: [74, 0, 0, 72, 0, 0, 69, 0, 70, 0, 69, 0, 65, 0, 0, 0],
  M4: [62, 0, 0, 0, 0, 0, 0, 0, 61, 0, 0, 0, 62, 0, 0, 0],
};
const SONG = [['A1', '__'], ['A2', '__'], ['A1', 'L1'], ['A2', 'L2'], ['B1', 'M1'], ['B2', 'M2'], ['A1', 'M3'], ['A2', 'M4']];
const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];

const music = {
  enabled: store.get('8bits-racing.music') !== '0',
  out: null, noise: null, timer: null, step: 0, next: 0, audio: null, tempo: 150,
  start() {
    const ac = sound.ctx;
    if (!ac || this.out) return;
    this.out = ac.createGain();
    this.out.connect(ac.destination);
    const buf = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // ¿Hay una música propia en public/music.mp3?
    fetch('music.mp3', { method: 'HEAD' }).then(r => {
      if (r.ok && (r.headers.get('content-type') || '').includes('audio')) {
        this.audio = new Audio('music.mp3');
        this.audio.loop = true;
        this.audio.volume = 0.4;
      }
    }).catch(() => {}).finally(() => {
      if (!this.audio) {
        this.next = ac.currentTime + 0.1;
        this.timer = setInterval(() => this.schedule(), 25);
      }
      this.apply();
    });
  },
  apply() {
    const on = this.enabled && !sound.muted;
    if (this.out) this.out.gain.value = on ? 0.05 : 0;
    if (this.audio) { if (on) this.audio.play().catch(() => {}); else this.audio.pause(); }
    for (const id of ['btnMusic', 'btnMusicLobby']) {
      const b = $(id);
      if (b) {
        b.classList.toggle('off', !this.enabled);
        b.querySelector('.mlabel').textContent = this.enabled ? 'MÚSICA: SÍ' : 'MÚSICA: NO';
      }
    }
  },
  toggle() {
    this.enabled = !this.enabled;
    store.set('8bits-racing.music', this.enabled ? '1' : '0');
    sound.init();
    this.apply();
  },
  // Programa las notas que tocan en los próximos 120 ms
  schedule() {
    const ac = sound.ctx, dt = 60 / this.tempo / 4;
    if (this.next < ac.currentTime - 0.2) this.next = ac.currentTime + 0.05;   // la pestaña estuvo dormida
    while (this.next < ac.currentTime + 0.12) {
      const bar = SONG[Math.floor(this.step / 16) % SONG.length], k = this.step % 16, t = this.next;
      const b = BASS[bar[0]][k], l = LEAD[bar[1]][k];
      if (b) { this.tone(midi(b), t, 0.13, 'square', 0.55, 700); this.tone(midi(b) * 1.5, t, 0.13, 'square', 0.3, 700); }
      if (l) this.tone(midi(l), t, 0.2, 'square', 0.32, 2600);
      if (KICK[k]) this.kick(t);
      if (SNARE[k]) this.hit(t, 0.12, 1200, 0.5);
      if (k % 2 === 0) this.hit(t, 0.03, 7000, 0.18);
      this.next += dt;
      this.step = (this.step + 1) % (SONG.length * 16);
    }
  },
  tone(freq, t, dur, type, vol, cut) {
    const ac = sound.ctx, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    f.type = 'lowpass'; f.frequency.value = cut;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t); o.stop(t + dur + 0.02);
  },
  kick(t) {
    const ac = sound.ctx, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.out);
    o.start(t); o.stop(t + 0.16);
  },
  hit(t, dur, cut, vol) {
    const ac = sound.ctx, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noise;
    f.type = 'highpass'; f.frequency.value = cut;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    s.start(t); s.stop(t + dur + 0.02);
  },
};
addEventListener('pointerdown', () => sound.init());

// ---------- Entrada (W A S D o flechas) ----------
const keys = { w: false, a: false, s: false, d: false };
const KEYMAP = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  ArrowUp: 'w', ArrowLeft: 'a', ArrowDown: 's', ArrowRight: 'd',
};
// Se guarda cada tecla física: si mantienes W y ↑ y sueltas una, sigues acelerando
const held = new Set();
function syncKeys() {
  for (const k of Object.keys(keys)) keys[k] = false;
  for (const code of held) keys[KEYMAP[code]] = true;
}

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  sound.init();
  if (KEYMAP[e.code]) {
    held.add(e.code);
    syncKeys();
    e.preventDefault();                    // que las flechas no muevan la página
    return;
  }
  if (e.code === 'KeyM') sound.toggle();
  if (e.code === 'KeyN') music.toggle();
  if (e.code === 'KeyF' && FS_SUPPORTED) toggleFullscreen();
});
addEventListener('keyup', e => {
  if (held.delete(e.code)) syncKeys();
});
addEventListener('blur', () => { held.clear(); syncKeys(); });

// ---------- Controles táctiles (móviles) ----------
// Flechas ← → a la izquierda: solo giran. Las dos siguen al mismo dedo, así el
// pulgar puede deslizarse de una a otra sin levantarlo. Botones A/B a la derecha.
const dpad = { left: false, right: false, id: null };
const dpadEl = $('dpad');
const DPAD_DIRS = ['left', 'right'];

function dpadSet(dir) {
  for (const d of DPAD_DIRS) {
    dpad[d] = d === dir;
    dpadEl.querySelector('.' + d).classList.toggle('on', dpad[d]);
  }
}
// Mitad izquierda = ←, mitad derecha = →; el hueco del centro no activa nada
function dpadMove(e) {
  const r = dpadEl.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  dpadSet(Math.abs(dx) < r.width * 0.04 ? null : dx < 0 ? 'left' : 'right');
}
function dpadRelease(e) {
  if (e && e.pointerId !== dpad.id) return;
  dpad.id = null;
  dpadSet(null);
}
dpadEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  sound.init();
  dpad.id = e.pointerId;
  dpadEl.setPointerCapture(e.pointerId);
  dpadMove(e);
});
dpadEl.addEventListener('pointermove', e => { if (e.pointerId === dpad.id) dpadMove(e); });
dpadEl.addEventListener('pointerup', dpadRelease);
dpadEl.addEventListener('pointercancel', dpadRelease);
dpadEl.addEventListener('lostpointercapture', dpadRelease);
dpadEl.addEventListener('contextmenu', e => e.preventDefault());

// Botones A (acelerar) y B (frenar). Cada uno sigue a su propio dedo,
// así se puede girar con las flechas y pulsar A a la vez.
const pads = { a: false, b: false };
for (const [key, id] of [['a', 'btnGas'], ['b', 'btnBrake']]) {
  const el = $(id);
  let pid = null;
  const up = e => {
    if (e.pointerId !== pid) return;
    pid = null; pads[key] = false; el.classList.remove('on');
  };
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    sound.init();
    pid = e.pointerId;
    el.setPointerCapture(e.pointerId);
    pads[key] = true;
    el.classList.add('on');
  });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

// Mezcla teclado y controles táctiles
function playerControl() {
  return {
    steer: Math.max(-1, Math.min(1, (keys.d || dpad.right ? 1 : 0) - (keys.a || dpad.left ? 1 : 0))),
    throttle: keys.w || pads.a ? 1 : 0,
    brake: keys.s || pads.b ? 1 : 0,
  };
}

// ---------- Render de la pista (una vez por carrera) ----------
// Margen alrededor de la pista: suficiente para que la cámara pueda centrar el
// coche aunque esté en el borde del mapa (en vertical la vista es muy alta).
const margins = () => [RUNOFF + Math.max(260, VIEW_W / 2 + 100), RUNOFF + Math.max(260, VIEW_H / 2 + 100)];

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
  const [mx, my] = margins();
  const ox = t.bounds.minX - mx, oy = t.bounds.minY - my;
  const w = Math.max(VIEW_W, Math.ceil(t.bounds.maxX - t.bounds.minX + 2 * mx));
  const h = Math.max(VIEW_H, Math.ceil(t.bounds.maxY - t.bounds.minY + 2 * my));
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
  if (t.cliff) drawTrackHazards(c, t, ox, oy, r);

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

// Acantilados (vacío con borde de roca), manchas de aceite, barro y raíles de los bloques
function drawTrackHazards(c, t, ox, oy, r) {
  const inner = t.half + CURB, outer = t.half + RUNOFF + 18;
  const edge = (i, side, d) => [t.xs[i] + t.nx[i] * side * d - ox, t.ys[i] + t.ny[i] * side * d - oy];
  for (let i = 0; i < t.N; i++) {
    const cv = t.cliff[i];
    if (!cv) continue;
    const j = (i + 1) % t.N;
    for (const side of cv === 2 ? [-1, 1] : [cv]) {
      const a = edge(i, side, inner), b = edge(j, side, inner), cc = edge(j, side, outer), d = edge(i, side, outer);
      c.fillStyle = '#000';
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(cc[0], cc[1]); c.lineTo(d[0], d[1]); c.closePath(); c.fill();
      // Borde de roca claro (para que el precipicio se vea bien) y piedras cayendo al fondo
      const rim = edge(i, side, inner + 3), rim2 = edge(i, side, inner + 10);
      c.fillStyle = i % 2 ? '#c2c3c7' : '#83769c';
      c.fillRect(Math.round(rim[0]) - 4, Math.round(rim[1]) - 4, 8, 8);
      c.fillStyle = '#5f574f';
      c.fillRect(Math.round(rim2[0]) - 3, Math.round(rim2[1]) - 3, 6, 6);
      if (r() < 0.3) {
        const m = edge(i, side, inner + 16 + r() * (outer - inner - 20));
        c.fillStyle = r() < 0.5 ? 'rgba(131,118,156,.5)' : 'rgba(126,37,83,.6)';
        c.fillRect(Math.round(m[0]), Math.round(m[1]), 3, 3);
      }
    }
  }
  for (const o of t.oil) {
    const x = o.x - ox, y = o.y - oy;
    c.fillStyle = '#0b0b10';
    for (const [dx, dy, rr] of [[0, 0, o.r], [-10, 6, o.r * 0.6], [12, -5, o.r * 0.55]]) {
      c.beginPath(); c.arc(x + dx, y + dy, rr, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(41,173,255,.45)'; c.lineWidth = 3;
    c.beginPath(); c.arc(x - 4, y - 4, o.r * 0.55, 3.6, 5.2); c.stroke();
    c.strokeStyle = 'rgba(255,119,168,.35)';
    c.beginPath(); c.arc(x + 3, y + 2, o.r * 0.7, 0.2, 1.4); c.stroke();
  }
  for (const m of t.mud) {
    c.save();
    c.translate(m.x - ox, m.y - oy);
    c.rotate(m.ang);
    c.fillStyle = '#5a3b1e';
    c.beginPath(); c.ellipse(0, 0, m.rx, m.ry, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3e2812';
    for (let k = 0; k < 14; k++) c.fillRect(Math.round((r() - 0.5) * m.rx * 1.4), Math.round((r() - 0.5) * m.ry * 1.2), 5, 4);
    c.restore();
  }
  for (const p of t.pistons) {
    const a = edge(p.idx, -1, t.half + 4), b = edge(p.idx, 1, t.half + 4);
    c.strokeStyle = '#16161a'; c.lineWidth = 14; c.setLineDash([]);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    c.fillStyle = '#ffec27';
    for (const e of [a, b]) c.fillRect(Math.round(e[0]) - 6, Math.round(e[1]) - 6, 12, 12);
  }
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

// ---------- Arena de demolición ----------
function renderArena(t, count) {
  const a = t.def, th = a.theme;
  const [mx, my] = margins();
  const ox = t.bounds.minX - mx, oy = t.bounds.minY - my;
  const w = Math.max(VIEW_W, Math.ceil(t.bounds.maxX - t.bounds.minX + 2 * mx));
  const h = Math.max(VIEW_H, Math.ceil(t.bounds.maxY - t.bounds.minY + 2 * my));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const r = rng(4242);
  const cx = a.cx - ox, cy = a.cy - oy;
  const ell = grow => { c.beginPath(); c.ellipse(cx, cy, a.rx + grow, a.ry + grow, 0, 0, Math.PI * 2); };

  c.fillStyle = th.out;
  c.fillRect(0, 0, w, h);
  // Gradas con público
  ell(240); c.fillStyle = '#2a2233'; c.fill();
  const crowd = ['#ff004d', '#29adff', '#ffec27', '#00e436', '#ff77a8', '#fff1e8', '#ffa300', '#83769c'];
  for (let i = 0; i < 3200; i++) {
    const ang = r() * Math.PI * 2, k = 70 + r() * 165;
    const x = cx + Math.cos(ang) * (a.rx + k), y = cy + Math.sin(ang) * (a.ry + k);
    c.fillStyle = crowd[Math.floor(r() * crowd.length)];
    c.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, 4, 4);
  }
  // Valla de hormigón
  ell(56); c.fillStyle = '#5f574f'; c.fill();
  ell(44); c.fillStyle = '#c2c3c7'; c.fill();
  // Suelo de tierra con grano y rodadas
  ell(0); c.fillStyle = th.floor; c.fill();
  c.save();
  ell(0); c.clip();
  for (let i = 0; i < a.rx * a.ry / 60; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.06)';
    c.fillRect(Math.round((cx + (r() * 2 - 1) * a.rx) / 4) * 4, Math.round((cy + (r() * 2 - 1) * a.ry) / 4) * 4, 4, 4);
  }
  c.lineWidth = 7;
  for (let k = 0; k < 18; k++) {
    c.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,.13)' : th.floor2;
    c.beginPath();
    c.ellipse(cx + (r() - 0.5) * 400, cy + (r() - 0.5) * 260, 140 + r() * 520, 90 + r() * 320, r() * Math.PI, r() * 6, r() * 6 + 1.2 + r() * 2);
    c.stroke();
  }
  c.strokeStyle = 'rgba(255,241,232,.3)';
  c.lineWidth = 8;
  c.beginPath(); c.arc(cx, cy, 130, 0, Math.PI * 2); c.stroke();
  c.restore();
  // Muro de neumáticos rojo y blanco
  c.lineWidth = 18;
  c.strokeStyle = '#fff1e8'; ell(9); c.stroke();
  c.setLineDash([20, 20]); c.strokeStyle = th.wall; ell(9); c.stroke(); c.setLineDash([]);
  // Pilares de neumáticos
  for (const [px, py, pr] of a.pillars) {
    const x = px - ox, y = py - oy;
    c.fillStyle = 'rgba(0,0,0,.4)';
    c.beginPath(); c.arc(x + 7, y + 7, pr, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 4; k++) {
      c.fillStyle = k % 2 ? '#3a3a42' : '#16161a';
      c.beginPath(); c.arc(x, y, pr * (1 - k * 0.22), 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = th.wall;
    c.beginPath(); c.arc(x, y, pr * 0.2, 0, Math.PI * 2); c.fill();
  }
  // Casillas de salida
  for (let g = 0; g < count; g++) {
    const sp = arenaSpawn(a, g, count);
    c.save();
    c.translate(sp.x - ox, sp.y - oy);
    c.rotate(sp.angle);
    c.strokeStyle = 'rgba(255,241,232,.6)';
    c.lineWidth = 3;
    c.strokeRect(-20, -14, 40, 28);
    c.restore();
  }
  return { canvas: cv, ctx: c, ox, oy, w, h };
}

function renderArenaMinimap(t, maxW, maxH) {
  const a = t.def;
  const bw = 2 * a.rx, bh = 2 * a.ry, pad = 10;
  const scale = Math.min((maxW - 2 * pad) / bw, (maxH - 2 * pad) / bh);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(bw * scale + 2 * pad);
  cv.height = Math.ceil(bh * scale + 2 * pad);
  const c = cv.getContext('2d');
  const ox = t.bounds.minX - pad / scale, oy = t.bounds.minY - pad / scale;
  c.fillStyle = '#c2c3c7';
  c.strokeStyle = '#000';
  c.lineWidth = 3;
  c.beginPath(); c.ellipse((a.cx - ox) * scale, (a.cy - oy) * scale, a.rx * scale, a.ry * scale, 0, 0, Math.PI * 2);
  c.fill(); c.stroke();
  c.fillStyle = '#16161a';
  for (const [px, py, pr] of a.pillars) {
    c.beginPath(); c.arc((px - ox) * scale, (py - oy) * scale, Math.max(2, pr * scale), 0, Math.PI * 2); c.fill();
  }
  return { canvas: cv, scale, ox, oy };
}

function drawArenaPreview(cv, a) {
  const c = cv.getContext('2d');
  const pad = 16;
  const scale = Math.min((cv.width - 2 * pad) / (2 * a.rx), (cv.height - 2 * pad) / (2 * a.ry));
  const X = x => cv.width / 2 + (x - a.cx) * scale, Y = y => cv.height / 2 + (y - a.cy) * scale;
  c.fillStyle = a.theme.out;
  c.fillRect(0, 0, cv.width, cv.height);
  c.beginPath(); c.ellipse(X(a.cx), Y(a.cy), a.rx * scale + 6, a.ry * scale + 6, 0, 0, Math.PI * 2);
  c.fillStyle = a.theme.wall; c.fill();
  c.beginPath(); c.ellipse(X(a.cx), Y(a.cy), a.rx * scale, a.ry * scale, 0, 0, Math.PI * 2);
  c.fillStyle = a.theme.floor; c.fill();
  c.fillStyle = '#16161a';
  for (const [px, py, pr] of a.pillars) { c.beginPath(); c.arc(X(px), Y(py), pr * scale, 0, Math.PI * 2); c.fill(); }
  // Unos coches chocando en el centro
  const cols = ['#ffec27', '#29adff', '#00e436', '#ff004d'];
  [[-30, -8, 0.3], [18, 4, 3.4], [-4, 26, -1.2], [30, -26, 2.2]].forEach(([dx, dy, ang], i) => {
    c.save();
    c.translate(X(a.cx) + dx, Y(a.cy) + dy);
    c.rotate(ang);
    c.fillStyle = cols[i];
    c.fillRect(-7, -4, 14, 8);
    c.restore();
  });
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

function makeDerbyCar(t, g, n, color) {
  const sp = arenaSpawn(t.arena, g, n);
  return {
    color, dark: darken(color),
    x: sp.x, y: sp.y, angle: sp.angle, vx: 0, vy: 0, fwd: 0, lat: 0,
    surface: 0, bumpCd: 0, wrongWay: 0,
    progress: 0, lapsDone: 0, lapStart: 0, lapTimes: [], bestLap: null, finished: false,
  };
}

// Muros y pilares de la arena
function arenaWalls(car, t) {
  const pos = { x: car.x, y: car.y };
  const hit = arenaCollide(t.arena, pos, carR());
  if (hit) {
    car.x = pos.x; car.y = pos.y;
    const vn = car.vx * hit.nx + car.vy * hit.ny;
    if (vn > 0) {
      car.vx -= 1.6 * vn * hit.nx;
      car.vy -= 1.6 * vn * hit.ny;
      car.vx *= 0.7; car.vy *= 0.7;
      if (car.bumpCd <= 0 && vn > 1) { sound.bump(); car.bumpCd = 15; shake = Math.min(8, vn * 1.5); }
    }
  }
  if (car.bumpCd > 0) car.bumpCd--;
  car.surface = 0;
}

// Mi coche ha embestido a otro: le digo al servidor cuánto daño le hace.
// El daño depende de mi velocidad hacia él: golpe corto 5%, con carrerilla 20%.
function reportHit(o, ram) {
  if (ram < DERBY.SOFT_MIN || o.id == null) return;
  const now = performance.now();
  if ((race.hitCd.get(o.id) || 0) > now) return;
  race.hitCd.set(o.id, now + 450);
  const dmg = ram >= DERBY.HARD_MIN ? DERBY.HIT_HARD : DERBY.HIT_SOFT;
  send({ t: 'hit', rid: race.rid, target: o.id, dmg });
  sound.crash(dmg === DERBY.HIT_HARD);
  shake = Math.max(shake, dmg === DERBY.HIT_HARD ? 7 : 3);
}

function stepCar(car, ctl) {
  // 1) Girar (más lento a baja y a muy alta velocidad)
  const dirSign = car.fwd >= 0 ? 1 : -1;
  const grip = car.oil > 0 ? 0.35 : 1;               // en aceite el volante casi no responde
  car.angle += ctl.steer * turnRate(car.fwd) * dirSign * grip;
  if (car.spin) {                                    // trompo al pisar aceite
    car.angle += car.spin;
    car.spin *= 0.93;
    if (Math.abs(car.spin) < 0.002) car.spin = 0;
  }

  // 2) Descomponer la velocidad respecto al nuevo rumbo (así aparece el derrape)
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let f = car.vx * fx + car.vy * fy;
  let l = -car.vx * fy + car.vy * fx;

  const grass = car.surface === 2;
  if (ctl.throttle) f += PHYS.accel * (grass ? 0.55 : 1) * ctl.throttle * (car.turbo ? TURBO.accel : 1);
  if (ctl.brake) {
    if (f > 0.15) f = Math.max(0, f - PHYS.brake * ctl.brake);
    else f -= PHYS.accel * 0.6 * ctl.brake;
  }
  if (!ctl.throttle && !ctl.brake) f *= 0.985;
  f *= grass ? 0.975 : car.surface === 1 ? 0.994 : 0.997;
  f = Math.max(-PHYS.reverseMax, Math.min(PHYS.maxSpeed * (car.turbo ? TURBO.speed : 1), f));
  if (grass && f > PHYS.grassMax) f = Math.max(PHYS.grassMax, f * 0.94);
  l *= car.oil > 0 ? 0.985 : grass ? 0.9 : 0.8;    // en aceite el coche resbala
  if (car.oil > 0) car.oil--;

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

// ---------- Peligros de la pista (DEMENCIA) ----------
const raceTimeMs = () => (race && race.state === 'racing' ? race.raceFrame * STEP_MS : 0);

function trackHazards(car, t, T) {
  if (!t.cliff) return;
  // Acantilado: salirse del piano por ese lado = caída al vacío
  const i = car.idx, c = t.cliff[i];
  if (c) {
    const lat = (car.x - t.xs[i]) * t.nx[i] + (car.y - t.ys[i]) * t.ny[i];
    if (Math.abs(lat) > t.half + CURB + 2 && (c === 2 || Math.sign(lat) === c)) { startFall(car); return; }
  }
  // Aceite: trompo y casi sin agarre durante un momento
  for (const o of t.oil) {
    if (Math.hypot(car.x - o.x, car.y - o.y) > o.r + 8) continue;
    if (!car.oil) {
      car.spin = (Math.random() < 0.5 ? -1 : 1) * 0.05 * Math.min(1, Math.abs(car.fwd) / 4);
      sound.beep(260, 0.25, 'sine', 0.1);
    }
    car.oil = 40;
  }
  // Barro: frena como la hierba
  for (const m of t.mud) {
    const dx = car.x - m.x, dy = car.y - m.y, ca = Math.cos(m.ang), sa = Math.sin(m.ang);
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    if ((u / m.rx) ** 2 + (v / m.ry) ** 2 < 1) car.surface = 2;
  }
  // Bloques que van de lado a lado: te empujan
  for (const p of t.pistons) {
    const q = pistonPos(p, T);
    const dx = car.x - q.x, dy = car.y - q.y, d = Math.hypot(dx, dy), min = p.r + CAR_R;
    if (d >= min || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    car.x = q.x + nx * min;
    car.y = q.y + ny * min;
    const vn = (car.vx - q.vx) * nx + (car.vy - q.vy) * ny;
    if (vn < 0) { car.vx -= 1.8 * vn * nx; car.vy -= 1.8 * vn * ny; }
    if (car.bumpCd <= 0) { sound.bump(); shake = Math.max(shake, 6); car.bumpCd = 20; }
  }
}

function startFall(car) {
  car.falling = FALL_FRAMES;
  car.fallIdx = car.idx;
  banner('¡AL VACÍO!', '#ff004d', 80);
  shake = Math.max(shake, 5);
  [600, 420, 260, 140].forEach((fq, k) => setTimeout(() => sound.beep(fq, 0.18, 'square', 0.1), k * 140));
}

// Durante la caída no se controla el coche; al terminar reaparece un poco más atrás, parado
function updateFall(car, t) {
  car.falling--;
  car.x += car.vx * 0.5;
  car.y += car.vy * 0.5;
  car.vx *= 0.9; car.vy *= 0.9;
  car.angle += 0.08;
  if (car.falling > 0) return;
  const i = (car.fallIdx - 14 + t.N) % t.N;
  let delta = i - car.idx;
  if (delta > t.N / 2) delta -= t.N;
  if (delta < -t.N / 2) delta += t.N;
  car.progress += delta;
  car.idx = i;
  Object.assign(car, { x: t.xs[i], y: t.ys[i], angle: t.dir[i], vx: 0, vy: 0, fwd: 0, lat: 0, oil: 0, spin: 0, surface: 0 });
}

function drawPiston(q, ang) {
  ctx.save();
  ctx.translate(Math.round(q.x), Math.round(q.y));
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(0,0,0,.4)';
  ctx.fillRect(-18, -18, 42, 42);
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(-22, -22, 44, 44);
  ctx.save();
  ctx.beginPath(); ctx.rect(-22, -22, 44, 44); ctx.clip();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 7;
  for (let k = -44; k <= 44; k += 16) { ctx.beginPath(); ctx.moveTo(k - 22, 22); ctx.lineTo(k + 22, -22); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeRect(-22, -22, 44, 44);
  ctx.restore();
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

// Choques con los coches de los demás (solo se mueve el mío). En demolición,
// además, el otro me empuja con su velocidad y yo informo de mis embestidas.
function collideRemote(car, others, derby) {
  const touching = new Set();
  const R2 = carR() * 2;                            // distancia entre centros al tocarse
  for (const o of others) {
    const dx = car.x - o.x, dy = car.y - o.y;
    const d = Math.hypot(dx, dy);
    // Contacto: empieza al chocar de verdad y dura mientras sigáis casi pegados
    // (el margen de 4 px evita que un pequeño rebote cuente como golpe nuevo)
    if (derby && d > 0 && (d < R2 || (d < R2 + 4 && race.touch.has(o.id)))) touching.add(o.id);
    if (d >= R2 || d === 0) continue;
    const nx = dx / d, ny = dy / d;
    const ram = -(car.vx * nx + car.vy * ny);        // mi velocidad hacia el otro, antes del choque
    car.x += nx * (R2 - d);
    car.y += ny * (R2 - d);
    if (derby) {
      const rel = (car.vx - (o.vx || 0)) * nx + (car.vy - (o.vy || 0)) * ny;
      if (rel < 0) {
        car.vx -= 0.65 * rel * nx;
        car.vy -= 0.65 * rel * ny;
      }
      // Solo cuenta como golpe nuevo si antes estabais separados: empujar
      // pegado a otro coche no le quita vida sin parar
      if (!race.touch.has(o.id)) reportHit(o, ram);
      continue;
    }
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      car.vx -= 1.3 * vn * nx;
      car.vy -= 1.3 * vn * ny;
      if (-vn > 1.5) sound.bump();
    }
  }
  if (derby) race.touch = touching;
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
  const arena = arenaById(s.tr);
  const t = arena ? buildArena(arena) : trackById(s.tr);
  if (!t) return;
  const derby = !!arena;
  const me = s.p.find(p => p.id === myId && p.ig);
  const racersCount = s.p.filter(p => p.ig).length;
  const small = compactHud() || IS_TOUCH;
  race = {
    rid: s.rid, t, mode: derby ? 'derby' : 'race',
    gfx: derby ? renderArena(t, Math.max(racersCount, 2)) : renderTrack(t, Math.max(racersCount, 2)),
    mini: derby
      ? renderArenaMinimap(t, small ? 150 : 190, small ? 120 : 150)
      : renderMinimap(t, small ? 150 : 190, small ? 120 : 150),
    car: me ? (derby ? makeDerbyCar(t, me.g, racersCount, me.c) : makeCar(t, me.g, me.c)) : null,
    remotes: new Map(),
    state: 'countdown', frame: 0, raceFrame: 0,
    banner: null, cam: { x: 0, y: 0 }, lastLit: 0, greenUntil: 0,
    newRecord: false, order: [],
    fx: [], hitCd: new Map(), touch: new Set(), hurt: 0,   // demolición
  };
  if (race.car) { race.cam.x = race.car.x; race.cam.y = race.car.y; }
  else if (derby) { race.cam.x = arena.cx; race.cam.y = arena.cy; }
  else { race.cam.x = t.xs[0]; race.cam.y = t.ys[0]; }
  shake = 0;
  $('results').hidden = true;
  myVote = null;
}

function banner(text, color = '#ffec27', frames = 120) {
  race.banner = { text, color, until: race.frame + frames };
}

// Texto flotante sobre la arena (-20%, +20%, K.O....)
function fx(x, y, str, color, size = 12) {
  race.fx.push({ x, y, text: str, color, size, start: race.frame, until: race.frame + 60 });
}

// Un paso de física (60 por segundo)
function update() {
  const r = race, t = r.t, car = r.car;
  r.frame++;

  if (r.state === 'countdown') {
    if (snap.ph === 'playing') {
      r.state = 'racing';
      r.raceFrame = Math.round(snap.rt / STEP_MS);
      sound.beep(880, 0.5);
      banner('¡YA!', '#00e436', 60);
      r.greenUntil = r.frame + 60;
    } else if (snap.ph === 'countdown') {
      const lit = lightsOn();
      if (lit > r.lastLit) { sound.beep(440, 0.18); r.lastLit = lit; }
    }
  } else if (r.state === 'racing') {
    r.raceFrame++;
  }

  if (car && r.state === 'racing' && r.mode === 'derby') {
    stepCar(car, playerControl());
    collideRemote(car, r.remotes.values(), true);
    arenaWalls(car, t);
    addSkid(car);
  } else if (car && r.state === 'racing' && car.falling) {
    updateFall(car, t);
  } else if (car && r.state === 'racing') {
    const ctl = car.finished ? autopilot(car, t) : playerControl();
    stepCar(car, ctl);
    collideRemote(car, r.remotes.values());
    updateTrackPos(car, t);
    trackHazards(car, t, raceTimeMs());
    checkLap(car);
    addSkid(car);
  }
  // Turbo del último (solo carreras): se revisa siempre, también durante una caída
  if (car && r.state === 'racing' && r.mode === 'race') updateTurbo(r, car);
  r.fx = r.fx.filter(e => e.until > r.frame);

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
      id: p.id, name: p.n, color: p.c, me: p.id === myId,
      progress: mine ? car.progress : p.pg,
      fin: mine ? (car.finished || p.fin) : p.fin,
      pl: p.pl || 0,
      lp: mine ? car.lapsDone : p.lp,
      hp: p.hp, al: p.al, ko: p.ko, kt: p.kt || 0,
    });
  }
  if (r.mode === 'derby') {
    // Vivos primero (más vida delante); luego eliminados, el último en caer delante
    list.sort((a, b) => (b.al - a.al) || (a.al ? b.hp - a.hp : b.kt - a.kt));
  } else {
    list.sort((a, b) => {
      if (a.fin && b.fin) return (a.pl || 99) - (b.pl || 99);
      if (a.fin) return -1;
      if (b.fin) return 1;
      return b.progress - a.progress;
    });
  }
  r.order = list;

  // Cámara: mi coche o, si miro, el que va primero
  let target = car;
  if (!car) target = list.map(o => r.remotes.get(o.id)).find(Boolean);
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
      t: 'st', rid: r.rid, x: car.x, y: car.y, a: car.angle, fl: car.falling ? 1 : 0, tb: car.turbo ? 1 : 0,
      pg: car.progress, lp: car.lapsDone,
      best: car.bestLap != null ? car.bestLap * STEP_MS : null,
    });
  }
}

// Luces rojas encendidas del semáforo (1..5): una más cada segundo
function lightsOn() {
  return Math.max(1, Math.min(5, 6 - Math.ceil(snap.left / 1000)));
}

// Turbo para el último: si va muy por detrás del coche que tiene delante, turbo
// hasta alcanzarlo. Si se vuelve a quedar atrás, vuelve el turbo.
function updateTurbo(r, car) {
  const prev = car.turbo;
  const others = r.order.filter(o => !o.me);
  const last = r.order.length > 1 && r.order[r.order.length - 1].me;
  if (car.finished || !others.length || !last) car.turbo = false;
  else {
    const gap = Math.min(...others.map(o => o.progress)) - car.progress;   // muestras hasta el de delante
    if (!car.turbo && gap > TURBO.on) car.turbo = true;
    else if (car.turbo && gap < TURBO.off) car.turbo = false;
  }
  if (car.turbo && !prev) {
    banner('¡TURBO! ALCANZA A LOS DEMÁS', '#ffa300', 90);
    [220, 330, 440, 660].forEach((fq, k) => setTimeout(() => sound.beep(fq, 0.1, 'sawtooth', 0.08), k * 50));
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
  const k = carScale(), sz = Math.round(4 * k);        // ruedas traseras (más grandes en la arena)
  c.fillStyle = 'rgba(20,18,24,.35)';
  for (const side of [-7 * k, 7 * k]) {
    const x = car.x - ca * 12 * k - sa * side - g.ox;
    const y = car.y - sa * 12 * k + ca * side - g.oy;
    c.fillRect(Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
  }
}

// ---------- Dibujo ----------
function drawCar(c, car) {
  c.save();
  c.translate(Math.round(car.x), Math.round(car.y));
  c.rotate(car.angle);
  let k = carScale();
  if (car.falling || car.fl) {                // cayendo por un acantilado: se encoge y se oscurece
    const f = car.falling ? Math.max(0.15, car.falling / FALL_FRAMES) : 0.5;
    k *= f;
    c.globalAlpha = Math.max(0.25, f);
  }
  if (k !== 1) c.scale(k, k);                 // arena: coches más grandes
  if (car.turbo || car.tb) {                  // llamas del turbo por el tubo de escape
    const fl = 8 + Math.random() * 10;
    c.fillStyle = '#ff004d'; c.fillRect(-19 - fl, -5, fl, 10);
    c.fillStyle = '#ffa300'; c.fillRect(-19 - fl * 0.7, -4, fl * 0.7, 8);
    c.fillStyle = '#ffec27'; c.fillRect(-19 - fl * 0.35, -2, fl * 0.35, 4);
  }
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

function text(str, x, y, size, color = '#fff1e8', align = 'left', maxW = 0) {
  ctx.font = `${size}px 'Press Start 2P', monospace`;
  if (maxW && ctx.measureText(str).width > maxW) {     // encoge el texto si no cabe
    size = Math.max(6, Math.floor(size * maxW / ctx.measureText(str).width));
    ctx.font = `${size}px 'Press Start 2P', monospace`;
  }
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
  if (r.mode === 'derby') drawPickups(r);
  if (r.t.pistons) for (const p of r.t.pistons) drawPiston(pistonPos(p, raceTimeMs()), p.ang);
  for (const o of r.remotes.values()) drawCar(ctx, o);
  if (r.car) drawCar(ctx, r.car);                // el mío encima
  if (r.mode === 'derby') {
    const byId = new Map(snap.p.map(p => [p.id, p]));
    for (const [id, o] of r.remotes) drawDerbyExtras(o, byId.get(id));
    if (r.car) drawDerbyExtras(r.car, byId.get(myId));
  }
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  const lab = Math.round(20 * carScale());     // el nombre, justo encima del coche
  for (const o of r.remotes.values()) {
    ctx.fillStyle = '#000';
    ctx.fillText(o.name, Math.round(o.x) + 1, Math.round(o.y) - lab);
    ctx.fillStyle = o.color;
    ctx.fillText(o.name, Math.round(o.x), Math.round(o.y) - lab - 1);
  }
  for (const e of r.fx) {
    const k = (r.frame - e.start) / 60;
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    text(e.text, Math.round(e.x), Math.round(e.y - k * 40), e.size, e.color, 'center');
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Destello rojo al recibir un golpe
  if (r.hurt > r.frame) {
    ctx.fillStyle = `rgba(255,0,77,${Math.min(0.35, (r.hurt - r.frame) / 60)})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  drawHud(r);
}

// Botiquines (cruz roja) y escudos (azules) flotando sobre la arena
function drawPickups(r) {
  for (const [id, k, x, y] of snap.pk || []) {
    const bob = Math.sin(r.frame * 0.08 + id) * 3;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(3, 20 - bob, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = k === 'hp' ? 'rgba(255,0,77,.6)' : 'rgba(41,173,255,.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 22 + Math.sin(r.frame * 0.15 + id) * 3, 0, Math.PI * 2); ctx.stroke();
    if (k === 'hp') {
      ctx.fillStyle = '#000'; ctx.fillRect(-16, -16, 32, 32);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(-14, -14, 28, 28);
      ctx.fillStyle = '#ff004d'; ctx.fillRect(-4, -10, 8, 20); ctx.fillRect(-10, -4, 20, 8);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -17); ctx.lineTo(15, -11); ctx.lineTo(13, 6); ctx.lineTo(0, 17); ctx.lineTo(-13, 6); ctx.lineTo(-15, -11);
      ctx.closePath();
      ctx.fillStyle = '#29adff'; ctx.fill();
      ctx.strokeStyle = '#fff1e8'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#1d2b53'; ctx.fillRect(-3, -10, 6, 20);
    }
    ctx.restore();
  }
}

// Escudo, humo y barra de vida de cada coche en demolición
function drawDerbyExtras(o, p) {
  if (!p) return;
  const x = Math.round(o.x), y = Math.round(o.y), fr = race.frame;
  if (p.hp <= 40) {
    for (let k = 0; k < 3; k++) {
      const t = (fr * 0.7 + k * 23 + p.id * 37) % 60;
      const sz = 6 + t / 5;
      ctx.fillStyle = `rgba(40,36,44,${Math.max(0, 0.55 - t / 110)})`;
      ctx.fillRect(Math.round(x - sz / 2 + Math.sin((t + k) * 0.3) * 6), Math.round(y - 8 - t * 0.7), sz, sz);
    }
    if (p.hp <= 20 && fr % 10 < 5) { ctx.fillStyle = '#ffa300'; ctx.fillRect(x - 4, y - 4, 8, 8); }
  }
  if (p.sh > 0 && (p.sh > 2000 || fr % 10 < 6)) {
    const rad = 27 * DERBY.CAR_SCALE + Math.sin(fr * 0.2) * 2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(41,173,255,.18)'; ctx.fill();
    ctx.strokeStyle = 'rgba(41,173,255,.95)'; ctx.lineWidth = 3; ctx.stroke();
  }
  const bw = 48, by = Math.round(y + 21 * DERBY.CAR_SCALE);
  ctx.fillStyle = '#000';
  ctx.fillRect(x - bw / 2 - 1, by, bw + 2, 7);
  ctx.fillStyle = hpColor(p.hp);
  ctx.fillRect(x - bw / 2, by + 1, Math.round(bw * p.hp / 100), 5);
}

// Marcador. En ordenador: minimapa y velocímetro abajo. En móvil van en la
// columna derecha, porque abajo están las flechas (izquierda) y los botones A/B (derecha).
function drawHud(r) {
  if (r.mode === 'derby') return drawDerbyHud(r);
  const car = r.car;
  const c = compactHud();
  const touchSafe = IS_TOUCH ? 170 : 12;           // hueco inferior para los controles táctiles
  const m = r.mini, mw = m.canvas.width, mh = m.canvas.height;
  const timesW = c ? 196 : 250, fs = c ? 8 : 10;
  let rightY = 12;                                 // siguiente hueco libre en la columna derecha

  if (car) {
    const me = r.order.findIndex(o => o.me) + 1;
    // Vuelta y posición
    const lapW = c ? 200 : 240, posX = c ? 124 : 160;
    box(12, 12, lapW, 78);
    text('VUELTA', 26, 26, 10, '#ffec27');
    text(`${Math.min(LAPS, car.lapsDone + 1)}/${LAPS}`, 26, 46, 22);
    text('POS', posX, 26, 10, '#ffec27');
    text(`${me}º`, posX, 46, 22, me === 1 ? '#00e436' : '#fff1e8');

    // Tiempos
    const tx = VIEW_W - timesW - 12;
    box(tx, 12, timesW, 92);
    const cur = r.state === 'countdown' ? 0 : r.raceFrame;
    text('TOTAL', tx + 14, 26, fs, '#ffec27');
    text(fmtFrames(car.finished ? car.finishFrame : cur), VIEW_W - 26, 26, fs, '#fff1e8', 'right');
    text('VUELTA', tx + 14, 50, fs, '#ffec27');
    text(fmtFrames(car.finished ? car.lapTimes[car.lapTimes.length - 1] : cur - car.lapStart), VIEW_W - 26, 50, fs, '#fff1e8', 'right');
    text('MEJOR', tx + 14, 74, fs, '#ffec27');
    text(fmtFrames(car.bestLap), VIEW_W - 26, 74, fs, '#00e436', 'right');
    rightY = 112;
  } else {
    box(12, 12, c ? 160 : 300, 44);
    text('MODO ESPECTADOR', 26, c ? 30 : 28, c ? 8 : 10, '#ffec27');
  }

  // Minimapa
  const mx = VIEW_W - mw - 12;
  const my = IS_TOUCH ? rightY : VIEW_H - mh - 12;
  if (IS_TOUCH) rightY += mh + 8;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(mx, my, mw, mh);
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

  // Velocímetro
  if (car) {
    const sw = c ? 170 : 200;
    const sx = IS_TOUCH ? VIEW_W - sw - 12 : 12;
    const sy = IS_TOUCH ? rightY : VIEW_H - 70;
    box(sx, sy, sw, 58);
    const kmh = Math.round(Math.abs(car.fwd) * 30);
    text(String(kmh).padStart(3, '0'), sx + 14, sy + 16, 22, car.surface === 2 ? '#ffa300' : '#fff1e8');
    text('KM/H', sx + sw - 70, sy + 24, 10, '#ffec27');
    if (car.turbo && r.frame % 20 < 14) text('TURBO', sx + sw - 14, sy + 8, 8, '#ffa300', 'right');
    const bw = sw - 28;
    ctx.fillStyle = '#000'; ctx.fillRect(sx + 14, sy + 46, bw, 6);
    ctx.fillStyle = car.turbo ? '#ffa300' : kmh > 240 ? '#ff004d' : '#00e436';
    ctx.fillRect(sx + 14, sy + 46, Math.round(bw * Math.min(1, Math.abs(car.fwd) / PHYS.maxSpeed)), 6);
  }

  // Clasificación en directo (solo las filas que caben; tú siempre sales)
  const ly = car ? 104 : 68;
  const fit = Math.max(3, Math.floor((VIEW_H - touchSafe - ly - 16) / 18));
  let rows = r.order.slice(0, Math.min(12, fit));
  const mine = r.order.find(o => o.me);
  if (mine && !rows.includes(mine)) rows[rows.length - 1] = mine;
  box(12, ly, 220, 16 + rows.length * 18);
  rows.forEach((o, i) => {
    const pos = r.order.indexOf(o) + 1;
    ctx.fillStyle = o.color;
    ctx.fillRect(24, ly + 12 + i * 18, 8, 8);
    text(`${pos} ${o.name}`, 40, ly + 11 + i * 18, 8, o.me ? '#ffec27' : '#fff1e8');
    text(o.fin ? 'META' : `V${Math.min(LAPS, o.lp + 1)}`, 220, ly + 11 + i * 18, 8, o.fin ? '#00e436' : '#83769c', 'right');
  });

  drawOverlays(r, c);
}

// Semáforo de salida: 5 luces; se enciende una roja por segundo y al final todas verdes
function drawTrafficLight(lit, green) {
  const rad = compactHud() ? 17 : 20, gap = rad * 2 + 12, w = gap * 5 + 16, h = rad * 2 + 24;
  const x = Math.round(VIEW_W / 2 - w / 2), y = Math.round(VIEW_H / 2 - 70);
  ctx.fillStyle = '#000'; ctx.fillRect(x + 4, y + 4, w, h);
  ctx.fillStyle = '#16161a'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#5f574f'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  for (let i = 0; i < 5; i++) {
    const cx = x + 8 + gap / 2 + i * gap, cy = y + h / 2;
    const on = green || i < lit;
    const col = green ? '#00e436' : on ? '#ff004d' : '#3a0a14';
    if (on) {
      ctx.fillStyle = green ? 'rgba(0,228,54,.25)' : 'rgba(255,0,77,.25)';
      ctx.beginPath(); ctx.arc(cx, cy, rad + 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = on ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.08)';
    ctx.fillRect(Math.round(cx - rad / 2), Math.round(cy - rad / 2), Math.round(rad / 2.5), Math.round(rad / 2.5));
  }
}

// Cuenta atrás, instrucciones y mensajes grandes (comunes a los dos modos)
function drawOverlays(r, c) {
  const car = r.car;
  const derby = r.mode === 'derby';
  const maxW = VIEW_W - 24;
  if (r.state === 'countdown' && snap.ph === 'countdown') {
    text(r.t.def.name, VIEW_W / 2, VIEW_H / 2 - 150, 28, r.t.def.color, 'center', maxW);
    text(derby ? 'DEMOLICIÓN · ¡GANA EL ÚLTIMO EN PIE!' : `DIFICULTAD ${r.t.def.diff} · ${LAPS} VUELTAS`,
      VIEW_W / 2, VIEW_H / 2 - 108, 12, '#fff1e8', 'center', maxW);
    drawTrafficLight(lightsOn(), false);
    if (car) {
      if (IS_TOUCH) text('FLECHAS IZQ-DER: GIRAR · A: ACELERAR · B: FRENAR', VIEW_W / 2, VIEW_H / 2 + 50, 10, '#fff1e8', 'center', maxW);
      else {
        // Sin símbolos de flecha: la fuente pixelada no los tiene y salen diminutos
        text('W / FLECHA ARRIBA: ACELERAR   S / FLECHA ABAJO: FRENAR', VIEW_W / 2, VIEW_H - 124, 10, '#fff1e8', 'center', VIEW_W - 24);
        text('A-D / FLECHAS IZQUIERDA-DERECHA: GIRAR', VIEW_W / 2, VIEW_H - 104, 10, '#fff1e8', 'center', VIEW_W - 24);
      }
    }
  }

  if (r.greenUntil > r.frame) drawTrafficLight(5, true);

  // Mensajes
  if (r.banner && r.frame < r.banner.until) {
    text(r.banner.text, VIEW_W / 2, c ? Math.round(VIEW_H * 0.3) : 150, 28, r.banner.color, 'center', maxW);
  }
  if (!derby && car && car.wrongWay > 40 && !car.finished && Math.floor(r.frame / 20) % 2 === 0) {
    text('¡SENTIDO CONTRARIO!', VIEW_W / 2, VIEW_H / 2 + 40, 18, '#ff004d', 'center', maxW);
  }
  if (!derby && snap.ph === 'playing' && snap.left > 0) {
    text(`FIN DE CARRERA EN ${Math.ceil(snap.left / 1000)}s`, VIEW_W / 2, c ? Math.round(VIEW_H * 0.3) - 30 : 110, 10, '#ffa300', 'center', maxW);
  }
}

// Marcador del modo demolición
function drawDerbyHud(r) {
  const c = compactHud();
  const touchSafe = IS_TOUCH ? 170 : 12;
  const me = snap.p.find(p => p.id === myId && p.ig);
  const car = r.car;
  const m = r.mini, mw = m.canvas.width, mh = m.canvas.height;
  const fs = c ? 8 : 10;
  let rightY = 12;

  // Mi vida (y escudo)
  if (me) {
    const bw = c ? 200 : 240, hp = me.al ? me.hp : 0;
    box(12, 12, bw, 78);
    text('VIDA', 26, 26, 10, '#ffec27');
    text(`${hp}%`, 26, 42, 22, hpColor(hp));
    if (!me.al) text('K.O.', 12 + bw - 14, 44, 16, '#ff004d', 'right');
    else if (me.sh > 0) text(`ESCUDO ${Math.ceil(me.sh / 1000)}s`, 12 + bw - 14, 26, 8, '#29adff', 'right');
    ctx.fillStyle = '#000'; ctx.fillRect(26, 70, bw - 28, 8);
    ctx.fillStyle = hpColor(hp); ctx.fillRect(26, 70, Math.round((bw - 28) * hp / 100), 8);
  } else {
    box(12, 12, c ? 160 : 300, 44);
    text('MODO ESPECTADOR', 26, c ? 30 : 28, c ? 8 : 10, '#ffec27');
  }

  // Tiempo, vivos, mis K.O. y cuándo salen los próximos objetos
  const playing = snap.ph === 'playing';
  const inArena = snap.p.filter(p => p.ig), alive = inArena.filter(p => p.al).length;
  const rows = [
    ['TIEMPO', fmtClock(playing ? snap.left : DERBY.TIME), '#fff1e8'],
    ['VIVOS', `${alive}/${inArena.length}`, '#fff1e8'],
    ...(me ? [['MIS K.O.', String(me.ko || 0), '#00e436']] : []),
    ['BOTIQUÍN', playing ? `${Math.ceil((snap.nh || 0) / 1000)}s` : `${DERBY.HEAL_EVERY / 1000}s`, '#ff004d'],
    ['ESCUDO', playing ? `${Math.ceil((snap.ns || 0) / 1000)}s` : `${DERBY.SHIELD_EVERY / 1000}s`, '#29adff'],
  ];
  const tw = c ? 196 : 250, tx = VIEW_W - tw - 12, th = 16 + rows.length * 20;
  box(tx, 12, tw, th);
  rows.forEach(([label, val, col], i) => {
    text(label, tx + 14, 24 + i * 20, fs, '#ffec27');
    text(val, VIEW_W - 26, 24 + i * 20, fs, col, 'right');
  });
  rightY = 12 + th + 8;

  // Minimapa con objetos y coches
  const mx = VIEW_W - mw - 12;
  const my = IS_TOUCH ? rightY : VIEW_H - mh - 12;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(mx, my, mw, mh);
  ctx.drawImage(m.canvas, mx, my);
  for (const [, k, x, y] of snap.pk || []) {
    ctx.fillStyle = k === 'hp' ? '#ff004d' : '#29adff';
    ctx.fillRect(Math.round(mx + (x - m.ox) * m.scale) - 3, Math.round(my + (y - m.oy) * m.scale) - 3, 6, 6);
  }
  const dots = [...r.remotes.values()];
  if (car) dots.push(car);
  for (const o of dots) {
    const x = mx + (o.x - m.ox) * m.scale, y = my + (o.y - m.oy) * m.scale;
    const sz = o === car ? 8 : 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(x - sz / 2) - 1, Math.round(y - sz / 2) - 1, sz + 2, sz + 2);
    ctx.fillStyle = o.color;
    ctx.fillRect(Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
  }

  // Velocímetro (en móvil no cabe con los botones: se omite)
  if (car && !IS_TOUCH) {
    const sw = c ? 170 : 200, sx = 12, sy = VIEW_H - 70;
    box(sx, sy, sw, 58);
    const kmh = Math.round(Math.abs(car.fwd) * 30);
    text(String(kmh).padStart(3, '0'), sx + 14, sy + 16, 22, kmh >= DERBY.HARD_MIN * 30 ? '#ff004d' : '#fff1e8');
    text('KM/H', sx + sw - 70, sy + 24, 10, '#ffec27');
    const bw = sw - 28;
    ctx.fillStyle = '#000'; ctx.fillRect(sx + 14, sy + 46, bw, 6);
    ctx.fillStyle = kmh >= DERBY.HARD_MIN * 30 ? '#ff004d' : '#00e436';
    ctx.fillRect(sx + 14, sy + 46, Math.round(bw * Math.min(1, Math.abs(car.fwd) / PHYS.maxSpeed)), 6);
  }

  // Clasificación: vida de cada uno
  const ly = me ? 98 : 64;
  const fit = Math.max(3, Math.floor((VIEW_H - touchSafe - ly - 16 - (car && !IS_TOUCH ? 70 : 0)) / 18));
  const rowsL = r.order.slice(0, Math.min(12, fit));
  const mine = r.order.find(o => o.me);
  if (mine && !rowsL.includes(mine)) rowsL[rowsL.length - 1] = mine;
  box(12, ly, 220, 16 + rowsL.length * 18);
  rowsL.forEach((o, i) => {
    const pos = r.order.indexOf(o) + 1;
    ctx.fillStyle = o.color;
    ctx.fillRect(24, ly + 12 + i * 18, 8, 8);
    text(`${pos} ${o.name}`, 40, ly + 11 + i * 18, 8, o.me ? '#ffec27' : o.al ? '#fff1e8' : '#83769c');
    text(o.al ? `${o.hp}%` : 'K.O.', 220, ly + 11 + i * 18, 8, o.al ? hpColor(o.hp) : '#ff004d', 'right');
  });

  if (me && !me.al && snap.ph === 'playing') {
    text('ELIMINADO · MIRANDO LA PARTIDA', VIEW_W / 2, VIEW_H - (IS_TOUCH ? 60 : 110), 10, '#ff004d', 'center', VIEW_W - 24);
  }
  drawOverlays(r, c);
}

// ---------- Resultados ----------
function showResults(s) {
  const body = $('resultsBody');
  body.innerHTML = '';
  const derby = s.md === 'derby';
  $('resultsHead').innerHTML = derby
    ? '<th>POS</th><th>PILOTO</th><th>VIDA</th><th>K.O.</th>'
    : '<th>POS</th><th>PILOTO</th><th>TIEMPO</th><th>MEJOR VUELTA</th>';
  for (const p of s.res || []) {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'me';
    const name = `<td>${p.pos}º</td><td><span class="dot" style="background:${esc(p.c)}"></span>${esc(p.n)}</td>`;
    if (derby) {
      tr.innerHTML = name + `<td>${p.al ? p.hp + '%' : 'ELIMINADO'}</td><td>${p.ko || 0}</td>`;
    } else {
      const time = p.fin ? fmtMs(p.t) : `VUELTA ${Math.min(LAPS, p.lp + 1)}/${LAPS}`;
      tr.innerHTML = name + `<td>${time}</td><td>${fmtMs(p.best)}</td>`;
    }
    body.appendChild(tr);
  }
  const mine = (s.res || []).find(p => p.id === myId);
  const winner = (s.res || [])[0];
  if (mine) {
    $('resultsTitle').textContent = mine.pos === 1 ? (derby ? '¡ÚLTIMO EN PIE!' : '¡HAS GANADO!') : `HAS QUEDADO ${mine.pos}º`;
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
      <span class="stat">LONGITUD: <b>${(t.length / 1000).toFixed(1)} KM</b> · ANCHO: <b>${t.def.width >= 160 ? 'AMPLIO' : t.def.width >= 135 ? 'MEDIO' : t.def.width >= 110 ? 'ESTRECHO' : 'MÍNIMO'}</b></span>
      ${t.cliffZones || t.traps ? `<span class="stat">ACANTILADOS: <b>${t.cliffZones}</b> · TRAMPAS: <b>${t.traps}</b></span>` : ''}
      <span class="stat record">TU RÉCORD: <b></b></span>
      <span class="votes" hidden></span>`;
    drawPreview(btn.querySelector('canvas'), t);
    btn.addEventListener('click', () => onCardClick(t.def.id));
    list.appendChild(btn);
    cards.set(t.def.id, { btn, votes: btn.querySelector('.votes'), record: btn.querySelector('.record b') });
  });
  ARENAS.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'track arena';
    btn.style.setProperty('--c', a.color);
    btn.innerHTML = `
      <span class="diff">${a.diff} <span class="stars">NUEVO</span></span>
      <canvas width="260" height="170"></canvas>
      <span class="tname">${a.name}</span>
      <span class="stat">VIDA <b>${DERBY.START_HP}%</b> · GOLPE <b>-${DERBY.HIT_SOFT}%</b> · FUERTE <b>-${DERBY.HIT_HARD}%</b></span>
      <span class="stat">BOTIQUÍN <b>+${DERBY.HEAL}%</b> CADA <b>${DERBY.HEAL_EVERY / 1000}s</b></span>
      <span class="stat">ESCUDO <b>${DERBY.SHIELD_MS / 1000}s</b> CADA <b>${DERBY.SHIELD_EVERY / 1000}s</b> · <b>¡ÚLTIMO EN PIE GANA!</b></span>
      <span class="votes" hidden></span>`;
    drawArenaPreview(btn.querySelector('canvas'), a);
    btn.addEventListener('click', () => onCardClick(a.id));
    list.appendChild(btn);
    cards.set(a.id, { btn, votes: btn.querySelector('.votes'), record: null });
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
    msg = joined ? (myVote ? '¡VOTO REGISTRADO! PUEDES CAMBIARLO' : '¡VOTA PISTA O ARENA!') : 'VOTACIÓN EN CURSO';
    sub = `QUEDAN ${secs}s · HAN VOTADO ${done}/${n}`;
  } else if (n === 0) {
    msg = 'ESPERANDO PILOTOS...';
    sub = '';
  } else if (n <= HOST_PICK_MAX) {
    msg = isHost ? 'ELIGE PISTA O ARENA PARA EMPEZAR' : 'EL HOST ESTÁ ELIGIENDO...';
    sub = `${n} PILOTO${n > 1 ? 'S' : ''}: CON ${HOST_PICK_MAX} O MENOS ELIGE EL HOST`;
  } else {
    msg = isHost ? 'ABRE LA VOTACIÓN PARA ELEGIR' : 'ESPERANDO A QUE EL HOST ABRA LA VOTACIÓN...';
    sub = `${n} PILOTOS: SE ELIGE POR VOTACIÓN`;
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
    if (c.record) {
      const best = Number(store.get(bestKey(id)));
      c.record.textContent = best ? fmtFrames(best) : '--:--.--';
    }
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
}

function renderAddresses() {
  const urls = ONLINE || location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
    ? [location.origin]
    : ips.map(ip => `http://${ip}:${port}`);
  if (!urls.length) urls.push(location.origin);
  for (const list of document.querySelectorAll('.addrList')) {
    list.innerHTML = '';
    for (const u of urls) {
      const d = document.createElement('div');
      d.textContent = u;
      list.appendChild(d);
    }
  }
  // En la pantalla de entrada, solo el host ve la dirección (para pasarla a los demás)
  $('joinAddr').hidden = !isHost;
}

// ---------- Pantallas ----------
let currentScreen = null;
function showScreen(id) {
  if (currentScreen === id) return;
  currentScreen = id;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  if (id !== 'game') {
    sound.setEngine(0, false);
    dpadRelease({ pointerId: dpad.id });
    pads.a = pads.b = false;
  }
  resizeView();
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
    if (race && race.mode === 'derby') derbyEvent(e);
  }

  // Demolición: si me han dejado K.O., mi coche desaparece y paso a mirar
  if (race && race.mode === 'derby' && race.car) {
    const meP = s.p.find(p => p.id === myId);
    if (meP && meP.al === false) race.car = null;
  }

  // Coches remotos
  if (race) {
    const seen = new Set();
    for (const p of s.p) {
      if (!p.ig || (race.car && p.id === myId) || p.pg < -1e8 || p.al === false) continue;
      if (p.id === myId && race.mode === 'derby') continue;       // mi coche eliminado no se dibuja
      seen.add(p.id);
      let o = race.remotes.get(p.id);
      if (!o) {
        o = { id: p.id, x: p.x, y: p.y, angle: p.a, color: p.c, dark: darken(p.c), name: p.n, vx: 0, vy: 0 };
        race.remotes.set(p.id, o);
      }
      o.fl = !!p.fl;                                              // cayendo por un acantilado
      o.tb = !!p.tb;                                              // con turbo
      o.vx = (p.x - (o.tx ?? p.x)) / 2;
      o.vy = (p.y - (o.ty ?? p.y)) / 2;
      o.tx = p.x; o.ty = p.y; o.ta = p.a;
    }
    for (const id of race.remotes.keys()) if (!seen.has(id)) race.remotes.delete(id);
  }

  // Sin nombre no se entra ni a la sala ni a ningún mapa (tampoco el host)
  if (!joined) showScreen('join');
  else if (inRace) showScreen('game');
  else showScreen('lobby');

  if (currentScreen === 'lobby') renderLobby();
  if (currentScreen === 'game') {
    if (s.ph === 'ended' && $('results').hidden) showResults(s);
    if (s.ph === 'ended') $('resultsBack').textContent = `VOLVIENDO A LA SALA EN ${Math.ceil(s.left / 1000)}s`;
    $('btnStop').hidden = !isHost;
    $('gameInfo').textContent = race ? `${race.t.def.name} · ${race.t.def.diff} · M: SONIDO · N: MÚSICA${FS_SUPPORTED ? " · F: PANTALLA COMPLETA" : ""}` : '';
  }
  document.body.classList.toggle('results', !$('results').hidden);
  document.body.classList.toggle('spectator', !(race && race.car));
}

// Eventos del modo demolición: daño, bloqueos, curas, escudos, K.O. y objetos nuevos
function derbyEvent(e) {
  const at = id => (id === myId ? race.car : race.remotes.get(id));
  const o = e.id != null ? at(e.id) : null;
  const mine = e.id === myId;
  switch (e.k) {
    case 'dmg':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, `-${e.d}%`, '#ff004d', e.d >= DERBY.HIT_HARD ? 18 : 12);
      if (mine) {
        race.hurt = race.frame + (e.d >= DERBY.HIT_HARD ? 30 : 16);
        shake = Math.max(shake, e.d >= DERBY.HIT_HARD ? 10 : 5);
        sound.crash(e.d >= DERBY.HIT_HARD);
      }
      break;
    case 'block':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, '¡BLOQUEADO!', '#29adff', 10);
      if (mine) sound.beep(1200, 0.08);
      break;
    case 'heal':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, `+${e.d}%`, '#00e436', 14);
      if (mine) { sound.beep(880, 0.1); setTimeout(() => sound.beep(1318, 0.15), 90); }
      break;
    case 'shield':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, '¡ESCUDO!', '#29adff', 12);
      if (mine) { sound.beep(523, 0.1); setTimeout(() => sound.beep(784, 0.2), 90); }
      break;
    case 'ko':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, 'K.O.', '#ffa300', 20);
      if (mine) { banner('¡DESTRUIDO!', '#ff004d', 180); sound.crash(true); }
      else if (e.by === myId) banner(`¡K.O. A ${e.n}!`, '#00e436', 120);
      else banner(`${e.bn} DEJA K.O. A ${e.n}`, e.c, 100);
      break;
    case 'spawn':
      if (!race.banner || race.frame > race.banner.until) {
        banner(e.kind === 'hp' ? '¡BOTIQUINES EN LA ARENA!' : '¡ESCUDOS EN LA ARENA!', e.kind === 'hp' ? '#ff004d' : '#29adff', 90);
      }
      sound.beep(e.kind === 'hp' ? 660 : 990, 0.12);
      break;
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
      renderAddresses();
    }
  };
  ws.onclose = () => {
    $('offline').hidden = false;
    setTimeout(connect, 1500);
  };
}

// En móvil, pantalla completa al entrar (necesita un toque del usuario).
// En iPhone no existe para páginas web: ahí simplemente no hace nada.
function goFullscreen() {
  if (IS_TOUCH && !isFullscreen()) enterFullscreen();
}

$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  sound.init();
  goFullscreen();
  myName = $('nameInput').value.trim();
  send({ t: 'join', name: myName });
});
$('btnVote').addEventListener('click', () => send({ t: 'voteStart' }));
if (IS_TOUCH) $('btnStop').textContent = 'FIN';
// Botón de pantalla completa (no aparece donde no existe, p. ej. Safari en iPhone)
$('btnFullscreen').hidden = !FS_SUPPORTED;
$('btnFullscreen').addEventListener('click', e => {
  toggleFullscreen();
  e.currentTarget.blur();          // que la barra espaciadora/Enter no lo vuelva a pulsar
});
$('btnStop').addEventListener('click', () => send({ t: 'stop' }));
for (const id of ['btnMusic', 'btnMusicLobby']) {
  $(id).addEventListener('click', e => { music.toggle(); e.currentTarget.blur(); });
}
music.apply();

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
