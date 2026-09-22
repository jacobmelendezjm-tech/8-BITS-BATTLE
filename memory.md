# Memoria del proyecto — 8 BITS BATTLE

Notas de contexto que no están en el código ni en `document.md`/`README.md`, para no tener que redescubrirlas.

## Despliegues activos

| Servicio | URL | Qué sirve |
|---|---|---|
| GitHub | https://github.com/jacobmelendezjm-tech/8-BITS-BATTLE | Repo (rama `master`) |
| Vercel | https://8bits-battle.vercel.app | Página estática (`public/`) |
| Render | https://eightbits-battle.onrender.com | Servidor WebSocket (`server.js`), plan Free |

- Vercel se despliega con la CLI (`vercel --prod --yes`) desde este equipo — **no** tiene conectado el auto-deploy por GitHub (falló al enlazarlo, ver más abajo), así que un `git push` **no** actualiza Vercel solo. Hay que correr `vercel --prod --yes` manualmente tras cada cambio en `public/`.
- Render **sí** tiene auto-deploy: cada `git push` a `master` redespliega `server.js` automáticamente (vía Blueprint, `render.yaml`).
- Render free tier se "duerme" tras ~15 min sin tráfico; la siguiente conexión tarda 30-50s en despertarlo. Si se va a jugar en clase, conviene abrir la página unos minutos antes.

## Arquitectura de doble modo (LAN + online)

El juego funciona en dos modos sin tocar código, gracias a `public/client.js`:

- **LAN/local** (`INICIAR.bat`, `npm start`): el cliente se conecta al mismo host que sirvió la página (`ws://${location.host}`), igual que siempre.
- **Online** (Vercel + Render): si `location.hostname` está en `VERCEL_HOSTS` (array en `client.js`), el cliente ignora el host actual y se conecta directo a `RENDER_WS_URL` (`wss://eightbits-battle.onrender.com`).

Si se cambia el dominio de Vercel o la URL de Render, hay que actualizar esas dos constantes en `public/client.js` y volver a desplegar ambos lados.

## Detección de "host" (profesor) — cambiada para soportar online

Antes: solo era host quien se conectaba desde `127.0.0.1`/`::1` (el propio equipo del profesor en LAN).

Problema: en un despliegue online nadie se conecta desde localhost, así que nadie podría pulsar "EMPEZAR PARTIDA".

Solución implementada en `server.js`: se mantiene la detección por IP local (prioridad, para LAN), y además **el primer jugador que se conecta mientras no haya host asignado se convierte en host** (variable `hostAssigned`). Al desconectarse el host, se libera el puesto para el siguiente que entre.

## Intento fallido: Vercel + GitHub auto-deploy

Al crear el proyecto en Vercel (`vercel link --yes --project 8bits-battle`), el paso de conectar el repo de GitHub falló:
`Error: Failed to connect jacobmelendezjm-tech/8-BITS-BATTLE to project.`
No se investigó la causa a fondo (posible permiso de la GitHub App de Vercel). Por eso el deploy a Vercel es manual por ahora. Si se quiere automatizar, revisar en el dashboard de Vercel → Settings → Git si el repo se puede conectar desde ahí.

## Cuentas usadas

- GitHub: `jacobmelendezjm-tech`
- Vercel: `jacobmelendezjm-tech` (team/scope `jacob14-416e`)
- Render: cuenta del profesor (jacobmelendez.jm@gmail.com), conectada a GitHub

## Otros cambios relevantes

- `INICIAR.bat` ahora detecta si falta Node.js y lo instala solo con `winget` (paquete `OpenJS.NodeJS.LTS`) antes de arrancar el servidor.
- `package.json` tiene `"dev": "start https://8bits-battle.vercel.app"` — `npm run dev` abre el juego online directamente en el navegador (Windows).
