@echo off
cd /d %~dp0
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [AVISO] Arquivo .env nao encontrado.
  echo Foi criado um .env a partir do .env.example.
  echo Revise credenciais e configuracoes quando necessario.
)

kds-bridge.exe
if errorlevel 1 (
  echo.
  echo [ERRO] kds-bridge.exe encerrou com erro.
  pause
  exit /b 1
)
