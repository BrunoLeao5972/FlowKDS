param(
  [string]$Target = "node18-win-x64"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $root "release"
$releaseScriptsDir = Join-Path $releaseDir "scripts"

Write-Host "[1/7] Limpando release anterior..."
if (Test-Path $releaseDir) {
  Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Path $releaseScriptsDir | Out-Null

Write-Host "[2/7] Build do frontend (dist)..."
Push-Location $root
npm run build
Pop-Location

Write-Host "[3/7] Empacotando backend em EXE..."
Push-Location (Join-Path $root "server")
npx pkg index.js --targets $Target --output (Join-Path $releaseDir "kds-server.exe")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $releaseDir "kds-server.exe"))) {
  throw "Falha ao gerar kds-server.exe"
}

Write-Host "[4/7] Empacotando bridge SQL em EXE..."
npx pkg scripts/sql2014-kds-bridge.js --targets $Target --output (Join-Path $releaseDir "kds-bridge.exe")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $releaseDir "kds-bridge.exe"))) {
  throw "Falha ao gerar kds-bridge.exe"
}
Pop-Location

Write-Host "[5/7] Copiando assets necessarios..."
Copy-Item -Path (Join-Path $root "dist") -Destination (Join-Path $releaseDir "dist") -Recurse -Force
Copy-Item -Path (Join-Path $root "server\.env.example") -Destination (Join-Path $releaseDir ".env.example") -Force
Copy-Item -Path (Join-Path $root "server\scripts\sql2014-*.sql") -Destination $releaseScriptsDir -Force

Write-Host "[6/7] Gerando scripts de inicializacao..."
@"
@echo off
cd /d %~dp0
if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo [AVISO] Arquivo .env nao encontrado.
  echo Foi criado um .env a partir do .env.example.
  echo Revise credenciais e configuracoes quando necessario.
)

kds-server.exe
if errorlevel 1 (
  echo.
  echo [ERRO] kds-server.exe encerrou com erro.
  pause
  exit /b 1
)
"@ | Set-Content -Path (Join-Path $releaseDir "start-server.cmd") -Encoding ASCII

@"
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
"@ | Set-Content -Path (Join-Path $releaseDir "start-bridge.cmd") -Encoding ASCII

@"
@echo off
cd /d %~dp0
start "Flow KDS Server" cmd /k "cd /d %~dp0 && call start-server.cmd"
timeout /t 2 >nul
start "Flow KDS Bridge" cmd /k "cd /d %~dp0 && call start-bridge.cmd"
"@ | Set-Content -Path (Join-Path $releaseDir "start-all.cmd") -Encoding ASCII

Write-Host "[7/7] Finalizado."
Write-Host "Release criada em: $releaseDir"
Write-Host "Copie para o cliente apenas a pasta 'release'."
