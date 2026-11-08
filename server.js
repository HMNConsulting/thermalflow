require('dotenv').config({ path: '.env.local' });
const express = require('express');
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const crypto = require('crypto');
const { spawn } = require('child_process');
// escpos removed (moved to standalone print-server.js)

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const port = 3000;

const DATA_FILE = path.join(__dirname, 'tasks.json');

// --- Persistence Helpers ---
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(raw);

            // Migration: Ensure all tasks have parentId and root doesn't list itself
            let migrated = false;
            Object.values(data.tasks).forEach(task => {
                if (task.id === 'root') return;
                if (!task.parentId) {
                    const parent = Object.values(data.tasks).find(t => t.children.includes(task.id));
                    if (parent) {
                        task.parentId = parent.id;
                        migrated = true;
                    }
                }
            });
            if (migrated) saveData(data);

            return data;
        }
    } catch (e) {
        console.error("Failed to load data:", e);
    }
    // Default initial state
    return {
        version: 1,
        tasks: {
            'root': { id: 'root', title: 'ThermalFlow', completed: false, children: [] }
        },
        scheduledPrints: []
    };
}

function runGC(state) {
    const RETENTION_HOURS = 24;
    const RETENTION_MS = RETENTION_HOURS * 60 * 60 * 1000;
    const now = Date.now();

    if (!state || !state.tasks || !state.tasks.root) return state;

    const tasksToRemove = new Set();

    // 1. Mark expired completed tasks (completed > 24h ago) and their entire subtrees for removal
    Object.values(state.tasks).forEach(task => {
        if (!task || task.id === 'root' || task.recurrence) return;

        if (task.completed) {
            const completedAt = typeof task.completedAt === 'string'
                ? new Date(task.completedAt).getTime()
                : task.completedAt;

            if (!completedAt || (now - completedAt) > RETENTION_MS) {
                const stack = [task.id];
                while (stack.length > 0) {
                    const cid = stack.pop();
                    if (!cid || tasksToRemove.has(cid)) continue;
                    tasksToRemove.add(cid);
                    const childTask = state.tasks[cid];
                    if (childTask && Array.isArray(childTask.children)) {
                        childTask.children.forEach(subId => stack.push(subId));
                    }
                }
            }
        }
    });

    // 2. Find all tasks reachable from 'root' (excluding tasks marked for removal)
    const reachable = new Set(['root']);
    const visitStack = [...(state.tasks.root.children || [])];
    while (visitStack.length > 0) {
        const currId = visitStack.pop();
        if (!currId || reachable.has(currId) || tasksToRemove.has(currId)) continue;
        const currTask = state.tasks[currId];
        if (!currTask) continue;
        reachable.add(currId);
        if (Array.isArray(currTask.children)) {
            currTask.children.forEach(cid => visitStack.push(cid));
        }
    }

    // 3. Any task not reachable from root is an orphan -> mark for removal
    Object.keys(state.tasks).forEach(id => {
        if (!reachable.has(id)) {
            tasksToRemove.add(id);
        }
    });

    // 4. Also check if any reachable task has dangling child IDs in .children
    let childrenCleaned = false;
    const newTasks = {};
    reachable.forEach(id => {
        const task = state.tasks[id];
        if (!task) return;
        const rawChildren = Array.isArray(task.children) ? task.children : [];
        const validChildren = rawChildren.filter(cid => reachable.has(cid) && !tasksToRemove.has(cid));
        if (validChildren.length !== rawChildren.length) {
            childrenCleaned = true;
            newTasks[id] = { ...task, children: validChildren };
        } else {
            newTasks[id] = task;
        }
    });

    if (tasksToRemove.size === 0 && !childrenCleaned) return state;

    console.log(`GC: Removed ${tasksToRemove.size} expired/orphaned task(s)`);

    const newState = {
        ...state,
        version: (state.version || 1) + 1,
        tasks: newTasks,
        lastModified: now
    };

    saveData(newState);
    return newState;
}

// Asynchronous, serialized debounced saver to prevent event-loop blocking
let isSaving = false;
let pendingSaveData = null;
let saveDebounceTimer = null;

async function performSave(data) {
    if (isSaving) {
        pendingSaveData = data;
        return;
    }
    isSaving = true;
    try {
        const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
        const content = JSON.stringify(data, null, 2);
        await fs.promises.writeFile(tempFile, content, 'utf8');
        await fs.promises.rename(tempFile, DATA_FILE);
    } catch (e) {
        console.error("Failed to save data asynchronously:", e);
    } finally {
        isSaving = false;
        if (pendingSaveData) {
            const nextData = pendingSaveData;
            pendingSaveData = null;
            performSave(nextData);
        }
    }
}

function saveData(data, immediate = false) {
    if (immediate) {
        if (saveDebounceTimer) {
            clearTimeout(saveDebounceTimer);
            saveDebounceTimer = null;
        }
        performSave(data);
        return;
    }
    pendingSaveData = data;
    if (saveDebounceTimer) return;
    saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        if (pendingSaveData) {
            const dataToSave = pendingSaveData;
            pendingSaveData = null;
            performSave(dataToSave);
        }
    }, 60);
}

// Ensure pending data is flushed synchronously on process exit
function flushSync() {
    if (pendingSaveData) {
        try {
            const tempFile = `${DATA_FILE}.exit.tmp`;
            fs.writeFileSync(tempFile, JSON.stringify(pendingSaveData, null, 2));
            fs.renameSync(tempFile, DATA_FILE);
        } catch (e) { }
    }
}
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });
process.on('beforeExit', () => { flushSync(); });

// Initialize "Master" State
let masterState = runGC(loadData());


// --- Recurrence Scheduler ---
// Check every minute
cron.schedule('* * * * *', () => {
    // console.log('Checking recurring tasks...');
    const now = Date.now();
    let modified = false;
    const tasks = masterState.tasks;
    const updates = {};

    Object.values(tasks).forEach(task => {
        if (!task.recurrence || typeof task.recurrence.nextRun !== 'number' || isNaN(task.recurrence.nextRun)) {
            return;
        }

        // Check if recurrence is due
        if (now >= task.recurrence.nextRun) {
            console.log(`Executing recurrence for task: ${task.title}`);

            const DAY = 24 * 60 * 60 * 1000;
            const step = task.recurrence.frequency === 'weekly' ? DAY * 7 : DAY;
            let nextRun = task.recurrence.nextRun + step;

            // Ensure nextRun is strictly in the future
            if (nextRun <= now) {
                const leapSteps = Math.floor((now - nextRun) / step) + 1;
                nextRun += leapSteps * step;
            }


            // Perform Action
            if (task.recurrence.action === 'reset') {
                // Reset: Uncheck and move to parent's children end? Or top?
                // Store logic: just uncheck.
                const updatedTask = {
                    ...task,
                    completed: false,
                    completedAt: undefined,
                    recurrence: {
                        ...task.recurrence,
                        nextRun
                    }
                };
                tasks[task.id] = updatedTask;
                updates[task.id] = updatedTask;
                modified = true;
            } else if (task.recurrence.action === 'clone') {
                // Clone: Create new task
                const newId = Math.random().toString(36).substring(2, 9);
                const newTask = {
                    ...task,
                    id: newId,
                    title: task.title, // Maybe append date?
                    completed: false,
                    completedAt: undefined,
                    recurrence: undefined, // Clone shouldn't recurse? Or should it? Usually instances don't.
                    createdAt: now
                };

                // Update parent to include new child
                const parent = tasks[task.parentId];
                if (parent) {
                    const updatedParent = {
                        ...parent,
                        children: [...parent.children, newId]
                    };
                    tasks[parent.id] = updatedParent;
                    updates[parent.id] = updatedParent;
                }

                // Update original task's nextRun
                const updatedOriginal = {
                    ...task,
                    recurrence: {
                        ...task.recurrence,
                        nextRun
                    }
                };
                tasks[task.id] = updatedOriginal;
                updates[task.id] = updatedOriginal;

                tasks[newId] = newTask;
                updates[newId] = newTask;
                modified = true;
            }
        }
    });

    // --- Check Scheduled Prints ---
    const prints = masterState.scheduledPrints || [];
    prints.forEach(printJob => {
        if (!printJob.enabled) return;

        // Check time
        const [hours, minutes] = printJob.time.split(':').map(Number);
        const scheduledTime = new Date();
        scheduledTime.setHours(hours, minutes, 0, 0);

        // Logic: If current minute matches scheduled minute AND it hasn't run today
        // Simple "Last Run" check is best.

        // If lastRun is today, skip.
        if (printJob.lastRun) {
            const lastDate = new Date(printJob.lastRun);
            if (lastDate.toDateString() === new Date().toDateString()) return;
        }

        // If it's time (or slightly past time but within same minute window)
        // Cron runs every minute. 
        // We just check if Now >= ScheduledTime AND Now < ScheduledTime + 1min? 
        // Or simpler: Now >= ScheduledTime. Warning: If server restarts, it might print immediately if time passed.
        // Let's assume user wants it to catch up if missed? Or strict? 
        // Strict is better for printers. "Only print if within 5 mins of target".
        const timeDiff = now - scheduledTime.getTime();

        // Trigger window: 0 to 5 minutes after scheduled time
        if (timeDiff >= 0 && timeDiff < 5 * 60 * 1000) {
            console.log(`Triggering Scheduled Print: ${printJob.label}`);

            // 1. Gather Tasks from Column
            const gatherTasks = () => {
                // We need to traverse or find tasks in "Today" etc.
                // This mirrors the logic in TaskColumn.tsx but backend side.
                // "Today" logic relies on 'createdAt' or just 'group'. 
                // Actually, TaskColumn Logic is derived. 'Today' isn't a stored property.
                // Implementation: Iterate all tasks, check date, filters.

                const result = [];
                const allTasks = Object.values(masterState.tasks);

                // Columns are "Today", "Yesterday", or "dateLabel".
                // Logic to match TaskColumn.tsx:
                const todayDate = new Date();

                if (printJob.columnName === 'Today') {
                    return allTasks.filter(t => {
                        if (t.id === 'root' || t.completed) return false;
                        const d = new Date(t.createdAt || 0);
                        return d.toDateString() === todayDate.toDateString();
                    });
                }
                return [];
            };

            const tasksToPrint = gatherTasks();

            if (tasksToPrint.length > 0) {
                // 2. Send to Print Server
                const payload = {
                    title: printJob.label.toUpperCase(),
                    date: new Date().toLocaleString(),
                    tasks: tasksToPrint.map(t => `[ ] ${t.title}`)
                };

                // Fire and forget fetch to local print server
                fetch('http://localhost:3001/print', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }).catch(err => console.error("Scheduled print failed", err));
            }

            // 3. Update lastRun
            const updatedPrint = { ...printJob, lastRun: now };
            const newPrints = (masterState.scheduledPrints || []).map(p => p.id === printJob.id ? updatedPrint : p);
            masterState.scheduledPrints = newPrints;
            modified = true;
        }
    });

    if (modified) {
        masterState.version++;
        masterState.lastModified = now;
        saveData(masterState);
        if (global.io) {
            global.io.emit('sync:patched', {
                tasks: updates,
                version: masterState.version,
                lastModified: masterState.lastModified
            });
        }
    }

    // Periodically purge completed tasks older than 24h & any orphaned tasks
    const prevVersion = masterState.version;
    masterState = runGC(masterState);
    if (masterState.version !== prevVersion && global.io) {
        const { geminiApiKey, mcpOAuth, ...publicState } = masterState;
        global.io.emit('sync:broadcast', publicState);
    }
});

