# 8 BITS RACING

Juego de carreras de 8 bits para el aula. Cada alumno conduce su coche desde el navegador; el equipo del profesor hace de servidor por WebSockets. Tres tipos de partida: **carrera** en pistas inventadas con 5 coches a elegir (4 vueltas), **pistas reales a escala** con Fórmula 1 (2 vueltas) y **demolición** estilo Wreckfest (gana el último que quede en pie).

## Arrancar (equipo del profesor)
1. Doble clic en `INICIAR.bat` (o ejecuta `npm install` y después `npm start`).
2. Se abre `http://localhost:3000`. Escribe tu nombre para entrar como **host**; en esa misma pantalla aparece la dirección para los alumnos.
3. Los alumnos abren en su navegador `http://TU_IP:3000`, escriben su nombre, pulsan **¡A CORRER!** y eligen su coche en el **garaje**.

**Nadie entra a la sala ni a ningún mapa sin haberse unido con su nombre**, tampoco el host. Quien abre la página a mitad de una partida ve primero la pantalla de nombre.
4. Se elige la pista y empieza la carrera (ver abajo).

La primera vez, Windows pedirá permiso en el firewall para Node.js: marca **Redes privadas** y acepta.

## Elección de pista o arena
- **1 o 2 pilotos**: la pista la elige el host haciendo clic en una de las tarjetas.
- **3 o más pilotos**: el host pulsa **ABRIR VOTACIÓN**; cada piloto vota (puede cambiar su voto). La votación dura 15 s o termina antes si ya han votado todos. Gana la más votada; si hay empate, se sortea entre las empatadas.

## Garaje: elige tu coche
Nada más entrar con tu nombre se abre el garaje. El coche elegido se usa en las **pistas inventadas** y en la **arena de demolición**; en las **pistas reales a escala** todos corren con **Fórmula 1**. Se puede cambiar en la sala con **CAMBIAR COCHE** (no a mitad de carrera) y el navegador lo recuerda para la próxima vez. En la lista de pilotos se ve qué coche lleva cada uno.

Coches: **NISSAN SKYLINE GT-R R34**, **SUBARU IMPREZA WRC**, **DODGE CHALLENGER HELLCAT**, **TOYOTA SUPRA MK4** y **VOLKSWAGEN GOLF GTI TCR**.

- **Todos corren igual** (270 km/h de punta, misma aceleración, giro, agarre y peso): solo cambian el **aspecto** y el **nombre**, así nadie tiene ventaja por el coche que elige.
- Controles del garaje: clic o toque en una tarjeta para elegir (doble clic: elegir y salir) y **¡LISTO!**. En el ordenador también **←/→** (o **A/D**) y **Enter**.

## Pistas
| Pista | Dificultad | Curvas | Curvas cerradas | Ancho | Puente |
|---|---|---|---|---|---|
| VALLE VERDE | Normal | 5 | 1 | Amplio | Un 8: se cruza en el centro |
| COSTA SERPIENTE | Difícil | 12 | 7 | Medio | Un bucle pasa por encima de su propio tramo |
| INFIERNO | Extrema | 21 | 13 | Estrecho | Un bucle cruza sobre la recta de abajo |
| DEMENCIA | Demencial ★★★★ | 27 | 22 | Mínimo | Una espiral antes de la recta de salida |

Todas las pistas inventadas tienen un **cruce con puente**: en una parte de la vuelta pasas por arriba y en otra por debajo. Los coches de arriba y de abajo no chocan entre sí, y el de abajo queda tapado por el puente.

## Pistas reales a escala (Fórmula 1)
Sección propia en la sala. Trazados calcados de los mapas oficiales de la F1, escalados para que la vuelta mida lo mismo que la real (5 px = 1 m), en su sentido real y con la salida en su recta de meta. Se corren con **Fórmula 1** (hasta **500 km/h** en las rectas largas) y a **2 vueltas**.

Antes del semáforo sale una **pantalla de carga** de 7 s: el nombre y los datos de la pista, cuatro F1 corriendo en pixel art (**MERCEDES W14**, **FERRARI F1-75**, **RED BULL RB18** y **RENAULT R.S.19**, con los colores de sus decoraciones, sin logos) y una barra de carga mientras se prepara de verdad el trozo de pista de la salida.

