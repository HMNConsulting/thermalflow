'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useTaskStore, useTask, isGroceryList } from '@/lib/store';
import { Sparkles, Printer, Plus, Trash2, AlertTriangle, X, Loader2, ShoppingCart } from 'lucide-react';
import { getPrintServerUrl, cn, printGroceryListReceipt } from '@/lib/utils';
import { toast } from 'sonner';

interface DecomposeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    taskId?: string | null;
    initialTitle?: string;
    initialMode?: 'task' | 'grocery';
}

interface StepItem {
    id: string;
    text: string;
    selected: boolean;
}

export function DecomposeModal({
    open,
    onOpenChange,
    taskId,
    initialTitle = '',
    initialMode
}: DecomposeModalProps) {
    const task = useTask(taskId);
    const addTask = useTaskStore((state) => state.addTask);
    const addTasksBatch = useTaskStore((state) => state.addTasksBatch);
    const selectTask = useTaskStore((state) => state.selectTask);
    const qrOnChits = useTaskStore((state) => state.qrOnChits);

    const [mode, setMode] = useState<'task' | 'grocery'>('task');
    const [goal, setGoal] = useState('');
    const [steps, setSteps] = useState<StepItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [printing, setPrinting] = useState(false);
    const [aiSource, setAiSource] = useState<'gemini' | 'openai' | 'heuristic' | null>(null);
    const [aiModel, setAiModel] = useState<string | null>(null);
    const [aiError, setAiError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            const resolvedMode = initialMode || (isGroceryList(task) ? 'grocery' : 'task');
            setMode(resolvedMode);
            const currentTitle = initialTitle || task?.title || '';
            setGoal(currentTitle);
            setAiError(null);
            setAiSource(null);
            if (currentTitle) {
                handleDecompose(currentTitle, resolvedMode);
            }
        } else {
            setSteps([]);
            setAiError(null);
            setAiSource(null);
        }
    }, [open, initialTitle, task?.title, initialMode]);

    const handleDecompose = async (targetGoal?: string, targetMode?: 'task' | 'grocery') => {
        const query = (targetGoal ?? goal).trim();
        const activeMode = targetMode ?? mode;
        if (!query) return;

        setLoading(true);
        setAiError(null);
        try {
            const res = await fetch('/api/tasks/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: query, mode: activeMode })
            });

            if (res.ok) {
                const data = await res.json();
                setAiSource(data.source || 'heuristic');
                setAiModel(data.model || null);
                if (data.aiError) {
                    setAiError(data.aiError);
                }
                if (Array.isArray(data.subtasks)) {
                    setSteps(
                        data.subtasks.map((text: string, idx: number) => ({
                            id: `step-${Date.now()}-${idx}`,
                            text,
                            selected: true
                        }))
                    );
                }
            } else {
                const err = await res.json().catch(() => ({}));
                const msg = err.error || 'Failed to decompose task';
                setAiError(msg);
                toast.error(msg);
            }
        } catch {
            setAiError('Decomposition server unreachable');
            toast.error('Decomposition server error');
        } finally {
            setLoading(false);
        }
    };

    const handleToggleStep = (id: string) => {
        setSteps(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
    };

    const handleUpdateText = (id: string, text: string) => {
        setSteps(prev => prev.map(s => s.id === id ? { ...s, text } : s));
    };

    const handleRemoveStep = (id: string) => {
        setSteps(prev => prev.filter(s => s.id !== id));
    };

    const handleAddStep = () => {
        setSteps(prev => [
            ...prev,
            { id: `step-${Date.now()}`, text: '', selected: true }
        ]);
    };

    const selectedStepTexts = steps.filter(s => s.selected && s.text.trim()).map(s => s.text.trim());

    const handleAddToBoard = () => {
        if (selectedStepTexts.length === 0) {
            toast.error(mode === 'grocery' ? "Please select at least one ingredient" : "Please select at least one step");
            return [];
        }

        if (mode === 'grocery') {
            // If we're already inside a Grocery List, add items directly to it; otherwise create a new Grocery List
            let targetListId = taskId && task && isGroceryList(task) ? taskId : null;
            if (!targetListId) {
                const listTitle = goal.trim() || 'Grocery List';
                targetListId = addTask('root', listTitle, undefined, 'grocery');
            }
            if (targetListId) {
                const created = addTasksBatch(targetListId, selectedStepTexts);
                selectTask(targetListId);
                toast.success(`Added ${selectedStepTexts.length} items to Grocery List!`);
                onOpenChange(false);
                return created;
            }
        }

        const targetParentId = taskId || 'root';
        const created = addTasksBatch(targetParentId, selectedStepTexts);
        toast.success(`Added ${selectedStepTexts.length} subtasks to "${goal || 'Task'}"!`);
        onOpenChange(false);
        return created;
    };

    const handlePrintOnly = async (createdTasks?: { id: string; title: string }[]) => {
        if (selectedStepTexts.length === 0) {
            toast.error(mode === 'grocery' ? "Please select at least one ingredient" : "Please select at least one step");
            return;
        }

        setPrinting(true);
        try {
            if (mode === 'grocery') {
                const res = await printGroceryListReceipt(
                    goal.trim() || task?.title || 'Grocery List',
                    selectedStepTexts.map(title => ({ title, completed: false }))
                );
                if (res.ok) {
                    toast.success("Grocery list receipt sent to thermal printer!");
                } else {
                    toast.warning("Thermal printer offline (Grocery receipt simulated)");
                }
                return;
            }

            const printServerUrl = getPrintServerUrl();
            const host = typeof window !== 'undefined' ? window.location.origin : '';

            const subtasksPayload = (createdTasks && createdTasks.length > 0)
                ? createdTasks.map(t => ({
                    title: t.title,
                    qrUrl: qrOnChits ? `${host}/api/tasks/toggle-qr?id=${t.id}` : undefined
                }))
                : selectedStepTexts.map(title => ({
                    title,
                    qrUrl: qrOnChits && taskId ? `${host}/api/tasks/toggle-qr?id=${taskId}` : undefined
                }));

            const res = await fetch(`${printServerUrl}/print-action-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goalTitle: goal,
                    subtasks: subtasksPayload
                })
            });

            if (res.ok) {
                toast.success("Action plan ticket sent to thermal printer!");
            } else {
                const errData = await res.json().catch(() => ({}));
                toast.warning(errData.error ? `Print warning: ${errData.error}` : "Thermal printer offline (Action plan simulated)");
            }
        } catch {
            toast.warning("Thermal printer offline (Print simulated)");
        } finally {
            setPrinting(false);
        }
    };

    const handleAddAndPrint = async () => {
        const created = handleAddToBoard();
        if (created && created.length > 0) {
            await handlePrintOnly(created);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-lg bg-card text-foreground p-0 border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl overflow-hidden font-mono">
                <DialogTitle className="sr-only">
                    {mode === 'grocery' ? 'AI Recipe & Grocery Generator' : 'AI Task Decomposer'}
                </DialogTitle>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/50 gap-2">
                    <div className="flex items-center gap-2">
                        {mode === 'grocery' ? (
                            <ShoppingCart size={17} className="text-emerald-600 dark:text-emerald-400" />
                        ) : (
                            <Sparkles size={17} className="text-amber-600 dark:text-amber-400 motion-safe:animate-pulse" />
                        )}
                        <span className="font-bold text-xs sm:text-sm tracking-wider uppercase text-zinc-900 dark:text-zinc-100">
                            {mode === 'grocery' ? 'Recipe-to-Grocery AI' : 'AI Task Decomposer'}
                        </span>
                        {aiSource === 'gemini' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 uppercase">
                                {aiModel || 'Gemini AI'}
                            </span>
                        )}
                        {aiSource === 'heuristic' && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 uppercase">
                                Offline Template
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                        {/* Mode Switcher */}
                        <div className="flex items-center bg-zinc-200/80 dark:bg-zinc-800 p-0.5 rounded-lg text-[10px] font-bold">
                            <button
                                type="button"
                                onClick={() => {
                                    setMode('task');
                                    if (goal.trim()) handleDecompose(goal, 'task');
                                }}
                                className={cn(
                                    "px-2 py-1 rounded-md transition-colors",
                                    mode === 'task'
                                        ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                )}
                            >
                                Tasks
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMode('grocery');
                                    if (goal.trim()) handleDecompose(goal, 'grocery');
                                }}
                                className={cn(
                                    "px-2 py-1 rounded-md transition-colors flex items-center gap-1",
                                    mode === 'grocery'
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                                )}
                            >
                                <ShoppingCart size={10} />
                                <span>Grocery</span>
                            </button>
                        </div>

                        <DialogClose aria-label="Close decomposer" className="opacity-70 hover:opacity-100 transition-opacity p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
                            <X size={16} />
                        </DialogClose>
                    </div>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {aiError && (
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs leading-relaxed">
                            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <div className="space-y-1">
                                <p className="font-bold uppercase tracking-wide text-[10px]">AI Unavailable — Using Offline Template</p>
                                <p className="text-[11px] opacity-90">{aiError}</p>
                            </div>
                        </div>
                    )}

                    {/* Goal / Recipe Input */}
                    <div>
                        <label htmlFor="decompose-goal-input" className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider block mb-1.5">
                            {mode === 'grocery' ? 'Meal, Recipe, or Shopping Theme' : 'Goal / Complex Task'}
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="decompose-goal-input"
                                value={goal}
                                onChange={(e) => setGoal(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleDecompose();
                                    }
                                }}
                                placeholder={
                                    mode === 'grocery'
                                        ? "e.g. Chicken Tikka Masala, Taco Night, Weekly Staples..."
                                        : "e.g. Fix garage door spring, Plan team offsite..."
                                }
                                className={cn(
                                    "flex-1 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-900 dark:text-zinc-100 outline-none",
                                    mode === 'grocery' ? "focus:border-emerald-500/60" : "focus:border-amber-500/60"
                                )}
                            />
                            <button
                                type="button"
                                onClick={() => handleDecompose()}
                                disabled={loading || !goal.trim()}
                                className={cn(
                                    "px-3.5 py-2 border rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50",
                                    mode === 'grocery'
                                        ? "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                                        : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border-amber-500/30"
                                )}
                            >
                                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                <span>{mode === 'grocery' ? 'Get Ingredients' : 'Analyze'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Breakdown / Ingredients List */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                                {mode === 'grocery'
                                    ? `Grocery Items (${selectedStepTexts.length}/${steps.length} selected)`
                                    : `Action Steps (${selectedStepTexts.length}/${steps.length} selected)`}
                            </span>
                            <button
                                type="button"
                                onClick={handleAddStep}
                                className="text-[10px] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 flex items-center gap-1"
                            >
                                <Plus size={11} />
                                <span>{mode === 'grocery' ? 'Add Item' : 'Add Step'}</span>
                            </button>
                        </div>

                        {loading ? (
                            <div className="py-8 text-center space-y-2 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                                <Loader2 size={24} className={cn("animate-spin mx-auto", mode === 'grocery' ? "text-emerald-500" : "text-amber-500")} />
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {mode === 'grocery' ? 'Gathering recipe ingredients & quantities...' : 'Synthesizing sequential action steps...'}
                                </p>
                            </div>
                        ) : steps.length === 0 ? (
                            <div className="py-8 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-500 dark:text-zinc-400">
                                {mode === 'grocery'
                                    ? 'Enter a meal or shopping theme above and click Get Ingredients'
                                    : 'Enter a goal above and click Analyze to generate steps'}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {steps.map((step, idx) => (
                                    <div
                                        key={step.id}
                                        className={cn(
                                            "flex items-center gap-2.5 p-2 rounded-lg border transition-colors",
                                            step.selected
                                                ? "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                                                : "bg-zinc-100/50 dark:bg-zinc-950/40 border-zinc-200/50 dark:border-zinc-900 opacity-60"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            aria-label={`Select item ${idx + 1}`}
                                            checked={step.selected}
                                            onChange={() => handleToggleStep(step.id)}
                                            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-emerald-600 cursor-pointer"
                                        />
                                        <span className="text-[11px] text-zinc-500 font-bold shrink-0">
                                            {idx + 1}.
                                        </span>
                                        <input
                                            aria-label={`Item ${idx + 1} description`}
                                            value={step.text}
                                            onChange={(e) => handleUpdateText(step.id, e.target.value)}
                                            className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-zinc-900 dark:text-zinc-200"
                                        />
                                        <button
                                            type="button"
                                            aria-label={`Remove item ${idx + 1}`}
                                            onClick={() => handleRemoveStep(step.id)}
                                            className="p-1 text-zinc-500 hover:text-red-500 rounded transition-colors"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-5 py-3.5 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => handlePrintOnly()}
                        disabled={selectedStepTexts.length === 0 || printing}
                        className="px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                        <Printer size={13} />
                        <span>{mode === 'grocery' ? 'Print Grocery Receipt' : 'Print Tear-Off Ticket'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleAddToBoard}
                            disabled={selectedStepTexts.length === 0}
                            className="px-3.5 py-2 rounded-lg bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-xs font-bold text-zinc-900 dark:text-white transition-colors disabled:opacity-50"
                        >
                            {mode === 'grocery' ? 'Add to Grocery List' : 'Add to Board'}
                        </button>
                        <button
                            type="button"
                            onClick={handleAddAndPrint}
                            disabled={selectedStepTexts.length === 0 || printing}
                            className={cn(
                                "px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-transform active:scale-95 disabled:opacity-50",
                                mode === 'grocery'
                                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                                    : "bg-amber-500 hover:bg-amber-400 text-zinc-950"
                            )}
                        >
                            {mode === 'grocery' ? <ShoppingCart size={13} /> : <Sparkles size={13} />}
                            <span>Add & Print Receipt</span>
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
