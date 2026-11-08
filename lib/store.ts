import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { persist } from 'zustand/middleware';
import { io, Socket } from 'socket.io-client';

// Simple ID generator
const generateId = () => Math.random().toString(36).substring(2, 9);

export interface Task {
    id: string;
    title: string;
    completed: boolean;
    children: string[];
    parentId?: string;
    createdAt?: number;
    completedAt?: number;
    createdBy: string;
    priority?: 'normal' | 'high' | 'urgent';
    taskType?: 'task' | 'grocery';
    recurrence?: {
        frequency: 'daily' | 'weekly' | 'custom';
        cron: string;        // "0 9 * * *"
        nextRun: number;     // Timestamp
        action: 'reset' | 'clone'; // 'reset' unchecks the task, 'clone' makes a copy
    };
}

const GROCERY_TITLE_REGEX = /\b(grocer(y|ies)|shopping\s*list|grocery\s*list|market\s*list|supermarket|costco|trader\s*joe'?s|whole\s*foods|safeway|kroger|aldi|heb|publix|wegmans|farmers\s*market)\b/i;

export function isGroceryTaskTitle(title: string): boolean {
    if (!title) return false;
    return GROCERY_TITLE_REGEX.test(title.trim());
}

export function isGroceryList(task?: Task | null): boolean {
    if (!task || task.id === 'root') return false;
    if (task.taskType === 'grocery') return true;
    if (task.taskType === 'task') return false;
    return isGroceryTaskTitle(task.title);
}

export function isInsideGroceryList(taskId: string, tasks: Record<string, Task>): boolean {
    const task = tasks[taskId];
    if (!task) return false;
    const parentId = task.parentId || Object.values(tasks).find(p => p.children?.includes(taskId))?.id;
    if (!parentId || parentId === 'root') return false;
    const parent = tasks[parentId];
    return isGroceryList(parent);
}

/**
 * Splits a grocery input string by commas or newlines (ignoring commas inside parentheses),
 * e.g. "2x Milk, Eggs (12), Avocados x4" -> ["2x Milk", "Eggs (12)", "Avocados x4"]
 */
export function parseGroceryInput(rawInput: string): string[] {
    const results: string[] = [];
    let current = '';
    let parenDepth = 0;

    for (let i = 0; i < rawInput.length; i++) {
        const ch = rawInput[i];
        if (ch === '(') parenDepth++;
        else if (ch === ')' && parenDepth > 0) parenDepth--;

        if ((ch === ',' || ch === '\n' || ch === ';') && parenDepth === 0) {
            const trimmed = current.trim();
            if (trimmed) results.push(trimmed);
            current = '';
        } else {
            current += ch;
        }
    }
    const finalTrimmed = current.trim();
    if (finalTrimmed) results.push(finalTrimmed);
    return results;
}

/**
 * Extracts a smart quantity badge and clean item name from a grocery item title.
 * Examples:
 * - "2x Milk" -> { quantity: "2x", name: "Milk" }
 * - "Eggs (12)" -> { quantity: "12", name: "Eggs" }
 * - "Avocados x4" -> { quantity: "x4", name: "Avocados" }
 * - "2 lbs Ground Beef" -> { quantity: "2 lbs", name: "Ground Beef" }
 * - "Milk - 1 gal" -> { quantity: "1 gal", name: "Milk" }
 */
export function parseGroceryItemDisplay(title: string): { name: string; quantity?: string } {
    const raw = (title || '').trim();
    if (!raw) return { name: '' };

    // 1. Prefix like "2x Milk", "2 x Milk", "3ct Lemons", "2 lbs Chicken"
    const prefixMultiplier = raw.match(/^(\d+(?:\.\d+)?\s*(?:x|ct|pk|pack|packs|bunch|bunches|can|cans|jar|jars|bag|bags|box|boxes|bottle|bottles|gal|qt|pt|lb|lbs|oz|kg|g|ml|l|loaf|loaves|head|heads|pint|pints|cup|cups))\s+(.+)$/i);
    if (prefixMultiplier) {
        return {
            quantity: prefixMultiplier[1].replace(/\s+/g, ' ').trim(),
            name: prefixMultiplier[2].trim()
        };
    }

    // 2. Suffix in parentheses like "Eggs (12)" or "Chicken breast (2 lbs)"
    const parenSuffix = raw.match(/^(.+?)\s*\((\d+[^)]*)\)$/);
    if (parenSuffix) {
        return {
            name: parenSuffix[1].trim(),
            quantity: parenSuffix[2].trim()
        };
    }

    // 3. Suffix multiplier like "Avocados x4" or "Milk x 2"
    const suffixMultiplier = raw.match(/^(.+?)\s+(x\s*\d+|\d+\s*x)$/i);
    if (suffixMultiplier) {
        return {
            name: suffixMultiplier[1].trim(),
            quantity: suffixMultiplier[2].replace(/\s+/g, '').toLowerCase()
        };
    }

    // 4. Dash suffix with number like "Milk - 1 gal" or "Apples - 6"
    const dashSuffix = raw.match(/^(.+?)\s+[-–]\s*(\d+.*)$/);
    if (dashSuffix && dashSuffix[2].length <= 12) {
        return {
            name: dashSuffix[1].trim(),
            quantity: dashSuffix[2].trim()
        };
    }

    // 5. Simple leading integer count like "4 Avocados"
    const leadingCount = raw.match(/^(\d+)\s+([a-zA-Z].+)$/);
    if (leadingCount && parseInt(leadingCount[1], 10) <= 99) {
        return {
            quantity: `${leadingCount[1]}x`,
            name: leadingCount[2].trim()
        };
    }

    return { name: raw };
}

