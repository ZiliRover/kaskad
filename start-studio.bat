@echo off
rem Double-click to run the studio: installs deps on first run, starts db + web + worker, opens the browser.
chcp 65001 >nul
title Каскад: студия
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

rem already running: just open it
netstat -ano | findstr "LISTENING" | findstr ":3000 " >nul
if not errorlevel 1 (
  echo Студия уже запущена, открываю браузер.
  start "" http://localhost:3000/studio
  exit /b 0
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости, это займёт пару минут...
  call npm install
  if errorlevel 1 goto fail
)

if not exist .env (
  copy .env.example .env >nul
  echo Создан файл .env. Для настоящих генераций впишите в него KASKAD_OPENROUTER_KEY и PROVIDER_MODE=live.
)

rem open the browser as soon as the site answers
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 180;$i++){try{Invoke-WebRequest http://localhost:3000/studio -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Process http://localhost:3000/studio; break}catch{Start-Sleep 1}}"

echo.
echo Студия запускается. Браузер откроется сам.
echo Чтобы остановить: закройте это окно или нажмите Ctrl+C.
echo.
call npm run dev
exit /b 0

:fail
echo.
echo Не удалось установить зависимости. Проверьте интернет и запустите снова.
pause
exit /b 1
