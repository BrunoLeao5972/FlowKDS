@echo off
cd /d %~dp0
start "Flow KDS Server" cmd /k "cd /d %~dp0 && call start-server.cmd"
timeout /t 2 >nul
start "Flow KDS Bridge" cmd /k "cd /d %~dp0 && call start-bridge.cmd"