export interface ScheduledPrint {
    id: string;
    label: string;      // "Daily Standup"
    columnName: string; // "Today"
    time: string;       // "09:00"
    frequency: 'daily' | 'weekly';
    enabled: boolean;
    lastRun?: number;
}

interface TaskStore {
    version: number;
    lastModified: number; // Timestamp
    tasks: Record<string, Task>;
    scheduledPrints: ScheduledPrint[];
    rootId: string;
    path: string[];
    selectedTaskId: string | null;
    currentUser: string | null;

    // Preferences & Settings
    autoPrintEnabled: boolean;
    toggleAutoPrint: () => void;
    soundEnabled: boolean;
    toggleSound: () => void;
    qrOnChits: boolean;
    toggleQrOnChits: () => void;

    // Undo / Redo
    undoStack: Record<string, Task>[];
    redoStack: Record<string, Task>[];
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;

    // Actions
    setCurrentUser: (email: string) => void;
    addTask: (parentId: string, title: string, priority?: 'normal' | 'high' | 'urgent', taskType?: 'task' | 'grocery') => string | null;
    addTasksBatch: (parentId: string, titles: string[], taskType?: 'task' | 'grocery') => Task[];
    toggleTask: (id: string) => void;
    updateTaskTitle: (id: string, title: string) => void;
    setTaskPriority: (id: string, priority?: 'normal' | 'high' | 'urgent') => void;
    setTaskType: (id: string, taskType: 'task' | 'grocery') => void;
    clearCheckedGroceryItems: (groceryListId: string) => void;
    setTaskRecurrence: (id: string, recurrence: Task['recurrence'] | undefined) => void;
    deleteTask: (id: string) => void;
    clearCompletedTasks: () => void;
    assignTask: (id: string, newCreator: string) => void;
    setPath: (path: string[]) => void;
    navigateTo: (id: string) => void;
    navigateBack: () => void;

    // Scheduled Prints
    addScheduledPrint: (print: ScheduledPrint) => void;
    toggleScheduledPrint: (id: string) => void;
    deleteScheduledPrint: (id: string) => void;

    // Selection Actions
    selectTask: (id: string | null) => void;
    selectNextTask: () => void;
    selectPrevTask: () => void;
    selectParentTask: () => void;
    selectChildTask: () => void;
    toggleSelectedTask: () => void; // For Enter key

    // Sync Action
    syncState: (serverState: any) => void;
    applyPatch: (patch: any) => void;

    // Filter State
    activeFilters: {
        creator: string | null;
    };
    setCreatorFilter: (creator: string | null) => void;

    // UI State
    showCompleted: boolean;
    viewMode: 'column' | 'grid';
    setViewMode: (mode: 'column' | 'grid') => void;
    setShowCompleted: (show: boolean) => void;
    toggleCompletedColumn: () => void;
    lastAction: 'add' | 'select' | 'delete' | 'nav' | null;
}

const INITIAL_ROOT_ID = 'root';


