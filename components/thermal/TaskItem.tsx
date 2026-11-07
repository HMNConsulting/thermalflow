'use client';

import React, { memo, useState, useRef, useEffect } from 'react';
import { useTask, useTaskStore, useTaskProgress } from '@/lib/store';
import { Checkbox } from '../ui/checkbox';
import { Trash2, Printer, Edit2, AlertCircle, Sparkles } from 'lucide-react';
import { cn, getPrintServerUrl } from '@/lib/utils';
import { getUserColor } from '@/lib/users';
import { toast } from 'sonner';
import { DecomposeModal } from './DecomposeModal';


interface TaskItemProps {
    taskId: string;
    isPathActive: boolean;
    isSelected: boolean;
    allCreators: string[];
    onSelect: (taskId: string) => void;
}

export const TaskItem = memo(function TaskItem({
    taskId,
    isPathActive,
    isSelected,
    allCreators,
    onSelect
}: TaskItemProps) {
    const task = useTask(taskId);
    const toggleTask = useTaskStore((state) => state.toggleTask);
    const deleteTask = useTaskStore((state) => state.deleteTask);
    const assignTask = useTaskStore((state) => state.assignTask);
    const updateTaskTitle = useTaskStore((state) => state.updateTaskTitle);
    const setTaskPriority = useTaskStore((state) => state.setTaskPriority);
    const qrOnChits = useTaskStore((state) => state.qrOnChits);
    const progress = useTaskProgress(taskId);

    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState('');
    const [isPrinting, setIsPrinting] = useState(false);
    const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);


    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    if (!task) return null;

    const handleStartEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditTitle(task.title);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        const trimmed = editTitle.trim();
        if (trimmed && trimmed !== task.title) {
            updateTaskTitle(task.id, trimmed);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            setIsEditing(false);
        }
    };

    const handlePrintSingle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPrinting) return;
        setIsPrinting(true);

        try {
            const printServerUrl = getPrintServerUrl();
            const host = typeof window !== 'undefined' ? window.location.origin : '';
            const qrUrl = qrOnChits ? `${host}/api/tasks/toggle-qr?id=${task.id}` : undefined;

            const res = await fetch(`${printServerUrl}/print-single`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskName: task.title,
                    taskId: task.id,
                    qrUrl,
                    priority: task.priority
                })
            });

            if (res.ok) {
                toast.success(`Sent chit for "${task.title}" to printer!`);
            } else {
                toast.info(`Printer offline. Simulation triggered.`);
            }
        } catch {
            toast.info(`Printer unavailable. (Simulated)`);
        } finally {
            setIsPrinting(false);
        }
    };

    const handleCyclePriority = (e: React.MouseEvent) => {
        e.stopPropagation();
        const nextPriority =
            task.priority === 'urgent'
                ? 'normal'
                : task.priority === 'high'
                ? 'urgent'
                : 'high';
        setTaskPriority(task.id, nextPriority);
        toast.info(`Priority set to ${nextPriority.toUpperCase()}`);
    };

    return (
        <div
            role="row"
            aria-selected={isSelected}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', task.id);
                e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => onSelect(task.id)}
            className={cn(
                "group flex items-center justify-between p-2 rounded text-sm cursor-pointer border border-transparent transition-colors relative overflow-hidden select-none",
                isPathActive ? "bg-zinc-200/80 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
                isSelected && "ring-2 ring-zinc-900 dark:ring-zinc-100 ring-inset bg-zinc-100/70 dark:bg-zinc-900 z-10",
                task.priority === 'urgent' && "border-red-400/40 bg-red-50/30 dark:bg-red-950/20"
            )}
        >
            <div className="flex items-center gap-2.5 min-w-0 flex-1 h-full py-0.5">
                {/* Creator Reassignment Dot */}
                <button
                    type="button"
                    aria-label={`Task creator: ${task.createdBy || 'local'}. Click to reassign`}
                    onClick={(e) => {
                        e.stopPropagation();
                        const current = task.createdBy || 'local';
                        if (allCreators.length <= 1) return;
                        const currentIndex = allCreators.indexOf(current);
                        const nextIndex = (currentIndex + 1) % allCreators.length;
                        assignTask(task.id, allCreators[nextIndex]);
                    }}
                    className={cn(
                        "w-2.5 h-2.5 rounded-full shrink-0 opacity-75 hover:opacity-100 hover:scale-125 transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                        getUserColor(task.createdBy || 'local').bg
                    )}
                    title={`Created by ${task.createdBy || 'local'} - Click to reassign`}
                />

                <div
                    className="p-1.5 -m-1.5 touch-manipulation flex items-center justify-center"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleTask(task.id);
                    }}
                >
                    <Checkbox
                        checked={task.completed}
                        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                        onCheckedChange={() => toggleTask(task.id)}
                        className="w-5 h-5 md:w-4 md:h-4 rounded-sm data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100"
                    />
                </div>

                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={editTitle}
                        aria-label="Edit task title"
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={handleSaveEdit}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-white dark:bg-zinc-950 border border-zinc-400 dark:border-zinc-600 rounded px-2 py-0.5 text-sm font-mono outline-none focus:ring-1 ring-zinc-900 dark:ring-zinc-100"
                    />
                ) : (
                    <span
                        onDoubleClick={handleStartEdit}
                        className={cn(
                            "font-mono text-base break-words leading-tight flex-1",
                            task.completed && "line-through text-zinc-500 dark:text-zinc-400"
                        )}
                        title="Double-click to edit"
                    >
                        {task.title}
                    </span>
                )}
            </div>

            {/* Priority Badge */}
            {task.priority && task.priority !== 'normal' && (
                <button
                    type="button"
                    onClick={handleCyclePriority}
                    aria-label={`Priority ${task.priority}. Click to cycle`}
                    title={`Priority: ${task.priority.toUpperCase()} - Click to cycle`}
                    className={cn(
                        "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ml-1",
                        task.priority === 'urgent'
                            ? "bg-red-600 text-white motion-safe:animate-pulse"
                            : "bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-500/30"
                    )}
                >
                    {task.priority}
                </button>
            )}

            {/* Progress Metadata */}
            {progress && (
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono ml-2 shrink-0">
                    {progress.formatted}
                </span>
            )}

            {/* Quick Actions (Hover) */}
            <div className="flex items-center gap-1 ml-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
                {/* Single chit print */}
                <button
                    type="button"
                    aria-label={`Print chit for ${task.title}`}
                    onClick={handlePrintSingle}
                    disabled={isPrinting}
                    className="p-2 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                    title="Print task chit (ESC/POS)"
                >
                    <Printer size={13} className={isPrinting ? 'animate-spin' : ''} />
                </button>

                {/* AI Sparkle Decompose */}
                <button
                    type="button"
                    aria-label={`Decompose "${task.title}" with AI`}
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsDecomposeOpen(true);
                    }}
                    className="p-2 md:p-1 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-zinc-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                    title="AI Sparkle: Decompose goal into subtasks & print checklist"
                >
                    <Sparkles size={13} />
                </button>

                {/* Edit Title */}
                <button
                    type="button"
                    aria-label={`Rename "${task.title}"`}
                    onClick={handleStartEdit}
                    className="p-2 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded transition-colors hidden sm:block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                    title="Rename task (or double click)"
                >
                    <Edit2 size={13} />
                </button>

                {/* Priority toggle */}
                <button
                    type="button"
                    aria-label={`Cycle priority for "${task.title}"`}
                    onClick={handleCyclePriority}
                    className="p-2 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                    title="Set Priority (!urgent / !high)"
                >
                    <AlertCircle size={13} />
                </button>

                {/* Delete */}
                <button
                    type="button"
                    aria-label={`Delete "${task.title}"`}
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(task.id);
                    }}
                    className="p-2 md:p-1 ml-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    title="Delete task"
                >
                    <Trash2 size={13} />
                </button>
            </div>

            {isDecomposeOpen && (
                <DecomposeModal
                    open={isDecomposeOpen}
                    onOpenChange={setIsDecomposeOpen}
                    taskId={task.id}
                    initialTitle={task.title}
                />
            )}
        </div>
    );
});

