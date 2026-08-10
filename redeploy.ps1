# ThermalFlow Remote Redeploy Script
# Pulls latest code from git and restarts gracefully

$ErrorActionPreference = "Stop"
$workingDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $workingDir

Write-Output "[$(Get-Date)] Starting redeployment process..."

# 1. Pull latest code from git main
Write-Output "Pulling latest code from git..."
git fetch origin main
git reset --hard origin/main

if ($LASTEXITCODE -ne 0) {
    Write-Output "Git pull failed, aborting redeploy"
    exit 1
}

Write-Output "Git pull successful"

# 2. Install dependencies (if package.json changed)
Write-Output "Installing dependencies..."
npm install --include=dev

if ($LASTEXITCODE -ne 0) {
    Write-Output "npm install failed"
    exit 1
}

# 3. Build
Write-Output "Building..."
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Output "Build failed"
    exit 1
}

# 4. Restart gracefully
Write-Output "Restarting server..."

# Find and stop existing node processes on ports 3000/3001
$ports = @(3000, 3001)
foreach ($port in $ports) {
    $processes = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($proc in $processes) {
        Write-Output "Stopping process $($proc.OwningProcess) on port $port"
        Stop-Process -Id $proc.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

# Wait a moment for ports to free up
Start-Sleep -Seconds 2

# Start server in background
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -WindowStyle Hidden -WorkingDirectory $workingDir

Write-Output "[$(Get-Date)] Redeployment complete. Server restarted."
