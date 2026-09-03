'use client';
import { useTaskStore, useTask, useUniqueCreators } from '@/lib/store';
import { useState, useMemo, useRef, useEffect } from 'react';
import { cn, getPrintServerUrl } from '@/lib/utils';
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
    const addTask = useTaskStore(state => state.addTask);
    const selectTask = useTaskStore(state => state.selectTask);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const autoPrintEnabled = useTaskStore(state => state.autoPrintEnabled);
    const qrOnChits = useTaskStore(state => state.qrOnChits);
    const allCreators = useUniqueCreators();

    const [newTaskTitle, setNewTaskTitle] = useState('');

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
                origin: { y: 0.6 }
            });
        }

        prevTodayCountRef.current = todayCount;
    }, [groupedTasks]);

    if (!parentTask) return null;

    const printSingleTask = async (title: string, taskId?: string) => {
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
                    taskName: title.toUpperCase(),
                    taskId,
                    qrUrl
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (e) {
            console.log("Auto-print skipped or offline", e);
        }
    };

    const handleAddTask = (e: React.FormEvent) => {
        e.preventDefault();
        const title = newTaskTitle.trim();
        if (title) {
            addTask(parentId, title);
            setNewTaskTitle('');
            printSingleTask(title);
        }
    };

    return (
        <div className="w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 min-h-0">
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 bg-zinc-50 dark:bg-zinc-950 z-20">
                <span className="font-mono text-sm font-bold truncate">
                    {parentTask.id === 'root' ? 'Home' : parentTask.title}
                </span>
                {parentTask.children && parentTask.children.length > 0 && (
                    <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        {parentTask.children.filter(id => !tasks[id]?.completed).length} pending
                    </span>
                )}
            </div>

            {/* Scrollable List with optimized rendering */}
            <div className="flex-1 overflow-y-auto p-2 scroll-smooth">
                {Object.keys(groupedTasks).length === 0 && parentTask.children.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-2 opacity-50">
                        <span className="text-xs">No tasks</span>
                    </div>
                ) : (
                    Object.entries(groupedTasks).reverse().map(([dateLabel, groupTasks]) => (
                        <div key={dateLabel} className="mb-4">
                            <h3 className="px-2 mb-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider sticky top-0 bg-zinc-50 dark:bg-zinc-950 py-1 z-10">
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
        </div>
    );
}

