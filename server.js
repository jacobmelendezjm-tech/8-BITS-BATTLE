// ============================================================
//  8 BITS RACING - Servidor (host del profesor)
//  Carreras de 4 vueltas o modo DEMOLICIÓN (arena, último en pie).
//  Con 1-2 jugadores la pista/arena la elige el host; con 3 o más
//  se elige por votación.
//  Cada navegador simula su propio coche y manda su posición; el
//  servidor coordina la sala, la votación, la salida y la llegada.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const { TRACKS, ARENAS, DERBY, arenaInside } = require('./public/tracks.js');

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 30;          // 30 actualizaciones por segundo
const LAPS = 4;
const HOST_PICK_MAX = 2;            // hasta 2 jugadores elige el host; más, votación
const VOTE_MS = 15000;              // duración de la votación
const COUNTDOWN_MS = 4000;          // 1 s mostrando la pista + 3, 2, 1
const FINISH_TIMEOUT = 45000;       // tras el primero en llegar, el resto tiene 45 s
const END_SCREEN_MS = 12000;
const NAME_MAX = 12;

const TRACK_IDS = [...TRACKS, ...ARENAS].map(t => t.id);
const isArena = id => ARENAS.some(a => a.id === id);
const placeName = id => [...TRACKS, ...ARENAS].find(t => t.id === id).name;

// Paleta tipo 8 bits para los coches
const COLORS = [
  '#ffec27', '#ff004d', '#29adff', '#00e436', '#ff77a8', '#ffa300',
  '#83769c', '#ffccaa', '#00b3a4', '#c2c3c7', '#ab5236', '#7e2553',
];

// ---------- Utilidades de red ----------
const VIRTUAL_IF = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier/i;
let mainIP = null;           // IP de la tarjeta que sale a la red del aula

// Averigua qué IP usa el sistema para salir a la red (no envía ningún paquete)
function detectMainIP() {
  const sock = dgram.createSocket('udp4');
  sock.on('error', () => sock.close());
  sock.connect(53, '8.8.8.8', () => {
    try { mainIP = sock.address().address; } catch {}
    sock.close();
  });
}

function lanIPs() {
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IF.test(name)) continue;
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  if (mainIP && ips.includes(mainIP)) return [mainIP];
  return ips;
}

function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, NAME_MAX);
  if (!n) n = 'Jugador';
  const taken = new Set([...players.values()].filter(p => p.joined).map(p => p.name.toLowerCase()));
  let final = n, i = 2;
  while (taken.has(final.toLowerCase())) final = `${n.slice(0, NAME_MAX - 2)}${i++}`;
  return final;
}

const num = (v, def = 0) => (typeof v === 'number' && isFinite(v) ? v : def);

// ---------- Estado del juego ----------
const players = new Map();   // id -> jugador
let events = [];             // eventos de este tick
let phase = 'lobby';         // lobby | voting | countdown | playing | ended
let phaseStart = Date.now();
let track = null;            // id de la pista (o arena) de la partida actual
let mode = 'race';           // race | derby
let pickups = [];            // demolición: botiquines y escudos en la arena
let nextPickupId = 1;
let nextHealAt = 0, nextShieldAt = 0;
const hitCd = new Map();     // demolición: pausa entre golpes del mismo atacante al mismo rival
let raceId = 0;
let firstFinish = 0;         // momento en que llegó el primero
let finishCount = 0;
let results = null;
let nextId = 1;
let colorIdx = 0;

function setPhase(p) { phase = p; phaseStart = Date.now(); }
const joinedPlayers = () => [...players.values()].filter(p => p.joined);
const hasHost = () => [...players.values()].some(p => p.isHost);

// Da el puesto de host a p (online: al primero que se une con su nombre)
function makeHost(p) {
  p.isHost = true;
  if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'host' }));
}
const racers = () => [...players.values()].filter(p => p.inGame);

function startCountdown(trackId) {
  const joined = joinedPlayers();
  if (!joined.length || !TRACK_IDS.includes(trackId)) return;
  track = trackId;
  mode = isArena(trackId) ? 'derby' : 'race';
  pickups = [];
  hitCd.clear();
  raceId++;
  firstFinish = 0;
  finishCount = 0;
  results = null;
  // Parrilla en orden aleatorio
  const order = joined.sort(() => Math.random() - 0.5);
  order.forEach((p, i) => Object.assign(p, {
    inGame: true, grid: i, x: 0, y: 0, a: 0, pg: -1e9, lp: 0,
    finished: false, finishTime: null, place: 0, best: null,
    hp: DERBY.START_HP, alive: true, kills: 0, shieldUntil: 0, koTime: null,
  }));
  for (const p of players.values()) p.vote = null;
  setPhase('countdown');
  console.log(`  > ${mode === 'derby' ? 'Demolición' : 'Carrera'} en ${placeName(trackId)} con ${order.length} jugador(es)`);
}

