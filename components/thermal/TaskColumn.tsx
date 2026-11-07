'use client';
import { useTaskStore, useTask, useUniqueCreators } from '@/lib/store';
import { useMemo, useRef, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { TaskItem } from './TaskItem';

interface TaskColumnProps {
    parentId: string;
    depth: number;
    activeTaskId?: string;
    isActiveColumn?: boolean;
}

export function TaskColumn({ parentId, depth, activeTaskId, isActiveColumn }: TaskColumnProps) {
    const parentTask = useTask(parentId);
    const tasks = useTaskStore(state => state.tasks);
    const selectTask = useTaskStore(state => state.selectTask);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const allCreators = useUniqueCreators();

    // Derived state: visible tasks (uncompleted), grouped by date
    const groupedTasks = useMemo(() => {
        if (!parentTask || !parentTask.children) return {};

        const visibleTasks = parentTask.children
            .map(id => tasks[id])
            .filter(t => t && !t.completed)
            .filter(t => !activeFilters.creator || t.createdBy === activeFilters.creator);

        const groups: Record<string, typeof visibleTasks> = {};
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        visibleTasks.forEach(task => {
            const date = new Date(task.createdAt || Date.now());
            const key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

            let label = key;
            if (date.toDateString() === today.toDateString()) label = "Today";
            else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";

            if (!groups[label]) groups[label] = [];
            groups[label].push(task);
        });

        return groups;
    }, [parentTask, tasks, activeFilters.creator]);

    // Confetti Logic
    const prevTodayCountRef = useRef<number | null>(null);

    useEffect(() => {
        const todayGroup = groupedTasks["Today"] || [];
        const todayCount = todayGroup.length;

        if (prevTodayCountRef.current !== null && prevTodayCountRef.current > 0 && todayCount === 0) {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                disableForReducedMotion: true
            });
        }

        prevTodayCountRef.current = todayCount;
    }, [groupedTasks]);

    if (!parentTask) return null;

    const pendingCount = parentTask.children ? parentTask.children.filter(id => !tasks[id]?.completed).length : 0;

    return (
        <section
            aria-label={parentTask.id === 'root' ? 'Home Tasks' : `${parentTask.title} Subtasks`}
            className="w-[calc(100vw-2rem)] sm:w-80 flex-shrink-0 flex flex-col h-full bg-background border-r border-zinc-200 dark:border-zinc-800 min-h-0"
        >
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 bg-background z-20">
                <h2 className="font-mono text-sm font-bold truncate">
                    {parentTask.id === 'root' ? 'Home' : parentTask.title}
                </h2>
                {pendingCount > 0 && (
                    <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        {pendingCount} pending
                    </span>
                )}
            </div>

            {/* Scrollable List with bottom clearance for GlobalTaskInput */}
            <div className="flex-1 overflow-y-auto p-2 pb-32 scroll-smooth">
                {Object.keys(groupedTasks).length === 0 && pendingCount === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 gap-2 px-6 text-center">
                        <span className="text-xs font-bold uppercase tracking-wider">No Pending Tasks</span>
                        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            Type anywhere to add a task, enter <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800">Job 1-5</code> for batch chits, or click <span className="text-amber-600 dark:text-amber-400 font-bold">✦</span> to break down a goal.
                        </p>
                    </div>
                ) : (
                    Object.entries(groupedTasks).reverse().map(([dateLabel, groupTasks]) => (
                        <div key={dateLabel} className="mb-4">
                            <h3 className="px-2 mb-2 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider sticky top-0 bg-background py-1 z-10">
                                {dateLabel}
                            </h3>
                            <div className="space-y-[2px]">
                                {groupTasks.map((task) => (
                                    <TaskItem
                                        key={task.id}
                                        taskId={task.id}
                                        isPathActive={activeTaskId === task.id}
                                        isSelected={selectedTaskId === task.id}
                                        allCreators={allCreators}
                                        onSelect={selectTask}
                                    />
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}

