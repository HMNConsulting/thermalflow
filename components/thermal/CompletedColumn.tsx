'use client';

import { useTaskStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CompletedColumn() {
    const tasks = useTaskStore(state => state.tasks);
    const toggleTask = useTaskStore(state => state.toggleTask);
    const activeFilters = useTaskStore(state => state.activeFilters);

    const completedTasks = useMemo(() => {
        return Object.values(tasks)
            .filter(t => t.completed && t.id !== 'root')
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
        // Show empty state instead of returning null
        return (
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 border-l border-dashed border-zinc-200 dark:border-zinc-800 transition-colors ${isOver ? 'bg-green-50 dark:bg-green-900/20 border-green-400' : ''}`}
            >
                <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 w-full">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">Completed</span>
                </div>
                <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs font-mono opacity-50">
                    {isOver ? 'Drop to complete' : 'No completed tasks'}
                </div>
            </div>
        );
    }
    // Better: Always render container if we want it to be a valid drop target? 
    // Or render a placeholder if empty?
    // User requirement: "Completed column is attached to the right side".
    // If it's hidden when empty, we can't drag to it easily if it's 0 width.
    // Let's make it always visible or at least visible when dragging? 
    // Simplified: Always visible for now, or check requirement.
    // "tasks marked as completed show up there...".

    // Let's update renders to support drag states.

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50/50 dark:bg-zinc-900/50 border-l border-dashed border-zinc-200 dark:border-zinc-800 transition-colors min-h-0 ${isOver ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-400' : ''}`}
        >
            <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 w-full">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-zinc-500">Completed</span>
                <span className="ml-auto text-[10px] text-zinc-400 font-mono">{completedTasks.length} Done</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                <AnimatePresence initial={false}>
                    {completedTasks.map((task) => (
                        <motion.div
                            key={task.id}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="group flex items-center gap-2 p-2 mb-1 rounded bg-zinc-100 dark:bg-zinc-800/50 text-lg font-mono text-zinc-500 decoration-zinc-400 line-through"
                        >
                            <span className="flex-1 truncate">{task.title}</span>
                            <button
                                onClick={() => toggleTask(task.id)}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-opacity"
                                title="Restore task"
                            >
                                <RotateCcw size={16} className="md:w-3 md:h-3" />
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
