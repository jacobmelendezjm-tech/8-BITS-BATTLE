# Arquitectura de 8 BITS RACING

## 1. Visión general

Juego de carreras multijugador para el aula. Un servidor Node.js (`server.js`) sirve la página y coordina la partida por WebSockets. Cada navegador **simula su propio coche** a 60 pasos por segundo y envía su posición al servidor 30 veces por segundo; el servidor reenvía el estado de todos a todos.

Así la conducción es inmediata aunque haya latencia (importante en el modo online Vercel + Render). A cambio, el servidor confía en lo que dice cada cliente, algo aceptable en un aula.

## 2. Archivos del proyecto

| Archivo | Qué hace |
|---|---|
| `server.js` | Servidor HTTP + WebSocket: sala, host, elección/votación de pista, salida, llegada y resultados |
| `public/tracks.js` | Definición de las 3 pistas, spline, física compartida (`PHYS`) y localización del coche en la pista. Lo usan el navegador y el servidor |
| `public/client.js` | Pantallas (entrada, sala, carrera), física del coche propio, dibujo, HUD, sonido, red |
| `public/index.html`, `public/style.css` | Interfaz |
| `INICIAR.bat` | Instala Node si falta, instala dependencias y arranca el servidor |

## 3. Fases de la partida (servidor)

```
lobby ──(host elige, ≤2 pilotos)──────────────► countdown (4 s) ──► playing ──► ended (12 s) ──► lobby
  └──(host abre votación, ≥3 pilotos)──► voting (15 s o todos votan) ─┘
```

- **lobby**: los pilotos entran con su nombre. Con 1-2 pilotos el host hace clic en una pista (`pick`). Con 3 o más, el host abre la votación (`voteStart`).
- **voting**: cada piloto vota (`vote`, puede cambiarlo). Se cierra a los 15 s o cuando han votado todos. Gana la más votada; empates → sorteo. Si durante la votación quedan 2 pilotos o menos, se vuelve a `lobby` para que elija el host.
- **countdown**: el servidor asigna a cada piloto una casilla de la parrilla (orden aleatorio). El cliente muestra el nombre de la pista y 3, 2, 1.
- **playing**: cada cliente conduce y cuenta sus vueltas. Al completar 4 manda `fin`; el servidor guarda el tiempo y el puesto. Termina cuando todos llegan o 45 s después del primero.
- **ended**: tabla de resultados; los que no terminaron se ordenan por distancia recorrida.

## 4. Las pistas (`tracks.js`)

Cada pista es una lista de puntos de control. `buildTrack` los une con una spline **Catmull-Rom centrípeta** cerrada y la remuestrea cada 8 px. Para cada muestra calcula dirección, normal y curvatura, y a partir de ahí:

- **Número de curvas y curvas cerradas** (se muestran en las tarjetas de la sala).
- **Velocidad máxima recomendada**, usada por el piloto automático que conduce tu coche después de cruzar la meta.

La dificultad sube con el número de curvas, lo cerradas que son y el ancho de la pista (170 / 140 / 115 px).

`locate` busca la muestra más cercana al coche solo alrededor de la anterior, así un coche no puede "saltar" a otro tramo cercano de la pista. Con ello se calcula:
- la **superficie** (asfalto, piano o hierba, que frena mucho),
- el **muro** exterior, que devuelve el coche a la pista,
- el **progreso** (muestras recorridas); cada `N` muestras es una vuelta completa. Ir marcha atrás resta progreso, por lo que no se pueden hacer trampas cruzando la meta hacia atrás.

## 5. Protocolo de mensajes

### Cliente → servidor
| `t` | Datos | Quién |
|---|---|---|
| `join` | `name` | cualquiera |
| `pick` | `track` | host, en `lobby`, con ≤2 pilotos |
| `voteStart` | — | host, en `lobby`, con ≥3 pilotos |
| `vote` | `track` | piloto, en `voting` |
| `st` | `rid, x, y, a, pg, lp, best` | piloto en carrera (30/s) |
| `fin` | `rid, best` | piloto al completar 4 vueltas |
| `stop` | — | host: vuelve a la sala |

### Servidor → cliente
- `welcome`: id, si es host, IPs, vueltas, límite de pilotos para que elija el host.
- `joined`: nombre definitivo (sin repetir).
- `host`: pasas a ser host (el anterior se desconectó).
- `s` (30/s): fase, tiempo restante, id de carrera `rid`, pista, recuento de votos, pilotos (posición, vuelta, progreso, llegada), resultados y eventos (`voted`, `fin`).

## 6. Cómo modificar el juego

- **Número de vueltas**: `LAPS` en `server.js` (se envía a los clientes).
- **Regla host/votación**: `HOST_PICK_MAX` en `server.js`.
- **Nueva pista**: añade un objeto a `TRACKS` en `public/tracks.js` con `id`, `name`, `diff`, `color`, `width`, `theme` y `points`. Evita que dos tramos queden a menos de `width + 2·RUNOFF` de distancia.
- **Manejo del coche**: `PHYS` en `public/tracks.js`.
