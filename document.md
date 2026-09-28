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

### 4.1b Pistas reales a escala y Fórmula 1

- `REAL_TRACKS` (en `tracks.js`): cada pista tiene sus `points` en coordenadas de la imagen del mapa oficial, `lengthM` (longitud real), `widthM` (ancho real), `runoff` (escapatoria en px; Bakú 8 = muros) y `car: 'f1'`. `buildTrack` escala el trazado para que la vuelta mida `lengthM · PX_PER_M` (5 px = 1 m) y redondea los picos del calco a un radio mínimo de 12 m.
- **Calco:** se hizo con scripts (en el scratchpad, no en el repo): un primer trazo a mano, luego cada punto se ajusta en perpendicular al centro de la línea de color del mapa (rojo/azul/amarillo), ignorando las cajas verdes de DRS y rosas del speed trap; en Bakú se usó seguimiento continuo de la línea porque hay tramos muy juntos. Después se comprobó superponiendo el trazado sobre la imagen original.
- **F1** (`F1` en `tracks.js`): punta 11,6 px/frame (500 km/h reales con `kmh = 43,2`), aceleración que cae al acercarse a la punta (`falloff`), frenada 0,12 px/frame² (~5 g), agarre lateral 0,08 px/frame² (~6 g): `turnRateFor` limita el giro a `latAcc / v`. `stepCar` usa `car.phys` (kart o F1) para todo.
- **Vueltas:** el servidor usa `raceLaps` = 2 en pistas reales (4 en el resto) y lo manda en la instantánea (`nl`).

### 4.1c Cruces con puente y pasarelas

- `buildTrack` detecta los cruces: pares de muestras lejanas en la vuelta cuyos ejes se cortan. El tramo de arriba es el más cercano al punto `def.over`; `B` = muestras a cada lado que ocupa el puente (según ancho, escapatoria y ángulo del cruce).
- **Nivel** de un coche: `levelAt(t, idx)` = 1 si está dentro del puente, 0 si no. Para los demás coches se calcula con su progreso (`pg`). Los coches de distinto nivel no chocan.
- **Dibujo:** coches de nivel 0 → tablero del puente (sprite pre-dibujado con barandillas, `renderDeck`) → coches de nivel 1. La sombra del puente se pinta en la pista.
- **Pasarelas** (pistas reales): 2 por pista, en los tramos más rectos lejos de la salida y de los cruces (`gantries`); se dibujan por encima de todos los coches.

### 4.1d Dibujo por bloques

Las pistas reales miden hasta ~11.000 × 6.000 px, y no caben en un lienzo. Las carreras usan bloques de 512 px (`makeTrackGfx`, `renderTile`) que se generan al entrar en pantalla (máx. 3 por frame, más un anillo alrededor para ir por delante) y se liberan los menos usados (máx. 36 en memoria). Cada bloque dibuja solo los tramos de pista que le tocan (`trackRuns`); las rayas discontinuas se alinean entre bloques con `lineDashOffset`. Las marcas de derrape se pintan en el bloque correspondiente. La arena de demolición sigue usando un solo lienzo.

### 4.2 Trazados con curvas circulares (`corners`)

Además de `points` (spline Catmull-Rom, curvas suaves pero con el radio variando), una pista puede definirse con `corners: [[x, y, radio], ...]`. `filletPath` une las esquinas con rectas y redondea cada una con un arco de circunferencia tangente a los dos tramos (radio constante). Dos esquinas de 90° separadas 2·radio forman una horquilla semicircular. DEMENCIA usa este sistema; con `points` sus horquillas quedaban en pico (35-47 px en el vértice y casi rectas al lado), poco realistas.

### 4.3 Salida, turbo y música

