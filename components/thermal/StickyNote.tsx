'use client';

import {
    useTaskStore,
    isGroceryList,
    parseGroceryInput,
    parseGroceryItemDisplay
} from '@/lib/store';
import { cn, printGroceryListReceipt } from '@/lib/utils';
import { memo, useMemo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Checkbox } from '../ui/checkbox';
import { Trash2, ShoppingCart, Printer, Sparkles, Plus, X, RotateCcw } from 'lucide-react';
import { getUserColor } from '@/lib/users';
import { RecurrenceModal } from './RecurrenceModal';
import { DecomposeModal } from './DecomposeModal';
import { toast } from 'sonner';

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
    const addTask = useTaskStore(state => state.addTask);
    const addTasksBatch = useTaskStore(state => state.addTasksBatch);
    const setTaskType = useTaskStore(state => state.setTaskType);
    const clearCheckedGroceryItems = useTaskStore(state => state.clearCheckedGroceryItems);

    const [quickItemText, setQuickItemText] = useState('');
    const [isPrintingReceipt, setIsPrintingReceipt] = useState(false);
    const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);

    const isGrocery = isGroceryList(task);

    // Subscribe to ALL children IDs
    const allChildIds = useTaskStore(useShallow((state) => state.tasks[taskId]?.children || []));

    // Incomplete children IDs
    const childIds = useTaskStore(useShallow((state) =>
        (state.tasks[taskId]?.children || []).filter(id => !state.tasks[id]?.completed)
    ));

    // Completed children IDs (used by grocery notepad to show crossed-out reusable staples)
    const completedChildIds = useTaskStore(useShallow((state) =>
        (state.tasks[taskId]?.children || []).filter(id => Boolean(state.tasks[id]?.completed))
    ));

    // Subscribe to child task objects when this is a grocery list
    const groceryChildren = useTaskStore(useShallow((state) => {
        if (!isGrocery) return [];
        const ids = state.tasks[taskId]?.children || [];
        return ids.map(id => state.tasks[id]).filter(Boolean);
    }));

    const completedChildCount = completedChildIds.length;
    const progress = allChildIds.length > 0 ? (completedChildCount / allChildIds.length) * 100 : 0;

    // Check if any child is selected (to keep sub-grid expanded)
    const hasSelectedChild = useTaskStore(useCallback(state => {
        const selId = state.selectedTaskId;
        return selId ? childIds.includes(selId) : false;
    }, [childIds]));

    const shouldShowChildren = depth < 1 || isSelected || hasSelectedChild;

    // Randomized rotation for the "post-it" feel (stable for this taskId)
    const rotation = useMemo(() => {
        let hash = 0;
        for (let i = 0; i < taskId.length; i++) {
            hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
        }
        return (hash % 21 - 10) / 10; // -1.0 to +1.0 degrees
    }, [taskId]);

    if (!task) return null;

    const handleQuickAddGrocery = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const trimmed = quickItemText.trim();
        if (!trimmed) return;

        const parsedItems = parseGroceryInput(trimmed);
        if (parsedItems.length === 0) return;

        if (parsedItems.length === 1) {
            addTask(taskId, parsedItems[0]);
        } else {
            addTasksBatch(taskId, parsedItems);
        }
        setQuickItemText('');
    };

    const handlePrintGrocery = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPrintingReceipt) return;
        setIsPrintingReceipt(true);
        try {
            const result = await printGroceryListReceipt(task.title, groceryChildren);
            if (result.ok) {
                toast.success(`Printed grocery receipt for "${task.title}"!`);
            } else {
                toast.info(`Printer offline — Grocery receipt queued/simulated.`);
            }
        } finally {
            setIsPrintingReceipt(false);
        }
    };

    // --- GROCERY SHOPPING LIST NOTEPAD CARD ---
    if (isGrocery && depth === 0) {
        const uncheckedItems = groceryChildren.filter(item => !item.completed);
        const checkedItems = groceryChildren.filter(item => item.completed);

        return (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    selectTask(taskId);
                }}
                style={{
                    '--rotation': `${rotation * 0.6}deg`,
                    contentVisibility: 'auto',
                    containIntrinsicSize: '0 180px'
                } as any}
                className={cn(
                    "group relative rounded-md cursor-pointer flex flex-col overflow-hidden transition-[transform,box-shadow] duration-200",
                    "bg-[#fffef9] dark:bg-zinc-900 border border-stone-300/90 dark:border-zinc-700",
                    "shadow-[2px_4px_12px_rgba(0,0,0,0.14)] hover:shadow-[4px_8px_18px_rgba(0,0,0,0.2)]",
                    isSelected
                        ? "ring-2 ring-emerald-600 dark:ring-emerald-400 rotate-0 scale-[1.01] z-10 shadow-xl"
                        : "rotate-[var(--rotation)]",
                    "will-change-transform contain-content"
                )}
            >
                {/* Notepad Spiral / Perforated Header */}
                <div className="bg-emerald-700 dark:bg-emerald-800 text-white px-3.5 py-2 flex items-center justify-between gap-2 border-b-2 border-dashed border-emerald-900/30">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <ShoppingCart size={13} className="shrink-0 text-emerald-200" />
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-100 truncate">
                            Shopping List
                        </span>
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-black/25 text-emerald-100 shrink-0">
                            {uncheckedItems.length} {uncheckedItems.length === 1 ? 'item' : 'items'}
                        </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            type="button"
                            onClick={handlePrintGrocery}
                            disabled={isPrintingReceipt}
                            title="Print consolidated Grocery List receipt"
                            aria-label={`Print grocery list "${task.title}"`}
                            className="p-1 rounded hover:bg-white/15 text-emerald-100 hover:text-white transition-colors"
                        >
                            <Printer size={13} className={isPrintingReceipt ? 'animate-spin' : ''} />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsDecomposeOpen(true);
                            }}
                            title="AI Recipe-to-Grocery: Generate ingredients for a meal"
                            aria-label={`Generate recipe ingredients for "${task.title}"`}
                            className="p-1 rounded hover:bg-white/15 text-amber-200 hover:text-amber-100 transition-colors"
                        >
                            <Sparkles size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setTaskType(taskId, 'task');
                                toast.info(`Converted "${task.title}" to standard task`);
                            }}
                            title="Switch to normal sticky note"
                            aria-label="Switch to normal sticky note"
                            className="p-1 rounded hover:bg-white/15 text-emerald-200/80 hover:text-white transition-colors"
                        >
                            <ShoppingCart size={12} />
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(taskId);
                            }}
                            title="Delete grocery list"
                            aria-label={`Delete "${task.title}"`}
                            className="p-1 rounded hover:bg-red-500/30 text-emerald-200/80 hover:text-red-200 transition-colors"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>

                {/* Notepad Title Row */}
                <div className="px-3.5 py-2.5 border-b border-emerald-600/20 dark:border-zinc-800 bg-amber-50/40 dark:bg-zinc-900/80 flex items-center gap-2.5">
                    <div onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            checked={task.completed}
                            aria-label={`Mark entire list "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                            onCheckedChange={() => toggleTask(taskId)}
                            className="border-emerald-700/40 dark:border-emerald-400/40 data-[state=checked]:bg-emerald-700 dark:data-[state=checked]:bg-emerald-500"
                        />
                    </div>
                    <h3 className={cn(
                        "font-mono text-sm sm:text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 truncate flex-1",
                        task.completed && "line-through opacity-60"
                    )}>
                        {task.title}
                    </h3>
                </div>

                {/* Lined Shopping Notepad Body with left red margin rule */}
                <div className="relative pl-7 pr-3 py-2 flex-1 flex flex-col">
                    {/* Vertical notepad margin line */}
                    <div
                        aria-hidden="true"
                        className="absolute top-0 bottom-0 left-5 w-[1.5px] bg-rose-400/35 dark:bg-emerald-500/20 pointer-events-none"
                    />

                    {/* Active (Unchecked) Grocery Items */}
                    {uncheckedItems.length === 0 && checkedItems.length === 0 ? (
                        <p className="font-mono text-xs text-zinc-400 dark:text-zinc-500 py-2 italic">
                            Empty list — add items below or click ✨ for recipe ingredients
                        </p>
                    ) : (
                        <ul className="divide-y divide-stone-200/80 dark:divide-zinc-800/80">
                            {uncheckedItems.map((item) => {
                                const parsed = parseGroceryItemDisplay(item.title);
                                return (
                                    <li
                                        key={item.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleTask(item.id);
                                        }}
                                        className="group/item flex items-center gap-2 py-1.5 text-xs sm:text-sm font-mono text-zinc-800 dark:text-zinc-200 hover:bg-emerald-500/5 rounded px-1 -mx-1 transition-colors"
                                    >
                                        <div onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                checked={false}
                                                onCheckedChange={() => toggleTask(item.id)}
                                                aria-label={`Check off ${item.title}`}
                                                className="w-3.5 h-3.5 rounded-xs border-zinc-400 dark:border-zinc-600 data-[state=checked]:bg-emerald-600"
                                            />
                                        </div>
                                        <span className="flex-1 break-words leading-snug">
                                            {parsed.name}
                                        </span>
                                        {parsed.quantity && (
                                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 shrink-0">
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
                                            className="opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 rounded transition-opacity"
                                        >
                                            <X size={12} />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {/* Inline Quick-Add Input on the Notepad */}
                    <form
                        onSubmit={handleQuickAddGrocery}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1.5 pt-1.5 border-t border-stone-200/80 dark:border-zinc-800 flex items-center gap-1.5"
                    >
                        <Plus size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <input
                            type="text"
                            value={quickItemText}
                            onChange={(e) => setQuickItemText(e.target.value)}
                            placeholder="Add item (e.g. 2x Milk, Eggs)..."
                            aria-label={`Add item to ${task.title}`}
                            className="flex-1 min-w-0 bg-transparent border-none outline-none font-mono text-xs text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 py-1"
                        />
                        {quickItemText.trim() && (
                            <button
                                type="submit"
                                className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500 transition-colors shrink-0"
                            >
                                Add
                            </button>
                        )}
                    </form>

                    {/* Checked-Off Reusable Staples Section */}
                    {checkedItems.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-dashed border-stone-300 dark:border-zinc-800">
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                                    Checked ({checkedItems.length}) • Tap to reuse
                                </span>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        clearCheckedGroceryItems(taskId);
                                        toast.success(`Cleared ${checkedItems.length} checked item(s)`);
                                    }}
                                    className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                >
                                    Clear Checked
                                </button>
                            </div>
                            <ul className="space-y-0.5">
                                {checkedItems.map((item) => {
                                    const parsed = parseGroceryItemDisplay(item.title);
                                    return (
                                        <li
                                            key={item.id}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleTask(item.id);
                                            }}
                                            title="Click to uncheck and add back to active grocery list"
                                            className="group/checked flex items-center gap-2 py-1 text-xs font-mono text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded px-1 -mx-1 transition-colors"
                                        >
                                            <RotateCcw size={11} className="shrink-0 opacity-60 group-hover/checked:opacity-100 group-hover/checked:text-emerald-600" />
                                            <span className="flex-1 truncate line-through">
                                                {parsed.name}
                                            </span>
                                            {parsed.quantity && (
                                                <span className="text-[9px] font-mono px-1 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 line-through shrink-0">
                                                    {parsed.quantity}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteTask(item.id);
                                                }}
                                                aria-label={`Delete ${item.title}`}
                                                className="opacity-0 group-hover/checked:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 rounded transition-opacity"
                                            >
                                                <X size={11} />
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Perforated Receipt Bottom Edge */}
                <div className="h-1.5 bg-stone-200/70 dark:bg-zinc-800 overflow-hidden">
                    <div
                        className="h-full w-full bg-emerald-600/70 dark:bg-emerald-400/70 origin-left transition-transform duration-300"
                        style={{ transform: `scaleX(${progress / 100})` }}
                    />
                </div>

                {isDecomposeOpen && (
                    <DecomposeModal
                        open={isDecomposeOpen}
                        onOpenChange={setIsDecomposeOpen}
                        taskId={taskId}
                        initialTitle={task.title}
                        initialMode="grocery"
                    />
                )}
            </div>
        );
    }

    // --- STANDARD STICKY NOTE CARD ---
    const userColors = getUserColor(task.createdBy || 'local');
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
                <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                        checked={task.completed}
                        aria-label={`Mark "${task.title}" as ${task.completed ? 'incomplete' : 'complete'}`}
                        onCheckedChange={() => toggleTask(taskId)}
                        className="mt-1 border-zinc-900/30 dark:border-zinc-100/30 data-[state=checked]:bg-zinc-900 dark:data-[state=checked]:bg-zinc-100 data-[state=checked]:text-white dark:data-[state=checked]:text-zinc-900"
                    />
                </div>
                <h3 className={cn(
                    "font-mono text-sm sm:text-base font-medium leading-snug break-words mr-12 text-zinc-900 dark:text-zinc-100",
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

            <RecurrenceModal taskId={taskId} isSelected={isSelected} />

            {/* Top-right action buttons (Convert to Grocery List + Delete) */}
            <div className={cn(
                "absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity",
                isSelected && "opacity-100"
            )}>
                {depth === 0 && (
                    <button
                        type="button"
                        aria-label={`Convert "${task.title}" to a Grocery List`}
                        title="Convert to Grocery Shopping List note"
                        onClick={(e) => {
                            e.stopPropagation();
                            setTaskType(taskId, 'grocery');
                            toast.success(`Converted "${task.title}" to a Grocery List!`);
                        }}
                        className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-zinc-700/60 dark:text-zinc-300/60 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
                    >
                        <ShoppingCart size={13} />
                    </button>
                )}
                <button
                    type="button"
                    aria-label={`Delete "${task.title}"`}
                    title="Delete task"
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(taskId);
                    }}
                    className="p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-zinc-700/60 dark:text-zinc-300/60 hover:text-red-600 dark:hover:text-red-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                    <Trash2 size={14} />
                </button>
            </div>

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
