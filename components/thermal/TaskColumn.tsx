'use client';
import { useTaskStore } from '@/lib/store';
import { Trash2, LayersPlus } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '../ui/checkbox';
import { cn, getPrintServerUrl } from '@/lib/utils';
import { getUserColor } from '@/lib/users';
import { AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { useRef, useEffect } from 'react';

interface TaskColumnProps {
    parentId: string;
    depth: number;
    activeTaskId?: string;
    isActiveColumn?: boolean;
}

export function TaskColumn({ parentId, depth, activeTaskId, isActiveColumn }: TaskColumnProps) {
    const tasks = useTaskStore(state => state.tasks);
    const addTask = useTaskStore(state => state.addTask);
    const toggleTask = useTaskStore(state => state.toggleTask);
    const selectTask = useTaskStore(state => state.selectTask);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const setPath = useTaskStore(state => state.setPath);
    const deleteTask = useTaskStore(state => state.deleteTask);
    const assignTask = useTaskStore(state => state.assignTask);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const currentUser = useTaskStore(state => state.currentUser);

    const [newTaskTitle, setNewTaskTitle] = useState('');

    const parentTask = tasks[parentId];

    // Derived state: visible tasks (uncompleted), grouped by date
    const groupedTasks = useMemo(() => {
        if (!parentTask || !parentTask.children) return {};

        const visibleTasks = parentTask.children
            .map(id => tasks[id])
            .filter(t => t && !t.completed) // Filter completed
            .filter(t => !activeFilters.creator || t.createdBy === activeFilters.creator);

        // Group by Date
        const groups: Record<string, typeof visibleTasks> = {};

        visibleTasks.forEach(task => {
            const date = new Date(task.createdAt || Date.now()); // Default to now if missing
            const key = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

            // Logic for "Today", "Yesterday"
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            let label = key;
            if (date.toDateString() === today.toDateString()) label = "Today";
            else if (date.toDateString() === yesterday.toDateString()) label = "Yesterday";

            if (!groups[label]) groups[label] = [];
            groups[label].push(task);
        });

        // Sort groups? Today first?
        // Actually keys order is insertion order usually, but let's reliable sort if needed.
        // For now, assume newer tasks (Today) are added last or we rely on iteration order.
        return groups;
    }, [parentTask, tasks, activeFilters.creator]);

    // Derived state: unique creators for cycling assignment
    const allCreators = useMemo(() => {
        const unique = new Set<string>();
        Object.values(tasks).forEach(task => {
            const creator = task.createdBy || 'local';
            if (creator !== 'system') unique.add(creator);
        });
        if (currentUser) unique.add(currentUser);
        return Array.from(unique).sort();
    }, [tasks, currentUser]);

    // Confetti Logic
    const prevTodayCountRef = useRef<number | null>(null);

    useEffect(() => {
        const todayGroup = groupedTasks["Today"] || [];
        const todayCount = todayGroup.length;

        // If we had tasks before (not null), and now we have 0, and it's the "Today" column
        if (prevTodayCountRef.current !== null && prevTodayCountRef.current > 0 && todayCount === 0) {
            // Only trigger if this is the active column or we are looking at it
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });
        }

        prevTodayCountRef.current = todayCount;
    }, [groupedTasks]);

    if (!parentTask) return null;

    const printSingleTask = async (title: string) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000); // Quick 1s timeout for auto-print

            const printServerUrl = getPrintServerUrl();

            await fetch(`${printServerUrl}/print-single`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ taskName: title.toUpperCase() }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
        } catch (e) {
            console.log("Auto-print failed or print server offline", e);
        }
    };

    const handleAddTask = (e: React.FormEvent) => {
        e.preventDefault();
        const title = newTaskTitle.trim();
        if (title) {
            addTask(parentId, title);
            setNewTaskTitle('');
            // Trigger auto-print for the new task
            printSingleTask(title);
        }
    };

    const handleTaskClick = (childId: string) => {
        selectTask(childId);
    };

    return (
        <div className="w-80 flex-shrink-0 flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 min-h-0">
            {/* Header */}
            <div className="h-14 flex items-center px-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 bg-zinc-50 dark:bg-zinc-950 z-20">
                <span className="font-mono text-sm font-bold truncate">
                    {parentTask.id === 'root' ? 'Home' : parentTask.title}
                </span>
            </div>

            {/* Scrollable List */}
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
                            <div className="space-y-[1px]">
                                {groupTasks.map((task) => {
                                    const isSelected = selectedTaskId === task.id;
                                    const isPathActive = activeTaskId === task.id;

                                    // Progress Metadata
                                    // Look up children. Count completed.
                                    // Note: Store has flat tasks map.
                                    const subtaskIds = task.children || [];
                                    const totalSub = subtaskIds.length;
                                    const completedSub = subtaskIds.filter(id => tasks[id]?.completed).length;
                                    const progress = totalSub > 0 ? `${completedSub}/${totalSub}` : null;

                                    return (
                                        <div
                                            key={task.id}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', task.id);
                                                e.dataTransfer.effectAllowed = 'move';
                                            }}
                                            onClick={() => handleTaskClick(task.id)}
                                            className={cn(
                                                "group flex items-center justify-between p-2 rounded text-sm cursor-pointer border border-transparent transition-all relative overflow-hidden",
                                                // Formatting
                                                isPathActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
                                                isSelected && "ring-2 ring-zinc-900 dark:ring-zinc-100 ring-inset bg-zinc-50 dark:bg-zinc-900 z-10"
                                            )}
                                        >
                                            {/* Creator Indicator */}
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
                                                        onCheckedChange={(checked) => {
                                                            // onCheckedChange might fire on mobile more reliably for some components
                                                            if (typeof checked === 'boolean' && checked !== task.completed) {
                                                                toggleTask(task.id);
                                                            }
                                                        }}
                                                        className="w-5 h-5 md:w-4 md:h-4 rounded-sm data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100"
                                                    />
                                                </div>
                                                <span className="font-mono text-base break-words leading-tight">
                                                    {task.title}
                                                </span>
                                            </div>

                                            {progress && (
                                                <span className="text-[10px] text-zinc-400 font-mono ml-2">
                                                    {progress}
                                                </span>
                                            )}

                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteTask(task.id);
                                                }}
                                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2 md:p-1 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 rounded transition-opacity ml-1"
                                                title="Delete task"
                                            >
                                                <Trash2 size={16} className="md:w-3 md:h-3" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))
                )}
            </div>


        </div>
    );
}
