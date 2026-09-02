param(
  [string]$Target = "node18-win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "release"
$releaseScriptsDir = Join-Path $releaseDir "scripts"

Write-Host "[1/6] Limpando release anterior..."
if (Test-Path $releaseDir) {
  Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Path $releaseScriptsDir | Out-Null

Write-Host "[2/6] Build do frontend (dist)..."
Push-Location $root
npm run build
Pop-Location

Write-Host "[3/6] Empacotando backend em EXE..."
Push-Location (Join-Path $root "server")
# A sincronizacao com o SQL2014 roda dentro deste mesmo processo (server/services/sql2014Sync.js) —
# nao ha mais um kds-bridge.exe separado para empacotar.
npx pkg index.js --targets $Target --output (Join-Path $releaseDir "kds-server.exe")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $releaseDir "kds-server.exe"))) {
  throw "Falha ao gerar kds-server.exe"
}
Pop-Location

Write-Host "[4/6] Copiando assets necessarios..."
Copy-Item -Path (Join-Path $root "dist") -Destination (Join-Path $releaseDir "dist") -Recurse -Force
Copy-Item -Path (Join-Path $root "server\.env.example") -Destination (Join-Path $releaseDir ".env.example") -Force
Copy-Item -Path (Join-Path $root "server\scripts\sql2014-*.sql") -Destination $releaseScriptsDir -Force
Copy-Item -Path (Join-Path $root "vendor\nssm\nssm.exe") -Destination (Join-Path $releaseDir "nssm.exe") -Force
Copy-Item -Path (Join-Path $root "scripts\install-service.cmd") -Destination (Join-Path $releaseDir "install-service.cmd") -Force
Copy-Item -Path (Join-Path $root "scripts\uninstall-service.cmd") -Destination (Join-Path $releaseDir "uninstall-service.cmd") -Force

Write-Host "[5/6] Gerando scripts de inicializacao..."
@"
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
"@ | Set-Content -Path (Join-Path $releaseDir "start-server.cmd") -Encoding ASCII

@"
@echo off
cd /d %~dp0
call start-server.cmd
"@ | Set-Content -Path (Join-Path $releaseDir "start-all.cmd") -Encoding ASCII

Write-Host "[6/6] Finalizado."
Write-Host "Release criada em: $releaseDir"
Write-Host "Copie para o cliente apenas a pasta 'release'."
Write-Host "Recomendado: rode install-service.cmd (como administrador) para instalar como Servico do Windows, sem janela visivel."
