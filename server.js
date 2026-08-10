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
    const RETENTION_DAYS = 7;
    const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1. Identify tasks that MUST be kept (incomplete or ancestors of incomplete)
    const taskIdsToKeep = new Set(['root']);
    Object.values(state.tasks).forEach(task => {
        if (!task.completed) {
            let current = task;
            while (current) {
                if (taskIdsToKeep.has(current.id)) break;
                taskIdsToKeep.add(current.id);
                current = current.parentId ? state.tasks[current.parentId] : null;
            }
        }
    });

    // 2. Identify candidates for removal (completed > 7 days AND not in keep set)
    const tasksToRemove = new Set();
    Object.values(state.tasks).forEach(task => {
        if (taskIdsToKeep.has(task.id)) return;

        const completedAt = typeof task.completedAt === 'string'
            ? new Date(task.completedAt).getTime()
            : task.completedAt;

        if (task.completed && completedAt && (now - completedAt) > RETENTION_MS) {
            tasksToRemove.add(task.id);
        }
    });

    if (tasksToRemove.size === 0) return state;

    console.log(`GC: Removing ${tasksToRemove.size} old completed tasks`);

    const newTasks = { ...state.tasks };
    tasksToRemove.forEach(id => {
        const task = newTasks[id];
        if (task && task.parentId && newTasks[task.parentId]) {
            newTasks[task.parentId] = {
                ...newTasks[task.parentId],
                children: newTasks[task.parentId].children.filter(cid => cid !== id)
            };
        }
    });

    tasksToRemove.forEach(id => {
        delete newTasks[id];
    });

    const newState = {
        ...state,
        version: state.version + 1,
        tasks: newTasks,
        lastModified: now
    };

    saveData(newState);
    return newState;
}

function saveData(data) {
    try {
        const tempFile = `${DATA_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
        fs.renameSync(tempFile, DATA_FILE);
    } catch (e) {
        console.error("Failed to save data:", e);
        // Clean up temp file if it exists
        try {
            const tempFile = `${DATA_FILE}.tmp`;
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (unlinkErr) { }
    }
}

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
        if (!task.recurrence) return;

        // Safety check: if nextRun is significantly in the past (e.g. server was off), 
        // we might not want to run it immediately or we might want to catch up. 
        // For now, let's just check if it's due.
        if (now >= task.recurrence.nextRun) {
            console.log(`Executing recurrence for task: ${task.title}`);

            // Calculate NEXT run time based on cron
            // We use 'cron-parser' behavior via a helper or simple add for now?
            // node-cron doesn't expose "next date" easily without a parser.
            // For MVP, if frequency is 'daily', add 24h. 'weekly', add 7d.
            // If 'custom' (cron string), we need a parser. 
            // LIMITATION: 'node-cron' handles scheduling, not parsing for next date math manually easily.
            // Workaround: We will rely on simple offsets for daily/weekly for now, 
            // or we might need 'cron-parser' package for robust calc.

            // Let's stick to simple logic for MVP to avoid extra heaviest deps if possible,
            // or just use 24h/7d logic.
            let nextRun = task.recurrence.nextRun;
            const DAY = 24 * 60 * 60 * 1000;

            if (task.recurrence.frequency === 'daily') {
                nextRun += DAY;
            } else if (task.recurrence.frequency === 'weekly') {
                nextRun += DAY * 7;
            } else {
                // Fallback for custom/other: just add 24h for now to prevent infinite loop
                nextRun += DAY;
            }

            // Ensure nextRun is in future (in case server was off for a week)
            while (nextRun <= now) {
                if (task.recurrence.frequency === 'daily') nextRun += DAY;
                else if (task.recurrence.frequency === 'weekly') nextRun += DAY * 7;
                else nextRun += DAY;
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
        // We need Io instance here. It is inside app.prepare()...
        // Issue: 'io' is not global.
        // Quick fix: generic broadcast function or move io to outer scope.
        if (global.io) {
            global.io.emit('sync:patch', {
                tasks: updates,
                version: masterState.version,
                lastModified: masterState.lastModified
            });
        }
    }
});

app.prepare().then(() => {
    const expressApp = express();
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

    // --- Socket.IO Sync ---
    io.on('connection', (socket) => {
        // Send current state to newly connected client
        socket.emit('sync:init', masterState);

        // Handle full updates from client (Fallback/Legacy)
        socket.on('sync:update', (newState) => {
            if (newState.version > masterState.version) {
                masterState.tasks = newState.tasks;
                if (newState.scheduledPrints) masterState.scheduledPrints = newState.scheduledPrints;
                masterState.version = newState.version;
                masterState.lastModified = newState.lastModified || Date.now();
                saveData(masterState);
                socket.broadcast.emit('sync:broadcast', masterState);
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

    // Printing is now handled by standalone print-server.js on port 3001 proxyed via /api/* above


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
        let cmd, args;

        if (isWin) {
            cmd = 'powershell.exe';
            args = [
                '-ExecutionPolicy', 'Bypass',
                '-File', path.join(__dirname, 'redeploy.ps1')
            ];
        } else {
            cmd = 'bash';
            args = [path.join(__dirname, 'redeploy.sh')];
            // ensure the script is executable
            try {
                fs.chmodSync(args[0], '755');
            } catch (e) { }
        }

        const subprocess = spawn(cmd, args, {
            detached: true,
            stdio: 'ignore',
            cwd: __dirname
        });

        subprocess.unref();

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
