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
- Online nadie viene de localhost, así que **el primer jugador que se conecta sin host asignado pasa a serlo** (`hostAssigned`). Si el host se desconecta, el servidor asciende al siguiente conectado y le manda `{t:'host'}`.

## Decisiones de diseño del juego de carreras

- **Elección de pista** (pedida por el usuario): con 1-2 pilotos elige el host; con 3 o más, votación (`HOST_PICK_MAX` en `server.js`). Empates → sorteo entre las empatadas.
- **Cada cliente simula su propio coche** (antes el servidor era autoritativo). Se eligió para que la conducción no tenga retraso online (Render). El servidor confía en los clientes: aceptable en el aula, pero se pueden hacer trampas.
- No hay coches de IA: se quitaron cuando el usuario pidió el modo multijugador. Queda un piloto automático que conduce tu coche tras cruzar la meta.
- La dificultad de las pistas se verificó con scripts de Node (sin commitear): separación mínima entre tramos, radio de curva mínimo y una simulación de 4 vueltas. Resultado: Normal 6 curvas / 0 cerradas, Difícil 11 / 6, Extrema 17 / 11; vueltas óptimas ≈ 11 s / 18 s / 29 s. Si se tocan los puntos de una pista, repetir esa comprobación.
- **Fallo encontrado y corregido (2026-09-28):** la línea de meta estaba en el primer punto de control, que en las tres pistas caía en plena curva (la parrilla giraba hasta 97°, los coches salían torcidos y el de atrás chocaba). Ahora `buildTrack` pone la salida en el tramo más recto. Lo destapó la prueba en navegador, no las simulaciones (que empezaban con el coche ya orientado).
- **Móvil (pedido por el usuario):** cruceta de flechas estilo PlayStation a la izquierda (←/→ giran, ↑ acelera, ↓ frena) + botones A (acelerar) y B (frenar) a la derecha. Historia: primero pidió un stick de movimiento, luego añadió A/B y después (2026-09-28) cambió el stick por "flechas estilo PlayStation". No volver a poner un stick.
- **Pantalla completa (pedida por el usuario):** botón en la carrera + tecla F; en ordenador a pantalla completa la vista se adapta a la forma de la pantalla (lado corto 640 px lógicos). Probado en Chrome headless (escritorio y móvil emulado); no en iPhone, donde el botón se oculta porque Safari no tiene la API.
- **Pruebas en navegador:** con Chrome headless + puppeteer-core (instalado en el scratchpad, no en el repo) emulando un Android en horizontal y vertical: controles táctiles con dos dedos, capturas de sala/carrera/espectador y escritorio. No se ha probado en un móvil físico ni en iPhone (Safari).

## Cuentas usadas

- GitHub: `jacobmelendezjm-tech`
- Vercel: `jacobmelendezjm-tech` (team/scope `jacob14-416e`, plan hobby)
- Render: cuenta del profesor (jacobmelendez.jm@gmail.com), conectada a GitHub

## Otros

- `INICIAR.bat` detecta si falta Node.js y lo instala solo con `winget` (paquete `OpenJS.NodeJS.LTS`) antes de arrancar el servidor.
- `package.json` tiene `"dev": "start https://8bits-battle.vercel.app"`: `npm run dev` abre el juego online en el navegador (Windows).
