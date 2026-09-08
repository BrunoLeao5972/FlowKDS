@echo off
setlocal
cd /d %~dp0

:: Precisa de administrador para registrar servico do Windows.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [AVISO] Arquivo .env nao encontrado. Foi criado a partir do .env.example.
  echo Edite o .env com as credenciais do cliente e rode este instalador de novo.
  pause
  exit /b 1
)

set SERVICE_NAME=FoxKDSServer
set EXE_PATH=%~dp0kds-server.exe
set APP_DIR=%~dp0
set LOG_DIR=%~dp0logs

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: Reinstalacao idempotente: se o servico ja existir (ex.: atualizando de versao), remove antes.
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
  echo Servico "%SERVICE_NAME%" ja existe. Parando e removendo para reinstalar...
  nssm.exe stop %SERVICE_NAME% >nul 2>&1
  nssm.exe remove %SERVICE_NAME% confirm >nul 2>&1
)

echo Instalando servico "%SERVICE_NAME%"...
nssm.exe install %SERVICE_NAME% "%EXE_PATH%"
nssm.exe set %SERVICE_NAME% AppDirectory "%APP_DIR%"
nssm.exe set %SERVICE_NAME% DisplayName "FOX KDS Server"
nssm.exe set %SERVICE_NAME% Description "FOX KDS - servidor web + sincronizacao SQL2014 (sem janela visivel)"
nssm.exe set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm.exe set %SERVICE_NAME% AppStdout "%LOG_DIR%\service-out.log"
nssm.exe set %SERVICE_NAME% AppStderr "%LOG_DIR%\service-err.log"
nssm.exe set %SERVICE_NAME% AppRotateFiles 1
nssm.exe set %SERVICE_NAME% AppRotateOnline 1
nssm.exe set %SERVICE_NAME% AppRotateBytes 10485760
:: Reinicia sozinho em qualquer saida (crash ou nao) - substitui o loop do start-server.cmd.
nssm.exe set %SERVICE_NAME% AppExit Default Restart
nssm.exe set %SERVICE_NAME% AppRestartDelay 5000

echo Iniciando servico...
nssm.exe start %SERVICE_NAME%

echo.
echo ============================================================
echo  FOX KDS instalado como servico do Windows (sem janela).
echo  Inicia sozinho no boot, reinicia sozinho se cair.
echo  Conferir em: services.msc -^> "FOX KDS Server"
echo  Logs em: %LOG_DIR%
echo ============================================================
pause
