@echo off
title 8 BITS BATTLE - Servidor
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Comprobando winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo No se encontro winget en este equipo.
    echo Instala Node.js manualmente desde https://nodejs.org y vuelve a ejecutar este archivo.
    start "" https://nodejs.org
    pause
    exit /b 1
  )

  echo Instalando Node.js LTS con winget, puede tardar un minuto...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo La instalacion de Node.js fallo. Instalalo manualmente desde https://nodejs.org
    pause
    exit /b 1
  )

  rem winget instala Node en Program Files; lo anadimos al PATH de esta ventana
  set "PATH=%PATH%;%ProgramFiles%\nodejs"

  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js se instalo pero no se detecta en esta ventana.
    echo Cierra esta ventana y vuelve a hacer doble clic en INICIAR.bat.
    pause
    exit /b 1
  )
  echo Node.js instalado correctamente.
)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000
node server.js
pause
