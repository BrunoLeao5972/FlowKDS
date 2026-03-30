@echo off
cd /d %~dp0
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [ERRO] Arquivo .env nao encontrado.
  echo Foi criado um .env a partir do .env.example.
  echo Edite o .env e configure SQL2014_* e KDS_*.
  pause
  exit /b 1
)

kds-bridge.exe
if errorlevel 1 (
  echo.
  echo [ERRO] kds-bridge.exe encerrou com erro.
  pause
  exit /b 1
)
