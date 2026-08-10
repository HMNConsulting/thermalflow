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
$processesToKill = @()

foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $procId = $conn.OwningProcess
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Output "Found process $($proc.ProcessName) (PID: $procId) on port $port"
            $processesToKill += $procId
        }
    }
}

# Kill processes
foreach ($procId in $processesToKill) {
    Write-Output "Stopping process $procId"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

# Wait for ports to actually free up (check every 500ms, max 30 seconds)
Write-Output "Waiting for ports to free up..."
$maxWait = 30
$waited = 0
$portsFree = $false

while (-not $portsFree -and $waited -lt $maxWait) {
    $portsFree = $true
    foreach ($port in $ports) {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            $portsFree = $false
            break
        }
    }
    if (-not $portsFree) {
        Start-Sleep -Milliseconds 500
        $waited += 0.5
    }
}

if (-not $portsFree) {
    Write-Output "WARNING: Ports still in use after $maxWait seconds, forcing restart anyway..."
} else {
    Write-Output "Ports are free after $waited seconds"
}

# Additional safety: kill any remaining node processes that might be hanging
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*thermalflow*" -or $_.CommandLine -like "*server.js*" -or $_.CommandLine -like "*print-server.js*"
}
foreach ($proc in $nodeProcesses) {
    Write-Output "Killing hanging node process: $($proc.Id)"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

# Start server in background with logging
Write-Output "Starting ThermalFlow server..."

# Create a log file for the new server instance
$serverLog = Join-Path $workingDir "server.log"
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$startupLog = Join-Path $workingDir "startup_$timestamp.log"

# Use Start-Process with redirect to capture startup output
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = "cmd.exe"
$startInfo.Arguments = "/c npm start > `"$startupLog`" 2>&1"
$startInfo.WorkingDirectory = $workingDir
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$startInfo.CreateNoWindow = $true

$process = [System.Diagnostics.Process]::Start($startInfo)

# Wait a moment and check if it started
Start-Sleep -Seconds 5

# Verify server is running
$serverRunning = $false
foreach ($port in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $serverRunning = $true
        Write-Output "Server is listening on port $port"
    }
}

if ($serverRunning) {
    Write-Output "[$(Get-Date)] Redeployment complete. Server restarted successfully."
} else {
    Write-Output "[$(Get-Date)] WARNING: Server may not have started properly. Check $startupLog for details."
    
    # Try alternative startup method
    Write-Output "Attempting alternative startup method..."
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c start-server.bat" -WindowStyle Hidden -WorkingDirectory $workingDir
    
    Start-Sleep -Seconds 5
    
    # Check again
    foreach ($port in $ports) {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($conn) {
            Write-Output "Server is now listening on port $port (alternative method)"
            $serverRunning = $true
        }
    }
    
    if ($serverRunning) {
        Write-Output "[$(Get-Date)] Redeployment complete (via alternative method)."
    } else {
        Write-Output "[$(Get-Date)] ERROR: Server failed to start. Manual intervention required."
        exit 1
    }
}