app.prepare().then(() => {
    const expressApp = express();
    expressApp.set('trust proxy', 1);
    const server = createServer(expressApp);
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        },
        path: "/socket.io"
    });

    // Make io accessible to cron
    global.io = io;

    expressApp.use(cors());
    expressApp.use(bodyParser.json());
    expressApp.use(bodyParser.urlencoded({ extended: true }));

    // --- Socket.IO Sync ---
    function getPublicState(state) {
        const { geminiApiKey, mcpOAuth, ...publicState } = state;
        return publicState;
    }

    io.on('connection', (socket) => {
        // Send current state to newly connected client (excluding raw API key)
        socket.emit('sync:init', getPublicState(masterState));

        // Log streaming for redeploy
        let logTailProcess = null;
        
        socket.on('logs:subscribe', (data) => {
            const { key } = data || {};
            const secret = process.env.REDEPLOY_KEY;
            
            if (!secret || key !== secret) {
                socket.emit('logs:error', { error: 'Unauthorized' });
                return;
            }
            
            console.log('Client subscribed to log stream');
            socket.emit('logs:info', { message: 'Connected to log stream' });
            
            // Start tailing the log file
            const logFile = path.join(__dirname, 'redeploy.log');
            const isWin = process.platform === "win32";
            
            if (isWin) {
                // Windows: Use PowerShell Get-Content -Wait
                logTailProcess = spawn('powershell.exe', [
                    '-Command', 
                    `Get-Content -Path "${logFile}" -Wait -Tail 50`
                ]);
            } else {
                // Linux/Mac: Use tail -f
                logTailProcess = spawn('tail', ['-f', '-n', '50', logFile]);
            }
            
            logTailProcess.stdout.on('data', (data) => {
                socket.emit('logs:data', { lines: data.toString().split('\n').filter(l => l.trim()) });
            });
            
            logTailProcess.stderr.on('data', (data) => {
                socket.emit('logs:error', { error: data.toString() });
            });
            
            logTailProcess.on('close', () => {
                socket.emit('logs:info', { message: 'Log stream ended' });
            });
        });
        
        socket.on('logs:unsubscribe', () => {
            if (logTailProcess) {
                logTailProcess.kill();
                logTailProcess = null;
                socket.emit('logs:info', { message: 'Unsubscribed from log stream' });
            }
        });
        
        socket.on('disconnect', () => {
            if (logTailProcess) {
                logTailProcess.kill();
                logTailProcess = null;
            }
        });

        // Handle full updates from client (Fallback/Legacy)
        socket.on('sync:update', (newState) => {
            if (newState.version > masterState.version) {
                masterState.tasks = newState.tasks;
                if (newState.scheduledPrints) masterState.scheduledPrints = newState.scheduledPrints;
                masterState.version = newState.version;
                masterState.lastModified = newState.lastModified || Date.now();
                saveData(masterState);
                socket.broadcast.emit('sync:broadcast', getPublicState(masterState));
            }
        });

        // Handle Delta Patches (Optimized)
        socket.on('sync:patch', (patch) => {
            const { tasks, deletedIds, version } = patch;
            let modified = false;

            // Apply modifications/additions
            if (tasks) {
                Object.entries(tasks).forEach(([id, task]) => {
                    masterState.tasks[id] = task;
                    modified = true;
                });
            }

            // Apply deletions
            if (deletedIds) {
                deletedIds.forEach(id => {
                    delete masterState.tasks[id];
                    modified = true;
                });
            }

            if (modified) {
                masterState.version++;
                masterState.lastModified = Date.now();
                saveData(masterState);
                // Broadcast the patch to ALL clients (including sender to confirm version)
                io.emit('sync:patched', {
                    tasks,
                    deletedIds,
                    version: masterState.version,
                    lastModified: masterState.lastModified
                });
            }
        });
    });


    // --- Printing Proxy ---
    // The print server runs on port 3001. We proxy requests here so that
    // clients (e.g. via Cloudflare) don't need to reach 3001 directly.
    const PRINT_SERVER_BASE = 'http://localhost:3001';

    expressApp.post('/api/print', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/print):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    expressApp.post('/api/print-single', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/print-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/print-single):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    expressApp.post('/api/print-action-plan', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/print-action-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/print-action-plan):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    // --- New Print Server Endpoints ---

    expressApp.post('/api/print-qr', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/print-qr`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/print-qr):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    expressApp.post('/api/print-barcode', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/print-barcode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/print-barcode):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    expressApp.get('/api/printer-status', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/printer-status`);
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/printer-status):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    expressApp.get('/api/queue', async (req, res) => {
        try {
            const response = await fetch(`${PRINT_SERVER_BASE}/queue`);
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (error) {
            console.error('Print proxy error (/api/queue):', error);
            res.status(502).json({ error: 'Could not connect to print server' });
        }
    });

    // --- Scan-to-Done QR Toggle Endpoint ---
    expressApp.get('/api/tasks/toggle-qr', (req, res) => {
        const { id } = req.query;
        if (!id || typeof id !== 'string' || !masterState.tasks[id]) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
                <title>ThermalFlow - Task Not Found</title>
                <style>
                    body { background: #09090b; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
                    .card { border: 1px solid #27272a; padding: 36px 24px; border-radius: 20px; background: #18181b; max-width: 400px; width: 100%; box-shadow: 0 25px 50px rgba(0,0,0,0.7); }
                    .icon { font-size: 48px; margin-bottom: 12px; }
                    h2 { margin: 0 0 8px 0; font-size: 20px; color: #ef4444; }
                    p { color: #a1a1aa; margin: 0 0 24px 0; font-size: 14px; }
                    .btn-primary { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px 20px; background: #f4f4f5; color: #09090b; font-weight: 700; font-size: 14px; border-radius: 12px; text-decoration: none; box-sizing: border-box; }
                </style></head>
                <body>
                    <div class="card">
                        <div class="icon">🔍</div>
                        <h2>Task Not Found</h2>
                        <p>This task may have been deleted or archived.</p>
                        <a href="/" class="btn-primary">Return to Task Board &rarr;</a>
                    </div>
                </body></html>
            `);
        }

        const task = masterState.tasks[id];
        const newCompleted = !task.completed;
        const now = Date.now();
        task.completed = newCompleted;
        task.completedAt = newCompleted ? now : undefined;

        masterState.version++;
        masterState.lastModified = now;
        saveData(masterState);

        if (global.io) {
            global.io.emit('sync:patch', {
                tasks: { [id]: task },
                version: masterState.version,
                lastModified: masterState.lastModified
            });
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <title>ThermalFlow - Scan-to-Done</title>
            <style>
                * { box-sizing: border-box; }
                body {
                    background: #09090b;
                    color: #f4f4f5;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    margin: 0;
                    padding: 20px;
                    text-align: center;
                }
                .card {
                    border: 1px solid #27272a;
                    padding: 36px 24px;
                    border-radius: 24px;
                    background: #18181b;
                    max-width: 420px;
                    width: 100%;
                    box-shadow: 0 25px 60px rgba(0,0,0,0.8);
                }
                .icon { font-size: 52px; margin-bottom: 16px; }
                .app-name {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    color: #71717a;
                    margin-bottom: 10px;
                    font-weight: 700;
                }
                h1 {
                    margin: 0 0 16px 0;
                    font-size: 22px;
                    word-break: break-word;
                    line-height: 1.35;
                }
                .status-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 16px;
                    border-radius: 9999px;
                    font-size: 13px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    ${newCompleted ? 'background: #052e16; color: #4ade80; border: 1px solid #166534;' : 'background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46;'}
                }
                .hint {
                    margin: 16px 0 24px 0;
                    font-size: 13px;
                    color: #a1a1aa;
                    line-height: 1.4;
                }
                .actions {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 20px;
                }
                .btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    padding: 14px 20px;
                    border-radius: 14px;
                    font-size: 15px;
                    font-weight: 700;
                    text-decoration: none;
                    cursor: pointer;
                    transition: all 0.15s ease-in-out;
                    border: none;
                }
                .btn:active { transform: scale(0.98); }
                .btn-primary {
                    background: #f4f4f5;
                    color: #09090b;
                    box-shadow: 0 4px 14px rgba(255,255,255,0.12);
                }
                .btn-primary:hover { background: #ffffff; }
                .btn-secondary {
                    background: #27272a;
                    color: #d4d4d8;
                    border: 1px solid #3f3f46;
                    font-size: 14px;
                    font-weight: 600;
                }
                .btn-secondary:hover { background: #3f3f46; color: #f4f4f5; }
                .redirect-notice {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    font-size: 12px;
                    color: #71717a;
                    margin-top: 8px;
                }
                .cancel-btn {
                    background: none;
                    border: none;
                    color: #38bdf8;
                    cursor: pointer;
                    font-size: 12px;
                    text-decoration: underline;
                    padding: 0;
                    font-family: inherit;
                }
                .progress-container {
                    width: 100%;
                    height: 3px;
                    background: #27272a;
                    border-radius: 2px;
                    overflow: hidden;
                    margin-top: 14px;
                }
                .progress-bar {
                    height: 100%;
                    background: #4ade80;
                    width: 100%;
                    transform-origin: left;
                    animation: drain 5s linear forwards;
                }
                @keyframes drain {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
            </style></head>
            <body>
                <div class="card">
                    <div class="icon">${newCompleted ? '✅' : '↩️'}</div>
                    <div class="app-name">ThermalFlow Slip Verified</div>
                    <h1>${task.title.replace(/</g, '&lt;')}</h1>
                    <div class="status-badge">${newCompleted ? '● Marked Completed' : '● Reopened'}</div>
                    <div class="hint">Your digital task board has been updated in real-time.</div>

                    <div class="actions">
                        <a href="/?select=${encodeURIComponent(task.id)}" id="primary-link" class="btn btn-primary">
                            <span>Open Task Board</span> &rarr;
                        </a>
                        <a href="/api/tasks/toggle-qr?id=${encodeURIComponent(task.id)}" class="btn btn-secondary">
                            <span>&#8635; Toggle Again (Undo)</span>
                        </a>
                    </div>

                    <div class="redirect-notice" id="redirect-banner">
                        <span>Auto-opening board in <strong id="timer">5</strong>s...</span>
                        <span>&middot;</span>
                        <button type="button" class="cancel-btn" onclick="cancelRedirect()">Stay here</button>
                    </div>
                    <div class="progress-container" id="pbar-container">
                        <div class="progress-bar" id="pbar"></div>
                    </div>
                </div>

                <script>
                    let timeLeft = 5;
                    const timerEl = document.getElementById('timer');
                    const bannerEl = document.getElementById('redirect-banner');
                    const pbarContainer = document.getElementById('pbar-container');
                    let cancelled = false;

                    const interval = setInterval(() => {
                        if (cancelled) return;
                        timeLeft--;
                        if (timerEl) timerEl.textContent = timeLeft;
                        if (timeLeft <= 0) {
                            clearInterval(interval);
                            window.location.href = '/?select=${encodeURIComponent(task.id)}';
                        }
                    }, 1000);

                    function cancelRedirect() {
                        cancelled = true;
                        clearInterval(interval);
                        if (bannerEl) bannerEl.innerHTML = '<span style="color:#a1a1aa">Auto-redirect paused.</span>';
                        if (pbarContainer) pbarContainer.style.display = 'none';
                    }
                </script>
            </body></html>
        `);
    });


    // --- Task Capture Endpoint (adds task to web UI + prints) ---

    const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://tasks.nebulous.space';

    async function createTaskAndPrint({ title, parentId = 'root', priority, print = true, qrOnChit = true, createdBy = 'gemini-mcp' }) {
        const cleanTitle = title.trim();
        const newId = Math.random().toString(36).substring(2, 9);
        const now = Date.now();
        const targetParentId = masterState.tasks[parentId] ? parentId : 'root';

        const newTask = {
            id: newId,
            title: cleanTitle,
            completed: false,
            children: [],
            parentId: targetParentId,
            createdAt: now,
            createdBy,
            priority: priority && priority !== 'normal' ? priority : undefined
        };

        masterState.tasks[newId] = newTask;
        const parent = masterState.tasks[targetParentId];
        masterState.tasks[targetParentId] = {
            ...parent,
            children: [...parent.children, newId]
        };

        masterState.version++;
        masterState.lastModified = now;
        saveData(masterState);

        if (global.io) {
            global.io.emit('sync:patched', {
                tasks: {
                    [newId]: newTask,
                    [targetParentId]: masterState.tasks[targetParentId]
                },
                version: masterState.version,
                lastModified: masterState.lastModified
            });
        }

        let printResult = null;
        if (print) {
            try {
                const qrUrl = qrOnChit ? `${PUBLIC_APP_URL}/api/tasks/toggle-qr?id=${newId}` : undefined;
                const printResponse = await fetch(`${PRINT_SERVER_BASE}/print-single`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskName: cleanTitle,
                        taskId: newId,
                        qrUrl,
                        priority: newTask.priority
                    })
                });
                printResult = await printResponse.json();
            } catch (printError) {
                console.error('Task captured but print failed:', printError);
                printResult = { error: 'Print failed' };
            }
        }

        return { taskId: newId, task: newTask, printed: Boolean(print), printResult };
    }

    expressApp.post('/api/tasks/capture', async (req, res) => {
        const { title, parentId = 'root', priority, print = true, qrOnChit = true } = req.body;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: 'title is required and must be a non-empty string' });
        }
        if (title.length > 200) {
            return res.status(400).json({ error: 'title too long: max 200 chars' });
        }

        const result = await createTaskAndPrint({ title, parentId, priority, print, qrOnChit, createdBy: 'api' });
        console.log(`Task captured via API: "${title}" (id: ${result.taskId}, printed: ${print})`);
        res.json({
            success: true,
            ...result
        });
    });

    // --- Model Context Protocol (MCP) Server Endpoints (/mcp & /sse) ---
    const MCP_TOOLS = [
        {
            name: 'list_tasks',
            description: 'View tasks on the ThermalFlow board. Returns pending and/or completed tasks with their IDs, hierarchy, priority, and subtask counts.',
            inputSchema: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['pending', 'completed', 'all'],
                        description: 'Filter tasks by completion status (default: pending).'
                    },
                    parentId: {
                        type: 'string',
                        description: 'Optional parent task ID to list only subtasks of a specific task.'
                    },
                    search: {
                        type: 'string',
                        description: 'Optional search keyword to filter tasks by title.'
                    }
                }
            }
        },
        {
            name: 'add_task',
            description: 'Add a new task (or multiple tasks) to ThermalFlow and physically print a thermal receipt chit by default. Print on creation defaults to true.',
            inputSchema: {
                type: 'object',
                properties: {
                    title: {
                        type: 'string',
                        description: 'The title of the task to create.'
                    },
                    subtasks: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional list of subtask titles to create under this task.'
                    },
                    parentId: {
                        type: 'string',
                        description: 'Parent task ID (defaults to "root" for top-level tasks).'
                    },
                    priority: {
                        type: 'string',
                        enum: ['normal', 'high', 'urgent'],
                        description: 'Task priority level (default: normal).'
                    },
                    print: {
                        type: 'boolean',
                        description: 'Whether to physically print the task chit on the thermal printer upon creation. Defaults to true.'
                    }
                },
                required: ['title']
            }
        },
        {
            name: 'complete_task',
            description: 'Mark a task as completed (or reopen it) by task ID or by matching its title.',
            inputSchema: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'Exact ID of the task to complete.'
                    },
                    titleSearch: {
                        type: 'string',
                        description: 'If taskId is unknown, search text to match the task title.'
                    },
                    completed: {
                        type: 'boolean',
                        description: 'Completion state to set (defaults to true).'
                    }
                }
            }
        },
        {
            name: 'print_tasks',
            description: 'Print a single task chit, an action plan checklist, or a full task manifest receipt on the physical thermal printer.',
            inputSchema: {
                type: 'object',
                properties: {
                    mode: {
                        type: 'string',
                        enum: ['single', 'manifest', 'today'],
                        description: '"single" prints one task chit; "manifest" prints all pending tasks; "today" prints today\'s pending tasks.'
                    },
                    taskId: {
                        type: 'string',
                        description: 'Task ID to print (when mode is "single") or root of subtree.'
                    },
                    customTitle: {
                        type: 'string',
                        description: 'Optional custom text or title to print.'
                    }
                }
            }
        },
        {
            name: 'delete_task',
            description: 'Delete a task from the ThermalFlow board by ID.',
            inputSchema: {
                type: 'object',
                properties: {
                    taskId: {
                        type: 'string',
                        description: 'The ID of the task to delete.'
                    }
                },
                required: ['taskId']
            }
        }
    ];

    async function executeMcpTool(name, args = {}) {
        if (name === 'list_tasks') {
            const status = args.status || 'pending';
            const search = (args.search || '').trim().toLowerCase();
            const parentFilter = args.parentId;

            const allTasks = Object.values(masterState.tasks).filter(t => t.id !== 'root');
            const filtered = allTasks.filter(t => {
                if (status === 'pending' && t.completed) return false;
                if (status === 'completed' && !t.completed) return false;
                if (parentFilter && t.parentId !== parentFilter) return false;
                if (search && !t.title.toLowerCase().includes(search)) return false;
                return true;
            });

            const lines = filtered.map(t => {
                const parentTitle = t.parentId && t.parentId !== 'root' && masterState.tasks[t.parentId]
                    ? ` (under "${masterState.tasks[t.parentId].title}")`
                    : '';
                const prio = t.priority && t.priority !== 'normal' ? ` [${t.priority.toUpperCase()}]` : '';
                return `- [${t.completed ? 'x' : ' '}] ${t.title}${prio} (id: ${t.id})${parentTitle}`;
            });

            return {
                content: [{
                    type: 'text',
                    text: filtered.length > 0
                        ? `Found ${filtered.length} task(s):\n${lines.join('\n')}`
                        : `No ${status} tasks found.`
                }]
            };
        }

        if (name === 'add_task') {
            const title = (args.title || '').trim();
            if (!title) {
                return { isError: true, content: [{ type: 'text', text: 'Error: title is required.' }] };
            }
            // Default print to true unless explicitly passed as false
            const shouldPrint = args.print !== false;
            const parentId = args.parentId || 'root';
            const priority = args.priority || 'normal';

            const mainResult = await createTaskAndPrint({
                title,
                parentId,
                priority,
                print: shouldPrint,
                qrOnChit: true,
                createdBy: 'gemini-mcp'
            });

            const createdSubtasks = [];
            if (Array.isArray(args.subtasks) && args.subtasks.length > 0) {
                for (const subTitle of args.subtasks) {
                    if (typeof subTitle === 'string' && subTitle.trim()) {
                        const subRes = await createTaskAndPrint({
                            title: subTitle.trim(),
                            parentId: mainResult.taskId,
                            priority: 'normal',
                            print: shouldPrint,
                            qrOnChit: true,
                            createdBy: 'gemini-mcp'
                        });
                        createdSubtasks.push(subRes.task);
                    }
                }
            }

            const printStatusMsg = shouldPrint
                ? (mainResult.printResult && !mainResult.printResult.error ? 'Printed to thermal printer.' : 'Queued/simulated print.')
                : 'Print skipped (print=false).';

            return {
                content: [{
                    type: 'text',
                    text: `Created task "${mainResult.task.title}" (id: ${mainResult.taskId})${createdSubtasks.length ? ` with ${createdSubtasks.length} subtask(s)` : ''}. ${printStatusMsg}`
                }]
            };
        }

        if (name === 'complete_task') {
            let target = args.taskId ? masterState.tasks[args.taskId] : null;
            if (!target && args.titleSearch) {
                const q = args.titleSearch.trim().toLowerCase();
                target = Object.values(masterState.tasks).find(t => t.id !== 'root' && t.title.toLowerCase().includes(q));
            }
            if (!target || target.id === 'root') {
                return { isError: true, content: [{ type: 'text', text: 'Task not found.' }] };
            }

            const newCompleted = args.completed !== undefined ? Boolean(args.completed) : true;
            const now = Date.now();
            const changedTasks = {};

            const stack = [target.id];
            while (stack.length > 0) {
                const tid = stack.pop();
                const t = masterState.tasks[tid];
                if (!t) continue;
                const updated = {
                    ...t,
                    completed: newCompleted,
                    completedAt: newCompleted ? now : undefined
                };
                masterState.tasks[tid] = updated;
                changedTasks[tid] = updated;
                if (newCompleted && Array.isArray(t.children)) {
                    t.children.forEach(cid => stack.push(cid));
                }
            }

            masterState.version++;
            masterState.lastModified = now;
            saveData(masterState);

            if (global.io) {
                global.io.emit('sync:patched', {
                    tasks: changedTasks,
                    version: masterState.version,
                    lastModified: masterState.lastModified
                });
            }

            return {
                content: [{
                    type: 'text',
                    text: `Task "${target.title}" (id: ${target.id}) marked as ${newCompleted ? 'COMPLETED' : 'INCOMPLETE'}.`
                }]
            };
        }

        if (name === 'print_tasks') {
            const mode = args.mode || (args.taskId ? 'single' : 'manifest');

            if (mode === 'single') {
                const task = args.taskId ? masterState.tasks[args.taskId] : null;
                const taskName = args.customTitle || task?.title;
                if (!taskName) {
                    return { isError: true, content: [{ type: 'text', text: 'Provide a valid taskId or customTitle for single chit printing.' }] };
                }
                const qrUrl = task ? `${PUBLIC_APP_URL}/api/tasks/toggle-qr?id=${task.id}` : undefined;
                const resp = await fetch(`${PRINT_SERVER_BASE}/print-single`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskName,
                        taskId: task?.id,
                        qrUrl,
                        priority: task?.priority
                    })
                });
                const data = await resp.json().catch(() => ({}));
                return {
                    content: [{
                        type: 'text',
                        text: resp.ok ? `Printed single chit for "${taskName}".` : `Print failed: ${data.error || resp.statusText}`
                    }]
                };
            }

            const todayStr = new Date().toDateString();
            const list = [];
            const traverse = (id, level) => {
                const t = masterState.tasks[id];
                if (!t) return;
                if (id !== 'root' && !t.completed) {
                    if (mode !== 'today' || new Date(t.createdAt || 0).toDateString() === todayStr) {
                        list.push(`[ ] ${'  '.repeat(Math.max(0, level - 1))}${t.title}`);
                    }
                }
                (t.children || []).forEach(cid => traverse(cid, level + 1));
            };
            const startId = args.taskId && masterState.tasks[args.taskId] ? args.taskId : 'root';
            traverse(startId, 0);

            if (list.length === 0) {
                return { content: [{ type: 'text', text: 'No pending tasks to print.' }] };
            }

            const resp = await fetch(`${PRINT_SERVER_BASE}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: args.customTitle || (mode === 'today' ? 'TODAY MANIFEST' : 'THERMALFLOW MANIFEST'),
                    date: new Date().toLocaleString(),
                    tasks: list.slice(0, 50)
                })
            });
            const data = await resp.json().catch(() => ({}));
            return {
                content: [{
                    type: 'text',
                    text: resp.ok ? `Printed manifest with ${list.length} task(s).` : `Print failed: ${data.error || resp.statusText}`
                }]
            };
        }

        if (name === 'delete_task') {
            const id = args.taskId;
            if (!id || id === 'root' || !masterState.tasks[id]) {
                return { isError: true, content: [{ type: 'text', text: 'Valid taskId is required.' }] };
            }
            const deletedTitle = masterState.tasks[id].title;
            const parent = Object.values(masterState.tasks).find(t => (t.children || []).includes(id));
            delete masterState.tasks[id];

            const changedTasks = {};
            if (parent) {
                const updatedParent = {
                    ...parent,
                    children: parent.children.filter(cid => cid !== id)
                };
                masterState.tasks[parent.id] = updatedParent;
                changedTasks[parent.id] = updatedParent;
            }

            masterState.version++;
            masterState.lastModified = Date.now();
            saveData(masterState);

            if (global.io) {
                global.io.emit('sync:patched', {
                    tasks: changedTasks,
                    deletedIds: [id],
                    version: masterState.version,
                    lastModified: masterState.lastModified
                });
            }

            return {
                content: [{ type: 'text', text: `Deleted task "${deletedTitle}" (id: ${id}).` }]
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    }

    async function handleMcpRpcRequest(rpc) {
        if (!rpc || typeof rpc !== 'object') return null;
        const { id, method, params } = rpc;

        // Notifications (no id) do not return a response object
        if (id === undefined || id === null) {
            return null;
        }

        try {
            if (method === 'initialize') {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
                        capabilities: {
                            tools: { listChanged: false }
                        },
                        serverInfo: {
                            name: 'thermalflow-mcp',
                            version: '1.0.0'
                        }
                    }
                };
            }

            if (method === 'ping') {
                return { jsonrpc: '2.0', id, result: {} };
            }

            if (method === 'tools/list') {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { tools: MCP_TOOLS }
                };
            }

            if (method === 'tools/call') {
                const toolName = params?.name;
                const toolArgs = params?.arguments || {};
                const result = await executeMcpTool(toolName, toolArgs);
                return {
                    jsonrpc: '2.0',
                    id,
                    result
                };
            }

            if (method === 'resources/list') {
                return { jsonrpc: '2.0', id, result: { resources: [] } };
            }

            if (method === 'prompts/list') {
                return { jsonrpc: '2.0', id, result: { prompts: [] } };
            }

            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Method not found: ${method}` }
            };
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32000, message: err.message || 'Internal MCP server error' }
            };
        }
    }

    // --- MCP OAuth 2.1 Provider (RFC 9728, RFC 8414, RFC 7591, PKCE S256) ---
    function ensureMcpOAuthState() {
        if (!masterState.mcpOAuth) {
            masterState.mcpOAuth = {
                enabled: true,
                clientId: 'thermalflow-mcp',
                clientSecret: 'tf_mcp_' + crypto.randomBytes(12).toString('hex'),
                passkey: process.env.MCP_PASSKEY || process.env.REDEPLOY_KEY || 'tf_redeploy_secret_8429',
                tokens: {},
                clients: {}
            };
            saveData(masterState);
        } else {
            if (masterState.mcpOAuth.enabled === undefined) masterState.mcpOAuth.enabled = true;
            if (!masterState.mcpOAuth.clientId) masterState.mcpOAuth.clientId = 'thermalflow-mcp';
            if (!masterState.mcpOAuth.clientSecret) masterState.mcpOAuth.clientSecret = 'tf_mcp_' + crypto.randomBytes(12).toString('hex');
            if (!masterState.mcpOAuth.passkey) masterState.mcpOAuth.passkey = process.env.MCP_PASSKEY || process.env.REDEPLOY_KEY || 'tf_redeploy_secret_8429';
            if (!masterState.mcpOAuth.tokens) masterState.mcpOAuth.tokens = {};
            if (!masterState.mcpOAuth.clients) masterState.mcpOAuth.clients = {};
        }
        return masterState.mcpOAuth;
    }

    const oauthAuthCodes = new Map(); // code -> { clientId, redirectUri, codeChallenge, codeChallengeMethod, scope, resource, expiresAt }

    function getRequestOrigin(req) {
        const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
        const forwardedHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
        const host = forwardedHost || req.headers.host || 'print.nebulous.space';
        const proto = forwardedProto || (host.includes('localhost') || host.startsWith('127.') || host.startsWith('192.168.') ? 'http' : 'https');
        return `${proto}://${host}`;
    }

    function verifyMcpBearer(req) {
        const oauth = ensureMcpOAuthState();
        if (!oauth.enabled) return true;

        const authHeader = req.headers.authorization || '';
        const queryToken = req.query.access_token || req.query.token || '';
        let token = '';
        if (authHeader.toLowerCase().startsWith('bearer ')) {
            token = authHeader.slice(7).trim();
        } else if (typeof queryToken === 'string' && queryToken.trim()) {
            token = queryToken.trim();
        }

        if (!token) return false;
        if (token === oauth.clientSecret || token === oauth.passkey) return true;

        const record = oauth.tokens[token];
        if (!record) return false;
        if (record.expiresAt && Date.now() > record.expiresAt) {
            delete oauth.tokens[token];
            saveData(masterState);
            return false;
        }
        return true;
    }

    function sendMcpUnauthorized(req, res) {
        const origin = getRequestOrigin(req);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
        res.setHeader(
            'WWW-Authenticate',
            `Bearer realm="thermalflow-mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`
        );
        return res.status(401).json({
            error: 'unauthorized',
            error_description: 'OAuth 2.1 Bearer token required. Discover metadata at /.well-known/oauth-protected-resource'
        });
    }

    // 1. Protected Resource Metadata (RFC 9728)
    const handleProtectedResourceMeta = (req, res) => {
        const origin = getRequestOrigin(req);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
            bearer_methods_supported: ['header'],
            scopes_supported: ['mcp:tools']
        });
    };
    expressApp.get('/.well-known/oauth-protected-resource', handleProtectedResourceMeta);
    expressApp.get('/.well-known/oauth-protected-resource/mcp', handleProtectedResourceMeta);

    // 2. Authorization Server Metadata (RFC 8414 & OIDC Discovery)
    const handleAuthServerMeta = (req, res) => {
        const origin = getRequestOrigin(req);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({
            issuer: origin,
            authorization_endpoint: `${origin}/oauth/authorize`,
            token_endpoint: `${origin}/oauth/token`,
            registration_endpoint: `${origin}/oauth/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
            token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
            code_challenge_methods_supported: ['S256', 'plain'],
            scopes_supported: ['mcp:tools', 'openid', 'profile']
        });
    };
    expressApp.get('/.well-known/oauth-authorization-server', handleAuthServerMeta);
    expressApp.get('/.well-known/openid-configuration', handleAuthServerMeta);

    // 3. Dynamic Client Registration (RFC 7591)
    expressApp.post('/oauth/register', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const oauth = ensureMcpOAuthState();
        const body = req.body || {};
        const clientId = 'tf_client_' + crypto.randomBytes(8).toString('hex');
        const clientSecret = 'tf_sec_' + crypto.randomBytes(16).toString('hex');
        const nowSec = Math.floor(Date.now() / 1000);

        const clientRecord = {
            client_id: clientId,
            client_secret: clientSecret,
            client_id_issued_at: nowSec,
            client_secret_expires_at: 0,
            client_name: body.client_name || 'MCP Client',
            redirect_uris: Array.isArray(body.redirect_uris) ? body.redirect_uris : [],
            grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
            response_types: body.response_types || ['code'],
            token_endpoint_auth_method: body.token_endpoint_auth_method || 'none'
        };

        oauth.clients[clientId] = clientRecord;
        saveData(masterState);
        res.status(201).json(clientRecord);
    });

    // 4. OAuth 2.1 Authorization Consent Screen (GET & POST /oauth/authorize)
    function renderAuthorizePage(params, errorMsg = '') {
        const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize ThermalFlow MCP</title>
    <style>
        * { box-sizing: border-box; }
        body {
            background: #09090b;
            color: #f4f4f5;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: #18181b;
            border: 1px solid #27272a;
            border-radius: 20px;
            max-width: 420px;
            width: 100%;
            padding: 32px 26px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.75);
        }
        .badge {
            display: inline-block;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.3);
            margin-bottom: 14px;
        }
        h1 { font-size: 20px; margin: 0 0 8px 0; }
        p { color: #a1a1aa; font-size: 12px; line-height: 1.5; margin: 0 0 20px 0; }
        .scopes {
            background: #09090b;
            border: 1px solid #27272a;
            border-radius: 12px;
            padding: 12px 14px;
            margin-bottom: 20px;
            font-size: 11px;
            color: #d4d4d8;
        }
        .scopes div { margin: 4px 0; }
        label {
            display: block;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #a1a1aa;
            margin-bottom: 6px;
        }
        input[type="password"] {
            width: 100%;
            background: #09090b;
            border: 1px solid #3f3f46;
            color: #f4f4f5;
            padding: 12px 14px;
            border-radius: 10px;
            font-family: inherit;
            font-size: 13px;
            margin-bottom: 16px;
            outline: none;
        }
        input[type="password"]:focus { border-color: #10b981; }
        .error {
            background: rgba(239, 68, 68, 0.12);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #fca5a5;
            padding: 10px 12px;
            border-radius: 10px;
            font-size: 11px;
            margin-bottom: 16px;
        }
        .actions { display: flex; gap: 10px; }
        button {
            flex: 1;
            padding: 12px 16px;
            border-radius: 10px;
            font-family: inherit;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            border: none;
        }
        .btn-approve {
            background: #10b981;
            color: #052e16;
        }
        .btn-approve:hover { background: #34d399; }
    </style>
</head>
<body>
    <div class="card">
        <span class="badge">OAuth 2.1 Security</span>
        <h1>Connect to ThermalFlow MCP</h1>
        <p>An AI client (<strong>${escapeHtml(params.client_id || 'Gemini Connected App')}</strong>) is requesting permission to manage and print tasks on your ThermalFlow board.</p>
        <div class="scopes">
            <div>&#10003; View &amp; search tasks (<code>list_tasks</code>)</div>
            <div>&#10003; Add &amp; auto-print tasks (<code>add_task</code>)</div>
            <div>&#10003; Complete &amp; print receipts (<code>complete_task</code>, <code>print_tasks</code>)</div>
        </div>
        ${errorMsg ? `<div class="error">${escapeHtml(errorMsg)}</div>` : ''}
        <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="client_id" value="${escapeHtml(params.client_id)}" />
            <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirect_uri)}" />
            <input type="hidden" name="response_type" value="${escapeHtml(params.response_type || 'code')}" />
            <input type="hidden" name="state" value="${escapeHtml(params.state)}" />
            <input type="hidden" name="code_challenge" value="${escapeHtml(params.code_challenge)}" />
            <input type="hidden" name="code_challenge_method" value="${escapeHtml(params.code_challenge_method || 'S256')}" />
            <input type="hidden" name="scope" value="${escapeHtml(params.scope || 'mcp:tools')}" />
            <input type="hidden" name="resource" value="${escapeHtml(params.resource)}" />
            <label for="passkey">ThermalFlow MCP Passkey</label>
            <input id="passkey" name="passkey" type="password" placeholder="Enter MCP Passkey (from Printer Ready menu)" required autofocus />
            <div class="actions">
                <button type="submit" class="btn-approve">AUTHORIZE ACCESS &rarr;</button>
            </div>
        </form>
    </div>
</body>
</html>`;
    }

    expressApp.get('/oauth/authorize', (req, res) => {
        res.status(200).send(renderAuthorizePage(req.query));
    });

    expressApp.post('/oauth/authorize', (req, res) => {
        const oauth = ensureMcpOAuthState();
        const params = { ...req.query, ...req.body };
        const submittedPasskey = (params.passkey || '').trim();

        if (!submittedPasskey || (submittedPasskey !== oauth.passkey && submittedPasskey !== oauth.clientSecret)) {
            return res.status(401).send(renderAuthorizePage(params, 'Invalid MCP Passkey. Check the passkey in your ThermalFlow Printer Ready menu.'));
        }

        const code = 'tf_code_' + crypto.randomBytes(18).toString('hex');
        oauthAuthCodes.set(code, {
            clientId: params.client_id || 'thermalflow-mcp',
            redirectUri: params.redirect_uri || '',
            codeChallenge: params.code_challenge || '',
            codeChallengeMethod: params.code_challenge_method || 'S256',
            scope: params.scope || 'mcp:tools',
            resource: params.resource || '',
            expiresAt: Date.now() + 10 * 60 * 1000
        });

        if (!params.redirect_uri) {
            return res.json({ code, state: params.state });
        }

        try {
            const redirectUrl = new URL(params.redirect_uri);
            redirectUrl.searchParams.set('code', code);
            if (params.state) {
                redirectUrl.searchParams.set('state', params.state);
            }
            return res.redirect(302, redirectUrl.toString());
        } catch {
            const sep = params.redirect_uri.includes('?') ? '&' : '?';
            const stateParam = params.state ? `&state=${encodeURIComponent(params.state)}` : '';
            return res.redirect(302, `${params.redirect_uri}${sep}code=${encodeURIComponent(code)}${stateParam}`);
        }
    });

    // 5. OAuth 2.1 Token Endpoint (POST /oauth/token)
    expressApp.post('/oauth/token', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        const oauth = ensureMcpOAuthState();
        const body = req.body || {};
        const grantType = body.grant_type || 'authorization_code';

        if (grantType === 'authorization_code') {
            const code = body.code;
            const record = oauthAuthCodes.get(code);
            if (!record || Date.now() > record.expiresAt) {
                oauthAuthCodes.delete(code);
                return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired.' });
            }
            oauthAuthCodes.delete(code);

            // Verify PKCE if codeChallenge was provided during authorization
            if (record.codeChallenge) {
                const verifier = body.code_verifier || '';
                if (!verifier) {
                    return res.status(400).json({ error: 'invalid_grant', error_description: 'Missing PKCE code_verifier.' });
                }
                if ((record.codeChallengeMethod || 'S256').toUpperCase() === 'S256') {
                    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
                    if (computed !== record.codeChallenge) {
                        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE S256 verification failed.' });
                    }
                } else if (verifier !== record.codeChallenge) {
                    return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE plain verification failed.' });
                }
            }

            const accessToken = 'tf_at_' + crypto.randomBytes(24).toString('hex');
            const refreshToken = 'tf_rt_' + crypto.randomBytes(24).toString('hex');
            const expiresIn = 30 * 24 * 3600; // 30 days
            const now = Date.now();

            oauth.tokens[accessToken] = {
                type: 'access',
                clientId: record.clientId,
                scope: record.scope || 'mcp:tools',
                createdAt: now,
                expiresAt: now + expiresIn * 1000
            };
            oauth.tokens[refreshToken] = {
                type: 'refresh',
                clientId: record.clientId,
                scope: record.scope || 'mcp:tools',
                createdAt: now
            };
            saveData(masterState);

            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: expiresIn,
                refresh_token: refreshToken,
                scope: record.scope || 'mcp:tools'
            });
        }

        if (grantType === 'refresh_token') {
            const refreshToken = body.refresh_token;
            const record = oauth.tokens[refreshToken];
            if (!record || record.type !== 'refresh') {
                return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token.' });
            }

            const accessToken = 'tf_at_' + crypto.randomBytes(24).toString('hex');
            const expiresIn = 30 * 24 * 3600;
            oauth.tokens[accessToken] = {
                type: 'access',
                clientId: record.clientId,
                scope: record.scope || 'mcp:tools',
                createdAt: Date.now(),
                expiresAt: Date.now() + expiresIn * 1000
            };
            saveData(masterState);

            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: expiresIn,
                refresh_token: refreshToken,
                scope: record.scope || 'mcp:tools'
            });
        }

        if (grantType === 'client_credentials') {
            let clientSecret = body.client_secret || '';
            const authHeader = req.headers.authorization || '';
            if (authHeader.toLowerCase().startsWith('basic ')) {
                const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
                const parts = decoded.split(':');
                if (parts.length >= 2) clientSecret = parts.slice(1).join(':');
            }
            if (clientSecret !== oauth.clientSecret && clientSecret !== oauth.passkey) {
                return res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client_secret.' });
            }

            const accessToken = 'tf_at_' + crypto.randomBytes(24).toString('hex');
            const expiresIn = 30 * 24 * 3600;
            oauth.tokens[accessToken] = {
                type: 'access',
                clientId: body.client_id || oauth.clientId,
                scope: 'mcp:tools',
                createdAt: Date.now(),
                expiresAt: Date.now() + expiresIn * 1000
            };
            saveData(masterState);

            return res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: expiresIn,
                scope: 'mcp:tools'
            });
        }

        return res.status(400).json({ error: 'unsupported_grant_type' });
    });

    // 6. UI Configuration Endpoint for MCP OAuth (/api/config/mcp-oauth)
    expressApp.get('/api/config/mcp-oauth', (req, res) => {
        const oauth = ensureMcpOAuthState();
        const activeTokens = Object.values(oauth.tokens || {}).filter(t => t.type === 'access' && (!t.expiresAt || t.expiresAt > Date.now())).length;
        res.json({
            enabled: Boolean(oauth.enabled),
            clientId: oauth.clientId,
            clientSecret: oauth.clientSecret,
            passkey: oauth.passkey,
            activeTokens
        });
    });

    expressApp.post('/api/config/mcp-oauth', (req, res) => {
        const oauth = ensureMcpOAuthState();
        const { enabled, passkey, regenerateSecret, revokeTokens } = req.body || {};

        if (typeof enabled === 'boolean') {
            oauth.enabled = enabled;
        }
        if (typeof passkey === 'string' && passkey.trim()) {
            oauth.passkey = passkey.trim();
        }
        if (regenerateSecret) {
            oauth.clientSecret = 'tf_mcp_' + crypto.randomBytes(12).toString('hex');
        }
        if (revokeTokens) {
            oauth.tokens = {};
        }
        saveData(masterState);

        const activeTokens = Object.values(oauth.tokens || {}).filter(t => t.type === 'access' && (!t.expiresAt || t.expiresAt > Date.now())).length;
        res.json({
            success: true,
            enabled: Boolean(oauth.enabled),
            clientId: oauth.clientId,
            clientSecret: oauth.clientSecret,
            passkey: oauth.passkey,
            activeTokens
        });
    });

    const mcpSseSessions = new Map();

    // Streamable HTTP + SSE endpoint at /mcp (protected by OAuth 2.1 when enabled)
    expressApp.get('/mcp', (req, res) => {
        if (!verifyMcpBearer(req)) {
            return sendMcpUnauthorized(req, res);
        }
        const accept = req.headers.accept || '';
        if (accept.includes('text/event-stream')) {
            const sessionId = Math.random().toString(36).substring(2, 12);
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            mcpSseSessions.set(sessionId, res);
            res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
            req.on('close', () => mcpSseSessions.delete(sessionId));
            return;
        }
        res.json({
            name: 'thermalflow-mcp',
            version: '1.0.0',
            status: 'ok',
            oauthProtected: Boolean(ensureMcpOAuthState().enabled),
            transport: ['streamable-http', 'sse'],
            tools: MCP_TOOLS.map(t => t.name)
        });
    });

    expressApp.post('/mcp', async (req, res) => {
        if (!verifyMcpBearer(req)) {
            return sendMcpUnauthorized(req, res);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        const sessionId = req.query.sessionId;
        const sseRes = sessionId ? mcpSseSessions.get(sessionId) : null;

        const payload = req.body;
        if (Array.isArray(payload)) {
            const responses = (await Promise.all(payload.map(item => handleMcpRpcRequest(item)))).filter(Boolean);
            if (sseRes) {
                responses.forEach(r => sseRes.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`));
                return res.status(202).end();
            }
            if (responses.length === 0) return res.status(202).end();
            return res.json(responses);
        }

        const response = await handleMcpRpcRequest(payload);
        if (sseRes) {
            if (response) {
                sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
            }
            return res.status(202).end();
        }
        if (!response) {
            return res.status(202).end();
        }
        return res.json(response);
    });

    expressApp.options('/mcp', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        res.status(204).end();
    });

    expressApp.delete('/mcp', (req, res) => {
        if (!verifyMcpBearer(req)) {
            return sendMcpUnauthorized(req, res);
        }
        res.status(200).json({ ok: true });
    });

    // --- AI Task Decomposition Engine & Endpoint ---
    function generateHeuristicSubtasks(goal) {
        const lower = goal.toLowerCase();

        if (lower.includes('smog') || lower.includes('emissions') || lower.includes('inspection')) {
            return [
                `Check OBD2 readiness monitors & CEL light`,
                `Locate DMV renewal notice & registration`,
                `Warm up engine with 15-min highway drive`,
                `Take ${goal.slice(0, 18)} to STAR smog station`,
                `Verify electronic DMV certificate & pay fee`
            ];
        }
        if (lower.includes('truck') || lower.includes('car') || lower.includes('vehicle') || lower.includes('brake') || lower.includes('ball joint') || lower.includes('oil') || lower.includes('tire')) {
            return [
                `Inspect vehicle & confirm part numbers`,
                `Order OEM/aftermarket parts & tools`,
                `Chock wheels, jack vehicle & set stands`,
                `Remove worn components & torque new parts`,
                `Road test vehicle & check alignment/leaks`
            ];
        }
        if (lower.includes('fix') || lower.includes('repair') || lower.includes('replace') || lower.includes('spring') || lower.includes('door') || lower.includes('leak') || lower.includes('roof') || lower.includes('bike')) {
            return [
                `Inspect & diagnose root cause`,
                `Identify & source replacement parts`,
                `Disconnect power & secure work area`,
                `Remove worn parts & install new units`,
                `Test complete cycle & clean up work area`
            ];
        }
        if (lower.includes('quote') || lower.includes('contractor') || lower.includes('estimate')) {
            return [
                `Document scope & take reference photos`,
                `Contact 3 licensed local contractors`,
                `Schedule on-site inspection walkthroughs`,
                `Compare written itemized estimates & warranty`,
                `Select vendor & confirm start date`
            ];
        }
        if (lower.includes('buy') || lower.includes('shop') || lower.includes('purchase') || lower.includes('order')) {
            return [
                `Research top-rated models & read reviews`,
                `Compare pricing & check return policy`,
                `Confirm exact measurements & specs`,
                `Place order or pick up locally`,
                `Unpack & inspect against packing slip`
            ];
        }
        if (lower.includes('clean') || lower.includes('organize') || lower.includes('garage') || lower.includes('closet') || lower.includes('room') || lower.includes('desk')) {
            return [
                `Sort items: Keep, Donate, Trash`,
                `Wipe down shelves & vacuum surfaces`,
                `Box up donations & discard trash bags`,
                `Arrange remaining items into labeled bins`,
                `Perform final visual walkthrough`
            ];
        }
        if (lower.includes('plan') || lower.includes('trip') || lower.includes('travel') || lower.includes('party') || lower.includes('event')) {
            return [
                `Finalize dates, budget & guest list`,
                `Book accommodations & transport`,
                `Prepare day-by-day itinerary`,
                `Pack gear using master checklist`,
                `Review emergency contacts & confirmations`
            ];
        }
        if (lower.includes('tax') || lower.includes('renew') || lower.includes('registration') || lower.includes('dmv') || lower.includes('doctor') || lower.includes('medical') || lower.includes('bill') || lower.includes('insurance') || lower.includes('escrow')) {
            return [
                `Gather statements, EOBs & account numbers`,
                `Verify itemized charges & insurance coverage`,
                `Call provider billing or log into portal`,
                `Submit payment or set up payment plan`,
                `Save confirmation receipt & update records`
            ];
        }
        if (lower.includes('code') || lower.includes('build') || lower.includes('feature') || lower.includes('bug') || lower.includes('api') || lower.includes('website')) {
            return [
                `Reproduce behavior & draft technical plan`,
                `Implement changes in isolated branch`,
                `Run automated test suite & verify edge cases`,
                `Review pull request & merge to main`,
                `Deploy update to production & verify`
            ];
        }

        // Universal practical fallback
        return [
            `Define scope & gather materials for ${goal.slice(0, 20)}`,
            `Prepare work area & eliminate blockers`,
            `Execute core action phase`,
            `Verify quality & resolve loose ends`,
            `Review final result & mark complete`
        ];
    }

    function extractGeminiErrorMessage(errData, statusCode) {
        const raw = errData?.error?.message || (Array.isArray(errData) && errData[0]?.error?.message) || '';
        if (statusCode === 402 || raw.toLowerCase().includes('prepayment credits are depleted')) {
            return 'Gemini API credits depleted (HTTP 402): Your Google AI Studio prepayment credits are exhausted. Visit https://ai.studio/projects to top up billing or enter another API key.';
        }
        if (statusCode === 400 && raw.toLowerCase().includes('api key not valid')) {
            return 'Invalid Gemini API key (HTTP 400): Please check the key in the Printer Ready menu.';
        }
        if (statusCode === 429) {
            return 'Gemini API rate limit / quota exceeded (HTTP 429): Please wait a moment or check your AI Studio quota.';
        }
        return raw ? `Gemini API Error (${statusCode}): ${raw.trim()}` : `Gemini API returned HTTP ${statusCode}`;
    }

    async function verifyGeminiKey(apiKey, model) {
        if (!apiKey) return { valid: false, keyError: null };
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Api-Revision': '2026-05-20'
                },
                body: JSON.stringify({
                    model: model || 'gemini-3.8-flash',
                    input: 'Reply with OK'
                })
            });
            if (response.ok) {
                return { valid: true, keyError: null };
            }
            const errData = await response.json().catch(() => ({}));
            return {
                valid: false,
                statusCode: response.status,
                keyError: extractGeminiErrorMessage(errData, response.status)
            };
        } catch (err) {
            return {
                valid: false,
                keyError: `Network error verifying Gemini key: ${err.message}`
            };
        }
    }

    // --- AI Key Configuration Endpoints ---
    expressApp.get('/api/config/gemini', async (req, res) => {
        const key = masterState.geminiApiKey || process.env.GEMINI_API_KEY || '';
        const source = masterState.geminiApiKey ? 'ui' : (process.env.GEMINI_API_KEY ? 'env' : 'none');
        const masked = key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : (key ? '••••••••' : '');
        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

        let verification = { valid: Boolean(key), keyError: null };
        if (key && req.query.verify === '1') {
            verification = await verifyGeminiKey(key, model);
        }

        res.json({
            configured: Boolean(key),
            source,
            masked,
            model,
            ...verification
        });
    });

    expressApp.post('/api/config/gemini', async (req, res) => {
        const { apiKey } = req.body;
        if (typeof apiKey !== 'string') {
            return res.status(400).json({ error: 'apiKey must be a string' });
        }
        const trimmed = apiKey.trim();
        if (trimmed) {
            masterState.geminiApiKey = trimmed;
        } else {
            delete masterState.geminiApiKey;
        }
        saveData(masterState);

        const activeKey = masterState.geminiApiKey || process.env.GEMINI_API_KEY || '';
        const source = masterState.geminiApiKey ? 'ui' : (process.env.GEMINI_API_KEY ? 'env' : 'none');
        const masked = activeKey.length > 8 ? `${activeKey.slice(0, 4)}••••${activeKey.slice(-4)}` : (activeKey ? '••••••••' : '');
        const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

        let verification = { valid: false, keyError: null };
        if (activeKey) {
            verification = await verifyGeminiKey(activeKey, model);
        }

        res.json({
            success: true,
            configured: Boolean(activeKey),
            source,
            masked,
            model,
            ...verification
        });
    });

    expressApp.post('/api/tasks/decompose', async (req, res) => {
        const { title, apiKey: clientKey } = req.body;
        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ error: 'title is required' });
        }
        const goal = title.trim();

        const promptText = `You are an expert practical organizer and project breakdown assistant for a physical thermal task receipt system.
Break down the following goal or task into 3 to 5 clear, concrete, sequential, actionable steps.
Each step must be short (under 45 characters, ideally starting with an action verb) so it fits neatly on a narrow thermal chit.
Return ONLY a valid JSON array of strings, e.g. ["Step 1", "Step 2", "Step 3"]. No markdown formatting, no commentary.

Goal: "${goal}"`;

        // 1. Try Gemini API if key is present (UI/server config -> client override -> .env)
        const geminiKey = (typeof clientKey === 'string' && clientKey.trim()) || masterState.geminiApiKey || process.env.GEMINI_API_KEY;
        const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        let aiError = null;
        let aiStatus = null;

        if (geminiKey) {
            try {
                // First try Interactions API (v1beta/interactions with Api-Revision: 2026-05-20)
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(geminiKey)}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Api-Revision': '2026-05-20'
                    },
                    body: JSON.stringify({
                        model: geminiModel,
                        input: promptText,
                        response_format: {
                            type: 'text',
                            mime_type: 'application/json',
                            schema: {
                                type: 'array',
                                items: { type: 'string' }
                            }
                        }
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    let text = data?.output_text;
                    if (!text && Array.isArray(data?.steps)) {
                        for (let i = data.steps.length - 1; i >= 0; i--) {
                            const step = data.steps[i];
                            if (step.type === 'model_output' && Array.isArray(step.content)) {
                                const textPart = step.content.find(c => c.type === 'text' && c.text);
                                if (textPart) {
                                    text = textPart.text;
                                    break;
                                }
                            }
                        }
                    }
                    if (!text && Array.isArray(data?.outputs)) {
                        text = data.outputs[data.outputs.length - 1]?.text;
                    }
                    if (text) {
                        const parsed = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            return res.json({
                                title: goal,
                                subtasks: parsed.slice(0, 6).map(String),
                                source: 'gemini',
                                model: geminiModel
                            });
                        }
                    }
                } else {
                    const errData = await response.json().catch(() => ({}));
                    aiStatus = response.status;
                    aiError = extractGeminiErrorMessage(errData, response.status);
                    console.warn(`Gemini (${geminiModel}) response error:`, response.status, aiError);
                }
            } catch (err) {
                aiError = `Gemini connection failed: ${err.message}`;
                console.warn(`Gemini (${geminiModel}) decomposition failed, falling back to heuristic engine:`, err.message);
            }
        } else {
            aiError = 'No Gemini API key configured. Enter a valid key in the Printer Ready menu to use live Gemini AI.';
        }

        // 2. Try OpenAI API if key is present
        const openAiKey = process.env.OPENAI_API_KEY;
        if (openAiKey) {
            try {
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openAiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: 'Break down the user goal into 3 to 5 short, concrete, sequential actionable steps (under 45 chars each). Return ONLY a JSON array of strings.'
                            },
                            { role: 'user', content: goal }
                        ]
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const content = data?.choices?.[0]?.message?.content;
                    if (content) {
                        const parsed = JSON.parse(content.replace(/```json/g, '').replace(/```/g, '').trim());
                        const list = Array.isArray(parsed) ? parsed : (parsed.steps || parsed.tasks || parsed.subtasks || Object.values(parsed));
                        if (Array.isArray(list) && list.length > 0) {
                            return res.json({
                                title: goal,
                                subtasks: list.slice(0, 6).map(String),
                                source: 'openai',
                                model: 'gpt-4o-mini'
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn('OpenAI decomposition failed, falling back to heuristic engine:', err.message);
            }
        }

        // 3. Fallback: Intelligent semantic heuristic engine (with explicit aiError metadata so UI does not fail silently)
        const subtasks = generateHeuristicSubtasks(goal);
        res.json({
            title: goal,
            subtasks,
            source: 'heuristic',
            aiError,
            aiStatus
        });
    });


    // --- Next.js Handling ---
    expressApp.post('/api/admin/redeploy', (req, res) => {
        const key = req.headers['x-redeploy-key'];
        const secret = process.env.REDEPLOY_KEY;

        if (!secret || key !== secret) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log('REDEPLOY: Triggering remote rebuild and restart...');

        // Spawn appropriate detached deployment script
        const isWin = process.platform === "win32";
        
        if (isWin) {
            // On Windows, use 'start' command to fully detach the process
            // This ensures the script survives when the parent (this server) exits
            const scriptPath = path.join(__dirname, 'redeploy.ps1');
            const logPath = path.join(__dirname, 'redeploy-trigger.log');
            
            // Use cmd /c start to create a truly independent process
            const subprocess = spawn('cmd.exe', [
                '/c', 'start', '/min', 'powershell.exe',
                '-ExecutionPolicy', 'Bypass',
                '-File', scriptPath
            ], {
                detached: true,
                stdio: 'ignore',
                cwd: __dirname,
                shell: true
            });
            
            subprocess.unref();
            
        } else {
            // Linux/Mac
            const subprocess = spawn('bash', [
                path.join(__dirname, 'redeploy.sh')
            ], {
                detached: true,
                stdio: 'ignore',
                cwd: __dirname
            });
            
            try {
                fs.chmodSync(path.join(__dirname, 'redeploy.sh'), '755');
            } catch (e) { }
            
            subprocess.unref();
        }

        res.json({ message: 'Redeploy triggered. Server will restart shortly.' });

        // Give response time to reach client before exiting
        setTimeout(() => {
            console.log('REDEPLOY: Exiting to allow update...');
            process.exit(0);
        }, 1000);
    });

    expressApp.all(/(.*)/, (req, res) => {
        return handle(req, res);
    });

    server.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