function startVoting() {
  for (const p of players.values()) p.vote = null;
  setPhase('voting');
}

function voteCounts() {
  const c = Object.fromEntries(TRACK_IDS.map(id => [id, 0]));
  for (const p of joinedPlayers()) if (p.vote) c[p.vote]++;
  return c;
}

function closeVoting() {
  const c = voteCounts();
  const max = Math.max(...Object.values(c));
  const tied = TRACK_IDS.filter(id => c[id] === max);   // si nadie vota, empatan todas
  const winner = tied[Math.floor(Math.random() * tied.length)];
  events.push({ k: 'voted', track: winner, tie: tied.length > 1 && max > 0 });
  startCountdown(winner);
}

function endRace() {
  let list;
  if (mode === 'derby') {
    // Vivos primero (más vida delante); luego eliminados, el último en caer delante
    list = racers().sort((a, b) => (b.alive - a.alive) || (a.alive ? b.hp - a.hp : b.koTime - a.koTime));
  } else {
    list = racers().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.pg - a.pg;
    });
  }
  results = list.map((p, i) => ({
    n: p.name, c: p.color, id: p.id, pos: i + 1,
    fin: p.finished, t: p.finishTime, lp: p.lp, best: p.best,
    hp: p.hp, ko: p.kills, al: p.alive,
  }));
  pickups = [];
  setPhase('ended');
}

// ---------- Demolición: botiquines, escudos y golpes ----------
function pickupCount() {
  const alive = racers().filter(p => p.alive).length;
  return Math.max(1, Math.floor(alive / DERBY.PER_PLAYERS));
}

// Añade objetos de un tipo hasta que haya "n" en la arena
function spawnPickups(kind, n) {
  const a = ARENAS.find(x => x.id === track);
  const cars = racers().filter(p => p.alive);
  let added = 0;
  while (pickups.filter(k => k.k === kind).length < n) {
    let spot = null;
    for (let tries = 0; tries < 60 && !spot; tries++) {
      const x = a.cx + (Math.random() * 2 - 1) * a.rx, y = a.cy + (Math.random() * 2 - 1) * a.ry;
      if (!arenaInside(a, x, y, 110)) continue;
      if (pickups.some(k => Math.hypot(k.x - x, k.y - y) < 170)) continue;
      if (cars.some(p => Math.hypot(p.x - x, p.y - y) < 90)) continue;
      spot = { x, y };
    }
    if (!spot) break;
    pickups.push({ id: nextPickupId++, k: kind, x: spot.x, y: spot.y });
    added++;
  }
  if (added) events.push({ k: 'spawn', kind, n: added });
}

function updateDerby(now, t) {
  const rs = racers();
  const alive = rs.filter(p => p.alive);
  if (now >= nextHealAt) { spawnPickups('hp', pickupCount()); nextHealAt += DERBY.HEAL_EVERY; }
  if (now >= nextShieldAt) { spawnPickups('sh', pickupCount()); nextShieldAt += DERBY.SHIELD_EVERY; }

  // Recoger objetos (con la última posición que ha mandado cada coche)
  for (const p of alive) {
    for (const k of [...pickups]) {
      if (Math.hypot(p.x - k.x, p.y - k.y) > DERBY.PICK_R) continue;
      if (k.k === 'hp') {
        if (p.hp >= DERBY.START_HP) continue;           // con la vida llena no lo gasta
        p.hp = Math.min(DERBY.START_HP, p.hp + DERBY.HEAL);
        events.push({ k: 'heal', id: p.id, d: DERBY.HEAL });
      } else {
        p.shieldUntil = now + DERBY.SHIELD_MS;
        events.push({ k: 'shield', id: p.id });
      }
      pickups = pickups.filter(x => x !== k);
    }
  }

  // Fin: queda uno (o ninguno), o se acaba el tiempo
  if ((rs.length >= 2 && alive.length <= 1) || alive.length === 0 || t >= DERBY.TIME) endRace();
}

