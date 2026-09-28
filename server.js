// ============================================================
//  8 BITS RACING - Servidor (host del profesor)
//  Carreras de 4 vueltas. Con 1-2 jugadores la pista la elige el
//  host; con 3 o más se elige por votación.
//  Cada navegador simula su propio coche y manda su posición; el
//  servidor coordina la sala, la votación, la salida y la llegada.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const { TRACKS } = require('./public/tracks.js');

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

const TRACK_IDS = TRACKS.map(t => t.id);

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
let track = null;            // id de la pista de la carrera actual
let raceId = 0;
let firstFinish = 0;         // momento en que llegó el primero
let finishCount = 0;
let results = null;
let nextId = 1;
let colorIdx = 0;
let hostAssigned = false;    // true mientras haya un host conectado

function setPhase(p) { phase = p; phaseStart = Date.now(); }
const joinedPlayers = () => [...players.values()].filter(p => p.joined);
const racers = () => [...players.values()].filter(p => p.inGame);

function startCountdown(trackId) {
  const joined = joinedPlayers();
  if (!joined.length || !TRACK_IDS.includes(trackId)) return;
  track = trackId;
  raceId++;
  firstFinish = 0;
  finishCount = 0;
  results = null;
  // Parrilla en orden aleatorio
  const order = joined.sort(() => Math.random() - 0.5);
  order.forEach((p, i) => Object.assign(p, {
    inGame: true, grid: i, x: 0, y: 0, a: 0, pg: -1e9, lp: 0,
    finished: false, finishTime: null, place: 0, best: null,
  }));
  for (const p of players.values()) p.vote = null;
  setPhase('countdown');
  console.log(`  > Carrera en ${TRACKS.find(t => t.id === trackId).name} con ${order.length} jugador(es)`);
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
  const list = racers().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.pg - a.pg;
  });
  results = list.map((p, i) => ({
    n: p.name, c: p.color, id: p.id, pos: i + 1,
    fin: p.finished, t: p.finishTime, lp: p.lp, best: p.best,
  }));
  setPhase('ended');
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
  if (phase === 'countdown' && t >= COUNTDOWN_MS) setPhase('playing');
  if (phase === 'countdown' || phase === 'playing') {
    const rs = racers();
    if (!rs.length) { backToLobby(); return; }
    if (phase === 'playing' && (rs.every(p => p.finished) ||
        (firstFinish && now - firstFinish >= FINISH_TIMEOUT))) endRace();
  }
  if (phase === 'ended' && t >= END_SCREEN_MS) backToLobby();
}

function snapshot() {
  const now = Date.now();
  const t = now - phaseStart;
  let left = 0;
  if (phase === 'voting') left = VOTE_MS - t;
  else if (phase === 'countdown') left = COUNTDOWN_MS - t;
  else if (phase === 'ended') left = END_SCREEN_MS - t;
  else if (phase === 'playing' && firstFinish) left = FINISH_TIMEOUT - (now - firstFinish);
  return JSON.stringify({
    t: 's',
    ph: phase,
    left: Math.max(0, Math.round(left)),
    rt: phase === 'playing' ? t : 0,
    rid: raceId,
    tr: track,
    votes: phase === 'voting' ? voteCounts() : null,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, n: p.name, c: p.color, h: p.isHost, ig: p.inGame, v: !!p.vote,
      ...(p.inGame ? {
        g: p.grid, x: p.x, y: p.y, a: p.a, pg: p.pg, lp: p.lp,
        fin: p.finished, ft: p.finishTime, pl: p.place,
      } : {}),
    })),
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
  // despliegue online no hay "localhost", así que el primer jugador que
  // se conecta mientras no haya host asignado pasa a serlo.
  const isHost = isLocalhost || !hostAssigned;
  if (isHost) hostAssigned = true;
  const p = {
    id: nextId++, ws, name: '', joined: false, isHost,
    color: COLORS[colorIdx++ % COLORS.length],
    inGame: false, grid: 0, x: 0, y: 0, a: 0, pg: 0, lp: 0,
    finished: false, finishTime: null, place: 0, best: null, vote: null,
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
        console.log(`  + ${p.name} se ha unido (${addr.replace('::ffff:', '')})`);
        break;
      case 'pick':         // el host elige la pista (1-2 jugadores)
        if (p.isHost && phase === 'lobby' && joinedPlayers().length <= HOST_PICK_MAX) startCountdown(m.track);
        break;
      case 'voteStart':    // el host abre la votación (3 o más jugadores)
        if (p.isHost && phase === 'lobby' && joinedPlayers().length > HOST_PICK_MAX) startVoting();
        break;
      case 'vote':
        if (phase === 'voting' && p.joined && TRACK_IDS.includes(m.track)) p.vote = m.track;
        break;
      case 'st':           // posición del coche de este jugador
        if (!p.inGame || m.rid !== raceId || (phase !== 'countdown' && phase !== 'playing')) return;
        p.x = Math.round(num(m.x) * 10) / 10;
        p.y = Math.round(num(m.y) * 10) / 10;
        p.a = Math.round(num(m.a) * 100) / 100;
        p.pg = Math.round(num(m.pg));
        if (!p.finished) p.lp = Math.max(0, Math.min(LAPS, Math.floor(num(m.lp))));
        if (typeof m.best === 'number' && m.best > 0) p.best = Math.round(m.best);
        break;
      case 'fin':          // ha cruzado la meta por última vez
        if (!p.inGame || p.finished || phase !== 'playing' || m.rid !== raceId) return;
        p.finished = true;
        p.lp = LAPS;
        p.finishTime = Date.now() - phaseStart;
        if (typeof m.best === 'number' && m.best > 0) p.best = Math.round(m.best);
        p.place = ++finishCount;
        if (!firstFinish) firstFinish = Date.now();
        events.push({ k: 'fin', n: p.name, c: p.color, pl: p.place });
        console.log(`  # ${p.name} llega ${p.place}º`);
        break;
      case 'stop':
        if (p.isHost && phase !== 'lobby') backToLobby();
        break;
    }
  });

  ws.on('close', () => {
    if (p.joined) console.log(`  - ${p.name} se ha desconectado`);
    if (p.isHost) hostAssigned = false;
    players.delete(p.id);
    // Si se va el host en un despliegue online, el siguiente conectado lo sustituye
    if (!hostAssigned) {
      const next = [...players.values()][0];
      if (next) {
        next.isHost = true;
        hostAssigned = true;
        if (next.ws.readyState === 1) next.ws.send(JSON.stringify({ t: 'host' }));
      }
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
