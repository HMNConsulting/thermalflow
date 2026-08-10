# ThermalFlow Remote Redeploy Script
$ErrorActionPreference = "Stop"
$workingDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $workingDir

Write-Output "[$(Get-Date)] Starting redeployment process..."

# 1. Wait for parent process to exit
Start-Sleep -Seconds 3

# 2. Force kill any node processes on app ports (3000, 3001)
$ports = @(3000, 3001)
foreach ($port in $ports) {
    $processes = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($proc in $processes) {
        Write-Output "Killing process $($proc.OwningProcess) on port $port"
        Stop-Process -Id $proc.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# 3. Clean up node_modules if needed (Optional, usually npm install is enough)
# Remove-Item -Recurse -Force node_modules

# 4. Install and Build
Write-Output "Running npm install (with devDependencies for build)..."
& npm install --include=dev
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Write-Output "Running npm run build..."
& npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

# 5. Restart via Start-Process
Write-Output "Restarting ThermalFlow Server..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c start-server.bat" -WindowStyle Hidden -WorkingDirectory $workingDir

Write-Output "Redeployment triggered successfully."
