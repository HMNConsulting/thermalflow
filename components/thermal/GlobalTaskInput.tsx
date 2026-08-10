'use client';

import { useState, useRef, useEffect } from 'react';
import { useTaskStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { LayersPlus, CornerDownRight, X } from 'lucide-react';
import { cn, getPrintServerUrl } from '@/lib/utils';

export default function GlobalTaskInput() {
    const [title, setTitle] = useState('');
    const addTask = useTaskStore(state => state.addTask);
    const addTasksBatch = useTaskStore(state => state.addTasksBatch);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const selectTask = useTaskStore(state => state.selectTask);
    const selectedTask = useTaskStore(useShallow(state =>
        state.selectedTaskId ? state.tasks[state.selectedTaskId] : null
    ));
    const inputRef = useRef<HTMLInputElement>(null);

    const printSingleTask = async (taskTitle: string) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);

            const printServerUrl = getPrintServerUrl();

            await fetch(`${printServerUrl}/print-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskName: taskTitle.toUpperCase() }),
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
        const trimmed = title.trim();
        if (!trimmed) return;

        const parentId = selectedTaskId || 'root';
        const range = parseRangePattern(trimmed);

        if (range) {
            // Build all titles, then create all tasks atomically in one store update
            const titles: string[] = [];
            for (let i = range.start; i <= range.end; i++) {
                titles.push(`${range.prefix} ${i}`);
            }
            addTasksBatch(parentId, titles);
            setTitle('');

            // Print each task sequentially
            for (const taskTitle of titles) {
                await printSingleTask(taskTitle);
            }
        } else {
            addTask(parentId, trimmed);
            setTitle('');
            printSingleTask(trimmed);
        }
    };

    // Auto-focus on selection change
    useEffect(() => {
        if (selectedTaskId) {
            inputRef.current?.focus();
        }
    }, [selectedTaskId]);

    return (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-full max-w-xl px-4 z-50">
            <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl p-2 transition-all group focus-within:ring-2 ring-zinc-500/20">
                <form onSubmit={handleAdd} className="flex gap-2 items-center">
                    <div className="flex-1 flex items-center bg-transparent border-none focus-within:ring-0">
                        {selectedTask && (
                            <div className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono text-zinc-500 shrink-0 max-w-[150px] shadow-sm animate-in fade-in slide-in-from-left-2 ml-2">
                                <CornerDownRight size={10} />
                                <span className="truncate flex-1">{selectedTask.title}</span>
                                <button
                                    type="button"
                                    onClick={() => selectTask(null)}
                                    className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-sm transition-colors ml-1"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                        <Input
                            id="global-task-input"
                            ref={inputRef}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={selectedTask ? `Add sub-task...` : "Add task to root..."}
                            autoComplete="off"
                            className="h-12 border-none bg-transparent focus-visible:ring-0 text-base font-handwriting flex-1"
                        />
                    </div>
                    <button
                        type="submit"
                        className="h-12 w-12 flex items-center justify-center rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-105 active:scale-95 transition-all shadow-lg"
                    >
                        <LayersPlus size={20} />
                    </button>
                </form>
            </div>

            {/* Visual Shortcut Hint */}
            <div className="hidden md:flex text-center mt-3 text-[10px] uppercase tracking-widest text-zinc-400 font-mono items-center justify-center gap-4">
                <span>Press <kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 font-bold">ESC</kbd> to deselect</span>
                <span>•</span>
                <span>Press <kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 font-bold">ENTER</kbd> to save</span>
            </div>
        </div>
    );
}
