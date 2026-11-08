'use client';
import {
    useTaskStore,
    useTask,
    useUniqueCreators,
    isGroceryList,
    parseGroceryItemDisplay
} from '@/lib/store';
import { useMemo, useRef, useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { TaskItem } from './TaskItem';
import { ShoppingCart, Printer, RotateCcw, Trash2, X } from 'lucide-react';
import { printGroceryListReceipt } from '@/lib/utils';
import { toast } from 'sonner';

interface TaskColumnProps {
    parentId: string;
    depth: number;
    activeTaskId?: string;
    isActiveColumn?: boolean;
}

export function TaskColumn({ parentId, depth, activeTaskId }: TaskColumnProps) {
    const parentTask = useTask(parentId);
    const tasks = useTaskStore(state => state.tasks);
    const selectTask = useTaskStore(state => state.selectTask);
    const toggleTask = useTaskStore(state => state.toggleTask);
    const deleteTask = useTaskStore(state => state.deleteTask);
    const clearCheckedGroceryItems = useTaskStore(state => state.clearCheckedGroceryItems);
    const selectedTaskId = useTaskStore(state => state.selectedTaskId);
    const activeFilters = useTaskStore(state => state.activeFilters);
    const allCreators = useUniqueCreators();

    const [isPrintingList, setIsPrintingList] = useState(false);

    const isGroceryColumn = isGroceryList(parentTask);

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

    // Grocery items split into unchecked and checked (reusable staples)
    const groceryItems = useMemo(() => {
        if (!isGroceryColumn || !parentTask?.children) return { unchecked: [], checked: [] };
        const all = parentTask.children
            .map(id => tasks[id])
            .filter(Boolean)
            .filter(t => !activeFilters.creator || t.createdBy === activeFilters.creator);
        return {
            unchecked: all.filter(t => !t.completed),
            checked: all.filter(t => t.completed)
        };
    }, [isGroceryColumn, parentTask, tasks, activeFilters.creator]);

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

    const handlePrintGroceryColumn = async () => {
        if (isPrintingList) return;
        setIsPrintingList(true);
        try {
            const allItems = [...groceryItems.unchecked, ...groceryItems.checked];
            const res = await printGroceryListReceipt(parentTask.title, allItems);
            if (res.ok) {
                toast.success(`Printed grocery receipt for "${parentTask.title}"!`);
            } else {
                toast.info(`Printer offline — Grocery receipt queued/simulated.`);
            }
        } finally {
            setIsPrintingList(false);
        }
    };

    return (
        <section
            aria-label={parentTask.id === 'root' ? 'Home Tasks' : `${parentTask.title} Subtasks`}
            className="w-[calc(100vw-2rem)] sm:w-80 flex-shrink-0 flex flex-col h-full bg-background border-r border-zinc-200 dark:border-zinc-800 min-h-0"
        >
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0 bg-background z-20 gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {isGroceryColumn && (
                        <span className="p-1 rounded bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 shrink-0">
                            <ShoppingCart size={14} />
                        </span>
                    )}
                    <h2 className="font-mono text-sm font-bold truncate">
                        {parentTask.id === 'root' ? 'Home' : parentTask.title}
                    </h2>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                    {isGroceryColumn && (
                        <button
                            type="button"
                            onClick={handlePrintGroceryColumn}
                            disabled={isPrintingList}
                            title="Print consolidated Grocery List receipt"
                            className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
                        >
                            <Printer size={11} className={isPrintingList ? 'animate-spin' : ''} />
                            <span>Print List</span>
                        </button>
                    )}
                    {pendingCount > 0 && (
                        <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                            {pendingCount} {isGroceryColumn ? 'to buy' : 'pending'}
                        </span>
                    )}
                </div>
            </div>

            {/* Scrollable List with bottom clearance for GlobalTaskInput */}
            <div className="flex-1 overflow-y-auto p-2 pb-32 scroll-smooth">
                {isGroceryColumn ? (
                    groceryItems.unchecked.length === 0 && groceryItems.checked.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-500 dark:text-zinc-400 gap-2 px-6 text-center">
                            <ShoppingCart className="w-7 h-7 text-emerald-600/50 dark:text-emerald-400/50 mb-1" />
                            <span className="text-xs font-bold uppercase tracking-wider">Grocery List Empty</span>
                            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                                Type items below (e.g. <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800">2x Milk, Eggs (12), Bread</code>) or click <span className="text-amber-600 dark:text-amber-400 font-bold">✦</span> to generate recipe ingredients.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Unchecked To-Buy Items */}
                            {groceryItems.unchecked.length > 0 && (
                                <div>
                                    <h3 className="px-2 mb-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider sticky top-0 bg-background py-1 z-10 flex items-center justify-between">
                                        <span>To Buy ({groceryItems.unchecked.length})</span>
                                    </h3>
                                    <div className="space-y-[2px]">
                                        {groceryItems.unchecked.map((task) => (
                                            <TaskItem
                                                key={task.id}
                                                taskId={task.id}
                                                isPathActive={activeTaskId === task.id}
                                                isSelected={selectedTaskId === task.id}
                                                allCreators={allCreators}
                                                onSelect={selectTask}
                                                isGroceryChild={true}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Checked-Off Reusable Staples */}
                            {groceryItems.checked.length > 0 && (
                                <div className="pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-800">
                                    <div className="px-2 mb-1.5 flex items-center justify-between">
                                        <h3 className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                            Checked ({groceryItems.checked.length}) • Tap to Reuse
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                clearCheckedGroceryItems(parentTask.id);
                                                toast.success(`Cleared ${groceryItems.checked.length} checked item(s)`);
                                            }}
                                            className="flex items-center gap-1 text-[10px] font-mono font-bold text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={11} />
                                            <span>Clear Checked</span>
                                        </button>
                                    </div>
                                    <div className="space-y-0.5">
                                        {groceryItems.checked.map((item) => {
                                            const parsed = parseGroceryItemDisplay(item.title);
                                            return (
                                                <div
                                                    key={item.id}
                                                    onClick={() => toggleTask(item.id)}
                                                    title="Click to uncheck and add back to your active grocery list"
                                                    className="group flex items-center gap-2.5 p-2 rounded text-sm font-mono text-zinc-400 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer transition-colors"
                                                >
                                                    <RotateCcw size={13} className="shrink-0 opacity-60 group-hover:opacity-100 group-hover:text-emerald-600" />
                                                    <span className="flex-1 truncate line-through">
                                                        {parsed.name}
                                                    </span>
                                                    {parsed.quantity && (
                                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 line-through shrink-0">
                                                            {parsed.quantity}
                                                        </span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            deleteTask(item.id);
                                                        }}
                                                        aria-label={`Remove ${item.title}`}
                                                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 rounded transition-opacity"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                ) : Object.keys(groupedTasks).length === 0 && pendingCount === 0 ? (
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
