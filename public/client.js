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
const isF1 = () => !!(race && race.t && race.t.phys === F1);
const carR = () => (isF1() ? 9 : CAR_R * carScale());   // un F1 mide 5,6 x 2 m (28 x 10 px)
const CURB = 10;                   // ancho del piano rojo/blanco
const FALL_FRAMES = 70;            // lo que dura la caída por un acantilado (~1,2 s)
// Turbo para el último: más punta y aceleración hasta alcanzar al de delante.
// Solo si en la carrera hay más de 3 pilotos (minPlayers) y el último va muy lejos:
// a más de onSec segundos del de delante, a ritmo de carrera. Se apaga al alcanzarlo (off muestras).
const TURBO = { speed: 1.3, accel: 1.5, minPlayers: 4, onSec: 5, off: 8 };

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

const built = [...TRACKS, ...REAL_TRACKS].map(d => buildTrack(d));   // ojo: map() pasaría el índice como 2º parámetro
const trackById = id => built.find(t => t.def.id === id);
const arenaById = id => ARENAS.find(a => a.id === id);
const buildArena = a => ({ def: a, arena: a, bounds: arenaBounds(a) });
// Vida en barritas: verde con 3,5 o más, amarillo de 2 a 3, rojo con 1,5 o menos
const hpColor = hp => (hp / DERBY.START_HP > 0.6 ? '#00e436' : hp / DERBY.START_HP > 0.3 ? '#ffec27' : '#ff004d');
const fmtBars = hp => (hp % 1 ? `${Math.floor(hp)},5` : String(hp));
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
const carById = id => CARS.find(c => c.id === id) || CARS[0];
let myCar = carById(store.get('8bits-racing.car')).id;   // coche elegido en el garaje
let garageOpen = false;                                   // pantalla de selección abierta
let hadJoined = false;                                    // ya entró alguna vez (al reconectar no se reabre el garaje)

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
// batería y melodía). Si el servidor tiene banda sonora (carpeta soundtrack/ del
// equipo del profesor) se ponen esas canciones una detrás de otra; si no, y existe
// public/music.mp3, ese archivo en bucle (solo música que se tenga permiso para usar).
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
  playlist: null, track: 0, fails: 0,
  start() {
    const ac = sound.ctx;
    if (!ac || this.out) return;
    this.out = ac.createGain();
    this.out.connect(ac.destination);
    const buf = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // ¿Hay banda sonora en el servidor? Si no, ¿una música propia en public/music.mp3?
    fetch('soundtrack.json').then(r => (r.ok ? r.json() : [])).catch(() => []).then(list => {
      if (Array.isArray(list) && list.length) return this.usePlaylist(list);
      return fetch('music.mp3', { method: 'HEAD' }).then(r => {
        if (r.ok && (r.headers.get('content-type') || '').includes('audio')) {
          this.audio = new Audio('music.mp3');
          this.audio.loop = true;
          this.audio.volume = 0.4;
        }
      });
    }).catch(() => {}).finally(() => {
      if (!this.audio) {
        this.next = ac.currentTime + 0.1;
        this.timer = setInterval(() => this.schedule(), 25);
      }
      this.apply();
    });
  },
  // Banda sonora: un solo reproductor; al acabar una canción empieza la siguiente
  // (y después de la última, otra vez la primera)
  usePlaylist(list) {
    this.playlist = list;
    this.track = 0;
    this.audio = new Audio(list[0].url);
    this.audio.volume = 0.4;
    this.audio.addEventListener('ended', () => this.nextTrack());
    this.audio.addEventListener('playing', () => { this.fails = 0; });
    this.audio.addEventListener('error', () => {           // archivo que no se puede leer: la siguiente
      if (++this.fails < this.playlist.length) this.nextTrack();
    });
  },
  nextTrack() {
    this.track = (this.track + 1) % this.playlist.length;
    this.audio.src = this.playlist[this.track].url;
    this.apply();
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
        b.title = this.playlist ? `SONANDO: ${this.playlist[this.track].title}` : '';
      }
    }
    const np = $('nowPlaying');
    if (np) {
      np.hidden = !this.playlist;
      if (this.playlist) np.textContent = `${on ? '♪ SONANDO' : 'EN PAUSA'} (${this.track + 1}/${this.playlist.length}): ${this.playlist[this.track].title}`;
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
  if (currentScreen === 'garage') {
    const i = CARS.findIndex(c => c.id === myCar);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { chooseCar(CARS[(i + 1) % CARS.length].id); e.preventDefault(); return; }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { chooseCar(CARS[(i - 1 + CARS.length) % CARS.length].id); e.preventDefault(); return; }
    if (e.code === 'Enter' || e.code === 'Space') { closeGarage(); e.preventDefault(); return; }
  }
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

// La pista se dibuja por bloques de TILE px que se generan al entrar en pantalla
// (las pistas reales a escala miden más de 10.000 px: no caben en un solo lienzo).
const TILE = 512;
const MAX_TILES = 36;
const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h ^ (h >>> 16); };

function makeTrackGfx(t, gridCount) {
  const m = t.half + t.runoff + 60;
  const px = Math.max(260, VIEW_W / 2 + 100), py = Math.max(260, VIEW_H / 2 + 100);
  const g = {
    t, gridCount, tiles: new Map(), budget: 0,
    ox: Math.floor(t.bounds.minX - m - px), oy: Math.floor(t.bounds.minY - m - py),
  };
  g.w = Math.max(VIEW_W, Math.ceil(t.bounds.maxX - t.bounds.minX + 2 * (m + px)));
  g.h = Math.max(VIEW_H, Math.ceil(t.bounds.maxY - t.bounds.minY + 2 * (m + py)));
  // Índice espacial de muestras, para decorar solo lejos de la pista
  g.cell = 256; g.grid = new Map();
  for (let i = 0; i < t.N; i += 2) {
    const k = Math.floor(t.xs[i] / g.cell) + ',' + Math.floor(t.ys[i] / g.cell);
    if (!g.grid.has(k)) g.grid.set(k, []);
    g.grid.get(k).push(i);
  }
  g.decks = t.crossings.map(cr => renderDeck(t, cr));
  g.gantries = t.gantries.map(i => renderGantry(t, i));
  return g;
}

// Tramos consecutivos de muestras dentro de un rectángulo: [inicio, nº de segmentos]
function trackRuns(t, x1, y1, x2, y2) {
  const N = t.N, inside = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    if (t.xs[i] >= x1 && t.xs[i] <= x2 && t.ys[i] >= y1 && t.ys[i] <= y2) { inside[i] = 1; any = true; }
  }
  if (!any) return [];
  let first = 0;
  while (first < N && inside[first]) first++;
  if (first === N) return [[0, N]];                 // toda la pista dentro
  const runs = [];
  for (let k = 1; k <= N; k++) {
    const i = (first + k) % N;
    if (inside[i] && !inside[(i - 1 + N) % N]) {
      let len = 0;
      while (inside[(i + len + 1) % N] && len < N) len++;
      runs.push([(i - 1 + N) % N, len + 2]);        // una muestra de margen a cada lado
    }
  }
  return runs;
}

function tilePath(c, t, s0, len, x0, y0, closed) {
  c.beginPath();
  for (let k = 0; k <= len; k++) {
    const i = (s0 + k) % t.N;
    if (k === 0) c.moveTo(t.xs[i] - x0, t.ys[i] - y0); else c.lineTo(t.xs[i] - x0, t.ys[i] - y0);
  }
  if (closed) c.closePath();
}