- **Semáforo:** `COUNTDOWN_MS = 5000` en el servidor; el cliente enciende `lightsOn()` = 1..5 luces rojas según `snap.left` y las pone verdes al pasar a `playing` (`drawTrafficLight`).
- **Turbo del último** (`updateTurbo`, solo carreras): si mi coche es el último y va más de `TURBO.on` muestras por detrás del de delante, `car.turbo` multiplica la velocidad punta (×1,3) y la aceleración (×1,5) en `stepCar`; se apaga a menos de `TURBO.off` muestras o al dejar de ser último. Se revisa en cada frame, también durante una caída. Se envía `tb` para que los demás vean las llamas.
- **Música** (`music` en `client.js`): chiptune original programado con Web Audio (secuenciador de semicorcheas con anticipación de 120 ms: bajo con quinta, melodía, bombo, caja y charles). Si el servidor tiene `public/music.mp3`, se reproduce ese archivo en bucle en su lugar (el servidor devuelve 404 si no existe). Se guarda en `localStorage` si está activada.

### 4.4 Peligros de pista (DEMENCIA)

Una pista puede definir `cliffs`, `oil`, `mud` y `pistons`. Se colocan con el índice de un punto de control y la fracción del camino hasta el siguiente, así no dependen de dónde caiga la meta. `buildTrack` los convierte en: `cliff` (por muestra: 0, -1 izquierda, 1 derecha, 2 ambos lados), y listas `oil`, `mud`, `pistons` con su posición.

- Todo se simula en el navegador de cada jugador (`trackHazards` en `client.js`), como el resto de la conducción; el servidor solo reenvía si un coche está cayendo (`fl`) para dibujarlo encogido en las otras pantallas.
- **Acantilado:** si el coche pasa más de `half + CURB + 2` del centro por un lado con acantilado, cae (`startFall`): 70 frames sin control y reaparece 14 muestras más atrás, parado, restando ese tramo del progreso.
- **Aceite:** `car.oil` 40 frames con el agarre lateral casi a cero y el volante al 35%, más un trompo (`car.spin`).
- **Barro:** fuerza `surface = 2` (se comporta como hierba).
- **Bloques:** `pistonPos(p, T)` (en `tracks.js`) da su posición según el tiempo de carrera, igual en todos los navegadores; chocan como un obstáculo circular que además empuja con su velocidad.
- Se dibujan en el pre-render de la pista (`drawTrackHazards`), salvo los bloques, que se mueven y se dibujan en cada frame.

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
- **Golpes:** cuando mi coche choca con otro, mi navegador mide mi velocidad hacia él (la conoce exacta) y manda `hit` con `HIT_SOFT` = 0,5 barritas (`< HARD_MIN`) o `HIT_HARD` = 1 barrita (`≥ HARD_MIN`). La vida (`hp`) se cuenta en barritas: `START_HP` = 5, siempre múltiplos de 0,5; el botiquín suma `HEAL` = 1. El cliente la dibuja con `drawBars` (marcador, bajo cada coche y clasificación) y `barsHtml` (resultados). Por debajo de `SOFT_MIN` no hay daño. Un golpe nuevo solo cuenta al empezar el contacto (hay que separarse antes), con 450 ms de pausa por rival. En un choque de frente cada uno informa de su golpe, así que los dos pierden vida. El servidor valida: partida de demolición en juego, los dos vivos, daño 0,5 o 1, coches a menos de 90 px y la misma pausa de 450 ms. Si el golpeado tiene escudo, se bloquea.
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
- `welcome`: id, si es host, IPs, vueltas, límite de pilotos para que elija el host. (Ser host no sirve de nada hasta unirse con nombre: el servidor exige `joined` para elegir, votar o terminar, y el cliente no enseña la sala ni los mapas sin nombre.)
- `joined`: nombre definitivo (sin repetir).
- `host`: pasas a ser host (online: eres el primero en unirte con nombre, o el anterior host se desconectó).
- `s` (30/s): fase, tiempo restante, id de carrera `rid`, pista, recuento de votos, pilotos (posición, vuelta, progreso, llegada), resultados y eventos (`voted`, `fin`).

## 6. Cómo modificar el juego

- **Número de vueltas**: `LAPS` en `server.js` (se envía a los clientes).
- **Regla host/votación**: `HOST_PICK_MAX` en `server.js`.
- **Nueva pista**: añade un objeto a `TRACKS` en `public/tracks.js` con `id`, `name`, `diff`, `color`, `width`, `theme` y `points`. Evita que dos tramos queden a menos de `width + 2·RUNOFF` de distancia.
- **Manejo del coche**: `PHYS` en `public/tracks.js`.
