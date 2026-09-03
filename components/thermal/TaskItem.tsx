'use client';

import React, { memo, useState, useRef, useEffect } from 'react';
import { useTask, useTaskStore, useTaskProgress } from '@/lib/store';
import { Checkbox } from '../ui/checkbox';
import { Trash2, Printer, Edit2, AlertCircle } from 'lucide-react';
import { cn, getPrintServerUrl } from '@/lib/utils';
import { getUserColor } from '@/lib/users';
import { toast } from 'sonner';

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
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', task.id);
                e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => onSelect(task.id)}
            className={cn(
                "group flex items-center justify-between p-2 rounded text-sm cursor-pointer border border-transparent transition-all relative overflow-hidden select-none",
                isPathActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
                isSelected && "ring-2 ring-zinc-900 dark:ring-zinc-100 ring-inset bg-zinc-50 dark:bg-zinc-900 z-10",
                task.priority === 'urgent' && "border-red-400/40 bg-red-50/30 dark:bg-red-950/20"
            )}
        >
            {/* Creator Color Indicator */}
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    const current = task.createdBy || 'local';
                    if (allCreators.length <= 1) return;
                    const currentIndex = allCreators.indexOf(current);
                    const nextIndex = (currentIndex + 1) % allCreators.length;
                    assignTask(task.id, allCreators[nextIndex]);
                }}
                className={cn(
                    "absolute left-0 top-0 bottom-0 w-2 hover:w-3 opacity-60 hover:opacity-100 transition-all cursor-pointer",
                    getUserColor(task.createdBy || 'local').bg
                )}
                title={`Created by ${task.createdBy || 'local'} - Click to reassign`}
            />

            <div className="flex items-center gap-3 min-w-0 flex-1 h-full py-0.5 ml-2">
                <div
                    className="p-1 -m-1 touch-manipulation"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleTask(task.id);
                    }}
                >
                    <Checkbox
                        checked={task.completed}
                        onCheckedChange={() => toggleTask(task.id)}
                        className="w-5 h-5 md:w-4 md:h-4 rounded-sm data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100"
                    />
                </div>

                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={editTitle}
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
                            task.completed && "line-through text-zinc-400"
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
                    onClick={handleCyclePriority}
                    title={`Priority: ${task.priority.toUpperCase()} - Click to cycle`}
                    className={cn(
                        "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ml-1",
                        task.priority === 'urgent'
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    )}
                >
                    {task.priority}
                </button>
            )}

            {/* Progress Metadata */}
            {progress && (
                <span className="text-[10px] text-zinc-400 font-mono ml-2 shrink-0">
                    {progress.formatted}
                </span>
            )}

            {/* Quick Actions (Hover) */}
            <div className="flex items-center gap-0.5 ml-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                {/* Single chit print */}
                <button
                    onClick={handlePrintSingle}
                    disabled={isPrinting}
                    className="p-1.5 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded transition-colors"
                    title="Print task chit (ESC/POS)"
                >
                    <Printer size={13} className={isPrinting ? 'animate-spin' : ''} />
                </button>

                {/* Edit Title */}
                <button
                    onClick={handleStartEdit}
                    className="p-1.5 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded transition-colors hidden sm:block"
                    title="Rename task (or double click)"
                >
                    <Edit2 size={13} />
                </button>

                {/* Priority toggle */}
                <button
                    onClick={handleCyclePriority}
                    className="p-1.5 md:p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-amber-500 rounded transition-colors"
                    title="Set Priority (!urgent / !high)"
                >
                    <AlertCircle size={13} />
                </button>

                {/* Delete */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(task.id);
                    }}
                    className="p-1.5 md:p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-zinc-400 hover:text-red-500 rounded transition-colors"
                    title="Delete task"
                >
                    <Trash2 size={13} />
                </button>
            </div>
        </div>
    );
});
