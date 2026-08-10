#!/bin/bash
set -e
exec > redeploy.log 2>&1
echo "[$(date)] Starting redeployment process..."

# 1. Wait for parent process to exit
sleep 3

# 2. Force kill any node processes on app ports (3000, 3001)
echo "Killing processes on ports 3000 and 3001..."
lsof -t -i:3000 | xargs kill -9 2>/dev/null || true
lsof -t -i:3001 | xargs kill -9 2>/dev/null || true

# 4. Install and Build
echo "Running npm install (with devDependencies for build)..."
npm install --include=dev
echo "Running npm run build..."
npm run build

# 5. Restart
echo "Restarting application via 'npm start' in the background..."
nohup npm start > server.log 2>&1 &
echo "Redeployment triggered successfully."