// Un coche dice que ha golpeado a otro. El daño lo decide el servidor.
function derbyHit(p, m) {
  if (mode !== 'derby' || phase !== 'playing' || m.rid !== raceId || !p.inGame || !p.alive) return;
  const v = players.get(m.target);
  if (!v || v === p || !v.inGame || !v.alive) return;
  const dmg = m.dmg === DERBY.HIT_HARD ? DERBY.HIT_HARD : m.dmg === DERBY.HIT_SOFT ? DERBY.HIT_SOFT : 0;
  if (!dmg) return;
  if (Math.hypot(p.x - v.x, p.y - v.y) > 90) return;     // demasiado lejos para ser un choque
  const now = Date.now(), key = p.id + '>' + v.id;
  if ((hitCd.get(key) || 0) > now) return;
  hitCd.set(key, now + 450);
  if (v.shieldUntil > now) { events.push({ k: 'block', id: v.id }); return; }
  v.hp = Math.max(0, v.hp - dmg);
  events.push({ k: 'dmg', id: v.id, by: p.id, d: dmg });
  if (v.hp <= 0) {
    v.alive = false;
    v.koTime = now - phaseStart;
    p.kills++;
    events.push({ k: 'ko', id: v.id, n: v.name, c: v.color, by: p.id, bn: p.name });
    console.log(`  x ${p.name} deja K.O. a ${v.name}`);
  }
}

function backToLobby() {
  for (const p of players.values()) { p.inGame = false; p.vote = null; }
  results = null;
  setPhase('lobby');
}

function update() {
  const now = Date.now();
  const t = now - phaseStart;

  if (phase === 'voting') {
    const joined = joinedPlayers();
    if (joined.length <= HOST_PICK_MAX) { setPhase('lobby'); return; }   // se fue gente: vuelve a elegir el host
    if (t >= VOTE_MS || joined.every(p => p.vote)) closeVoting();
  }
  if (phase === 'countdown' && t >= COUNTDOWN_MS) {
    setPhase('playing');
    nextHealAt = phaseStart + DERBY.HEAL_EVERY;
    nextShieldAt = phaseStart + DERBY.SHIELD_EVERY;
  }
  if (phase === 'countdown' || phase === 'playing') {
    const rs = racers();
    if (!rs.length) { backToLobby(); return; }
    if (phase === 'playing' && mode === 'derby') updateDerby(now, now - phaseStart);
    else if (phase === 'playing' && (rs.every(p => p.finished) ||
        (firstFinish && now - firstFinish >= FINISH_TIMEOUT))) endRace();
  }
  // Ojo: "t" se calculó antes de que endRace() cambiase de fase; aquí hay que
  // medir desde el inicio de la pantalla de resultados, o se saltaría entera.
  if (phase === 'ended' && now - phaseStart >= END_SCREEN_MS) backToLobby();
}

function snapshot() {
  const now = Date.now();
  const t = now - phaseStart;
  let left = 0;
  if (phase === 'voting') left = VOTE_MS - t;
  else if (phase === 'countdown') left = COUNTDOWN_MS - t;
  else if (phase === 'ended') left = END_SCREEN_MS - t;
  else if (phase === 'playing' && mode === 'derby') left = DERBY.TIME - t;
  else if (phase === 'playing' && firstFinish) left = FINISH_TIMEOUT - (now - firstFinish);
  return JSON.stringify({
    t: 's',
    ph: phase,
    left: Math.max(0, Math.round(left)),
    rt: phase === 'playing' ? t : 0,
    rid: raceId,
    tr: track,
    md: mode,
    votes: phase === 'voting' ? voteCounts() : null,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, n: p.name, c: p.color, h: p.isHost, ig: p.inGame, v: !!p.vote,
      ...(p.inGame ? {
        g: p.grid, x: p.x, y: p.y, a: p.a, pg: p.pg, lp: p.lp, fl: p.fl ? 1 : 0,
        fin: p.finished, ft: p.finishTime, pl: p.place,
        ...(mode === 'derby' ? {
          hp: p.hp, al: p.alive, ko: p.kills, kt: p.koTime,
          sh: Math.max(0, p.shieldUntil - now),
        } : {}),
      } : {}),
    })),
    ...(mode === 'derby' && phase === 'playing' ? {
      pk: pickups.map(k => [k.id, k.k, Math.round(k.x), Math.round(k.y)]),
      nh: Math.max(0, nextHealAt - now),
      ns: Math.max(0, nextShieldAt - now),
    } : {}),
    res: results,
    e: events,
  });
}

