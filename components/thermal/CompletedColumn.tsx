'use client';

import { useTaskStore, isGroceryList } from "@/lib/store";
import { useMemo, useState } from "react";
import { CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export function CompletedColumn() {
    const tasks = useTaskStore(state => state.tasks);
    const toggleTask = useTaskStore(state => state.toggleTask);
    const clearCompletedTasks = useTaskStore(state => state.clearCompletedTasks);
    const activeFilters = useTaskStore(state => state.activeFilters);

    const completedTasks = useMemo(() => {
        const reachable = new Set<string>();
        const stack = [...(tasks['root']?.children || [])];
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (reachable.has(id)) continue;
            reachable.add(id);
            const t = tasks[id];
            if (t && Array.isArray(t.children)) {
                t.children.forEach(cid => stack.push(cid));
            }
        }

        return Object.values(tasks)
            .filter(t => {
                if (!t.completed || t.id === 'root' || !reachable.has(t.id)) return false;
                // Keep checked grocery items inside their active Grocery List rather than cluttering Completed column
                const parent = t.parentId ? tasks[t.parentId] : undefined;
                if (parent && !parent.completed && isGroceryList(parent)) return false;
                return true;
            })
            .filter(t => !activeFilters.creator || t.createdBy === activeFilters.creator)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    }, [tasks, activeFilters.creator]);

    const [isOver, setIsOver] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Allow drop
        setIsOver(true);
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDragLeave = () => {
        setIsOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsOver(false);
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId && tasks[taskId] && !tasks[taskId].completed) {
            toggleTask(taskId);
        }
    };

    if (completedTasks.length === 0 && !isOver) {
        return (
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 border-l border-dashed border-zinc-200 dark:border-zinc-800 transition-colors ${isOver ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-400' : ''}`}
            >
                <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 w-full">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Completed</h2>
                    </div>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">Auto-clears 24h</span>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 text-xs font-mono px-6 text-center gap-1.5">
                    <span className="font-bold uppercase tracking-wider">{isOver ? 'Drop to Complete' : 'No Completed Tasks'}</span>
                    <p className="text-[11px] leading-relaxed">
                        Drag a task here, press <kbd className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700 font-bold">Enter</kbd> on a selected task, or scan a printed QR chit.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 border-l border-dashed border-zinc-200 dark:border-zinc-800 transition-colors min-h-0 ${isOver ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-400' : ''}`}
        >
            <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 w-full">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <div className="flex flex-col">
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 leading-none">Completed</h2>
                    <span className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono mt-0.5">Auto-clears after 24h</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">{completedTasks.length} Done</span>
                    <button
                        type="button"
                        onClick={() => {
                            clearCompletedTasks();
                            toast.success("Cleared completed tasks");
                        }}
                        className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        title="Clear all completed tasks now"
                        aria-label="Clear all completed tasks"
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 pb-32">
                <AnimatePresence initial={false}>
                    {completedTasks.map((task) => (
                        <motion.div
                            key={task.id}
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.15 }}
                            className="group flex items-center gap-2 p-2 mb-1 rounded bg-zinc-100 dark:bg-zinc-800/50 text-sm font-mono text-zinc-500 dark:text-zinc-400 decoration-zinc-400 line-through"
                        >
                            <span className="flex-1 truncate">{task.title}</span>
                            <button
                                type="button"
                                aria-label={`Restore "${task.title}"`}
                                onClick={() => toggleTask(task.id)}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 p-2 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                                title="Restore task"
                            >
                                <RotateCcw size={14} />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
