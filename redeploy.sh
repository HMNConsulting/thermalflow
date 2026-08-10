#!/bin/bash
# ThermalFlow Remote Redeploy Script
# Pulls latest code from git and restarts gracefully

set -e
exec > redeploy.log 2>&1
echo "[$(date)] Starting redeployment process..."

# 1. Pull latest code from git main
echo "Pulling latest code from git..."
git fetch origin main
git reset --hard origin/main

if [ $? -ne 0 ]; then
    echo "Git pull failed, aborting redeploy"
    exit 1
fi

echo "Git pull successful"

# 2. Install dependencies (if package.json changed)
echo "Installing dependencies..."
npm install --include=dev

# 3. Build
echo "Building..."
npm run build

# 4. Restart gracefully
echo "Restarting server..."

# Find and stop existing node processes on ports 3000/3001
lsof -t -i:3000 | xargs kill -9 2>/dev/null || true
lsof -t -i:3001 | xargs kill -9 2>/dev/null || true

# Wait a moment for ports to free up
sleep 2

# Start server in background
nohup npm start > server.log 2>&1 &

echo "[$(date)] Redeployment complete. Server restarted."
