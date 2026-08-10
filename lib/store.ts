import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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
    recurrence?: {
        frequency: 'daily' | 'weekly' | 'custom';
        cron: string;        // "0 9 * * *"
        nextRun: number;     // Timestamp
        action: 'reset' | 'clone'; // 'reset' unchecks the task, 'clone' makes a copy
    };
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

    // Actions
    setCurrentUser: (email: string) => void;
    addTask: (parentId: string, title: string) => void;
    addTasksBatch: (parentId: string, titles: string[]) => void;
    toggleTask: (id: string) => void;
    updateTaskTitle: (id: string, title: string) => void;
    setTaskRecurrence: (id: string, recurrence: Task['recurrence'] | undefined) => void;
    deleteTask: (id: string) => void;
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

            setCurrentUser: (email) => set({ currentUser: email }),
            setCreatorFilter: (creator) => set((state) => ({
                activeFilters: { creator },
                path: ['root'],
                selectedTaskId: null
            })),
            setViewMode: (mode) => set({ viewMode: mode }),

            setShowCompleted: (show) => set({ showCompleted: show }),
            toggleCompletedColumn: () => set((state) => ({ showCompleted: !state.showCompleted })),

            addTask: (parentId, title) => {
                const now = Date.now();
                const newId = generateId();

                set((state) => {
                    const parentTask = state.tasks[parentId];
                    if (!parentTask) {
                        console.error(`Parent task ${parentId} not found`);
                        return state;
                    }

                    const newTask: Task = {
                        id: newId,
                        title,
                        completed: false,
                        children: [],
                        parentId,
                        createdAt: now,
                        createdBy: state.currentUser || 'local'
                    };

                    const updatedParent = {
                        ...parentTask,
                        children: [...parentTask.children, newId]
                    };

                    const changedTasks = {
                        [newId]: newTask,
                        [parentId]: updatedParent
                    };

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
            },

            addTasksBatch: (parentId, titles) => {
                const now = Date.now();

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
                        changedTasks[newId] = {
                            id: newId,
                            title,
                            completed: false,
                            children: [],
                            parentId,
                            createdAt: now,
                            createdBy: state.currentUser || 'local'
                        };
                    });

                    const updatedParent = {
                        ...parentTask,
                        children: [...parentTask.children, ...newChildIds]
                    };
                    changedTasks[parentId] = updatedParent;

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
            },

            toggleTask: (id) => {
                set((state) => {
                    const task = state.tasks[id];
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
                    const updatedTask = { ...state.tasks[id], title };
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
                    delete newTasks[id];

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
                        selectedTaskId: newSelectedId,
                        path: newPath,
                        lastModified: Date.now(),
                        lastAction: 'delete' as const
                    };
                    broadcastPatch({ [parent.id]: updatedParent }, [id]);
                    return newState;
                })
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
                        // Fallback: This might happen if parent isn't in current path (jumping context)
                        // Ideally we should rebuild path from root, but that's expensive without back-links.
                        // For now, if we select something completely outside, we might just keep path?
                        // Or if parent is root, path is [root, id].
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
                const { currentUser, ...rest } = state;
                return rest;
            },
            onRehydrateStorage: () => (state) => {
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
