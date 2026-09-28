# Memoria del proyecto — 8 BITS RACING

Notas de contexto que no están en el código ni en `document.md`/`README.md`, para no tener que redescubrirlas.

> El repo se sigue llamando `8-BITS-BATTLE` y el proyecto de Vercel `8bits-battle` por historia: el 2026-09-28 el juego pasó de battle royale (8 BITS BATTLE) a carreras (8 BITS RACING). No se renombraron para no romper URLs.

## Despliegues activos

| Servicio | URL | Qué sirve | ¿Se actualiza solo? |
|---|---|---|---|
| GitHub | https://github.com/jacobmelendezjm-tech/8-BITS-BATTLE | Repo (rama `master`) | — |
| Render | https://eightbits-battle.onrender.com | Servidor WebSocket (`server.js`), plan Free | **Sí**, con cada push a `master` (Blueprint, `render.yaml`) |
| Vercel | https://8bits-battle.vercel.app | Página estática (`public/`) | **No** (ver abajo): hay que desplegar con la CLI |

- Render free tier se "duerme" tras ~15 min sin tráfico; la siguiente conexión tarda 30-50 s en despertarlo. Si se va a jugar en clase, conviene abrir la página unos minutos antes.
- `server.js` hace `require('./public/tracks.js')`, así que Render necesita ese archivo en el repo.

## Flujo de publicación (pedido por el usuario)

El usuario quiere que cada cambio se publique solo, sin tener que pedirlo (regla también en `CLAUDE.md`):

1. Comprobar el cambio (al menos `node --check` de los archivos tocados).
2. Commit + `git push origin master` → actualiza GitHub y Render.
3. `npx vercel --prod --yes --scope jacob14-416e` → actualiza Vercel.

**Usar siempre el proyecto de Vercel existente `8bits-battle`; nunca crear uno nuevo** (el usuario lo pidió expresamente).

## Vercel sin auto-deploy por GitHub

`vercel git connect` falla dos veces (al crear el proyecto y el 2026-09-28):
`Error: Failed to connect jacobmelendezjm-tech/8-BITS-BATTLE to project.`
Causa probable: la GitHub App de Vercel no tiene acceso al repo. Para arreglarlo el usuario debe, con su cuenta:
1. https://github.com/settings/installations → Vercel → Configure → Repository access → añadir `8-BITS-BATTLE`.
2. En Vercel, tarjeta del proyecto `8bits-battle` → **Connect Git Repository** → elegir el repo, rama de producción `master`.

Cuando esté conectado, el paso 3 del flujo de publicación deja de ser necesario (actualizar `CLAUDE.md`).

## Equipo del aula ("Alumno")

- Carpeta de trabajo: `C:\Users\Alumno\Desktop\8-BITS-BATTLE-master\8-BITS-BATTLE-master`. Venía de un ZIP; se convirtió en clon git del repo (remote `origin`, rama `master`) el 2026-09-28.
- Identidad git configurada en el repo: `jacobmelendezjm-tech <jacobmelendez.jm@gmail.com>`.
- La CLI de Vercel tiene sesión iniciada con la cuenta del usuario y la carpeta está enlazada (`.vercel/`, ignorado por git). Es un equipo compartido: si hace falta, `npx vercel logout`.
- No está instalado `gh` ni la CLI de Vercel global (se usa `npx vercel`).

## Arquitectura de doble modo (LAN + online)

El juego funciona en dos modos sin tocar código, gracias a `public/client.js`:

- **LAN/local** (`INICIAR.bat`, `npm start`): el cliente se conecta al mismo host que sirvió la página (`ws://${location.host}`).
- **Online** (Vercel + Render): si `location.hostname` está en `VERCEL_HOSTS`, el cliente se conecta directo a `RENDER_WS_URL` (`wss://eightbits-battle.onrender.com`).

Si se cambia el dominio de Vercel o la URL de Render, hay que actualizar esas dos constantes en `public/client.js` y volver a desplegar ambos lados.

## Detección de "host"

- En LAN, quien se conecta desde `127.0.0.1`/`::1` (el equipo del profesor) es siempre host. Ojo al probar con varias pestañas en el mismo equipo: todas son host.
- Online nadie viene de localhost, así que **el primero que se une con su nombre** pasa a ser host si no hay ninguno (`hasHost()`/`makeHost()`). Si el host se desconecta y no queda ninguno, pasa al primer jugador **con nombre** y se le manda `{t:'host'}`.
- **Regla del usuario (2026-09-28): nadie entra a la sala ni a ningún mapa sin haberse unido con su nombre, tampoco el host.** El cliente muestra siempre la pantalla de nombre si no se ha unido (al host le enseña ahí la dirección para los alumnos) y el servidor exige `p.joined` para `pick`, `voteStart`, `vote` y `stop`. Antes el host podía entrar sin nombre y mirar las partidas; se quitó el formulario "UNIRME" del panel del host.
- Para probar "jugadores de fuera" en el mismo equipo, conectarse por la IP de red (p. ej. `ws://192.168.x.x:PUERTO`), no por localhost.