// Socket Connection
let socket: Socket;

if (typeof window !== 'undefined') {
    socket = io(); // Connects to same host/port

    socket.on('connect', () => {
        console.log('Connected to sync server');
    });
}

function broadcastUpdate(state: any) {
    if (socket) {
        const payload = {
            version: state.version,
            tasks: state.tasks,
            scheduledPrints: state.scheduledPrints,
            lastModified: state.lastModified
        };
        socket.emit('sync:update', payload);
    }
}

function broadcastPatch(tasks: Record<string, Task> | null, deletedIds: string[] | null = null) {
    if (socket) {
        socket.emit('sync:patch', {
            tasks,
            deletedIds
        });
    }
}

export const useTaskStore = create<TaskStore>()(
    persist(
        (set, get) => ({
            version: 1,
            lastModified: Date.now(),
            tasks: {
                [INITIAL_ROOT_ID]: {
                    id: INITIAL_ROOT_ID,
                    title: 'ThermalFlow',
                    completed: false,
                    children: [],
                    createdAt: Date.now(),
                    createdBy: 'system'
                },
            },
            scheduledPrints: [],
            rootId: INITIAL_ROOT_ID,
            path: [INITIAL_ROOT_ID],
            selectedTaskId: null,
            currentUser: null,
            activeFilters: {
                creator: null
            },
            showCompleted: true,
            viewMode: 'column',
            lastAction: null,

            // Preferences
            autoPrintEnabled: true,
            toggleAutoPrint: () => set((state) => ({ autoPrintEnabled: !state.autoPrintEnabled })),
            soundEnabled: true,
            toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
            qrOnChits: true,
            toggleQrOnChits: () => set((state) => ({ qrOnChits: !state.qrOnChits })),

            // Undo / Redo
            undoStack: [],
            redoStack: [],
            canUndo: false,
            canRedo: false,

            setCurrentUser: (email) => set({ currentUser: email }),
            setCreatorFilter: (creator) => set((state) => ({
                activeFilters: { creator },
                path: ['root'],
                selectedTaskId: null
            })),
            setViewMode: (mode) => set({ viewMode: mode }),

            setShowCompleted: (show) => set({ showCompleted: show }),
            toggleCompletedColumn: () => set((state) => ({ showCompleted: !state.showCompleted })),

            addTask: (parentId, title, priority, taskType) => {
                const now = Date.now();
                const newId = generateId();
                let created = false;

                set((state) => {
                    const parentTask = state.tasks[parentId];
                    if (!parentTask) {
                        console.error(`Parent task ${parentId} not found`);
                        return state;
                    }

                    const resolvedType: 'task' | 'grocery' | undefined =
                        taskType || (parentId === INITIAL_ROOT_ID && isGroceryTaskTitle(title) ? 'grocery' : undefined);

                    const newTask: Task = {
                        id: newId,
                        title,
                        completed: false,
                        children: [],
                        parentId,
                        createdAt: now,
                        createdBy: state.currentUser || 'local',
                        priority: priority || undefined,
                        taskType: resolvedType
                    };

                    const updatedParent = {
                        ...parentTask,
                        children: [...parentTask.children, newId]
                    };


                    const changedTasks = {
                        [newId]: newTask,
                        [parentId]: updatedParent
                    };

                    created = true;
                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        selectedTaskId: state.selectedTaskId,
                        path: state.path,
                        lastModified: now,
                        lastAction: 'add' as const
                    };

                    broadcastPatch(changedTasks);
                    return newState;
                });

                return created ? newId : null;
            },

            addTasksBatch: (parentId, titles, taskType) => {
                const now = Date.now();
                const createdTasks: Task[] = [];

                set((state) => {
                    const parentTask = state.tasks[parentId];
                    if (!parentTask) {
                        console.error(`Parent task ${parentId} not found`);
                        return state;
                    }

                    const changedTasks: Record<string, Task> = {};
                    const newChildIds: string[] = [];

                    titles.forEach((title) => {
                        const newId = generateId();
                        newChildIds.push(newId);
                        const resolvedType: 'task' | 'grocery' | undefined =
                            taskType || (parentId === INITIAL_ROOT_ID && isGroceryTaskTitle(title) ? 'grocery' : undefined);
                        const newTask: Task = {
                            id: newId,
                            title,
                            completed: false,
                            children: [],
                            parentId,
                            createdAt: now,
                            createdBy: state.currentUser || 'local',
                            taskType: resolvedType
                        };
                        changedTasks[newId] = newTask;
                        createdTasks.push(newTask);
                    });

                    const updatedParent = {
                        ...parentTask,
                        children: [...parentTask.children, ...newChildIds]
                    };
                    changedTasks[parentId] = updatedParent;

                    // Ensure parentTask is selected and expanded in Miller column path
                    let newPath = state.path;
                    let newSelectedId = state.selectedTaskId;
                    if (parentId !== INITIAL_ROOT_ID) {
                        newSelectedId = parentId;
                        const chain: string[] = [];
                        let curr: string | undefined = parentId;
                        const visited = new Set<string>();
                        while (curr && !visited.has(curr)) {
                            visited.add(curr);
                            chain.unshift(curr);
                            const currentId: string = curr;
                            const t: Task | undefined = state.tasks[currentId];
                            if (!t || currentId === INITIAL_ROOT_ID) break;
                            curr = t.parentId || Object.values(state.tasks).find(p => p.children.includes(currentId))?.id;
                        }
                        if (chain[0] !== INITIAL_ROOT_ID) {
                            chain.unshift(INITIAL_ROOT_ID);
                        }
                        newPath = chain;
                    }

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        selectedTaskId: newSelectedId,
                        path: newPath,
                        lastModified: now,
                        lastAction: 'add' as const
                    };

                    broadcastPatch(changedTasks);
                    return newState;
                });

                return createdTasks;
            },

            toggleTask: (id) => {
                set((state) => {
                    const task = state.tasks[id];
                    if (!task) return state;
                    const newCompleted = !task.completed;

                    let newSelectedId = state.selectedTaskId;
                    let newPath = state.path;

                    // If we are completing the currently selected task, find a new selection
                    if (id === state.selectedTaskId && newCompleted) {
                        const parent = Object.values(state.tasks).find(t => t.children.includes(id));
                        if (parent) {
                            const siblings = parent.children.filter(sid => sid === id || !state.tasks[sid]?.completed);
                            const currentIndex = siblings.indexOf(id);

                            // Try next sibling
                            const nextSiblingId = siblings.slice(currentIndex + 1).find(sid => !state.tasks[sid]?.completed);
                            // Try previous sibling
                            const prevSiblingId = siblings.slice(0, currentIndex).reverse().find(sid => !state.tasks[sid]?.completed);

                            if (nextSiblingId) {
                                newSelectedId = nextSiblingId;
                            } else if (prevSiblingId) {
                                newSelectedId = prevSiblingId;
                            } else if (parent.id !== INITIAL_ROOT_ID) {
                                newSelectedId = parent.id;
                            } else {
                                newSelectedId = null;
                            }

                            // Update path for the new selection
                            if (newSelectedId) {
                                const p = Object.values(state.tasks).find(t => t.children.includes(newSelectedId!));
                                if (p) {
                                    const idx = state.path.indexOf(p.id);
                                    if (idx !== -1) {
                                        newPath = state.path.slice(0, idx + 1);
                                        newPath.push(newSelectedId);
                                    }
                                } else if (newSelectedId === INITIAL_ROOT_ID) {
                                    newPath = [INITIAL_ROOT_ID];
                                }
                            } else {
                                newPath = [INITIAL_ROOT_ID];
                            }
                        }
                    }

                    const changedTasks: Record<string, Task> = {};
                    const newTasks = { ...state.tasks };
                    const now = Date.now();

                    // Iterative toggle for safety and to avoid stack overflow
                    const stack = [id];
                    while (stack.length > 0) {
                        const taskId = stack.pop()!;
                        const t = newTasks[taskId];
                        if (!t || (taskId === '__proto__' || taskId === 'constructor')) continue;

                        const updatedTask = {
                            ...t,
                            completed: newCompleted,
                            completedAt: newCompleted ? now : undefined
                        };
                        newTasks[taskId] = updatedTask;
                        changedTasks[taskId] = updatedTask;

                        if (newCompleted && t.children) {
                            for (const childId of t.children) {
                                stack.push(childId);
                            }
                        }
                    }

                    const newState = {
                        ...state,
                        tasks: newTasks,
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        selectedTaskId: newSelectedId,
                        path: newPath,
                        lastModified: now
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                })
            },

            updateTaskTitle: (id, title) => {
                set((state) => {
                    const task = state.tasks[id];
                    if (!task) return state;
                    const updatedTask = { ...task, title };
                    const changedTasks = { [id]: updatedTask };

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        lastModified: Date.now()
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                })
            },

            setTaskPriority: (id, priority) => {
                set((state) => {
                    const task = state.tasks[id];
                    if (!task || task.id === INITIAL_ROOT_ID) return state;
                    const updatedTask = { ...task, priority };
                    const changedTasks = { [id]: updatedTask };

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        lastModified: Date.now()
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                });
            },

            setTaskType: (id, taskType) => {
                set((state) => {
                    const task = state.tasks[id];
                    if (!task || task.id === INITIAL_ROOT_ID) return state;
                    const updatedTask = { ...task, taskType };
                    const changedTasks = { [id]: updatedTask };

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        lastModified: Date.now()
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                });
            },

            clearCheckedGroceryItems: (groceryListId) => {
                set((state) => {
                    const listTask = state.tasks[groceryListId];
                    if (!listTask || !Array.isArray(listTask.children)) return state;

                    const checkedChildIds = listTask.children.filter(cid => state.tasks[cid]?.completed);
                    if (checkedChildIds.length === 0) return state;

                    const newTasks = { ...state.tasks };
                    const deletedIds: string[] = [];
                    const stack = [...checkedChildIds];

                    while (stack.length > 0) {
                        const currId = stack.pop()!;
                        if (deletedIds.includes(currId)) continue;
                        deletedIds.push(currId);
                        const currTask = newTasks[currId];
                        if (currTask && Array.isArray(currTask.children)) {
                            currTask.children.forEach(subId => stack.push(subId));
                        }
                        delete newTasks[currId];
                    }

                    const deletedSet = new Set(deletedIds);
                    const updatedListTask: Task = {
                        ...listTask,
                        children: listTask.children.filter(cid => !deletedSet.has(cid))
                    };
                    newTasks[groceryListId] = updatedListTask;

                    const newState = {
                        ...state,
                        tasks: newTasks,
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        lastModified: Date.now(),
                        lastAction: 'delete' as const
                    };

                    broadcastPatch({ [groceryListId]: updatedListTask }, deletedIds);
                    return newState;
                });
            },

            undo: () => {
                set((state) => {
                    if (state.undoStack.length === 0) return state;
                    const newUndoStack = [...state.undoStack];
                    const previousTasks = newUndoStack.pop()!;
                    const newRedoStack = [...state.redoStack, state.tasks];
                    const now = Date.now();

                    const newState = {
                        ...state,
                        tasks: previousTasks,
                        undoStack: newUndoStack,
                        redoStack: newRedoStack,
                        canUndo: newUndoStack.length > 0,
                        canRedo: true,
                        version: state.version + 1,
                        lastModified: now
                    };
                    broadcastUpdate(newState);
                    return newState;
                });
            },

            redo: () => {
                set((state) => {
                    if (state.redoStack.length === 0) return state;
                    const newRedoStack = [...state.redoStack];
                    const nextTasks = newRedoStack.pop()!;
                    const newUndoStack = [...state.undoStack, state.tasks];
                    const now = Date.now();

                    const newState = {
                        ...state,
                        tasks: nextTasks,
                        undoStack: newUndoStack,
                        redoStack: newRedoStack,
                        canUndo: true,
                        canRedo: newRedoStack.length > 0,
                        version: state.version + 1,
                        lastModified: now
                    };
                    broadcastUpdate(newState);
                    return newState;
                });
            },


            setTaskRecurrence: (id, recurrence) => {
                set((state) => {
                    const updatedTask = { ...state.tasks[id], recurrence };
                    const changedTasks = { [id]: updatedTask };

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        lastModified: Date.now()
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                })
            },

            addScheduledPrint: (print) => {
                set(state => {
                    const newState = {
                        ...state,
                        scheduledPrints: [...(state.scheduledPrints || []), print],
                        lastModified: Date.now()
                    };
                    broadcastUpdate(newState);
                    return newState;
                });
            },

            toggleScheduledPrint: (id) => {
                set(state => {
                    const newState = {
                        ...state,
                        scheduledPrints: (state.scheduledPrints || []).map(p =>
                            p.id === id ? { ...p, enabled: !p.enabled } : p
                        ),
                        lastModified: Date.now()
                    };
                    broadcastUpdate(newState);
                    return newState;
                });
            },

            deleteScheduledPrint: (id) => {
                set(state => {
                    const newState = {
                        ...state,
                        scheduledPrints: (state.scheduledPrints || []).filter(p => p.id !== id),
                        lastModified: Date.now()
                    };
                    broadcastUpdate(newState);
                    return newState;
                });
            },

            deleteTask: (id) => {
                set((state) => {
                    if (id === INITIAL_ROOT_ID) return state;
                    const parent = Object.values(state.tasks).find(t => t.children.includes(id));
                    if (!parent) return state;

                    let newSelectedId = state.selectedTaskId;
                    let newPath = state.path;

                    // If we are deleting the currently selected task, find a new selection
                    if (id === state.selectedTaskId) {
                        const siblings = parent.children.filter(sid => !state.tasks[sid]?.completed);
                        const currentIndex = siblings.indexOf(id);

                        if (siblings.length > 1) {
                            if (currentIndex < siblings.length - 1) {
                                newSelectedId = siblings[currentIndex + 1];
                            } else {
                                newSelectedId = siblings[currentIndex - 1];
                            }
                        } else if (parent.id !== INITIAL_ROOT_ID) {
                            newSelectedId = parent.id;
                        } else {
                            newSelectedId = null;
                        }

                        // Update path for the new selection
                        if (newSelectedId) {
                            const p = Object.values(state.tasks).find(t => t.children.includes(newSelectedId!));
                            if (p) {
                                const idx = state.path.indexOf(p.id);
                                if (idx !== -1) {
                                    newPath = state.path.slice(0, idx + 1);
                                    newPath.push(newSelectedId);
                                }
                            } else if (newSelectedId === INITIAL_ROOT_ID) {
                                newPath = [INITIAL_ROOT_ID];
                            }
                        } else {
                            newPath = [INITIAL_ROOT_ID];
                        }
                    }

                    const newTasks = { ...state.tasks };
                    const deletedIds: string[] = [];
                    const stack = [id];
                    while (stack.length > 0) {
                        const currId = stack.pop()!;
                        if (deletedIds.includes(currId)) continue;
                        deletedIds.push(currId);
                        const currTask = newTasks[currId];
                        if (currTask && Array.isArray(currTask.children)) {
                            currTask.children.forEach(cid => stack.push(cid));
                        }
                        delete newTasks[currId];
                    }

                    const updatedParent = {
                        ...newTasks[parent.id],
                        children: parent.children.filter(childId => childId !== id)
                    };

                    const newState = {
                        ...state,
                        tasks: {
                            ...newTasks,
                            [parent.id]: updatedParent
                        },
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        selectedTaskId: newSelectedId,
                        path: newPath,
                        lastModified: Date.now(),
                        lastAction: 'delete' as const
                    };
                    broadcastPatch({ [parent.id]: updatedParent }, deletedIds);
                    return newState;

                })
            },

            clearCompletedTasks: () => {
                set((state) => {
                    const newTasks = { ...state.tasks };
                    const deletedIds: string[] = [];
                    const changedParents: Record<string, Task> = {};

                    // Collect all completed tasks (excluding root and items inside an active grocery list) and their subtrees
                    Object.values(state.tasks).forEach(task => {
                        if (task.id !== INITIAL_ROOT_ID && task.completed) {
                            const parent = task.parentId ? state.tasks[task.parentId] : Object.values(state.tasks).find(p => p.children?.includes(task.id));
                            if (parent && !parent.completed && isGroceryList(parent)) {
                                return;
                            }
                            const stack = [task.id];
                            while (stack.length > 0) {
                                const cid = stack.pop()!;
                                if (deletedIds.includes(cid)) continue;
                                deletedIds.push(cid);
                                const t = state.tasks[cid];
                                if (t && Array.isArray(t.children)) {
                                    t.children.forEach(subId => stack.push(subId));
                                }
                            }
                        }
                    });

                    if (deletedIds.length === 0) return state;

                    const deletedSet = new Set(deletedIds);
                    deletedIds.forEach(id => {
                        delete newTasks[id];
                    });

                    Object.values(newTasks).forEach(task => {
                        if (Array.isArray(task.children) && task.children.some(cid => deletedSet.has(cid))) {
                            const updated = {
                                ...task,
                                children: task.children.filter(cid => !deletedSet.has(cid))
                            };
                            newTasks[task.id] = updated;
                            changedParents[task.id] = updated;
                        }
                    });

                    const newState = {
                        ...state,
                        tasks: newTasks,
                        undoStack: [...state.undoStack.slice(-25), state.tasks],
                        redoStack: [],
                        canUndo: true,
                        canRedo: false,
                        lastModified: Date.now(),
                        lastAction: 'delete' as const
                    };

                    broadcastPatch(changedParents, deletedIds);
                    return newState;
                });
            },

            assignTask: (id, newCreator) => {
                set((state) => {
                    const task = state.tasks[id];
                    if (!task || task.id === INITIAL_ROOT_ID) return state;

                    const updatedTask = { ...task, createdBy: newCreator };
                    const changedTasks = { [id]: updatedTask };

                    const newState = {
                        ...state,
                        tasks: {
                            ...state.tasks,
                            ...changedTasks
                        },
                        lastModified: Date.now()
                    };
                    broadcastPatch(changedTasks);
                    return newState;
                });
            },

            setPath: (path) => set({ path }),

            navigateTo: (id) => set((state) => ({ path: [...state.path, id] })),

            navigateBack: () => set((state) => ({ path: state.path.slice(0, -1) })),

            selectTask: (id) => set((state) => {
                if (!id) return { selectedTaskId: null, path: [INITIAL_ROOT_ID] };

                // Find parent to construct path
                const parent = Object.values(state.tasks).find(t => t.children.includes(id));
                let newPath = [...state.path];

                // If we found a parent, try to align the path
                if (parent) {
                    const parentIndex = newPath.indexOf(parent.id);
                    if (parentIndex !== -1) {
                        // Truncate path after parent
                        newPath = newPath.slice(0, parentIndex + 1);
                        // Append the selected task (expanding it)
                        newPath.push(id);
                    } else {
                        if (parent.id === INITIAL_ROOT_ID) {
                            newPath = [INITIAL_ROOT_ID, id];
                        }
                    }
                }

                return { selectedTaskId: id, path: newPath, lastAction: 'select' as const };
            }),

            selectNextTask: () => set((state) => {
                if (!state.selectedTaskId) return state;
                const parent = Object.values(state.tasks).find(t => t.children.includes(state.selectedTaskId!));
                if (!parent) return state;

                // Filter uncompleted siblings
                const siblings = parent.children.filter(id => !state.tasks[id]?.completed);
                const currentIndex = siblings.indexOf(state.selectedTaskId);

                if (currentIndex !== -1 && currentIndex < siblings.length - 1) {
                    const nextId = siblings[currentIndex + 1];
                    // Update path: same parent, so just swap last item
                    const newPath = [...state.path];
                    newPath.pop(); // Remove current
                    newPath.push(nextId); // Add next
                    return { selectedTaskId: nextId, path: newPath, lastAction: 'nav' as const };
                }
                return state;
            }),

            selectPrevTask: () => set((state) => {
                if (!state.selectedTaskId) return state;
                const parent = Object.values(state.tasks).find(t => t.children.includes(state.selectedTaskId!));
                if (!parent) return state;

                const siblings = parent.children.filter(id => !state.tasks[id]?.completed);
                const currentIndex = siblings.indexOf(state.selectedTaskId);

                if (currentIndex > 0) {
                    const prevId = siblings[currentIndex - 1];
                    const newPath = [...state.path];
                    newPath.pop();
                    newPath.push(prevId);
                    return { selectedTaskId: prevId, path: newPath, lastAction: 'nav' as const };
                }
                return state;
            }),

            selectParentTask: () => set((state) => {
                if (!state.selectedTaskId) return state;
                const parent = Object.values(state.tasks).find(t => t.children.includes(state.selectedTaskId!));
                if (parent && parent.id !== INITIAL_ROOT_ID) {
                    // Truncate path to parent
                    const parentIndex = state.path.indexOf(parent.id);
                    let newPath = [...state.path];
                    if (parentIndex !== -1) {
                        newPath = newPath.slice(0, parentIndex + 1);
                    }
                    return { selectedTaskId: parent.id, path: newPath, lastAction: 'nav' as const };
                }
                return state;
            }),

            selectChildTask: () => set((state) => {
                if (!state.selectedTaskId) return state;
                const task = state.tasks[state.selectedTaskId];
                if (!task) return state;

                const children = task.children?.filter(id => !state.tasks[id]?.completed) || [];
                if (children.length > 0) {
                    const childId = children[0];
                    return {
                        selectedTaskId: childId,
                        path: [...state.path, childId],
                        lastAction: 'nav' as const
                    };
                }
                return state;
            }),

            toggleSelectedTask: () => {
                const id = get().selectedTaskId;
                if (id) get().toggleTask(id);
            },

            syncState: (serverState: any) => {
                set((state) => {
                    if (serverState.version > state.version) {
                        return {
                            version: serverState.version,
                            tasks: serverState.tasks,
                            scheduledPrints: serverState.scheduledPrints || [],
                            lastModified: serverState.lastModified || Date.now()
                        };
                    }
                    return state;
                });
            },

            applyPatch: (patch: any) => {
                set((state) => {
                    // Only apply if version is newer, or if it's a direct patch response
                    const newTasks = { ...state.tasks };
                    let modified = false;

                    if (patch.tasks) {
                        Object.entries(patch.tasks).forEach(([id, t]) => {
                            newTasks[id] = t as Task;
                            modified = true;
                        });
                    }
                    if (patch.deletedIds) {
                        patch.deletedIds.forEach((id: string) => {
                            delete newTasks[id];
                            modified = true;
                        });
                    }

                    if (modified) {
                        return {
                            tasks: newTasks,
                            version: patch.version,
                            lastModified: patch.lastModified
                        };
                    }
                    return state;
                });
            }
        }),
        {
            name: 'thermalflow-storage',
            partialize: (state) => {
                const { currentUser, undoStack, redoStack, canUndo, canRedo, ...rest } = state;
                return rest;
            },
            onRehydrateStorage: () => () => {
                console.log('State rehydrated');
            }
        }
    )
);

