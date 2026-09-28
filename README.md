# 8 BITS RACING

Juego de carreras de 8 bits para el aula. Cada alumno conduce su coche desde el navegador; el equipo del profesor hace de servidor por WebSockets. Dos modos: **carrera** (gana quien complete 4 vueltas primero) y **demolición** estilo Wreckfest (gana el último que quede en pie).

## Arrancar (equipo del profesor)
1. Doble clic en `INICIAR.bat` (o ejecuta `npm install` y después `npm start`).
2. Se abre `http://localhost:3000`. Escribe tu nombre para entrar como **host**; en esa misma pantalla aparece la dirección para los alumnos.
3. Los alumnos abren en su navegador `http://TU_IP:3000`, escriben su nombre y pulsan **¡A CORRER!**

**Nadie entra a la sala ni a ningún mapa sin haberse unido con su nombre**, tampoco el host. Quien abre la página a mitad de una partida ve primero la pantalla de nombre.
4. Se elige la pista y empieza la carrera (ver abajo).

La primera vez, Windows pedirá permiso en el firewall para Node.js: marca **Redes privadas** y acepta.

## Elección de pista o arena
- **1 o 2 pilotos**: la pista la elige el host haciendo clic en una de las tarjetas.
- **3 o más pilotos**: el host pulsa **ABRIR VOTACIÓN**; cada piloto vota (puede cambiar su voto). La votación dura 15 s o termina antes si ya han votado todos. Gana la más votada; si hay empate, se sortea entre las empatadas.

## Pistas
| Pista | Dificultad | Curvas | Curvas cerradas | Ancho |
|---|---|---|---|---|
| VALLE VERDE | Normal | 6 | 0 | Amplio |
| COSTA SERPIENTE | Difícil | 11 | 6 | Medio |
| INFIERNO | Extrema | 17 | 11 | Estrecho |
| DEMENCIA | Demencial ★★★★ | 23 | 18 | Mínimo |

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
- **Turbo para el último** (solo carreras): si vas último y muy por detrás del coche que tienes delante, tienes turbo (más velocidad punta y aceleración, con llamas) hasta que lo alcanzas. Si te vuelves a quedar atrás, vuelve.
- **Música de fondo**: un chiptune original de estilo metal. Se quita con el botón ♪ / **MÚSICA** o la tecla **N** (la **M** silencia todo). Para usar otra música, pon un archivo `public/music.mp3` (solo música que tengas permiso para usar: se publica en internet con el juego).

## Modo demolición (ARENA DEL CAOS)
Se elige como una pista más (la tarjeta rosa de la sala). Arena ovalada cerrada con 4 pilares de neumáticos. En la arena los coches son un 50% más grandes que en las carreras, para que sea más fácil golpearse.
- Todos empiezan con **100% de vida**. Con 0% quedas eliminado (K.O.) y pasas a mirar.
- **Golpe corto** (embistes a poca velocidad, sin carrerilla): quita **5%** al golpeado.
- **Golpe fuerte** (embistes desde lejos, a más de ~165 km/h en el marcador): quita **20%**.
- Solo cuenta un golpe nuevo si los coches se habían separado: empujar pegado a otro no le quita vida sin parar.
- **Botiquines** (cruz roja, **+20%**): cada **30 s** aparece 1 por cada 2 jugadores vivos (mínimo 1). Con la vida llena no se gastan.
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
- `public/client.js`: `TURBO` (cuánto más rápido va el último y a qué distancia se activa/desactiva) y la música (`BASS`, `LEAD`, `SONG`, `tempo`).
- `public/tracks.js` → `DERBY`: reglas del modo demolición (vida, daño de cada golpe y velocidad a partir de la que es fuerte, botiquines, escudos, tiempo límite, tamaño de los coches en la arena `CAR_SCALE`). `ARENAS`: forma de la arena y sus pilares.