function renderTile(g, tx, ty) {
  const t = g.t, th = t.def.theme, W = t.def.width, RO = t.runoff;
  const x0 = g.ox + tx * TILE, y0 = g.oy + ty * TILE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = TILE;
  const c = cv.getContext('2d');
  const r = rng(hash2(tx + 5000, ty + 5000) ^ (t.N * 7919));
  c.fillStyle = th.out;
  c.fillRect(0, 0, TILE, TILE);
  for (let i = 0; i < TILE * TILE / 900; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.05)';
    c.fillRect(Math.floor(r() * TILE / 4) * 4, Math.floor(r() * TILE / 4) * 4, 4, 4);
  }
  const E = W / 2 + RO + 30;
  const runs = trackRuns(t, x0 - E, y0 - E, x0 + TILE + E, y0 + TILE + E);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const stroke = (width, color, dash) => {
    c.setLineDash(dash || []);
    c.lineWidth = width;
    c.strokeStyle = color;
    for (const [s0, len] of runs) {
      c.lineDashOffset = s0 * SAMPLE_DS;            // así las rayas casan entre bloques
      tilePath(c, t, s0, Math.min(len, t.N), x0, y0, len >= t.N);
      c.stroke();
    }
  };
  if (runs.length) {
    const walls = t.def.walls;                      // circuito urbano: muros de hormigón
    stroke(W + 2 * RO + 14, walls ? '#c2c3c7' : '#fff1e8');
    stroke(W + 2 * RO + 14, walls ? '#83769c' : '#ff004d', walls ? [36, 6] : [14, 14]);
    stroke(W + 2 * RO, th.runoff);
    stroke(W + 2 * CURB, '#ff004d');
    stroke(W + 2 * CURB, '#fff1e8', [16, 16]);
    stroke(W, th.asphalt);
    for (const [s0, len] of runs) {                 // grano del asfalto (fijo por muestra)
      for (let k = 0; k <= len; k++) {
        const i = (s0 + k) % t.N, rr = rng(i * 9973 + 17);
        for (let q = 0; q < 3; q++) {
          const off = (rr() - 0.5) * (W - 8);
          c.fillStyle = rr() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.05)';
          c.fillRect(Math.round(t.xs[i] + t.nx[i] * off - x0), Math.round(t.ys[i] + t.ny[i] * off - y0), 3, 3);
        }
      }
    }
    stroke(3, 'rgba(255,241,232,.45)', [26, 26]);
    drawTrackHazards(c, t, x0, y0);
    // Sombras de los puentes y de las pasarelas sobre la pista (extremos rectos)
    c.setLineDash([]);
    c.lineCap = 'butt';
    for (const cr of t.crossings) {
      c.lineWidth = W + 2 * CURB + 12;
      c.strokeStyle = 'rgba(0,0,0,.35)';
      tilePath(c, t, (cr.up - cr.B + 1 + t.N) % t.N, 2 * cr.B - 2, x0 - 10, y0 - 12, false);
      c.stroke();
    }
    c.lineCap = 'round';
    for (const i of t.gantries) {
      c.save();
      c.translate(t.xs[i] - x0 + 14, t.ys[i] - y0 + 16);
      c.rotate(t.dir[i]);
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.fillRect(-12, -(W / 2 + RO + 30), 24, W + 2 * RO + 60);
      c.restore();
    }
    drawCheckers(c, t, x0, y0);
    for (let q = 0; q < g.gridCount; q++) {
      const sl = gridSlot(t, q), i = sl.idx;
      c.save();
      c.translate(t.xs[i] + t.nx[i] * sl.lat - x0, t.ys[i] + t.ny[i] * sl.lat - y0);
      c.rotate(t.dir[i]);
      c.strokeStyle = 'rgba(255,241,232,.7)';
      c.lineWidth = 3;
      c.beginPath();
      const L = t.phys === F1 ? 16 : 24, Hh = t.phys === F1 ? 9 : 16;
      c.moveTo(L - 16, -Hh); c.lineTo(L, -Hh); c.lineTo(L, Hh); c.lineTo(L - 16, Hh);
      c.stroke();
      c.restore();
    }
  }
  // Decoración (árboles, rocas, edificios...) lejos de la pista
  const minD = W / 2 + RO + 40, reach = Math.ceil(minD / g.cell) + 1;
  const nDeco = Math.round(TILE * TILE * 5.5e-5);
  for (let q = 0; q < nDeco; q++) {
    const lx = r() * TILE, ly = r() * TILE, x = x0 + lx, y = y0 + ly;
    const gx = Math.floor(x / g.cell), gy = Math.floor(y / g.cell);
    let near = false;
    for (let dx = -reach; dx <= reach && !near; dx++) for (let dy = -reach; dy <= reach && !near; dy++) {
      for (const i of g.grid.get((gx + dx) + ',' + (gy + dy)) || []) {
        if (Math.hypot(t.xs[i] - x, t.ys[i] - y) < minD) { near = true; break; }
      }
    }
    const sz = 3 + Math.floor(r() * 3), col = th.deco[Math.floor(r() * th.deco.length)];
    if (near) continue;
    const px = Math.round(lx), py = Math.round(ly);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(px - sz * 2 + 4, py - sz * 2 + 4, sz * 4, sz * 4);
    c.fillStyle = col;
    c.fillRect(px - sz * 2, py - sz * 2, sz * 4, sz * 4);
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.fillRect(px - sz * 2, py - sz * 2, sz * 2, sz * 2);
  }
  return { canvas: cv, ctx: c, x0, y0 };
}

// Devuelve el bloque (lo genera si hace falta y queda presupuesto en este frame)
function getTile(g, tx, ty, force) {
  const key = tx + ',' + ty;
  let tile = g.tiles.get(key);
  if (!tile && (force || g.budget > 0)) {
    g.budget--;
    tile = renderTile(g, tx, ty);
    g.tiles.set(key, tile);
  }
  if (tile) tile.used = race ? race.frame : 0;
  return tile;
}

// Libera los bloques que llevan más tiempo sin usarse
function trimTiles(g) {
  if (g.tiles.size <= MAX_TILES) return;
  const old = [...g.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let k = 0; k < g.tiles.size - MAX_TILES; k++) g.tiles.delete(old[k][0]);
}

// Tablero de un puente (cruce): el tramo de arriba con barandillas, en un sprite
function renderDeck(t, cr) {
  const W = t.def.width, idx = [];
  for (let k = -cr.B; k <= cr.B; k++) idx.push((cr.up + k + t.N) % t.N);
  const m = W / 2 + CURB + 14;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const i of idx) { x1 = Math.min(x1, t.xs[i]); y1 = Math.min(y1, t.ys[i]); x2 = Math.max(x2, t.xs[i]); y2 = Math.max(y2, t.ys[i]); }
  x1 = Math.floor(x1 - m); y1 = Math.floor(y1 - m);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(x2 + m - x1); cv.height = Math.ceil(y2 + m - y1);
  const c = cv.getContext('2d');
  c.lineJoin = 'round'; c.lineCap = 'butt';
  const path = () => { c.beginPath(); idx.forEach((i, k) => (k ? c.lineTo(t.xs[i] - x1, t.ys[i] - y1) : c.moveTo(t.xs[i] - x1, t.ys[i] - y1))); };
  const st = (w, col, dash, off) => { c.setLineDash(dash || []); c.lineDashOffset = off || 0; c.lineWidth = w; c.strokeStyle = col; path(); c.stroke(); };
  st(W + 2 * CURB + 16, '#16161a');                         // borde exterior
  st(W + 2 * CURB + 12, '#c2c3c7');                         // barandilla de hormigón
  st(W + 2 * CURB + 12, '#83769c', [6, 10]);                // postes
  st(W + 2 * CURB, '#fff1e8');                              // línea blanca del borde
  st(W, t.def.theme.asphalt);
  st(3, 'rgba(255,241,232,.45)', [26, 26], idx[0] * SAMPLE_DS);
  // juntas de dilatación en los extremos
  for (const i of [idx[0], idx[idx.length - 1]]) {
    c.save();
    c.translate(t.xs[i] - x1, t.ys[i] - y1);
    c.rotate(t.dir[i]);
    c.fillStyle = '#16161a';
    c.fillRect(-3, -(W / 2 + CURB + 8), 6, W + 2 * CURB + 16);
    c.restore();
  }
  return { canvas: cv, x0: x1, y0: y1 };
}

// Pasarela sobre la pista (pistas reales): se dibuja por encima de los coches
function renderGantry(t, i) {
  const W = t.def.width, L = W + 2 * t.runoff + 60, S = Math.ceil(L + 40);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.translate(S / 2, S / 2);
  c.rotate(t.dir[i]);
  c.fillStyle = '#5f574f';                                 // pilares
  c.fillRect(-12, -L / 2 - 6, 24, 20);
  c.fillRect(-12, L / 2 - 14, 24, 20);
  c.fillStyle = '#16161a';                                 // viga
  c.fillRect(-11, -L / 2, 22, L);
  c.fillStyle = '#c2c3c7';
  c.fillRect(-9, -L / 2 + 2, 18, L - 4);
  c.fillStyle = t.def.color;                               // pancarta con el color de la pista
  c.fillRect(-7, -W / 2, 14, W);
  c.fillStyle = '#fff1e8';
  for (let y = -W / 2 + 4; y < W / 2 - 4; y += 12) c.fillRect(-2, y, 4, 6);
  return { canvas: cv, x0: t.xs[i] - S / 2, y0: t.ys[i] - S / 2 };
}

