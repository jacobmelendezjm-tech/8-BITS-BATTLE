# Arquitectura de 8 BITS RACING

## 1. Visión general

Juego de carreras multijugador para el aula, con un segundo modo de **demolición** (sección 4c). Un servidor Node.js (`server.js`) sirve la página y coordina la partida por WebSockets. Cada navegador **simula su propio coche** a 60 pasos por segundo y envía su posición al servidor 30 veces por segundo; el servidor reenvía el estado de todos a todos.

Así la conducción es inmediata aunque haya latencia (importante en el modo online Vercel + Render). A cambio, el servidor confía en lo que dice cada cliente, algo aceptable en un aula.

## 2. Archivos del proyecto

| Archivo | Qué hace |
|---|---|
| `server.js` | Servidor HTTP + WebSocket: sala, host, elección/votación de pista, salida, llegada y resultados |
| `public/tracks.js` | Definición de las 3 pistas, spline, física compartida (`PHYS`) y localización del coche en la pista. Lo usan el navegador y el servidor |
| `public/client.js` | Pantallas (entrada, sala, carrera), física del coche propio, dibujo, HUD, controles (teclado y táctiles), sonido, red |
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

### 4.1 Salida y parrilla

`buildTrack` coloca la línea de meta (muestra 0) en el tramo más recto de la pista: busca la ventana de 75 muestras antes y 25 después con menos giro acumulado. Así la parrilla (hasta 12 coches, ~60 muestras detrás de la meta) y el arranque quedan en recta, sea cual sea el primer punto de control.

## 4b. Móviles y tablets

- `client.js` detecta pantalla táctil con `matchMedia('(pointer: coarse)')` y añade la clase `touch` al `<body>`.
- En móvil el canvas ocupa toda la pantalla y su tamaño lógico se adapta: en horizontal 440 px de alto, en vertical 480 px de ancho (`resizeView`). El marcador se recoloca: en móvil el minimapa y el velocímetro van en la columna derecha, porque abajo están los controles.
- **Flechas ← →** estilo PlayStation (izquierda): solo giran; digitales, como las teclas. Las dos flechas siguen al mismo dedo (mitad izquierda = ←, mitad derecha = →, el hueco del centro no activa nada), así que se puede deslizar el pulgar de una a otra. **Botones A/B** (derecha): acelerar y frenar. Cada control sigue a su propio dedo (Pointer Events + `setPointerCapture`), así que se puede girar y acelerar a la vez. El teclado sigue funcionando y se mezcla con lo táctil (`playerControl`).
- Los controles se ocultan en modo espectador y con la tabla de resultados.
- **Pantalla completa:** se pone sobre todo el documento (`document.documentElement`), para que sigan visibles los resultados y los botones. En móvil se pide sola al entrar; además hay un botón en la carrera y la tecla F. La clase `fill` del `<body>` (móvil, u ordenador a pantalla completa) activa la vista a toda pantalla y el tamaño lógico adaptable; `is-fs` cambia el icono y el texto del botón. Se escucha `fullscreenchange` para reaccionar también cuando se sale con Esc o con el gesto de atrás. En Safari de iPhone no hay API de pantalla completa y el botón se oculta.
- El margen del mapa pre-renderizado depende del tamaño de la vista, para que la cámara pueda centrar el coche también en vertical. En la pista extrema el lienzo llega a ~4100×2700 px, por debajo del límite de 16,7 M píxeles de Safari en iOS.

## 4c. Modo demolición (estilo Wreckfest)

- La arena (`ARENAS` en `tracks.js`) es una elipse con pilares circulares. `arenaCollide` mantiene los coches dentro y fuera de los pilares; `arenaSpawn` reparte la salida por el borde mirando al centro, con el giro del anillo que deja más libre el camino recto al centro (`ringOffset`).
- **Quién manda:** el servidor lleva la vida, los K.O., los botiquines y los escudos. Cada navegador sigue simulando solo su coche.
- **Golpes:** cuando mi coche choca con otro, mi navegador mide mi velocidad hacia él (la conoce exacta) y manda `hit` con 5 (`< HARD_MIN`) o 20 (`≥ HARD_MIN`). Por debajo de `SOFT_MIN` no hay daño. Un golpe nuevo solo cuenta al empezar el contacto (hay que separarse antes), con 450 ms de pausa por rival. En un choque de frente cada uno informa de su golpe, así que los dos pierden vida. El servidor valida: partida de demolición en juego, los dos vivos, daño 5 o 20, coches a menos de 90 px y la misma pausa de 450 ms. Si el golpeado tiene escudo, se bloquea.
- **Tamaño:** en la arena los coches se dibujan y chocan un 50% más grandes (`DERBY.CAR_SCALE`, `carScale()`/`carR()` en el cliente): radio de choque 19,5 px en vez de 13. El radio para recoger objetos (`PICK_R`) se subió a 46 px en consonancia.
- **Empujones:** en demolición, al chocar también me empuja la velocidad (estimada) del otro coche, así que a quien embisten sale despedido.
- **Objetos:** el servidor rellena botiquines cada 30 s y escudos cada 40 s hasta tener 1 por cada 2 vivos (mínimo 1), en sitios libres de la arena. Se recogen en el servidor con la última posición de cada coche (radio `PICK_R`).
- **Fin:** queda 1 vivo (o ninguno), o se acaban los 3 minutos. Clasificación: vivos por vida; después, eliminados del último en caer al primero.
- **Mensajes nuevos:** cliente→servidor `hit` (`rid, target, dmg`). En la instantánea: `md` (modo), por jugador `hp, al, ko, kt, sh`, y `pk` (objetos), `nh`/`ns` (ms hasta los próximos). Eventos: `dmg`, `block`, `heal`, `shield`, `ko`, `spawn`.

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
