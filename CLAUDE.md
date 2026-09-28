# 8 BITS RACING

Juego de carreras multijugador (Node + WebSockets). Arquitectura en `document.md`, despliegues y contexto en `memory.md`.

## Publicar siempre los cambios

El usuario quiere que cada cambio en el juego se publique solo, sin tener que pedirlo:

- Al terminar cualquier cambio en el juego (y tras comprobarlo), haz commit y `git push origin master` sin preguntar.
- Ese push actualiza **Render** (auto-deploy por `render.yaml`) y **Vercel** (si tiene conectado el repo de GitHub; ver `memory.md`).
- No hagas push de cambios a medias o rotos: comprueba antes al menos `node --check` de los archivos tocados.
- Identidad de git del repo: `jacobmelendezjm-tech <jacobmelendez.jm@gmail.com>`.
