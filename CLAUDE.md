# 8 BITS RACING

Juego de carreras multijugador (Node + WebSockets). Arquitectura en `document.md`, despliegues y contexto en `memory.md`.

## Publicar siempre los cambios

El usuario quiere que cada cambio en el juego se publique solo, sin tener que pedirlo:

- Al terminar cualquier cambio en el juego (y tras comprobarlo), haz commit y `git push origin master` sin preguntar.
- Ese push actualiza **Render** (auto-deploy por `render.yaml`).
- **Vercel**: usa SIEMPRE el proyecto existente `8bits-battle` (scope `jacob14-416e`), nunca crees otro. Mientras el repo de GitHub no esté conectado en Vercel (`vercel git connect` falla por permisos de la GitHub App), después del push ejecuta `npx vercel --prod --yes --scope jacob14-416e` desde esta carpeta (ya enlazada en `.vercel/`). Si ya está conectado, el push basta.
- No hagas push de cambios a medias o rotos: comprueba antes al menos `node --check` de los archivos tocados.
- Identidad de git del repo: `jacobmelendezjm-tech <jacobmelendez.jm@gmail.com>`.
