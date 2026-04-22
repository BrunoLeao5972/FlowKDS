@echo off
cd /d %~dp0
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [AVISO] Arquivo .env nao encontrado.
  echo Foi criado um .env a partir do .env.example.
  echo Revise credenciais e configuracoes quando necessario.
)

if exist "..\server\scripts\sql2014-kds-bridge.js" (
  node "..\server\scripts\sql2014-kds-bridge.js"
) else (
  kds-bridge.exe
)
if errorlevel 1 (
  echo.
  echo [ERRO] Bridge encerrou com erro.
  pause
  exit /b 1
)