// Global listeners setup function
if (typeof window !== 'undefined' && socket!) {
    socket.on('sync:init', (data: any) => {
        useTaskStore.getState().syncState(data);
    });

    socket.on('sync:broadcast', (data: any) => {
        useTaskStore.getState().syncState(data);
    });

    socket.on('sync:patched', (data: any) => {
        useTaskStore.getState().applyPatch(data);
    });
}

// --- High-Performance Granular Selectors ---

/**
 * Select a single task by ID. Only re-renders if this specific task changes.
 */
export const useTask = (id: string | null | undefined) => {
    return useTaskStore((state) => (id ? state.tasks[id] : undefined));
};

/**
 * Select an array of children IDs for a parent. Only re-renders when children are added/removed.
 */
export const useTaskChildIds = (parentId: string) => {
    return useTaskStore(
        useShallow((state) => state.tasks[parentId]?.children || [])
    );
};

/**
 * Select subtask progress count for a task.
 */
export const useTaskProgress = (id: string) => {
    return useTaskStore(
        useShallow((state) => {
            const task = state.tasks[id];
            if (!task || !task.children || task.children.length === 0) {
                return null;
            }
            const total = task.children.length;
            const completed = task.children.filter((cid) => state.tasks[cid]?.completed).length;
            return {
                total,
                completed,
                formatted: `${completed}/${total}`,
                percentage: Math.round((completed / total) * 100)
            };
        })
    );
};

/**
 * Select all unique creators efficiently.
 */
export const useUniqueCreators = () => {
    return useTaskStore(
        useShallow((state) => {
            const set = new Set<string>();
            const visited = new Set<string>(['root']);
            const stack = [...(state.tasks['root']?.children || [])];

            while (stack.length > 0) {
                const id = stack.pop()!;
                if (visited.has(id)) continue;
                visited.add(id);
                const t = state.tasks[id];
                if (!t) continue;
                const creator = t.createdBy;
                if (creator && creator !== 'system' && creator !== 'local' && creator !== 'api' && creator !== 'gemini-mcp') {
                    set.add(creator);
                }
                if (Array.isArray(t.children)) {
                    t.children.forEach(cid => stack.push(cid));
                }
            }

            if (state.currentUser && state.currentUser !== 'local' && state.currentUser !== 'system') {
                set.add(state.currentUser);
            }
            return Array.from(set).sort();
        })
    );
};
