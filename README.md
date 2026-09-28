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

Salirse del asfalto (hierba/tierra) frena mucho, y el muro de neumáticos te devuelve a la pista.

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
- **Ordenador:** **W** o **↑** acelerar · **S** o **↓** frenar / marcha atrás · **A** o **←** girar a la izquierda · **D** o **→** girar a la derecha · **M** sonido · **F** pantalla completa
- **Móvil / tablet:** la carrera ocupa toda la pantalla (mejor en horizontal, también funciona en vertical). Flechas **←** y **→** estilo PlayStation abajo a la izquierda para girar (se puede deslizar el pulgar de una a otra) · botón **A** acelerar · botón **B** frenar / marcha atrás. Se puede girar y acelerar a la vez, con dos dedos.

## Pantalla completa
- Durante la carrera hay un botón de pantalla completa (arriba en el centro en el móvil, abajo a la derecha en el ordenador). Sirve para entrar y para salir.
- En el ordenador también con la tecla **F** (o **F11**). A pantalla completa la vista se adapta a la forma de la pantalla, sin bandas negras.
- En Android se activa sola al pulsar **¡A CORRER!**.
- En iPhone no existe para páginas web (el botón no aparece): usa **Compartir → Añadir a pantalla de inicio** y abre el juego desde ese icono.

## Ajustes
- `server.js`: `LAPS` (vueltas), `HOST_PICK_MAX` (hasta cuántos pilotos elige el host), `VOTE_MS`, `FINISH_TIMEOUT`, `PORT`.
- `public/tracks.js`: los puntos de cada pista, su ancho, colores y la física del coche (`PHYS`).
- `public/tracks.js` → `DERBY`: reglas del modo demolición (vida, daño de cada golpe y velocidad a partir de la que es fuerte, botiquines, escudos, tiempo límite, tamaño de los coches en la arena `CAR_SCALE`). `ARENAS`: forma de la arena y sus pilares.
