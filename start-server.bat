@echo off
cd /d "%~dp0"
echo [%date% %time%] Starting ThermalFlow Server >> server.log
npm start >> server.log 2>&1

