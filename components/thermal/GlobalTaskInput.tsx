'use client';

import { useState, useRef, useEffect } from 'react';
import { useTaskStore } from '@/lib/store';
import { useShallow } from 'zustand/react/shallow';
import { Input } from '@/components/ui/input';
import { LayersPlus, CornerDownRight, X, Sparkles } from 'lucide-react';
import { cn, getPrintServerUrl } from '@/lib/utils';
import { DecomposeModal } from './DecomposeModal';

export default function GlobalTaskInput() {
    const [title, setTitle] = useState('');
    const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);
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

            if (autoPrintEnabled) {
                const parentChildren = useTaskStore.getState().tasks[parentId]?.children || [];
                const addedIds = parentChildren.slice(-titles.length);
                for (let idx = 0; idx < titles.length; idx++) {
                    await printSingleTask(titles[idx], addedIds[idx]);
                }
            }
        } else {
            addTask(parentId, trimmed);
            setTitle('');
            const parentChildren = useTaskStore.getState().tasks[parentId]?.children || [];
            const createdId = parentChildren[parentChildren.length - 1];
            printSingleTask(trimmed, createdId);
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
            <div className="bg-card border-2 border-zinc-900/15 dark:border-zinc-100/15 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] rounded-xl p-1.5 sm:p-2 transition-colors group focus-within:border-zinc-900 dark:focus-within:border-zinc-100">
                <form onSubmit={handleAdd} className="flex gap-1.5 sm:gap-2 items-center">
                    <div className="flex-1 flex items-center bg-transparent border-none focus-within:ring-0 min-w-0">
                        {selectedTask && (
                            <div className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono text-zinc-600 dark:text-zinc-300 shrink-0 max-w-[140px] sm:max-w-[160px] shadow-xs animate-in fade-in slide-in-from-left-2 ml-1.5">
                                <CornerDownRight size={10} />
                                <span className="truncate flex-1">{selectedTask.title}</span>
                                <button
                                    type="button"
                                    aria-label="Deselect parent task"
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
                            aria-label={selectedTask ? `Add subtask to ${selectedTask.title}` : "Add task to root"}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder={selectedTask ? `Add sub-task...` : "Add task to root..."}
                            autoComplete="off"
                            className="h-11 sm:h-12 border-none bg-transparent focus-visible:ring-0 text-lg font-handwriting flex-1"
                        />
                    </div>
                    <button
                        type="button"
                        aria-label="Decompose goal into subtasks with AI"
                        onClick={() => setIsDecomposeOpen(true)}
                        className="h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:scale-105 active:scale-95 transition-transform shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                        title="AI Sparkle: Decompose goal into subtasks & print checklist"
                    >
                        <Sparkles size={18} />
                    </button>
                    <button
                        type="submit"
                        aria-label="Add task"
                        className="h-11 w-11 sm:h-12 sm:w-12 flex items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:scale-105 active:scale-95 transition-transform shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                        title="Add task"
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
                <span>Press <kbd className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700 font-bold text-zinc-700 dark:text-zinc-300">/</kbd> for shortcuts</span>
            </div>

            {isDecomposeOpen && (
                <DecomposeModal
                    open={isDecomposeOpen}
                    onOpenChange={setIsDecomposeOpen}
                    taskId={selectedTaskId}
                    initialTitle={title || selectedTask?.title || ''}
                />
            )}
        </div>
    );
}

