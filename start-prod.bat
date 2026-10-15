@echo off
rem Боевой запуск: собранный сайт (next start) + база + воркер. Двойной клик.
rem После обновления кода: start-prod.bat rebuild
chcp 65001 >nul
title Каскад: боевой сервер
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

netstat -ano | findstr "LISTENING" | findstr ":3000 " >nul
if not errorlevel 1 (
  echo Порт 3000 уже занят: сервер уже запущен или открыта dev-версия. Закройте её и запустите снова.
  pause
  exit /b 1
)

if not exist .env (
  echo Нет файла .env с настройками боевого сервера. Скопируйте .env.example в .env и заполните.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install
  if errorlevel 1 goto fail
)

if /i "%~1"=="rebuild" if exist .next rmdir /s /q .next
if not exist .next\BUILD_ID (
  echo Собираю сайт, это пара минут...
  call npm run build
  if errorlevel 1 goto fail
)

set NODE_ENV=production
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){try{Invoke-WebRequest http://localhost:3000/studio -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Process http://localhost:3000/studio; break}catch{Start-Sleep 1}}"

echo.
echo Сервер запускается: http://localhost:3000/studio
echo Доступ коллегам: npm run invite -- почта 500   (в другом окне, пока сервер работает)
echo Остановить: закройте окно или Ctrl+C.
echo.
call npm run prod
exit /b 0

:fail
echo.
echo Не получилось. Сообщение об ошибке выше.
pause
exit /b 1
