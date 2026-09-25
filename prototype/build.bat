@echo off
rem Rebuild Seedance Studio: exe (PyInstaller) + installer (Inno Setup).
cd /d "%~dp0"
python build_icon.py || goto :err
python -m PyInstaller --noconfirm --clean --windowed --name SeedanceStudio --icon assets\icon.ico --add-data "web;web" app.py || goto :err
"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" installer.iss || goto :err
echo.
echo Done: installer\SeedanceStudio-Setup-1.0.0.exe
pause
exit /b 0
:err
echo BUILD FAILED
pause
exit /b 1
