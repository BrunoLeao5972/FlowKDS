@echo off
setlocal
cd /d %~dp0

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set SERVICE_NAME=FoxKDSServer

sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% neq 0 (
  echo Servico "%SERVICE_NAME%" nao esta instalado. Nada a fazer.
  pause
  exit /b 0
)

echo Parando servico "%SERVICE_NAME%"...
nssm.exe stop %SERVICE_NAME%
echo Removendo servico...
nssm.exe remove %SERVICE_NAME% confirm

echo.
echo Servico removido. Para rodar manualmente (com janela visivel), use start-server.cmd.
pause