// Acantilados (vacío con borde de roca), manchas de aceite, barro y raíles de los bloques
function drawTrackHazards(c, t, ox, oy) {
  const inner = t.half + CURB, outer = t.half + t.runoff + 18;
  const edge = (i, side, d) => [t.xs[i] + t.nx[i] * side * d - ox, t.ys[i] + t.ny[i] * side * d - oy];
  for (let i = 0; i < t.N; i++) {
    const cv = t.cliff[i];
    if (!cv) continue;
    const j = (i + 1) % t.N, r = rng(i * 131 + 7);
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
    const r = rng(m.idx * 53 + 3);
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
function makeCar(t, g, color, model) {
  const s = gridSlot(t, g), i = s.idx;
  const f1 = t.phys === F1;
  return {
    color, dark: darken(color), model: f1 ? null : carById(model).id,
    x: t.xs[i] + t.nx[i] * s.lat, y: t.ys[i] + t.ny[i] * s.lat,
    angle: t.dir[i], vx: 0, vy: 0, fwd: 0, lat: 0,
    idx: i, dist: Math.abs(s.lat), surface: 0,
    progress: -s.back,             // muestras recorridas (negativo = detrás de la meta)
    lapsDone: 0, lapStart: 0, lapTimes: [], bestLap: null,
    finished: false, finishFrame: null, wrongWay: 0, bumpCd: 0,
    phys: f1 ? F1 : carPhysFor(model),   // Fórmula 1 o el coche elegido
  };
}

function makeDerbyCar(t, g, n, color, model) {
  const sp = arenaSpawn(t.arena, g, n);
  return {
    color, dark: darken(color), model: carById(model).id, phys: carPhysFor(model),
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
  const P = car.phys || PHYS;                        // kart o Fórmula 1
  // 1) Girar (kart: más lento a baja y a muy alta velocidad; F1: limitado por el agarre lateral)
  const dirSign = car.fwd >= 0 ? 1 : -1;
  const grip = car.oil > 0 ? 0.35 : 1;               // en aceite el volante casi no responde
  car.angle += ctl.steer * turnRateFor(P, car.fwd) * dirSign * grip;
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
  const top = P.maxSpeed * (car.turbo ? (P.turboSpeed || TURBO.speed) : 1);
  if (ctl.throttle) {
    // F1: el empuje cae al acercarse a la punta (resistencia del aire)
    const fall = P.falloff && f > 0 ? 1 - P.falloff * Math.min(1, (f / top) ** 2) : 1;
    f += P.accel * (grass ? (P.grassAccel || 0.55) : 1) * ctl.throttle * (car.turbo ? TURBO.accel : 1) * fall;
  }
  if (ctl.brake) {
    if (f > 0.15) f = Math.max(0, f - P.brake * ctl.brake);
    else f -= P.accel * (P.falloff ? 1.5 : 0.6) * ctl.brake;
  }
  if (!ctl.throttle && !ctl.brake) f *= P.falloff ? 0.994 : 0.985;
  f *= grass ? (P.grassDrag || 0.975) : car.surface === 1 ? 0.994 : (P.drag || 0.997);
  f = Math.max(-P.reverseMax, Math.min(top, f));
  if (grass && f > P.grassMax) f = Math.max(P.grassMax, f * 0.94);
  l *= car.oil > 0 ? 0.985 : grass ? 0.9 : (P.grip || 0.8);    // en aceite el coche resbala
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
  const limit = t.half + t.runoff - carR() * 0.6;
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
  const myLvl = !derby && race.t.crossings && race.t.crossings.length ? levelAt(race.t, car.idx) : 0;
  for (const o of others) {
    if (!derby && (o.lvl || 0) !== myLvl) continue;   // uno pasa por el puente y el otro por debajo
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
        car.vx -= 0.65 * rel * nx;                   // todos los coches pesan lo mismo
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
    gfx: derby ? renderArena(t, Math.max(racersCount, 2)) : makeTrackGfx(t, Math.max(racersCount, 2)),
    laps: s.nl || (t.def && t.def.real ? REAL_LAPS : LAPS),
    mini: derby
      ? renderArenaMinimap(t, small ? 150 : 190, small ? 120 : 150)
      : renderMinimap(t, small ? 150 : 190, small ? 120 : 150),
    car: me ? (derby ? makeDerbyCar(t, me.g, racersCount, me.c, me.car) : makeCar(t, me.g, me.c, me.car)) : null,
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
    const ahead = isF1() ? 24 : 14;                  // a 500 km/h hay que ver más lejos
    const tx = target.x + (target.vx || 0) * ahead, ty = target.y + (target.vy || 0) * ahead;
    r.cam.x += (tx - r.cam.x) * 0.12;
    r.cam.y += (ty - r.cam.y) * 0.12;
  }
  if (shake > 0) shake *= 0.85;
  if (shake < 0.2) shake = 0;

  sound.setEngine(car ? car.fwd : 0, !!car && snap.ph !== 'ended' && snap.ph !== 'loading');

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
  const last = r.order.length >= TURBO.minPlayers && r.order[r.order.length - 1].me;
  if (car.finished || !others.length || !last) car.turbo = false;
  else {
    const gap = Math.min(...others.map(o => o.progress)) - car.progress;   // muestras hasta el de delante
    const pace = car.phys.maxSpeed * 0.75 * 60 / SAMPLE_DS;                // muestras por segundo a ritmo de carrera
    if (!car.turbo && gap > TURBO.onSec * pace) car.turbo = true;
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

  if (car.lapsDone >= r.laps) {
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
  if (car.lapsDone === r.laps - 1) banner('¡ÚLTIMA VUELTA!', '#ff004d', 150);
  else banner(`VUELTA ${car.lapsDone + 1}/${r.laps}`, '#29adff', 100);
  sound.beep(660, 0.12);
}

// Marcas de derrape pintadas directamente sobre la pista pre-renderizada
function addSkid(car) {
  if (car.surface === 2 || Math.abs(car.lat) < 1.3) return;
  const g = race.gfx;
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  const k = isF1() ? 0.7 : carScale(), sz = Math.max(3, Math.round(4 * k));   // ruedas traseras
  for (const side of [-7 * k, 7 * k]) {
    const x = car.x - ca * 12 * k - sa * side, y = car.y - sa * 12 * k + ca * side;
    let c = g.ctx, ox = g.ox, oy = g.oy;
    if (g.tiles) {                                   // pista por bloques: se pinta en el bloque que toca
      const tile = g.tiles.get(Math.floor((x - g.ox) / TILE) + ',' + Math.floor((y - g.oy) / TILE));
      if (!tile) continue;
      c = tile.ctx; ox = tile.x0; oy = tile.y0;
    }
    c.fillStyle = 'rgba(20,18,24,.35)';
    c.fillRect(Math.round(x - ox - sz / 2), Math.round(y - oy - sz / 2), sz, sz);
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
  const f1 = isF1();
  if (car.turbo || car.tb) {                  // llamas del turbo por el tubo de escape
    const fl = 8 + Math.random() * 10, bx = f1 ? -15 : car.model ? -carById(car.model).len / 2 - 1 : -19;
    c.fillStyle = '#ff004d'; c.fillRect(bx - fl, -5, fl, 10);
    c.fillStyle = '#ffa300'; c.fillRect(bx - fl * 0.7, -4, fl * 0.7, 8);
    c.fillStyle = '#ffec27'; c.fillRect(bx - fl * 0.35, -2, fl * 0.35, 4);
  }
  if (f1) { drawF1Body(c, car); c.restore(); return; }
  if (car.model && CAR_ART[car.model]) { CAR_ART[car.model](c); c.restore(); return; }
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

// ---------- Coches elegibles: dibujo pixelado visto desde arriba (morro hacia +x) ----------
// Inspirados en las fotos que pasó el usuario (sin logotipos de marca).
function carShadow(c, len) { c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-len / 2 + 2, -7, len, 19); }
function carWheels(c, fx, rx, w, hub) {                 // fx / rx: x de las ruedas delanteras / traseras
  c.fillStyle = '#111';
  for (const x of [fx, rx]) { c.fillRect(x, -10, w, 3); c.fillRect(x, 7, w, 3); }
  if (hub) { c.fillStyle = hub; for (const x of [fx, rx]) { c.fillRect(x + 2, -10, w - 4, 1); c.fillRect(x + 2, 9, w - 4, 1); } }
}
function carBody(c, len, outline, color) {
  c.fillStyle = outline; c.fillRect(-len / 2, -9, len, 18);
  c.fillStyle = color; c.fillRect(-len / 2 + 1, -8, len - 2, 16);
}
function carGlass(c, x, w, y0 = -6, h = 12) {
  c.fillStyle = '#1d2b53'; c.fillRect(x, y0, w, h);
  c.fillStyle = 'rgba(41,173,255,.8)'; c.fillRect(x + w - 2, y0 + 1, 1, h - 2);
}
function carLights(c, x) { c.fillStyle = '#fff1e8'; c.fillRect(x, -7, 2, 3); c.fillRect(x, 4, 2, 3); }

const CAR_ART = {
  // Nissan Skyline GT-R R34: plata con franjas azules y gran alerón
  r34(c) {
    carShadow(c, 38); carWheels(c, 8, -14, 7);
    carBody(c, 38, '#5f574f', '#c2c3c7');
    c.fillStyle = '#e2e2e8'; c.fillRect(6, -7, 12, 14);
    c.fillStyle = '#1e5fd8'; c.fillRect(-18, -4, 36, 2); c.fillRect(-18, 2, 36, 2);
    for (const x of [-15, -9, -3, 3, 9]) { c.fillRect(x, -8, 3, 2); c.fillRect(x, 6, 3, 2); }
    carGlass(c, 2, 4); carGlass(c, -10, 3, -5, 10);
    c.fillStyle = '#16161a'; c.fillRect(-20, -9, 3, 18);
    carLights(c, 17);
  },
  // Subaru Impreza WRC: azul con franjas amarillas, llantas doradas, toma de aire y alerón
  wrc(c) {
    carShadow(c, 36); carWheels(c, 7, -13, 7, '#ffec27');
    carBody(c, 36, '#0d1f5a', '#1f47c4');
    c.fillStyle = '#ffec27'; c.fillRect(-12, -8, 19, 2); c.fillRect(-12, 6, 19, 2);
    c.fillStyle = '#29adff'; c.fillRect(-12, -6, 19, 1); c.fillRect(-12, 5, 19, 1);
    c.fillStyle = '#16161a'; c.fillRect(9, -3, 5, 6);
    c.fillStyle = '#0d1f5a'; c.fillRect(10, -2, 3, 4);
    carGlass(c, 2, 4);
    c.fillStyle = '#fff1e8'; c.fillRect(-7, -3, 5, 6);            // dorsal en el techo
    c.fillStyle = '#ff7a00'; c.fillRect(-5, -2, 1, 4);
    carGlass(c, -11, 3, -5, 10);
    c.fillStyle = '#16161a'; c.fillRect(-19, -9, 3, 18);
    c.fillStyle = '#1f47c4'; c.fillRect(-19, -9, 3, 2); c.fillRect(-19, 7, 3, 2);
    carLights(c, 16);
  },
  // Dodge Challenger Hellcat: gris, capó largo con dos tomas de aire, pilotos de lado a lado
  challenger(c) {
    carShadow(c, 42); carWheels(c, 10, -16, 8);
    carBody(c, 42, '#2a2a33', '#6f737c');
    c.fillStyle = '#7d818a'; c.fillRect(5, -7, 15, 14);
    c.fillStyle = '#16161a'; c.fillRect(11, -5, 5, 3); c.fillRect(11, 2, 5, 3);
    carGlass(c, 1, 4);
    c.fillStyle = '#5c6069'; c.fillRect(-9, -6, 10, 12);
    carGlass(c, -12, 3, -5, 10);
    c.fillStyle = '#16161a'; c.fillRect(-21, -8, 1, 16);
    c.fillStyle = '#ff004d'; c.fillRect(-20, -7, 1, 14);
    c.fillStyle = '#fff1e8'; for (const y of [-7, -4, 2, 5]) c.fillRect(20, y, 1, 2);
  },
  // Toyota Supra MK4: naranja con gráficos verdes y alerón plateado
  supra(c) {
    carShadow(c, 38); carWheels(c, 8, -14, 7, '#c2c3c7');
    carBody(c, 38, '#ab3d00', '#ff7a00');
    c.fillStyle = '#16161a'; c.fillRect(9, -5, 4, 2); c.fillRect(9, 3, 4, 2);
    c.fillStyle = '#00e436'; c.fillRect(-15, -8, 10, 2); c.fillRect(-15, 6, 10, 2); c.fillRect(-11, -6, 5, 1); c.fillRect(-11, 5, 5, 1);
    carGlass(c, 2, 4); carGlass(c, -10, 3, -5, 10);
    c.fillStyle = '#5f574f'; c.fillRect(-17, -6, 2, 2); c.fillRect(-17, 4, 2, 2);
    c.fillStyle = '#c2c3c7'; c.fillRect(-20, -10, 3, 20);
    c.fillStyle = '#5f574f'; c.fillRect(-20, -10, 3, 1); c.fillRect(-20, 9, 3, 1);
    carLights(c, 17);
  },
  // Volkswagen Golf GTI TCR: compacto gris, techo negro, panal en los laterales y línea roja delante
  golf(c) {
    carShadow(c, 32); carWheels(c, 6, -12, 7);
    carBody(c, 32, '#2a2a33', '#5d6270');
    c.fillStyle = '#4a4f5b';
    for (let x = -13; x <= -3; x += 3) { c.fillRect(x, -8, 2, 2); c.fillRect(x + 1, -6, 2, 1); c.fillRect(x, 6, 2, 2); c.fillRect(x + 1, 5, 2, 1); }
    carGlass(c, 4, 4);
    c.fillStyle = '#2a2a33'; c.fillRect(-11, -6, 15, 12);
    c.fillStyle = '#16161a'; c.fillRect(-14, -7, 3, 14);
    c.fillStyle = '#ff004d'; c.fillRect(15, -6, 1, 12);
    c.fillStyle = '#fff1e8'; c.fillRect(14, -7, 2, 2); c.fillRect(14, 5, 2, 2);
  },
};

// Dibujo grande del coche (garaje y sala), sobre una plaza de aparcamiento
function drawCarPreview(cv, id) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, len = carById(id).len;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#16161a'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1f1f27';
  for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < W; x += 8) c.fillRect(x, y, 4, 4);
  c.fillStyle = '#ffec27'; c.fillRect(8, 6, W - 16, 3); c.fillRect(8, H - 9, W - 16, 3);
  const k = Math.max(1, Math.floor(Math.min((W - 24) / (len + 6), (H - 26) / 22)));
  c.save(); c.translate(Math.round(W / 2), Math.round(H / 2) + 1); c.scale(k, k); CAR_ART[id](c); c.restore();
}

// Fórmula 1 visto desde arriba: 28 x 10 px (5,6 x 2 m), ruedas descubiertas y alerones
function drawF1Body(c, car) {
  c.fillStyle = 'rgba(0,0,0,.35)';            // sombra
  c.fillRect(-13, -5, 30, 12);
  c.fillStyle = '#111';                       // ruedas (las traseras más anchas)
  c.fillRect(6, -8, 6, 3); c.fillRect(6, 5, 6, 3);
  c.fillRect(-11, -9, 7, 4); c.fillRect(-11, 5, 7, 4);
  c.fillStyle = car.dark;                     // alerón delantero
  c.fillRect(13, -7, 3, 14);
  c.fillStyle = car.color;                    // morro y monocasco
  c.fillRect(-10, -2, 24, 4);
  c.fillRect(-9, -5, 12, 10);                 // pontones
  c.fillStyle = car.dark;
  c.fillRect(-9, -5, 12, 1); c.fillRect(-9, 4, 12, 1);
  c.fillStyle = '#1d2b53';                    // cabina
  c.fillRect(1, -2, 5, 4);
  c.fillStyle = '#ffec27';                    // casco
  c.fillRect(2, -1, 2, 2);
  c.fillStyle = car.dark;                     // alerón trasero
  c.fillRect(-15, -6, 3, 12);
}

// ---------- Pantalla de carga de las pistas reales: los F1 de perfil ----------
// Pixel art de 72 × 17 mirando a la derecha. Cada tramo: [fila, x1, x2, zona]; los últimos tapan a los primeros.
// Zonas: W alerón trasero, w su franja, K carbono, B carrocería, b carrocería baja,
// S franja lateral, E toma de aire, H casco, V visera, N punta del morro, F alerón delantero, f su franja.
const F1_SIDE = [
  // alerón trasero y su soporte
  [0, 1, 10, 'w'], [1, 0, 10, 'W'], [2, 0, 10, 'W'], [3, 0, 9, 'K'], [4, 0, 9, 'W'], [5, 1, 8, 'W'], [6, 2, 6, 'W'],
  [7, 4, 6, 'K'], [8, 4, 6, 'K'],
  // difusor y caja de cambios (casi tapados por la rueda)
  [9, 0, 15, 'K'], [10, 0, 15, 'K'], [11, 1, 15, 'K'], [12, 2, 15, 'K'],
  // tapa del motor, subiendo hasta la toma de aire
  [4, 30, 32, 'B'], [5, 26, 37, 'B'], [6, 22, 48, 'B'], [7, 18, 52, 'B'], [8, 14, 56, 'B'],
  [9, 14, 60, 'B'], [10, 14, 64, 'B'], [11, 14, 67, 'B'], [12, 14, 67, 'b'], [13, 18, 54, 'b'],
  // toma de aire sobre el piloto
  [1, 34, 36, 'E'], [2, 33, 37, 'E'], [3, 33, 37, 'E'], [4, 33, 37, 'E'], [2, 37, 37, 'K'], [3, 37, 37, 'K'],
  // piloto y halo
  [4, 38, 40, 'H'], [5, 38, 40, 'H'], [5, 41, 41, 'V'], [4, 41, 41, 'V'],
  [3, 37, 44, 'K'], [4, 44, 45, 'K'], [5, 45, 45, 'K'],
  // entrada de aire del pontón, franja lateral y punta del morro
  [8, 42, 43, 'K'], [9, 42, 43, 'K'], [10, 43, 43, 'K'],
  [10, 16, 41, 'S'], [11, 16, 41, 'S'], [11, 45, 58, 'S'],
  [10, 61, 64, 'N'], [11, 60, 67, 'N'], [12, 58, 67, 'N'],
  // suelo
  [14, 14, 56, 'K'],
  // alerón delantero
  [13, 62, 69, 'f'], [14, 58, 71, 'F'], [15, 60, 71, 'F'],
  [11, 69, 71, 'F'], [12, 69, 71, 'F'], [13, 70, 71, 'F'],
];
const F1_W = 72, F1_H = 17, F1_WHEELS = [11, 57];           // centros de las ruedas (y = 11)

// Los 4 F1 de la pantalla de carga: colores de su decoración (sin logos ni patrocinadores)
const F1_TEAMS = [
  { id: 'merc', name: 'MERCEDES W14', label: '#00d2be',
    pal: { B: '#26282f', b: '#16171b', S: '#00d2be', E: '#26282f', N: '#26282f', W: '#26282f', w: '#00d2be', F: '#26282f', f: '#00d2be', H: '#ffd23f' },
    rim: '#2bd47d', stripe: '#eeeeee' },
  { id: 'ferrari', name: 'FERRARI F1-75', label: '#ff2a2a',
    pal: { B: '#d8000f', b: '#1a1a1a', S: '#d8000f', E: '#d8000f', N: '#d8000f', W: '#1a1a1a', w: '#d8000f', F: '#d8000f', f: '#1a1a1a', H: '#f4f4f4' },
    rim: '#d7e800', stripe: '#ffd800' },
  { id: 'redbull', name: 'RED BULL RB18', label: '#ffc906',
    pal: { B: '#1f2b52', b: '#172142', S: '#e2233b', E: '#ffc906', N: '#ffc906', W: '#1f2b52', w: '#e2233b', F: '#1f2b52', f: '#e2233b', H: '#f4f4f4' },
    rim: '#1f2b52', rimRing: '#e2233b', stripe: '#e2233b' },
  { id: 'renault', name: 'RENAULT R.S.19', label: '#ffe100',
    pal: { B: '#161616', b: '#0d0d0d', S: '#161616', E: '#ffe100', N: '#ffe100', W: '#161616', w: '#ffe100', F: '#ffe100', f: '#161616', H: '#f4f4f4' },
    // la mitad delantera y el lomo de la tapa del motor, amarillos
    paint: [[6, 38, 67, '#ffe100'], [7, 44, 67, '#ffe100'], [8, 46, 67, '#ffe100'], [9, 47, 67, '#ffe100'], [10, 48, 67, '#ffe100'], [11, 48, 67, '#ffe100'],
      [4, 30, 32, '#ffe100'], [5, 26, 32, '#ffe100'], [6, 22, 30, '#ffe100']],
    rim: '#2a2a2a', stripe: '#ffd800' },
];

function shadeHex(hex, k) {     // k > 0 aclara, k < 0 oscurece
  const n = parseInt(hex.slice(1), 16);
  const ch = s => { const v = (n >> s) & 255; return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Carrocería pre-dibujada (sin ruedas), con brillo en el borde de arriba
const f1SideCache = new Map();
function f1SideSprite(tm) {
  if (f1SideCache.has(tm.id)) return f1SideCache.get(tm.id);
  const zone = Array.from({ length: F1_H }, () => new Array(F1_W).fill(null));
  const col = Array.from({ length: F1_H }, () => new Array(F1_W).fill(null));
  const pal = { K: '#0b0b0e', V: '#101014', ...tm.pal };
  for (const [y, x1, x2, z] of F1_SIDE) for (let x = x1; x <= x2; x++) { zone[y][x] = z; col[y][x] = pal[z]; }
  for (const [y, x1, x2, c] of tm.paint || []) for (let x = x1; x <= x2; x++) if ('BbSN'.includes(zone[y][x])) col[y][x] = c;
  const cv = document.createElement('canvas');
  cv.width = F1_W; cv.height = F1_H;
  const c = cv.getContext('2d');
  for (let y = 0; y < F1_H; y++) for (let x = 0; x < F1_W; x++) {
    if (!col[y][x]) continue;
    const z = zone[y][x], up = y > 0 ? zone[y - 1][x] : null;
    const edge = z !== 'K' && z !== 'V' && (!up || up === 'K');
    c.fillStyle = edge ? shadeHex(col[y][x], 0.35) : col[y][x];
    c.fillRect(x, y, 1, 1);
  }
  f1SideCache.set(tm.id, cv);
  return cv;
}

// Rueda de 11 × 11 con su franja de compuesto; 4 fotogramas para que parezca que gira
const f1WheelCache = new Map();
function f1WheelSprite(tm, frame) {
  const key = tm.id + (frame & 3);
  if (f1WheelCache.has(key)) return f1WheelCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 11;
  const c = cv.getContext('2d');
  const rot = (frame & 3) * Math.PI / 8;
  for (let j = 0; j < 11; j++) for (let i = 0; i < 11; i++) {
    const dx = i + 0.5 - 5.5, dy = j + 0.5 - 5.5, d = Math.hypot(dx, dy);
    if (d > 5.6) continue;
    const a = (Math.atan2(dy, dx) + rot + Math.PI * 4) % (Math.PI / 2);
    let color;
    if (d > 4.7) color = '#141418';                                   // banda de rodadura
    else if (d > 3.8) color = a < 0.5 ? '#141418' : tm.stripe;        // franja del compuesto, con cortes que giran
    else if (d > 2.9) color = '#1e1e24';                              // flanco
    else if (d > 2.1 && tm.rimRing) color = tm.rimRing;
    else if (d > 1.0) color = tm.rim;                                 // tapacubos
    else color = '#9a9aa4';                                           // tuerca
    c.fillStyle = color;
    c.fillRect(i, j, 1, 1);
  }
  f1WheelCache.set(key, cv);
  return cv;
}

// Dibuja el F1 con la esquina de arriba a la izquierda en (x, y), ampliado S veces
function drawF1Side(c, tm, x, y, S, frame) {
  c.imageSmoothingEnabled = false;
  c.fillStyle = 'rgba(0,0,0,.45)';                                     // sombra en el suelo
  c.fillRect(x + 2 * S, y + (F1_H - 0.5) * S, (F1_W - 3) * S, S);
  c.drawImage(f1SideSprite(tm), x, y, F1_W * S, F1_H * S);
  for (const wx of F1_WHEELS) c.drawImage(f1WheelSprite(tm, frame), x + (wx - 5.5) * S, y + 5.5 * S, 11 * S, 11 * S);
}

// Alto (en píxeles de la vista) que tapan los botones de arriba (FIN, música, pantalla completa)
function topBarBottom() {
  if (!document.body.classList.contains('fill')) return 0;
  const b = document.querySelector('.gamebar').getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  return cr.height ? Math.max(0, (b.bottom - cr.top) * VIEW_H / cr.height) : 0;
}

// Mientras se ve la pantalla de carga se preparan de verdad los bloques de pista
// que se verán en la salida. Devuelve la fracción lista (0-1).
function warmTiles(r) {
  const g = r.gfx;
  if (!g.tiles) return 1;
  g.budget = 3;
  const cx = Math.max(0, Math.min(g.w - VIEW_W, r.cam.x - VIEW_W / 2 - g.ox));
  const cy = Math.max(0, Math.min(g.h - VIEW_H, r.cam.y - VIEW_H / 2 - g.oy));
  const mx = Math.floor((g.w - 1) / TILE), my = Math.floor((g.h - 1) / TILE);
  const x0 = Math.max(0, Math.floor(cx / TILE) - 1), x1 = Math.min(mx, Math.floor((cx + VIEW_W) / TILE) + 1);
  const y0 = Math.max(0, Math.floor(cy / TILE) - 1), y1 = Math.min(my, Math.floor((cy + VIEW_H) / TILE) + 1);
  let ready = 0, total = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { total++; if (getTile(g, tx, ty)) ready++; }
  return total ? ready / total : 1;
}

const LOAD_TIPS = [
  'FRENA ANTES DE LAS CURVAS: A 500 KM/H LLEGAN ENSEGUIDA',
  'LAS PISTAS MIDEN LO MISMO QUE LAS DE VERDAD',
  'CON 4 PILOTOS O MÁS, EL ÚLTIMO TIENE TURBO SI SE QUEDA MUY ATRÁS',
  'EN SUZUKA HAY UN PUENTE: EL DE ARRIBA Y EL DE ABAJO NO CHOCAN',
  'EN BAKÚ HAY MUROS: NO HAY ESCAPATORIA',
  'FUERA DEL ASFALTO EL F1 NO PASA DE 130 KM/H',
];

function drawLoading(r) {
  const def = r.t.def, f = r.frame, low = VIEW_H < 560;
  const cxv = VIEW_W / 2, maxW = VIEW_W - 24;
  const prog = Math.max(0, Math.min(1 - snap.left / REAL_LOADING_MS, warmTiles(r)));

  // Fondo con estelas de velocidad
  ctx.fillStyle = '#0b0b14';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  for (let i = 0; i < 46; i++) {
    const len = 24 + (i * 37) % 90, y = Math.round((i * 97.3 + 13) % VIEW_H);
    const x = VIEW_W - ((f * (8 + (i % 5) * 4) + i * 211) % (VIEW_W + len));
    ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.07)' : 'rgba(41,173,255,.16)';
    ctx.fillRect(Math.round(x), y, len, 2);
  }

  // Cabecera: sección, nombre de la pista y datos
  let y = Math.max(topBarBottom() + 8, low ? 12 : 22);
  const head = r.banner && r.frame < r.banner.until ? r.banner.text : 'PISTAS REALES A ESCALA · FÓRMULA 1';
  text(head, cxv, y, low ? 8 : 10, '#ffec27', 'center', maxW); y += low ? 16 : 22;
  text(def.name, cxv, y, low ? 20 : 28, def.color, 'center', maxW); y += low ? 30 : 42;
  text(`${def.country} · ${(def.lengthM / 1000).toFixed(3).replace('.', ',')} KM · ${def.turns} CURVAS · ${r.laps} VUELTAS`,
    cxv, y, low ? 8 : 10, '#fff1e8', 'center', maxW);
  y += low ? 18 : 26;

  // Pie: barra de carga y consejo
  const tipY = VIEW_H - (low ? 16 : 28), barH = low ? 10 : 14;
  const barY = tipY - (low ? 16 : 24) - barH, labY = barY - (low ? 14 : 20);

  // Asfalto con los F1: 4 carriles (o 2 carriles con 2 coches si la pantalla es ancha y baja)
  const roadTop = y, roadBot = labY - (low ? 8 : 14), roadH = roadBot - roadTop;
  const inTop = roadTop + 8, inH = roadH - 16;                 // carriles sin pisar los pianos
  const lab = low ? 8 : 10;
  const fitS = (lanes, frac) => Math.max(1, Math.min(6, Math.floor((inH / lanes - lab - 12) / F1_H), Math.floor(VIEW_W * frac / F1_W)));
  const s4 = fitS(4, VIEW_W < 760 ? 0.75 : 0.42), s2 = fitS(2, 0.36);
  const lanes = s2 > s4 ? 2 : 4, S = Math.max(s2, s4), laneH = inH / lanes;
  ctx.fillStyle = '#2b2b34';
  ctx.fillRect(0, roadTop, VIEW_W, roadH);
  const run = (f * 16) % 64;                                 // la pista corre hacia la izquierda
  for (const ky of [roadTop, roadBot - 6]) {                 // pianos
    for (let x = -run; x < VIEW_W; x += 64) {
      ctx.fillStyle = '#ff004d'; ctx.fillRect(x, ky, 32, 6);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(x + 32, ky, 32, 6);
    }
  }
  ctx.fillStyle = 'rgba(255,241,232,.55)';                   // líneas entre carriles
  for (let k = 1; k < lanes; k++) {
    const ly = Math.round(inTop + k * laneH) - 1;
    for (let x = -((f * 16) % 80); x < VIEW_W; x += 80) ctx.fillRect(x, ly, 40, 3);
  }
  const carW = F1_W * S, carH = F1_H * S;
  F1_TEAMS.forEach((tm, i) => {
    const lane = lanes === 4 ? i : i >> 1;
    const slot = lanes === 4 ? 0.5 : (i & 1 ? 0.27 : 0.73);  // con 2 carriles: uno delante y otro detrás
    const amp = lanes === 4 ? Math.max(0, (VIEW_W - carW) / 2 - 16) * 0.55 : VIEW_W * 0.05;
    let x = VIEW_W * slot - carW / 2 + amp * Math.sin(f * 0.017 * (1 + i * 0.23) + i * 1.9);
    const intro = Math.min(1, Math.max(0, (f - i * 9) / 50));             // entran desde la izquierda
    x -= (1 - (1 - Math.pow(1 - intro, 3))) * (x + carW + 40);
    const cy = Math.round(inTop + lane * laneH + (laneH - carH - lab - 6) / 2 + lab + 6) + (((f >> 2) + i) % 3 === 0 ? 1 : 0);
    ctx.fillStyle = 'rgba(255,255,255,.22)';                 // estela
    for (let k = 0; k < 3; k++) ctx.fillRect(Math.round(x - 24 - k * 22 - (f * 6 + k * 9) % 18), cy + Math.round((6 + k * 3) * S), 18, Math.max(1, S >> 1));
    drawF1Side(ctx, tm, Math.round(x), cy, S, (f >> 1) + i);
    text(tm.name, Math.round(x + carW / 2), cy - lab - 5, lab, tm.label, 'center');
  });

  // Barra de carga
  const bw = Math.min(560, VIEW_W - 48), bx = Math.round(cxv - bw / 2);
  text(prog >= 1 ? '¡LISTO!' : `CARGANDO PISTA${'.'.repeat(1 + ((f >> 4) % 3))}  ${Math.round(prog * 100)}%`, cxv, labY, low ? 8 : 10, '#fff1e8', 'center', maxW);
  ctx.fillStyle = '#000'; ctx.fillRect(bx - 3, barY - 3, bw + 6, barH + 6);
  ctx.fillStyle = '#1d2b53'; ctx.fillRect(bx, barY, bw, barH);
  ctx.fillStyle = '#00e436';
  const fillW = Math.round(bw * prog);
  for (let x = 0; x + 10 <= fillW; x += 14) ctx.fillRect(bx + x + 2, barY + 2, 10, barH - 4);
  text(`CONSEJO: ${LOAD_TIPS[r.rid % LOAD_TIPS.length]}`, cxv, tipY, low ? 7 : 9, '#c2c3c7', 'center', maxW);
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
  if (snap.ph === 'loading') { drawLoading(r); return; }    // pistas reales: pantalla de carga con los F1

  // Cámara limitada al mapa
  const clampX = v => Math.round(Math.max(0, Math.min(g.w - VIEW_W, v)));
  const clampY = v => Math.round(Math.max(0, Math.min(g.h - VIEW_H, v)));
  let cx = r.cam.x - VIEW_W / 2 - g.ox, cy = r.cam.y - VIEW_H / 2 - g.oy;
  if (shake) { cx += (Math.random() - 0.5) * shake; cy += (Math.random() - 0.5) * shake; }
  cx = clampX(cx); cy = clampY(cy);

  if (g.tiles) {
    // Pista por bloques: se dibujan los visibles y se preparan los de alrededor
    g.budget = 3;
    const t0x = Math.floor(cx / TILE), t0y = Math.floor(cy / TILE);
    const t1x = Math.floor((cx + VIEW_W) / TILE), t1y = Math.floor((cy + VIEW_H) / TILE);
    ctx.fillStyle = r.t.def.theme.out;
    for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
      const tile = getTile(g, tx, ty, r.frame < 2);
      if (tile) ctx.drawImage(tile.canvas, tx * TILE - cx, ty * TILE - cy);
      else ctx.fillRect(tx * TILE - cx, ty * TILE - cy, TILE, TILE);
    }
    for (let ty = t0y - 1; ty <= t1y + 1; ty++) for (let tx = t0x - 1; tx <= t1x + 1; tx++) getTile(g, tx, ty);
    trimTiles(g);
  } else {
    ctx.drawImage(g.canvas, cx, cy, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  }

  ctx.save();
  ctx.translate(-cx - g.ox, -cy - g.oy);
  if (r.mode === 'derby') drawPickups(r);
  if (r.t.pistons) for (const p of r.t.pistons) drawPiston(pistonPos(p, raceTimeMs()), p.ang);
  // Puentes: primero los coches de abajo, luego el tablero, luego los de arriba
  const decks = g.decks || [];
  const myLvl = r.car && decks.length ? levelAt(r.t, r.car.idx) : 0;
  for (const o of r.remotes.values()) if (!o.lvl) drawCar(ctx, o);
  if (r.car && !myLvl) drawCar(ctx, r.car);
  for (const d of decks) ctx.drawImage(d.canvas, d.x0, d.y0);
  for (const o of r.remotes.values()) if (o.lvl) drawCar(ctx, o);
  if (r.car && myLvl) drawCar(ctx, r.car);       // el mío encima
  if (r.mode === 'derby') {
    const byId = new Map(snap.p.map(p => [p.id, p]));
    for (const [id, o] of r.remotes) drawDerbyExtras(o, byId.get(id));
    if (r.car) drawDerbyExtras(r.car, byId.get(myId));
  }
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textAlign = 'center';
  const lab = isF1() ? 14 : Math.round(20 * carScale());     // el nombre, justo encima del coche
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
  // Pasarelas sobre la pista: por encima de todos los coches
  for (const gt of g.gantries || []) ctx.drawImage(gt.canvas, gt.x0, gt.y0);
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

// Dibuja la vida en barritas (llenas, medias o vacías)
function drawBars(x, y, w, h, hp, gap = 3) {
  const n = DERBY.START_HP, segW = (w - gap * (n - 1)) / n, col = hpColor(hp);
  for (let i = 0; i < n; i++) {
    const sx = Math.round(x + i * (segW + gap)), sw = Math.round(segW);
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 1, y - 1, sw + 2, h + 2);
    ctx.fillStyle = '#2a2233';                       // hueco vacío
    ctx.fillRect(sx, y, sw, h);
    const fill = Math.max(0, Math.min(1, hp - i));   // 1 = llena, 0,5 = media, 0 = vacía
    if (fill > 0) {
      ctx.fillStyle = col;
      ctx.fillRect(sx, y, Math.round(sw * fill), h);
      ctx.fillStyle = 'rgba(255,255,255,.35)';       // brillo
      ctx.fillRect(sx, y, Math.round(sw * fill), Math.max(1, Math.round(h / 4)));
    }
  }
}

// Escudo, humo y barritas de vida de cada coche en demolición
function drawDerbyExtras(o, p) {
  if (!p) return;
  const x = Math.round(o.x), y = Math.round(o.y), fr = race.frame;
  if (p.hp / DERBY.START_HP <= 0.4) {             // con 2 barritas o menos echa humo
    for (let k = 0; k < 3; k++) {
      const t = (fr * 0.7 + k * 23 + p.id * 37) % 60;
      const sz = 6 + t / 5;
      ctx.fillStyle = `rgba(40,36,44,${Math.max(0, 0.55 - t / 110)})`;
      ctx.fillRect(Math.round(x - sz / 2 + Math.sin((t + k) * 0.3) * 6), Math.round(y - 8 - t * 0.7), sz, sz);
    }
    if (p.hp / DERBY.START_HP <= 0.2 && fr % 10 < 5) { ctx.fillStyle = '#ffa300'; ctx.fillRect(x - 4, y - 4, 8, 8); }
  }
  if (p.sh > 0 && (p.sh > 2000 || fr % 10 < 6)) {
    const rad = 27 * DERBY.CAR_SCALE + Math.sin(fr * 0.2) * 2;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(41,173,255,.18)'; ctx.fill();
    ctx.strokeStyle = 'rgba(41,173,255,.95)'; ctx.lineWidth = 3; ctx.stroke();
  }
  const bw = 54, by = Math.round(y + 21 * DERBY.CAR_SCALE);
  drawBars(x - bw / 2, by + 1, bw, 6, p.hp, 2);
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
    text(`${Math.min(r.laps, car.lapsDone + 1)}/${r.laps}`, 26, 46, 22);
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
    const P = car.phys || PHYS, frac = Math.min(1, Math.abs(car.fwd) / P.maxSpeed);
    const kmh = Math.round(Math.abs(car.fwd) * P.kmh);
    text(String(kmh).padStart(3, '0'), sx + 14, sy + 16, 22, car.surface === 2 ? '#ffa300' : '#fff1e8');
    text('KM/H', sx + sw - 70, sy + 24, 10, '#ffec27');
    if (car.turbo && r.frame % 20 < 14) text('TURBO', sx + sw - 14, sy + 8, 8, '#ffa300', 'right');
    else if (P === F1) text('F1', sx + sw - 14, sy + 8, 8, '#83769c', 'right');
    const bw = sw - 28;
    ctx.fillStyle = '#000'; ctx.fillRect(sx + 14, sy + 46, bw, 6);
    ctx.fillStyle = car.turbo ? '#ffa300' : frac > 0.88 ? '#ff004d' : '#00e436';
    ctx.fillRect(sx + 14, sy + 46, Math.round(bw * frac), 6);
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
    text(o.fin ? 'META' : `V${Math.min(r.laps, o.lp + 1)}`, 220, ly + 11 + i * 18, 8, o.fin ? '#00e436' : '#83769c', 'right');
  });

  drawOverlays(r, c);
}

// Vista baja (móvil en horizontal): la cuenta atrás se apila justo debajo de los botones de arriba
const shortView = () => VIEW_H < 560;

// Semáforo de salida: 5 luces; se enciende una roja por segundo y al final todas verdes
function drawTrafficLight(lit, green) {
  const rad = shortView() ? 15 : compactHud() ? 17 : 20, gap = rad * 2 + 12, w = gap * 5 + 16, h = rad * 2 + 24;
  const x = Math.round(VIEW_W / 2 - w / 2), y = shortView() ? 98 : Math.round(VIEW_H / 2 - 135);   // por encima de la parrilla
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
    const low = shortView();
    text(r.t.def.name, VIEW_W / 2, low ? 52 : VIEW_H / 2 - 205, low ? 22 : 28, r.t.def.color, 'center', maxW);
    text(derby ? 'DEMOLICIÓN · ¡GANA EL ÚLTIMO EN PIE!' : r.t.def.real ? `${r.t.def.country} · FÓRMULA 1 · ${r.laps} VUELTAS` : `DIFICULTAD ${r.t.def.diff} · ${r.laps} VUELTAS`,
      VIEW_W / 2, low ? 80 : VIEW_H / 2 - 165, low ? 10 : 12, '#fff1e8', 'center', maxW);
    drawTrafficLight(lightsOn(), false);
    if (car && car.model) text(`TU COCHE: ${carById(car.model).name}`, VIEW_W / 2, low ? 166 : VIEW_H / 2 - 56, low ? 8 : 9, '#ffec27', 'center', maxW);
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
    text(`VIDA ${fmtBars(hp)}/${DERBY.START_HP}`, 26, 26, 10, '#ffec27');
    if (me.al && me.sh > 0) text(`ESCUDO ${Math.ceil(me.sh / 1000)}s`, 12 + bw - 14, 26, 8, '#29adff', 'right');
    drawBars(26, 46, bw - 28, 26, hp, 4);
    if (!me.al) text('K.O.', 12 + bw / 2, 50, 16, '#ff004d', 'center');
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
    if (o.al) drawBars(176, ly + 12 + i * 18, 44, 7, o.hp, 1);
    else text('K.O.', 220, ly + 11 + i * 18, 8, '#ff004d', 'right');
  });

  if (me && !me.al && snap.ph === 'playing') {
    text('ELIMINADO · MIRANDO LA PARTIDA', VIEW_W / 2, VIEW_H - (IS_TOUCH ? 60 : 110), 10, '#ff004d', 'center', VIEW_W - 24);
  }
  drawOverlays(r, c);
}

// ---------- Resultados ----------
// Barritas de vida en HTML (tabla de resultados)
function barsHtml(hp) {
  let h = `<span class="bars" style="--bc:${hpColor(hp)}">`;
  for (let i = 0; i < DERBY.START_HP; i++) h += `<i class="${hp - i >= 1 ? 'full' : hp - i > 0 ? 'half' : ''}"></i>`;
  return h + `</span> ${fmtBars(hp)}`;
}

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
      tr.innerHTML = name + `<td>${p.al ? barsHtml(p.hp) : 'ELIMINADO'}</td><td>${p.ko || 0}</td>`;
    } else {
      const nl = s.nl || LAPS, time = p.fin ? fmtMs(p.t) : `VUELTA ${Math.min(nl, p.lp + 1)}/${nl}`;
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

// Miniatura al estilo de los mapas oficiales de la F1: fondo negro y trazado de color
function drawRealPreview(cv, t) {
  const c = cv.getContext('2d');
  const bw = t.bounds.maxX - t.bounds.minX, bh = t.bounds.maxY - t.bounds.minY, pad = 16;
  const scale = Math.min((cv.width - 2 * pad) / bw, (cv.height - 2 * pad) / bh);
  const ox = t.bounds.minX - (cv.width / scale - bw) / 2, oy = t.bounds.minY - (cv.height / scale - bh) / 2;
  c.fillStyle = '#0b0b10';
  c.fillRect(0, 0, cv.width, cv.height);
  c.lineJoin = c.lineCap = 'round';
  c.lineWidth = 9; c.strokeStyle = '#2a2a33'; tracePath(c, t, ox, oy, scale); c.stroke();
  c.lineWidth = 3; c.strokeStyle = t.def.color; tracePath(c, t, ox, oy, scale); c.stroke();
  // puente: el tramo de arriba se repinta encima
  for (const cr of t.crossings) {
    c.beginPath();
    for (let k = -cr.B; k <= cr.B; k++) { const i = (cr.up + k + t.N) % t.N; const X = (t.xs[i] - ox) * scale, Y = (t.ys[i] - oy) * scale; k === -cr.B ? c.moveTo(X, Y) : c.lineTo(X, Y); }
    c.lineWidth = 9; c.strokeStyle = '#2a2a33'; c.stroke();
    c.lineWidth = 3; c.strokeStyle = t.def.color; c.stroke();
  }
  c.save();
  c.translate((t.xs[0] - ox) * scale, (t.ys[0] - oy) * scale);
  c.rotate(t.dir[0]);
  c.fillStyle = '#fff1e8'; c.fillRect(-2, -7, 4, 14);
  c.restore();
}

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
  built.filter(t => !t.def.real).forEach((t, i) => {
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
      ${t.crossings.length ? '<span class="stat">CRUCE CON <b>PUENTE</b></span>' : ''}
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
      <span class="stat">VIDA <b>${DERBY.START_HP} BARRITAS</b> · GOLPE SUAVE <b>-MEDIA</b> · FUERTE <b>-1</b></span>
      <span class="stat">BOTIQUÍN <b>+${DERBY.HEAL} BARRITA</b> CADA <b>${DERBY.HEAL_EVERY / 1000}s</b></span>
      <span class="stat">ESCUDO <b>${DERBY.SHIELD_MS / 1000}s</b> CADA <b>${DERBY.SHIELD_EVERY / 1000}s</b> · <b>¡ÚLTIMO EN PIE GANA!</b></span>
      <span class="votes" hidden></span>`;
    drawArenaPreview(btn.querySelector('canvas'), a);
    btn.addEventListener('click', () => onCardClick(a.id));
    list.appendChild(btn);
    cards.set(a.id, { btn, votes: btn.querySelector('.votes'), record: null });
  });
  // Pistas reales a escala (Fórmula 1)
  const real = $('realList');
  real.innerHTML = '';
  built.filter(t => t.def.real).forEach(t => {
    const d = t.def;
    const btn = document.createElement('button');
    btn.className = 'track real';
    btn.style.setProperty('--c', d.color);
    btn.innerHTML = `
      <span class="diff">${d.diff} <span class="stars">${'★'.repeat(d.stars)}${'☆'.repeat(5 - d.stars)}</span></span>
      <canvas width="260" height="170"></canvas>
      <span class="tname">${d.name}</span>
      <span class="stat">${d.country} · <b>${(d.lengthM / 1000).toFixed(3).replace('.', ',')} KM</b> · <b>${d.turns} CURVAS</b></span>
      <span class="stat">FÓRMULA 1 · <b>500 KM/H</b> · <b>${REAL_LAPS} VUELTAS</b>${d.walls ? ' · <b>MUROS</b>' : ''}</span>
      <span class="stat">${t.crossings.length ? 'CRUCE REAL CON <b>PUENTE</b> · ' : ''}PASARELAS: <b>${t.gantries.length}</b></span>
      <span class="stat record">TU RÉCORD: <b></b></span>
      <span class="votes" hidden></span>`;
    drawRealPreview(btn.querySelector('canvas'), t);
    btn.addEventListener('click', () => onCardClick(d.id));
    real.appendChild(btn);
    cards.set(d.id, { btn, votes: btn.querySelector('.votes'), record: btn.querySelector('.record b') });
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
    li.innerHTML = `<span><span class="dot" style="background:${esc(p.c)}"></span><span class="pname">${esc(p.n)}</span> <span class="pcar">${carById(p.car).short}</span></span>` +
      `<span>${p.h ? '<span class="tag">HOST</span>' : ''}${voting ? (p.v ? ' ✔' : ' …') : ''}</span>`;
    ul.appendChild(li);
  }

  $('hostPanel').hidden = !isHost;
  if (renderLobby.shownCar !== myCar) {                     // mi coche (solo se redibuja si cambia)
    renderLobby.shownCar = myCar;
    drawCarPreview($('myCarCanvas'), myCar);
    $('myCarName').textContent = carById(myCar).name;
  }
}

// ---------- Garaje: pantalla de selección de coche ----------
function buildGarage() {
  const list = $('carList');
  list.innerHTML = '';
  for (const m of CARS) {
    const b = document.createElement('button');
    b.className = 'carcard';
    b.dataset.id = m.id;
    b.innerHTML = `
      <canvas width="240" height="130"></canvas>
      <span class="cname">${m.name}</span>
      <span class="cdesc">${m.desc}</span>
      <span class="csel">ELEGIDO</span>`;
    drawCarPreview(b.querySelector('canvas'), m.id);
    b.addEventListener('click', () => chooseCar(m.id));
    b.addEventListener('dblclick', () => { chooseCar(m.id); closeGarage(); });
    list.appendChild(b);
  }
  renderGarage();
}

function renderGarage() {
  for (const b of document.querySelectorAll('.carcard')) b.classList.toggle('sel', b.dataset.id === myCar);
}

function chooseCar(id) {
  myCar = carById(id).id;
  store.set('8bits-racing.car', myCar);
  if (joined) send({ t: 'car', car: myCar });
  sound.beep(660, 0.06);
  renderGarage();
  const sel = document.querySelector('.carcard.sel');
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function openGarage() { garageOpen = true; if (snap) onSnapshot(snap); }
function closeGarage() { garageOpen = false; sound.beep(880, 0.08); if (snap) onSnapshot(snap); }

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
  const inRace = s.ph === 'loading' || s.ph === 'countdown' || s.ph === 'playing' || s.ph === 'ended';

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
      if (!isF1()) o.model = carById(p.car).id;
      if (race.t.crossings && race.t.crossings.length) o.lvl = levelAt(race.t, ((Math.round(p.pg) % race.t.N) + race.t.N) % race.t.N);
      o.tb = !!p.tb;                                              // con turbo
      o.vx = (p.x - (o.tx ?? p.x)) / 2;
      o.vy = (p.y - (o.ty ?? p.y)) / 2;
      o.tx = p.x; o.ty = p.y; o.ta = p.a;
    }
    for (const id of race.remotes.keys()) if (!seen.has(id)) race.remotes.delete(id);
  }

  // Sin nombre no se entra ni a la sala ni a ningún mapa (tampoco el host).
  // Tras poner el nombre sale el garaje (elegir coche); desde la sala se puede volver.
  const inThisRace = s.p.some(p => p.id === myId && p.ig);
  if (inThisRace) garageOpen = false;
  if (!joined) showScreen('join');
  else if (inRace && (inThisRace || !garageOpen)) showScreen('game');
  else if (garageOpen) showScreen('garage');
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
  document.body.classList.toggle('loading', s.ph === 'loading');
}

// Eventos del modo demolición: daño, bloqueos, curas, escudos, K.O. y objetos nuevos
function derbyEvent(e) {
  const at = id => (id === myId ? race.car : race.remotes.get(id));
  const o = e.id != null ? at(e.id) : null;
  const mine = e.id === myId;
  switch (e.k) {
    case 'dmg':
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, e.d < 1 ? '-MEDIA BARRITA' : `-${e.d} BARRITA`, '#ff004d', e.d >= DERBY.HIT_HARD ? 16 : 11);
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
      if (o) fx(o.x, o.y - 32 * DERBY.CAR_SCALE, `+${e.d} BARRITA`, '#00e436', 14);
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
      if (myName) send({ t: 'join', name: myName, car: myCar });      // reconexión
    } else if (m.t === 'joined') {
      if (!hadJoined) garageOpen = true;                 // recién entrado: a elegir coche
      hadJoined = true;
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
  send({ t: 'join', name: myName, car: myCar });
});
$('btnGarage').addEventListener('click', openGarage);
$('btnGarageDone').addEventListener('click', closeGarage);
buildGarage();
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
