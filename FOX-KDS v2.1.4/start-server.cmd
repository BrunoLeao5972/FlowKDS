@echo off
cd /d %~dp0
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [AVISO] Arquivo .env nao encontrado.
  echo Foi criado um .env a partir do .env.example.
  echo Revise credenciais e configuracoes quando necessario.
)

:loop
kds-server.exe
echo [%date% %time%] kds-server.exe encerrou com codigo %errorlevel%. Reiniciando em 5s... >> server-restart.log
timeout /t 5 >nul
goto loop