// ---------- Servidor HTTP (sirve el cliente) ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/tracks.js': ['tracks.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  const file = STATIC[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); return res.end('No encontrado'); }
  fs.readFile(path.join(__dirname, 'public', file[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSockets ----------
const wss = new WebSocketServer({ server, maxPayload: 1024 });

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress || '';
  const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
  // En LAN, el equipo del profesor (localhost) siempre es host. En un
  // despliegue online no hay "localhost": el host será el primero que se
  // una con su nombre (ver 'join'). Nadie puede hacer nada sin nombre.
  const isHost = isLocalhost;
  const p = {
    id: nextId++, ws, name: '', joined: false, isHost,
    color: COLORS[colorIdx++ % COLORS.length],
    inGame: false, grid: 0, x: 0, y: 0, a: 0, pg: 0, lp: 0,
    finished: false, finishTime: null, place: 0, best: null, vote: null,
    hp: 0, alive: false, kills: 0, shieldUntil: 0, koTime: null,
  };
  players.set(p.id, p);

  ws.send(JSON.stringify({
    t: 'welcome', id: p.id, isHost, ips: lanIPs(), port: PORT,
    laps: LAPS, hostPickMax: HOST_PICK_MAX,
  }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    switch (m.t) {
      case 'join':
        if (p.joined) return;
        p.name = cleanName(m.name);
        p.joined = true;
        ws.send(JSON.stringify({ t: 'joined', name: p.name }));
        if (!hasHost()) makeHost(p);
        console.log(`  + ${p.name} se ha unido (${addr.replace('::ffff:', '')})`);
        break;
      case 'pick':         // el host elige la pista (1-2 jugadores)
        if (p.isHost && p.joined && phase === 'lobby' && joinedPlayers().length <= HOST_PICK_MAX) startCountdown(m.track);
        break;
      case 'voteStart':    // el host abre la votación (3 o más jugadores)
        if (p.isHost && p.joined && phase === 'lobby' && joinedPlayers().length > HOST_PICK_MAX) startVoting();
        break;
      case 'vote':
        if (phase === 'voting' && p.joined && TRACK_IDS.includes(m.track)) p.vote = m.track;
        break;
      case 'st':           // posición del coche de este jugador
        if (!p.inGame || m.rid !== raceId || (phase !== 'countdown' && phase !== 'playing')) return;
        if (mode === 'derby' && !p.alive) return;            // eliminado: ya no se mueve
        p.x = Math.round(num(m.x) * 10) / 10;
        p.y = Math.round(num(m.y) * 10) / 10;
        p.a = Math.round(num(m.a) * 100) / 100;
        p.pg = Math.round(num(m.pg));
        p.fl = !!m.fl;                                  // cayendo por un acantilado
        if (!p.finished) p.lp = Math.max(0, Math.min(LAPS, Math.floor(num(m.lp))));
        if (typeof m.best === 'number' && m.best > 0) p.best = Math.round(m.best);
        break;
      case 'fin':          // ha cruzado la meta por última vez
        if (mode !== 'race' || !p.inGame || p.finished || phase !== 'playing' || m.rid !== raceId) return;
        p.finished = true;
        p.lp = LAPS;
        p.finishTime = Date.now() - phaseStart;
        if (typeof m.best === 'number' && m.best > 0) p.best = Math.round(m.best);
        p.place = ++finishCount;
        if (!firstFinish) firstFinish = Date.now();
        events.push({ k: 'fin', n: p.name, c: p.color, pl: p.place });
        console.log(`  # ${p.name} llega ${p.place}º`);
        break;
      case 'hit':          // demolición: mi coche ha golpeado a otro
        derbyHit(p, m);
        break;
      case 'stop':
        if (p.isHost && p.joined && phase !== 'lobby') backToLobby();
        break;
    }
  });

  ws.on('close', () => {
    if (p.joined) console.log(`  - ${p.name} se ha desconectado`);
    players.delete(p.id);
    // Si se queda sin host (online), lo sustituye el primero que ya tenga nombre
    if (!hasHost()) {
      const next = joinedPlayers()[0];
      if (next) makeHost(next);
    }
  });
});

// ---------- Bucle principal ----------
setInterval(() => {
  update();
  const msg = snapshot();
  events = [];
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}, TICK_MS);

detectMainIP();
setInterval(detectMainIP, 30000);

server.listen(PORT, '0.0.0.0', async () => {
  await new Promise(r => setTimeout(r, 300));   // da tiempo a detectar la IP principal
  const ips = lanIPs();
  console.log('\n  ==========================================');
  console.log('        8 BITS RACING  -  servidor listo');
  console.log('  ==========================================\n');
  console.log('  PROFESOR (host) abre en este equipo:');
  console.log(`     http://localhost:${PORT}\n`);
  console.log('  ALUMNOS abren en su navegador:');
  if (ips.length) ips.forEach(ip => console.log(`     http://${ip}:${PORT}`));
  else console.log('     (no se ha encontrado ninguna IP de red)');
  console.log('\n  Pulsa Ctrl+C para cerrar el servidor.\n');
});