| Pista | País | Dificultad | Longitud real | Curvas (oficiales) | Notas |
|---|---|---|---|---|---|
| MONZA | Italia | Fácil ★ | 5,793 km | 11 | La más rápida |
| BARCELONA | España | Normal ★★ | 4,675 km | 16 | Con la chicane final |
| SPA-FRANCORCHAMPS | Bélgica | Difícil ★★★ | 7,004 km | 19 | Eau Rouge, Kemmel |
| SUZUKA | Japón | Muy difícil ★★★★ | 5,807 km | 18 | Cruce real con puente (en 8) |
| BAKÚ | Azerbaiyán | Extremo ★★★★★ | 6,003 km | 20 | Callejero: estrecha y con muros |

- Todas tienen 2 **pasarelas** sobre la pista (pasas por debajo). Suzuka tiene además su **puente real**: la recta hacia 130R pasa por encima del tramo que va de Degner a la horquilla.
- El F1 frena y agarra como un F1: en las curvas manda el agarre lateral, así que cuanto más rápido vas, más abierta tiene que ser la curva. Hay que frenar antes de las curvas lentas.
- Vueltas de referencia (simulación a ritmo máximo): Monza ~1:07, Barcelona ~1:10, Spa ~1:32, Suzuka ~1:20, Bakú ~1:23.

Salirse del asfalto (hierba/tierra) frena mucho, y el muro de neumáticos te devuelve a la pista.

### DEMENCIA: acantilados y trampas
La pista más difícil: la más estrecha, con rectas y **curvas circulares de verdad** (las horquillas son semicírculos, como en un circuito real), peines de horquillas y eses, y además:
- **Acantilados** (6 zonas, 2 de ellas puentes con vacío a ambos lados): si te sales del piano por ese lado caes al vacío y reapareces un poco más atrás, parado (pierdes varios segundos).
- **Manchas de aceite** (7): trompo y casi sin agarre ni volante durante un momento.
- **Charcos de barro** (4): frenan como la hierba.
- **Bloques móviles** amarillos y negros (6) que cruzan la pista de lado a lado y te empujan. Siempre queda hueco para pasar.

Comprobado con simulación: se puede terminar (unos 5 min a ritmo prudente sin caerse; unos 3 min y medio a tope, cayéndose varias veces).

## Salida, turbo y música
- **Semáforo de 5 segundos** en la salida (carreras y arena): se enciende una luz roja por segundo y al quinto se ponen todas en verde: ¡YA!
- **Turbo para el último** (solo carreras y solo con **más de 3 pilotos**, es decir 4 o más): si vas último y **muy lejos** del coche que tienes delante (a más de ~5 segundos), tienes turbo (más velocidad punta y aceleración, con llamas) hasta que lo alcanzas. Si te vuelves a quedar atrás, vuelve. Con el F1, la punta con turbo es de unos 540 km/h.
- **Música de fondo**: se quita con el botón ♪ / **MÚSICA** o la tecla **N** (la **M** silencia todo).
  - **Banda sonora del aula:** si junto a `server.js` hay una carpeta `soundtrack` (o `sountrack`) con canciones (mp3, ogg, m4a, wav…), el servidor del profesor las pone **una detrás de otra**, en el orden de los nombres de archivo; al acabar la última vuelve a la primera. En la sala se ve cuál suena. Para añadir, quitar o reordenar canciones basta con cambiar los archivos de la carpeta (el orden es alfabético: se puede numerar, `01 …`, `02 …`).
  - Esa carpeta **no se sube** a GitHub ni a Vercel (`.gitignore` y `.vercelignore`): son canciones con derechos de autor y publicarlas en internet no está permitido. Por eso en la versión online (Vercel) suena el chiptune original.
  - Sin carpeta de banda sonora: si existe `public/music.mp3` se pone en bucle (solo música que tengas permiso para usar, porque sí se publica); si no, el chiptune original de estilo metal.

