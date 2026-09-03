'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { useTaskStore, useTask } from '@/lib/store';
import { Sparkles, Printer, Plus, Trash2, CheckCircle2, ArrowRight, X, Loader2 } from 'lucide-react';
import { getPrintServerUrl, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DecomposeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    taskId?: string | null;
    initialTitle?: string;
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
    initialTitle = ''
}: DecomposeModalProps) {
    const task = useTask(taskId);
    const addTasksBatch = useTaskStore((state) => state.addTasksBatch);
    const qrOnChits = useTaskStore((state) => state.qrOnChits);

    const [goal, setGoal] = useState('');
    const [steps, setSteps] = useState<StepItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [printing, setPrinting] = useState(false);

    useEffect(() => {
        if (open) {
            const currentTitle = initialTitle || task?.title || '';
            setGoal(currentTitle);
            if (currentTitle) {
                handleDecompose(currentTitle);
            }
        } else {
            setSteps([]);
        }
    }, [open, initialTitle, task?.title]);

    const handleDecompose = async (targetGoal?: string) => {
        const query = (targetGoal || goal).trim();
        if (!query) return;

        setLoading(true);
        try {
            const res = await fetch('/api/tasks/decompose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: query })
            });

            if (res.ok) {
                const data = await res.json();
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
                toast.error("Failed to decompose task");
            }
        } catch {
            toast.error("Decomposition server error");
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
        const targetParentId = taskId || 'root';
        if (selectedStepTexts.length === 0) {
            toast.error("Please select at least one step");
            return;
        }

        addTasksBatch(targetParentId, selectedStepTexts);
        toast.success(`Added ${selectedStepTexts.length} subtasks to "${goal || 'Task'}"!`);
        onOpenChange(false);
    };

    const handlePrintOnly = async () => {
        if (selectedStepTexts.length === 0) {
            toast.error("Please select at least one step");
            return;
        }

        setPrinting(true);
        try {
            const printServerUrl = getPrintServerUrl();
            const host = typeof window !== 'undefined' ? window.location.origin : '';

            const res = await fetch(`${printServerUrl}/print-action-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goalTitle: goal,
                    subtasks: selectedStepTexts.map(title => ({
                        title,
                        qrUrl: qrOnChits && taskId ? `${host}/api/tasks/toggle-qr?id=${taskId}` : undefined
                    }))
                })
            });

            if (res.ok) {
                toast.success("Action plan ticket sent to thermal printer!");
            } else {
                toast.info("Thermal printer offline (Action plan printed to simulation)");
            }
        } catch {
            toast.info("Thermal printer offline (Action plan simulated)");
        } finally {
            setPrinting(false);
        }
    };

    const handleAddAndPrint = async () => {
        handleAddToBoard();
        await handlePrintOnly();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-lg bg-zinc-950 text-zinc-100 p-0 border border-zinc-800 shadow-2xl rounded-2xl overflow-hidden font-mono">
                <DialogTitle className="sr-only">AI Task Decomposer</DialogTitle>

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center gap-2 text-amber-400">
                        <Sparkles size={18} className="animate-pulse" />
                        <span className="font-bold text-sm tracking-wider uppercase text-zinc-100">
                            AI Task Decomposer
                        </span>
                    </div>
                    <DialogClose className="opacity-70 hover:opacity-100 transition-opacity p-1 text-zinc-400 hover:text-white">
                        <X size={16} />
                    </DialogClose>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Goal Input */}
                    <div>
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                            Goal / Complex Task
                        </label>
                        <div className="flex gap-2">
                            <input
                                value={goal}
                                onChange={(e) => setGoal(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleDecompose();
                                    }
                                }}
                                placeholder="e.g. Fix garage door spring, Plan team offsite..."
                                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 outline-none focus:border-amber-500/60"
                            />
                            <button
                                onClick={() => handleDecompose()}
                                disabled={loading || !goal.trim()}
                                className="px-3.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                <span>Analyze</span>
                            </button>
                        </div>
                    </div>

                    {/* Breakdown List */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                Action Steps ({selectedStepTexts.length}/{steps.length} selected)
                            </label>
                            <button
                                onClick={handleAddStep}
                                className="text-[10px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1"
                            >
                                <Plus size={11} />
                                <span>Add Step</span>
                            </button>
                        </div>

                        {loading ? (
                            <div className="py-8 text-center space-y-2 border border-dashed border-zinc-800 rounded-xl">
                                <Loader2 size={24} className="animate-spin text-amber-400 mx-auto" />
                                <p className="text-xs text-zinc-400">Synthesizing sequential action steps...</p>
                            </div>
                        ) : steps.length === 0 ? (
                            <div className="py-8 text-center border border-dashed border-zinc-800 rounded-xl text-xs text-zinc-500">
                                Enter a goal above and click Analyze to generate steps
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {steps.map((step, idx) => (
                                    <div
                                        key={step.id}
                                        className={cn(
                                            "flex items-center gap-2.5 p-2 rounded-lg border transition-colors",
                                            step.selected
                                                ? "bg-zinc-900 border-zinc-800"
                                                : "bg-zinc-950/40 border-zinc-900 opacity-60"
                                        )}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={step.selected}
                                            onChange={() => handleToggleStep(step.id)}
                                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-amber-500 cursor-pointer"
                                        />
                                        <span className="text-[11px] text-zinc-500 font-bold shrink-0">
                                            {idx + 1}.
                                        </span>
                                        <input
                                            value={step.text}
                                            onChange={(e) => handleUpdateText(step.id, e.target.value)}
                                            className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-zinc-200"
                                        />
                                        <button
                                            onClick={() => handleRemoveStep(step.id)}
                                            className="p-1 text-zinc-600 hover:text-red-400 rounded transition-colors"
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
                <div className="px-5 py-3.5 bg-zinc-900/50 border-t border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <button
                        onClick={handlePrintOnly}
                        disabled={selectedStepTexts.length === 0 || printing}
                        className="px-3 py-2 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-xs font-bold text-zinc-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                        <Printer size={13} />
                        <span>Print Tear-Off Ticket</span>
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleAddToBoard}
                            disabled={selectedStepTexts.length === 0}
                            className="px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-white transition-colors disabled:opacity-50"
                        >
                            Add to Board
                        </button>
                        <button
                            onClick={handleAddAndPrint}
                            disabled={selectedStepTexts.length === 0 || printing}
                            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                        >
                            <Sparkles size={13} />
                            <span>Add & Print Both</span>
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
