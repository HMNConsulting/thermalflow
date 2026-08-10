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
                <Button variant="outline" className="gap-2 px-2 font-mono border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800" title="Scheduled Prints">
                    <Clock size={16} />
                </Button>
            </DialogTrigger>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-md bg-white dark:bg-zinc-950 p-0 overflow-hidden gap-0 border-zinc-200 dark:border-zinc-800">
                <DialogTitle className="sr-only">Scheduled Prints</DialogTitle>

                {/* Header */}
                <div className="bg-zinc-100 dark:bg-zinc-900 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <CalendarClock size={16} />
                        Auto-Print Schedule
                    </h2>
                    <DialogClose className="opacity-70 hover:opacity-100">
                        <X size={16} />
                    </DialogClose>
                </div>

                <div className="p-4 max-h-[60vh] overflow-y-auto space-y-4">
                    {scheduledPrints.length === 0 && !isAdding && (
                        <div className="text-center py-8 text-zinc-400">
                            <Printer size={32} className="mx-auto mb-2 opacity-20" />
                            <p className="text-xs uppercase tracking-wide">No scheduled prints</p>
                        </div>
                    )}

                    {/* List Existing */}
                    <div className="space-y-2">
                        {scheduledPrints.map(print => (
                            <div key={print.id} className="flex items-center justify-between p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        checked={print.enabled}
                                        onChange={() => toggleScheduledPrint(print.id)}
                                        className="rounded border-zinc-300 dark:border-zinc-700"
                                    />
                                    <div>
                                        <div className="font-bold text-sm flex items-center gap-2">
                                            {print.time}
                                            <span className="text-[10px] font-normal opacity-50 uppercase bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{print.frequency}</span>
                                        </div>
                                        <div className="text-xs opacity-70">
                                            Print <span className="font-mono">{print.columnName}</span> as "{print.label}"
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-zinc-400 hover:text-red-500"
                                    onClick={() => deleteScheduledPrint(print.id)}
                                >
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        ))}
                    </div>

                    {/* Add Form */}
                    {isAdding ? (
                        <div className="border border-blue-200 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-800 p-3 rounded space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300">Time</label>
                                    <input
                                        type="time"
                                        value={newTime}
                                        onChange={e => setNewTime(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 rounded p-1 text-sm font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300">Column</label>
                                    <select
                                        value={newColumn}
                                        onChange={e => setNewColumn(e.target.value)}
                                        className="w-full bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 rounded p-1 text-sm"
                                    >
                                        <option value="Today">Today</option>
                                        <option value="Yesterday">Yesterday</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase text-blue-700 dark:text-blue-300">Label (Title)</label>
                                <input
                                    type="text"
                                    value={newLabel}
                                    onChange={e => setNewLabel(e.target.value)}
                                    className="w-full bg-white dark:bg-zinc-900 border border-blue-200 dark:border-blue-800 rounded p-1 text-sm"
                                    placeholder="e.g. Morning Brief"
                                />
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                                <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)} className="h-7 text-xs">Cancel</Button>
                                <Button size="sm" onClick={handleAdd} className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1">
                                    <Check size={12} /> Save
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Button variant="outline" className="w-full border-dashed gap-2 text-zinc-500" onClick={() => setIsAdding(true)}>
                            <Plus size={16} /> Add Schedule
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