## Decisiones de diseño del juego de carreras

- **Elección de pista** (pedida por el usuario): con 1-2 pilotos elige el host; con 3 o más, votación (`HOST_PICK_MAX` en `server.js`). Empates → sorteo entre las empatadas.
- **Cada cliente simula su propio coche** (antes el servidor era autoritativo). Se eligió para que la conducción no tenga retraso online (Render). El servidor confía en los clientes: aceptable en el aula, pero se pueden hacer trampas.
- No hay coches de IA: se quitaron cuando el usuario pidió el modo multijugador. Queda un piloto automático que conduce tu coche tras cruzar la meta.
- La dificultad de las pistas se verificó con scripts de Node (sin commitear): separación mínima entre tramos, radio de curva mínimo y una simulación de 4 vueltas. Resultado: Normal 6 curvas / 0 cerradas, Difícil 11 / 6, Extrema 17 / 11; vueltas óptimas ≈ 11 s / 18 s / 29 s. Si se tocan los puntos de una pista, repetir esa comprobación.
- **Fallo encontrado y corregido (2026-09-28):** la línea de meta estaba en el primer punto de control, que en las tres pistas caía en plena curva (la parrilla giraba hasta 97°, los coches salían torcidos y el de atrás chocaba). Ahora `buildTrack` pone la salida en el tramo más recto. Lo destapó la prueba en navegador, no las simulaciones (que empezaban con el coche ya orientado).
- **Móvil (pedido por el usuario):** solo flechas ← → estilo PlayStation a la izquierda (para girar) + botones A (acelerar) y B (frenar) a la derecha. Historia, todo el 2026-09-28: primero pidió un stick de movimiento, luego añadió A/B, después cambió el stick por una cruceta de 4 flechas estilo PlayStation y por último pidió dejar solo izquierda/derecha. No volver a poner stick ni flechas ↑/↓ en el móvil.
- **Pantalla completa (pedida por el usuario):** botón en la carrera + tecla F; en ordenador a pantalla completa la vista se adapta a la forma de la pantalla (lado corto 640 px lógicos). Probado en Chrome headless (escritorio y móvil emulado); no en iPhone, donde el botón se oculta porque Safari no tiene la API.
- **Pruebas en navegador:** con Chrome headless + puppeteer-core (instalado en el scratchpad, no en el repo) emulando un Android en horizontal y vertical: controles táctiles con dos dedos, capturas de sala/carrera/espectador y escritorio. No se ha probado en un móvil físico ni en iPhone (Safari).

## Modo demolición (añadido 2026-09-28, pedido por el usuario)

Petición literal: "modo estilo wreckfest", vida 100%, "cada golpe cercano quite 5%, los golpes más lejanos o con más aceleración quiten 20%", 1 punto de vida por cada 2 jugadores cada 30 s que recupere 20%, 1 escudo de inmunidad por cada 2 jugadores cada 40 s con 10 s de duración.

Decisiones tomadas por Claude (no las pidió el usuario; revisar si pide cambios):
- "Golpe cercano / lejano" se interpretó como la velocidad de embestida: corto sin carrerilla = 5%, con carrerilla ≥ 5,5 px/frame (≈165 km/h) = 20%. Umbrales en `DERBY` de `tracks.js`.
- El daño lo recibe el golpeado; en un choque de frente, los dos.
- Empujar pegado no quita vida; los rebotes que vuelven a chocar sí (5% cada uno).
- Objetos: "por cada 2 jugadores" = jugadores **vivos**, mínimo 1; cada oleada rellena hasta ese número (no se acumulan). Botiquín no se gasta con 100%.
- Límite de 3 minutos (gana quien tenga más vida) para que la partida siempre acabe.
- Se elige como una pista más (4ª tarjeta), con la misma regla host/votación.
- Después el usuario pidió coches más grandes en la arena ("son muy pequeños y es difícil golpearse"): `DERBY.CAR_SCALE = 1.5` (dibujo y choque). En las carreras siguen igual.

**Fallo antiguo corregido al probar este modo:** en `server.js`, al terminar una partida, la comprobación de "fin de la pantalla de resultados" usaba el tiempo de la partida ya terminada, así que si la carrera duraba más de 12 s se volvía a la sala al instante y **nunca se veían los resultados** (también en el modo carrera, desde el principio).

Pruebas: servidor con 4 clientes simulados (todas las reglas) y dos navegadores Chrome reales (uno de ordenador y uno de móvil emulado) chocando de frente. Con puppeteer hay que usar **un navegador por jugador**: una segunda pestaña en el mismo navegador queda en segundo plano, no dibuja y los clics/toques se cuelgan.

