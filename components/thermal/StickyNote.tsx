'use client';

import { Task, useTaskStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { memo, useMemo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Checkbox } from '../ui/checkbox';
import { Trash2 } from 'lucide-react';
import { getUserColor } from '@/lib/users';
import { RecurrenceModal } from './RecurrenceModal';

interface StickyNoteProps {
    taskId: string;
    depth?: number;
}



const StickyNote = memo(({ taskId, depth = 0 }: StickyNoteProps) => {
    const task = useTaskStore(useMemo(() => (state) => state.tasks[taskId], [taskId]));
    const toggleTask = useTaskStore(state => state.toggleTask);
    const selectTask = useTaskStore(state => state.selectTask);
    const isSelected = useTaskStore(useMemo(() => (state) => state.selectedTaskId === taskId, [taskId]));
    const deleteTask = useTaskStore(state => state.deleteTask);

    // Only subscribe to incomplete children IDs to avoid re-rendering when child titles change
    const childIds = useTaskStore(useShallow((state) =>
        (state.tasks[taskId]?.children || []).filter(id => !state.tasks[id]?.completed)
    ));

    // Subscribe to ALL children to calculate progress
    const allChildIds = useTaskStore(useShallow((state) => state.tasks[taskId]?.children || []));
    const completedChildCount = useTaskStore(useShallow((state) =>
        allChildIds.filter(id => state.tasks[id]?.completed).length
    ));

    const progress = allChildIds.length > 0 ? (completedChildCount / allChildIds.length) * 100 : 0;

    // Check if any child is selected (to keep sub-grid expanded)
    const hasSelectedChild = useTaskStore(useCallback(state => {
        const selId = state.selectedTaskId;
        return selId ? childIds.includes(selId) : false;
    }, [childIds]));

    const shouldShowChildren = depth < 1 || isSelected || hasSelectedChild;

    // Randomized rotation for the "post-it" feel (stable for this taskId)
    const rotation = useMemo(() => {
        // Simple hash of taskId to get a stable random-like number
        let hash = 0;
        for (let i = 0; i < taskId.length; i++) {
            hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
        }
        return (hash % 21 - 10) / 10; // -1.0 to +1.0 degrees
    }, [taskId]);

    if (!task) return null;

    const userColors = getUserColor(task.createdBy || 'local');
    // Alternate between light and nested variant based on depth to create visual hierarchy
    const colorClass = depth > 0 && depth % 2 !== 0 ? userColors.nested : userColors.light;

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                selectTask(taskId);
            }}
            style={{
                '--rotation': `${rotation}deg`,
                contentVisibility: 'auto',
                containIntrinsicSize: '0 100px'
            } as any}
            className={cn(
                "group relative p-3.5 transition-[transform,box-shadow,background-color] duration-200 rounded-xs cursor-pointer min-h-[100px] flex flex-col",
                "shadow-[2px_3px_8px_rgba(0,0,0,0.15)] hover:shadow-[4px_6px_12px_rgba(0,0,0,0.2)]",
                colorClass,
                isSelected ? "ring-2 ring-zinc-900 dark:ring-zinc-100 rotate-0 scale-[1.02] z-10 shadow-xl" : "rotate-[var(--rotation)]",
                "will-change-transform contain-content content-visibility-auto"
            )}
        >
            {/* Task title */}
            <div className="flex items-start gap-2.5 mb-2">
                <div
                    onClick={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        checked={task.completed}
                        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                        onCheckedChange={() => toggleTask(taskId)}
                        className="mt-1 border-zinc-900/30 dark:border-zinc-100/30 data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100 data-[state=checked]:text-white dark:data-[state=checked]:text-zinc-900"
                    />
                </div>
                <h3 className={cn(
                    "font-mono text-sm sm:text-base font-medium leading-snug break-words mr-6 text-zinc-900 dark:text-zinc-100",
                    task.completed && "line-through opacity-60"
                )}>
                    {task.title}
                </h3>
            </div>

            {/* Sub-grid for children */}
            {childIds.length > 0 && depth < 3 && shouldShowChildren && (
                <div className="mt-1 pt-2 grid grid-cols-1 gap-2 animate-in fade-in zoom-in-95 duration-200">
                    {childIds.map(childId => (
                        <StickyNote key={childId} taskId={childId} depth={depth + 1} />
                    ))}
                </div>
            )}

            {/* Delete button (only on hover or selected) */}
            <RecurrenceModal taskId={taskId} isSelected={isSelected} />
            <button
                type="button"
                aria-label={`Delete "${task.title}"`}
                title="Delete task"
                onClick={(e) => {
                    e.stopPropagation();
                    deleteTask(taskId);
                }}
                className={cn(
                    "absolute top-2 right-2 p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-zinc-700/60 dark:text-zinc-300/60 hover:text-red-600 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                    isSelected && "opacity-100"
                )}
            >
                <Trash2 size={14} />
            </button>

            {/* Visual Tape effect */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-12 h-6 bg-white/30 dark:bg-white/10 backdrop-blur-xs rotate-2 pointer-events-none border border-white/20 dark:border-white/5" />

            {/* Progress Bar (Only if has children) */}
            {allChildIds.length > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                        className="h-full w-full bg-zinc-900/50 dark:bg-zinc-100/50 origin-left transition-transform duration-300"
                        style={{ transform: `scaleX(${progress / 100})` }}
                    />
                </div>
            )}
        </div>
    );
});

StickyNote.displayName = 'StickyNote';

export default StickyNote;