## Modo demolición (ARENA DEL CAOS)
Se elige como una pista más (la tarjeta rosa de la sala). Arena ovalada cerrada con 4 pilares de neumáticos. En la arena los coches son un 50% más grandes que en las carreras, para que sea más fácil golpearse.
- La vida va en **barritas**: todos empiezan con **5 barritas**. Sin barritas quedas eliminado (K.O.) y pasas a mirar.
- **Golpe suave** (embistes a poca velocidad, sin carrerilla): quita **media barrita** al golpeado.
- **Golpe fuerte** (embistes desde lejos, a más de ~165 km/h en el marcador): quita **1 barrita**.
- Solo cuenta un golpe nuevo si los coches se habían separado: empujar pegado a otro no le quita vida sin parar.
- **Botiquines** (cruz roja, **+1 barrita**): cada **30 s** aparece 1 por cada 2 jugadores vivos (mínimo 1). Con la vida llena no se gastan.
- **Escudos** (azules, **10 s de inmunidad**): cada **40 s** aparece 1 por cada 2 jugadores vivos (mínimo 1).
- Gana el **último en pie**. Si pasan **3 minutos**, gana quien tenga más vida.

## Controles
- **Ordenador:** **W** o **↑** acelerar · **S** o **↓** frenar / marcha atrás · **A** o **←** girar a la izquierda · **D** o **→** girar a la derecha · **M** sonido · **N** música · **F** pantalla completa
- **Móvil / tablet:** la carrera ocupa toda la pantalla (mejor en horizontal, también funciona en vertical). Flechas **←** y **→** estilo PlayStation abajo a la izquierda para girar (se puede deslizar el pulgar de una a otra) · botón **A** acelerar · botón **B** frenar / marcha atrás. Se puede girar y acelerar a la vez, con dos dedos.

## Pantalla completa
- Durante la carrera hay un botón de pantalla completa (arriba en el centro en el móvil, abajo a la derecha en el ordenador). Sirve para entrar y para salir.
- En el ordenador también con la tecla **F** (o **F11**). A pantalla completa la vista se adapta a la forma de la pantalla, sin bandas negras.
- En Android se activa sola al pulsar **¡A CORRER!**.
- En iPhone no existe para páginas web (el botón no aparece): usa **Compartir → Añadir a pantalla de inicio** y abre el juego desde ese icono.

## Ajustes
- `server.js`: `COUNTDOWN_MS` (semáforo, 5 s), `LAPS` (vueltas), `HOST_PICK_MAX` (hasta cuántos pilotos elige el host), `VOTE_MS`, `FINISH_TIMEOUT`, `PORT`.
- `public/tracks.js`: los puntos de cada pista, su ancho, colores y la física del coche (`PHYS`). Una pista puede tener `cliffs`, `oil`, `mud` y `pistons` (ver DEMENCIA), y definirse con `points` (curva suave) o con `corners` `[x, y, radio]` (rectas + arcos circulares).
- `public/tracks.js` → `REAL_TRACKS` (pistas reales: puntos calcados, longitud y ancho reales en metros, escapatoria, dificultad), `REAL_LAPS` (2), `F1` (física del Fórmula 1) y `PX_PER_M` (escala).
- `public/tracks.js` → `CARS`: los 5 coches del garaje (nombre, colores y largo del dibujo). Todos usan la física `PHYS` (`carPhysFor(id)` solo apunta el modelo). Los dibujos están en `CAR_ART` (`client.js`).
- `public/tracks.js` → `REAL_LOADING_MS`: duración de la pantalla de carga de las pistas reales (7 s). Los F1 de esa pantalla (colores y dibujo) están en `F1_TEAMS` y `F1_SIDE` (`client.js`).
- `public/client.js`: `TURBO` (cuánto más rápido va el último y a qué distancia se activa/desactiva) y la música (`BASS`, `LEAD`, `SONG`, `tempo`).
- `public/tracks.js` → `DERBY`: reglas del modo demolición (vida, daño de cada golpe y velocidad a partir de la que es fuerte, botiquines, escudos, tiempo límite, tamaño de los coches en la arena `CAR_SCALE`). `ARENAS`: forma de la arena y sus pilares.
