'use client';

import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Clock, CalendarClock, Printer, Plus, Trash2, X, Check } from 'lucide-react';
import { useState } from 'react';
import { useTaskStore, ScheduledPrint } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function ScheduledPrintModal() {
    const [open, setOpen] = useState(false);
    const scheduledPrints = useTaskStore(state => state.scheduledPrints || []);
    const addScheduledPrint = useTaskStore(state => state.addScheduledPrint);
    const toggleScheduledPrint = useTaskStore(state => state.toggleScheduledPrint);
    const deleteScheduledPrint = useTaskStore(state => state.deleteScheduledPrint);

    // New Print Form State
    const [isAdding, setIsAdding] = useState(false);
    const [newTime, setNewTime] = useState('09:00');
    const [newLabel, setNewLabel] = useState('Daily Summary');
    const [newColumn, setNewColumn] = useState('Today'); // "Today" is mostly what matters now

    const handleAdd = () => {
        const id = Math.random().toString(36).substring(2, 9);
        const print: ScheduledPrint = {
            id,
            label: newLabel,
            columnName: newColumn,
            time: newTime,
            frequency: 'daily',
            enabled: true
        };
        addScheduledPrint(print);
        setIsAdding(false);
        toast.success("Schedule Added");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" aria-label="Scheduled Prints" className="gap-2 px-2 font-mono border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Scheduled Prints">
                    <Clock size={16} />
                </Button>
            </DialogTrigger>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md bg-card text-foreground p-0 overflow-hidden gap-0 border border-zinc-200 dark:border-zinc-800 font-mono rounded-2xl shadow-2xl">
                <DialogTitle className="sr-only">Scheduled Prints</DialogTitle>

                {/* Header */}
                <div className="bg-zinc-100/70 dark:bg-zinc-900/50 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />
                        Auto-Print Schedule
                    </h2>
                    <DialogClose aria-label="Close scheduled prints" className="opacity-70 hover:opacity-100 p-1">
                        <X size={16} />
                    </DialogClose>
                </div>

                <div className="p-4 max-h-[60vh] overflow-y-auto space-y-4">
                    {scheduledPrints.length === 0 && !isAdding && (
                        <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
                            <Printer size={32} className="mx-auto mb-2 opacity-30" />
                            <p className="text-xs font-bold uppercase tracking-wide">No scheduled prints</p>
                            <p className="text-[11px] mt-1">Automatically print your daily manifest at a set time.</p>
                        </div>
                    )}

                    {/* List Existing */}
                    <div className="space-y-2">
                        {scheduledPrints.map(print => (
                            <div key={print.id} className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        aria-label={`Enable schedule ${print.label} at ${print.time}`}
                                        checked={print.enabled}
                                        onChange={() => toggleScheduledPrint(print.id)}
                                        className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700"
                                    />
                                    <div>
                                        <div className="font-bold text-sm flex items-center gap-2">
                                            {print.time}
                                            <span className="text-[10px] font-normal text-zinc-600 dark:text-zinc-400 uppercase bg-zinc-200/70 dark:bg-zinc-800 px-1.5 py-0.5 rounded">{print.frequency}</span>
                                        </div>
                                        <div className="text-xs text-zinc-600 dark:text-zinc-400">
                                            Print <span className="font-mono font-semibold">{print.columnName}</span> as &ldquo;{print.label}&rdquo;
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Delete schedule ${print.label}`}
                                    title="Delete schedule"
                                    className="h-8 w-8 text-zinc-500 hover:text-red-500"
                                    onClick={() => deleteScheduledPrint(print.id)}
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        ))}
                    </div>

                    {/* Add Form */}
                    {isAdding ? (
                        <div className="border border-amber-500/30 bg-amber-500/5 p-3.5 rounded-xl space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="schedule-time-input" className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block mb-1">Time</label>
                                    <input
                                        id="schedule-time-input"
                                        type="time"
                                        value={newTime}
                                        onChange={e => setNewTime(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="schedule-column-select" className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block mb-1">Column</label>
                                    <select
                                        id="schedule-column-select"
                                        value={newColumn}
                                        onChange={e => setNewColumn(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
                                    >
                                        <option value="Today">Today</option>
                                        <option value="Yesterday">Yesterday</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="schedule-label-input" className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block mb-1">Label (Title)</label>
                                <input
                                    id="schedule-label-input"
                                    type="text"
                                    value={newLabel}
                                    onChange={e => setNewLabel(e.target.value)}
                                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm font-mono"
                                    placeholder="e.g. Morning Brief"
                                />
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                                <Button type="button" size="sm" variant="ghost" onClick={() => setIsAdding(false)} className="h-8 text-xs">Cancel</Button>
                                <Button type="button" size="sm" onClick={handleAdd} className="h-8 text-xs bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 gap-1 font-bold">
                                    <Check size={12} /> Save
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button type="button" variant="outline" className="w-full border-dashed gap-2 text-zinc-600 dark:text-zinc-400" onClick={() => setIsAdding(true)}>
                            <Plus size={16} /> Add Schedule
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