## Pista DEMENCIA (añadida 2026-09-28, pedida por el usuario)

Petición: "demasiado difícil, no imposible pero que sea realmente un desafío con muchas curvas, acantilados y trampas en la pista".

- Primera versión con `points` (spline): curvas de 35 px (imposibles), luego ajustadas a 47 px. **El usuario pidió después curvas "más circulares, las hiciste poco reales"**: se rehízo con `corners` (rectas + arcos, `filletPath`), horquillas semicirculares de radio 120. Ahora: 23 curvas (18 cerradas), 15,2 km, radio mínimo 120 (> giro mínimo ~42 px = `2.5 / PHYS.turn`).
- La separación mínima entre tramos (217 px) cumple de sobra; para que exista muro entre dos tramos basta con > 2·(half + RUNOFF − 7,8) ≈ 168 px.
- Trampas elegidas por Claude: acantilados (caída = reaparecer 14 muestras atrás parado), aceite, barro y bloques móviles deterministas por tiempo de carrera. Ninguna en la parrilla ni junto a la salida.
- Simulación (`sim2.js` en el scratchpad): 4 vueltas OK; ritmo prudente ~318 s sin caídas, ritmo máximo ~217 s con ~6 caídas. Es una carrera larga (5 min): si el usuario se queja, acortar el trazado.
- El tema es morado (`out: '#221536'`) para que el vacío negro de los acantilados contraste; con el fondo casi negro no se distinguía.

## Semáforo, turbo y música (2026-09-28)

- Semáforo de 5 s en la salida (pedido por el usuario): `COUNTDOWN_MS = 5000`, 1 luz roja por segundo, verde al salir.
- Turbo para el último "hasta que alcance a los demás": interpretado como alcanzar al coche que tiene justo delante (se activa a > 25 muestras = 200 px, se apaga a < 8). Solo en carreras.
- **Música:** el usuario pidió "My Own Summer" de Deftones en versión 8 bits. **No se hizo**: una versión 8 bits reproduce la melodía/riff con derechos de autor y además se publicaría en Vercel. En su lugar: chiptune **original** de estilo metal (Web Audio) + opción de poner un `public/music.mp3` propio (con permiso). Si vuelve a pedirlo, mantener la negativa y ofrecer el archivo propio.

## Pistas reales a escala + F1 + puentes (2026-09-28)

Petición: F1 que lleguen a 500 km/h, 5 mapas reales a escala de distinta dificultad (el usuario pasó imágenes de los mapas oficiales de Spa, Bakú, Suzuka, Barcelona y Monza) en una sección nueva "pistas reales a escala" donde estén los F1, y "a todos los mapas puentes por los que pasar por arriba y por abajo".

**Decisiones del usuario (pregunta explícita):**
- Puentes: **respetar los trazados reales** (solo Suzuka tiene cruce real; en las otras reales, pasarelas por encima) y **rediseñar las pistas inventadas** para que cada una tenga un cruce con puente.
- Escala: **real, con 2 vueltas** en esa sección (no reducirlas).

Decisiones de Claude: escala 5 px = 1 m; dificultad Monza < Barcelona < Spa < Suzuka < Bakú; F1 con agarre ~6 g y frenada ~5 g; turbo del último con F1 limitado a ×1,08 (~540 km/h); coche de F1 de 28 × 10 px con radio de choque 9.

Cómo se calcaron: scripts `real-draft.js`, `pt/snap2.js` (ajuste perpendicular a la línea de color; modo `follow` para Bakú), `real-traced.json` en el scratchpad. Correcciones a mano: en Bakú las curvas 6 y 20 quedaban tocándose (creaban un cruce falso) → separadas; Barcelona tenía un pico de 7 m → redondeo automático a 12 m mínimo.

Pruebas: simulación de 2 vueltas con F1 en las 5 (todas terminan; Monza llega a 497 km/h), dos navegadores en el cruce de Suzuka (no chocan entre niveles, cada uno ve al otro en su nivel). Para teletransportar coches en pruebas hay que ajustar también `progress`, porque el nivel de los demás se calcula con él.

Costa Serpiente: la salida automática ("tramo más recto") caía en la recta nueva del bucle, bajo el puente → se fijó `start: [0, 0.85]`.

## Cuentas usadas

- GitHub: `jacobmelendezjm-tech`
- Vercel: `jacobmelendezjm-tech` (team/scope `jacob14-416e`, plan hobby)
- Render: cuenta del profesor (jacobmelendez.jm@gmail.com), conectada a GitHub

## Otros

- `INICIAR.bat` detecta si falta Node.js y lo instala solo con `winget` (paquete `OpenJS.NodeJS.LTS`) antes de arrancar el servidor.
- `package.json` tiene `"dev": "start https://8bits-battle.vercel.app"`: `npm run dev` abre el juego online en el navegador (Windows).
