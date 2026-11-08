'use client';

import { useState, useRef, useEffect } from 'react';
import {
    useTaskStore,
    isGroceryList,
    isGroceryTaskTitle,
    parseGroceryInput
} from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { LayersPlus, CornerDownRight, X, Sparkles, ShoppingCart } from 'lucide-react';
import { cn, getPrintServerUrl } from '@/lib/utils';
import { DecomposeModal } from './DecomposeModal';
import { toast } from 'sonner';

export default function GlobalTaskInput() {
    const [title, setTitle] = useState('');
    const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);
    const [groceryModeToggle, setGroceryModeToggle] = useState(false);

    const addTask = useTaskStore(state => state.addTask);
    const addTasksBatch = useTaskStore(state => state.addTasksBatch);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const selectTask = useTaskStore(state => state.selectTask);
    const autoPrintEnabled = useTaskStore(state => state.autoPrintEnabled);
    const qrOnChits = useTaskStore(state => state.qrOnChits);
    const selectedTask = useTaskStore(useShallow(state =>
        state.selectedTaskId ? state.tasks[state.selectedTaskId] : null
    ));
    const inputRef = useRef<HTMLInputElement>(null);

    const parentIsGrocery = isGroceryList(selectedTask);
    const effectiveGroceryMode = parentIsGrocery || (!selectedTask && groceryModeToggle);

    const printSingleTask = async (taskTitle: string, taskId?: string) => {
        if (!autoPrintEnabled) return;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1200);

            const printServerUrl = getPrintServerUrl();
            const host = typeof window !== 'undefined' ? window.location.origin : '';
            const qrUrl = qrOnChits && taskId ? `${host}/api/tasks/toggle-qr?id=${taskId}` : undefined;

            await fetch(`${printServerUrl}/print-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskName: taskTitle.toUpperCase(),
                    taskId,
                    qrUrl
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (e) {
            console.log("Auto-print failed", e);
        }
    };

    // Detect range patterns like "Job 1-15" → creates "Job 1", "Job 2", ... "Job 15"
    const parseRangePattern = (input: string): { prefix: string; start: number; end: number } | null => {
        const match = input.match(/^(.+)\s+(\d+)-(\d+)$/);
        if (!match) return null;
        const start = parseInt(match[2], 10);
        const end = parseInt(match[3], 10);
        if (start > end || start === end) return null;
        return { prefix: match[1], start, end };
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        let trimmed = title.trim();
        if (!trimmed) return;

        // Support "/grocery ..." prefix shortcut
        let forcedGroceryPrefix = false;
        if (/^\/(grocery|groceries|shop)\b/i.test(trimmed)) {
            forcedGroceryPrefix = true;
            trimmed = trimmed.replace(/^\/(grocery|groceries|shop)\s*/i, '').trim() || 'Grocery List';
        }

        const parentId = selectedTaskId || 'root';
        const isCreatingGroceryAtRoot =
            parentId === 'root' && (effectiveGroceryMode || forcedGroceryPrefix || isGroceryTaskTitle(trimmed));

        // 1. Adding items inside an existing Grocery List -> split commas & suppress individual auto-print
        if (parentIsGrocery) {
            const items = parseGroceryInput(trimmed);
            if (items.length === 1) {
                addTask(parentId, items[0]);
            } else if (items.length > 1) {
                addTasksBatch(parentId, items);
                toast.success(`Added ${items.length} items to "${selectedTask?.title}"`);
            }
            setTitle('');
            return;
        }

        // 2. Creating a Grocery List (or adding comma-separated items directly in Grocery Mode at root)
        if (isCreatingGroceryAtRoot || effectiveGroceryMode || forcedGroceryPrefix) {
            const parts = parseGroceryInput(trimmed);
            if (parts.length > 1) {
                // User typed multiple items like "2x Milk, Eggs (12), Bread" directly!
                // Find an existing uncompleted Grocery List at root, or create "Grocery List"
                const state = useTaskStore.getState();
                const rootChildren = state.tasks['root']?.children || [];
                const existingGroceryId = rootChildren.find(cid => {
                    const t = state.tasks[cid];
                    return t && !t.completed && isGroceryList(t);
                });

                const targetListId = existingGroceryId || addTask('root', 'Grocery List', undefined, 'grocery') || 'root';
                addTasksBatch(targetListId, parts);
                selectTask(targetListId);
                toast.success(`Added ${parts.length} items to Grocery List`);
            } else {
                // Create a new Grocery List (e.g., "Grocery List", "Trader Joe's", "Costco") and select it
                const newListId = addTask(parentId, trimmed, undefined, 'grocery');
                if (newListId) {
                    selectTask(newListId);
                }
                toast.success(`Created Grocery List "${trimmed}" — type items to add!`);
            }
            setTitle('');
            setGroceryModeToggle(false);
            return;
        }

        // 3. Standard Task Creation (with range pattern support and normal auto-print)
        const range = parseRangePattern(trimmed);

        if (range) {
            const titles: string[] = [];
            for (let i = range.start; i <= range.end; i++) {
                titles.push(`${range.prefix} ${i}`);
            }
            addTasksBatch(parentId, titles);
            setTitle('');

            if (autoPrintEnabled) {
                const parentChildren = useTaskStore.getState().tasks[parentId]?.children || [];
                const addedIds = parentChildren.slice(-titles.length);
                for (let idx = 0; idx < titles.length; idx++) {
                    await printSingleTask(titles[idx], addedIds[idx]);
                }
            }
        } else {
            const createdId = addTask(parentId, trimmed);
            setTitle('');
            if (createdId) {
                printSingleTask(trimmed, createdId);
            }
        }
    };

    // Auto-focus on selection change
    useEffect(() => {
        if (selectedTaskId) {
            inputRef.current?.focus();
        }
    }, [selectedTaskId]);

    return (
        <div className="fixed bottom-4 sm:bottom-8 left-1/2 -translate-x-1/2 w-full max-w-xl px-3 sm:px-4 z-40">
            {/* Graceful Context Pill Banner Above the Footer Bar when a parent task is selected */}
            {selectedTask && (
                <div className="flex justify-start mb-1.5 px-1 animate-in fade-in slide-in-from-bottom-1 duration-150">
                    <div
                        className={cn(
                            "inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-lg border text-xs font-mono shadow-md backdrop-blur-md max-w-full",
                            parentIsGrocery
                                ? "bg-emerald-950/90 dark:bg-emerald-950/90 border-emerald-500/40 text-emerald-200"
                                : "bg-zinc-900/90 dark:bg-zinc-900/95 border-zinc-700/80 text-zinc-200"
                        )}
                    >
                        {parentIsGrocery ? (
                            <ShoppingCart size={12} className="text-emerald-400 shrink-0" />
                        ) : (
                            <CornerDownRight size={12} className="text-zinc-400 shrink-0" />
                        )}
                        <span className="text-[10px] uppercase tracking-wider opacity-70 shrink-0">
                            {parentIsGrocery ? 'List:' : 'Sub-task of:'}
                        </span>
                        <span className="font-bold truncate">{selectedTask.title}</span>
                        <button
                            type="button"
                            aria-label="Deselect parent task"
                            onClick={() => selectTask(null)}
                            className="p-0.5 hover:bg-white/15 rounded transition-colors ml-0.5 shrink-0 text-zinc-400 hover:text-white"
                            title="Return to root (ESC)"
                        >
                            <X size={13} />
                        </button>
                    </div>
                </div>
            )}

            <div className={cn(
                "bg-card border-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-xl p-1.5 sm:p-2 transition-colors group",
                effectiveGroceryMode
                    ? "border-emerald-600/40 dark:border-emerald-400/40 focus-within:border-emerald-600 dark:focus-within:border-emerald-400"
                    : "border-zinc-900/15 dark:border-zinc-100/15 focus-within:border-zinc-900 dark:focus-within:border-zinc-100"
            )}>
                <form onSubmit={handleAdd} className="flex gap-1.5 sm:gap-2 items-center">
                    <div className="flex-1 flex items-center bg-transparent border-none focus-within:ring-0 min-w-0">
                        <Input
                            id="global-task-input"
                            ref={inputRef}
                            value={title}
                            aria-label={selectedTask ? `Add subtask to ${selectedTask.title}` : "Add task to root"}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={
                                parentIsGrocery
                                    ? `Add items to ${selectedTask?.title} (e.g. 2x Milk, Eggs)...`
                                    : groceryModeToggle
                                    ? "New grocery list name or items (Milk, Eggs)..."
                                    : selectedTask
                                    ? `Add sub-task to ${selectedTask.title}...`
                                    : "Add task to root..."
                            }
                            autoComplete="off"
                            className="h-11 sm:h-12 border-none bg-transparent focus-visible:ring-0 text-sm sm:text-base font-mono flex-1 min-w-0"
                        />
                    </div>

                    {/* Dedicated Grocery Mode Toggle Button (shown at root or when inside a grocery list) */}
                    {(!selectedTask || parentIsGrocery) && (
                        <button
                            type="button"
                            aria-label={effectiveGroceryMode ? "Grocery list mode active" : "Switch to Grocery List mode"}
                            aria-pressed={effectiveGroceryMode}
                            onClick={() => {
                                if (parentIsGrocery) {
                                    selectTask(null);
                                    setGroceryModeToggle(false);
                                } else {
                                    setGroceryModeToggle(prev => !prev);
                                    inputRef.current?.focus();
                                }
                            }}
                            className={cn(
                                "h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center rounded-lg border transition-all shadow-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                                effectiveGroceryMode
                                    ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500"
                                    : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 hover:scale-105 active:scale-95"
                            )}
                            title={
                                parentIsGrocery
                                    ? `Adding to Grocery List "${selectedTask?.title}" (Click to exit)`
                                    : groceryModeToggle
                                    ? "Grocery List Mode ON: Type a list name (e.g. Trader Joe's) or comma-separated items (2x Milk, Eggs)"
                                    : "Create a Grocery List or add shopping items"
                            }
                        >
                            <ShoppingCart size={18} />
                        </button>
                    )}

                    <button
                        type="button"
                        aria-label="Decompose goal or generate grocery recipe with AI"
                        onClick={() => setIsDecomposeOpen(true)}
                        className="h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:scale-105 active:scale-95 transition-transform shadow-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        title={effectiveGroceryMode ? "AI Recipe-to-Grocery: Generate ingredients from a meal name" : "AI Sparkle: Decompose goal into subtasks & print checklist"}
                    >
                        <Sparkles size={18} />
                    </button>
                    <button
                        type="submit"
                        aria-label={effectiveGroceryMode ? "Add grocery list or items" : "Add task"}
                        className={cn(
                            "h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center rounded-lg hover:scale-105 active:scale-95 transition-transform shadow-md shrink-0 focus-visible:outline-none focus-visible:ring-2",
                            effectiveGroceryMode
                                ? "bg-emerald-700 dark:bg-emerald-500 text-white dark:text-zinc-950 focus-visible:ring-emerald-500"
                                : "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                        )}
                        title={effectiveGroceryMode ? "Add to Grocery List (no individual chit waste)" : "Add task"}
                    >
                        <LayersPlus size={20} />
                    </button>
                </form>
            </div>

            {/* Visual Shortcut Hint */}
            <div className="hidden md:flex text-center mt-2.5 text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-mono items-center justify-center gap-4">
                <span>Press <kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">ESC</kbd> to deselect</span>
                <span>•</span>
                <span>Press <kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">ENTER</kbd> to save</span>
                <span>•</span>
                <span>Tip: Comma-separate grocery items (<kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">2x Milk, Eggs (12)</kbd>)</span>
            </div>

            {isDecomposeOpen && (
                <DecomposeModal
                    open={isDecomposeOpen}
                    onOpenChange={setIsDecomposeOpen}
                    taskId={selectedTaskId}
                    initialTitle={title || selectedTask?.title || ''}
                    initialMode={effectiveGroceryMode ? 'grocery' : 'task'}
                />
            )}
        </div>
    );
}
