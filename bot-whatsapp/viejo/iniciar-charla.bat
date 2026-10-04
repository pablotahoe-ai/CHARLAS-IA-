@echo off
chcp 65001 >nul
title Charla IA - bot de WhatsApp
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instalalo desde https://nodejs.org  ^(boton verde "LTS"^) y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo.
  echo  Instalando lo necesario ^(solo la primera vez en esta PC, tarda unos minutos^)...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo. & echo  Fallo la instalacion. Revisa la conexion a internet. & pause & exit /b 1 )
)
start "" "http://localhost:3777/#q12b"
echo.
echo  Charla abierta en el navegador, en la pantalla del bot. Escanea el QR con WhatsApp.
echo  Los textos del bot y la clave se leen del Google Sheet de la charla.
echo  Dejar esta ventana abierta mientras dure la charla. Para cerrar: cerrar esta ventana.
echo.
node bot.js
pause
