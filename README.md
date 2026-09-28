# 8 BITS RACING

Juego de carreras de 8 bits para el aula. Cada alumno conduce su coche desde el navegador; el equipo del profesor hace de servidor por WebSockets. Gana quien complete **4 vueltas** primero.

## Arrancar (equipo del profesor)
1. Doble clic en `INICIAR.bat` (o ejecuta `npm install` y después `npm start`).
2. Se abre `http://localhost:3000`: es el **panel del host**. Tu IP sale a la derecha.
3. Los alumnos abren en su navegador `http://TU_IP:3000`, escriben su nombre y pulsan **¡A CORRER!**
4. Se elige la pista y empieza la carrera (ver abajo).

La primera vez, Windows pedirá permiso en el firewall para Node.js: marca **Redes privadas** y acepta.

## Elección de pista
- **1 o 2 pilotos**: la pista la elige el host haciendo clic en una de las tarjetas.
- **3 o más pilotos**: el host pulsa **ABRIR VOTACIÓN**; cada piloto vota (puede cambiar su voto). La votación dura 15 s o termina antes si ya han votado todos. Gana la más votada; si hay empate, se sortea entre las empatadas.

## Pistas
| Pista | Dificultad | Curvas | Curvas cerradas | Ancho |
|---|---|---|---|---|
| VALLE VERDE | Normal | 6 | 0 | Amplio |
| COSTA SERPIENTE | Difícil | 12 | 6 | Medio |
| INFIERNO | Extrema | 16 | 11 | Estrecho |

Salirse del asfalto (hierba/tierra) frena mucho, y el muro de neumáticos te devuelve a la pista.

## Controles
**W** acelerar · **S** frenar / marcha atrás · **A** girar a la izquierda · **D** girar a la derecha · **M** sonido

## Ajustes
- `server.js`: `LAPS` (vueltas), `HOST_PICK_MAX` (hasta cuántos pilotos elige el host), `VOTE_MS`, `FINISH_TIMEOUT`, `PORT`.
- `public/tracks.js`: los puntos de cada pista, su ancho, colores y la física del coche (`PHYS`).
