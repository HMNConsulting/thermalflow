'use client';

import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Repeat, CalendarClock, Copy, RotateCcw, X, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTaskStore, Task } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface RecurrenceModalProps {
    taskId: string;
    trigger?: React.ReactNode;
    isSelected?: boolean;
}

export function RecurrenceModal({ taskId, trigger, isSelected }: RecurrenceModalProps) {
    const [open, setOpen] = useState(false);
    const task = useTaskStore(state => state.tasks[taskId]);
    const setTaskRecurrence = useTaskStore(state => state.setTaskRecurrence);

    const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'custom'>('daily');
    const [action, setAction] = useState<'reset' | 'clone'>('reset');
    const [time, setTime] = useState('09:00');

    // Load existing settings
    useEffect(() => {
        if (open && task?.recurrence) {
            setFrequency(task.recurrence.frequency);
            setAction(task.recurrence.action);

            // Try to extract time from nextRun or just default
            const nextDate = new Date(task.recurrence.nextRun);
            const hours = nextDate.getHours().toString().padStart(2, '0');
            const minutes = nextDate.getMinutes().toString().padStart(2, '0');
            setTime(`${hours}:${minutes}`);
        }
    }, [open, task]);

    if (!task) return null;

    const handleSave = () => {
        // Calculate nextRun based on frequency and time
        const [hours, minutes] = time.split(':').map(Number);

        let nextDate = new Date();
        nextDate.setHours(hours, minutes, 0, 0);

        // If time has passed today, move to tomorrow (for daily) or next week
        // Simple logic for MVP:
        if (nextDate.getTime() <= Date.now()) {
            nextDate.setDate(nextDate.getDate() + 1);
        }

        // If weekly, we might want to respect the current day, but for now let's just use the "Next Occurence" logic
        // which implies "Daily" = +1 day, "Weekly" = +7 days FROM NOW?
        // Actually, user expects "Every Monday".
        // Let's keep it simple: "Repeat [Frequency] at [Time]" starting from *Next Valid Slot*.

        // For 'weekly', if today is Monday and we set for Monday, and time passed, it's next Monday.
        // If today is Tuesday and we set for Monday, it's next Monday.
        // Current MVP UI doesn't allow picking day of week, just "Weekly" implies "Every [Day of Week of Next Run]".
        // So if I set it today (Wednesday), it means "Every Wednesday".

        if (frequency === 'weekly') {
            // If we just bumped it to tomorrow because of time, that's wrong for weekly if we wanted "Same day next week".
            // Let's reset:
            nextDate = new Date();
            nextDate.setHours(hours, minutes, 0, 0);
            if (nextDate.getTime() <= Date.now()) {
                nextDate.setDate(nextDate.getDate() + 7);
            }
        }

        const recurrence: Task['recurrence'] = {
            frequency,
            cron: '', // unused for simple types
            nextRun: nextDate.getTime(),
            action
        };

        setTaskRecurrence(taskId, recurrence);
        setOpen(false);
        toast.success(`Repeats ${frequency} at ${time}`);
    };

    const handleClear = () => {
        setTaskRecurrence(taskId, undefined);
        setOpen(false);
        toast.info("Recurrence removed");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <button
                        type="button"
                        aria-label={`Repeat task "${task.title}"`}
                        className={cn(
                            "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1.5 rounded hover:bg-black/10 dark:hover:bg-white/10 absolute top-2 right-8 text-zinc-700/60 dark:text-zinc-300/60 hover:text-zinc-900 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                            (task.recurrence || isSelected) && "opacity-100",
                            task.recurrence && "text-amber-600 dark:text-amber-400 bg-amber-500/15"
                        )}
                        onClick={(e) => e.stopPropagation()}
                        title="Repeat Task"
                    >
                        <Repeat size={14} />
                    </button>
                )}
            </DialogTrigger>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-xs bg-card text-foreground p-0 overflow-hidden gap-0 border border-zinc-200 dark:border-zinc-800 font-mono rounded-2xl shadow-2xl">
                <DialogTitle className="sr-only">Configure Recurrence</DialogTitle>

                {/* Header */}
                <div className="bg-zinc-100/70 dark:bg-zinc-900/50 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />
                        Repeat Task
                    </h2>
                    <DialogClose aria-label="Close recurrence settings" className="opacity-70 hover:opacity-100 p-1">
                        <X size={16} />
                    </DialogClose>
                </div>

                <div className="p-4 space-y-5">
                    {/* Frequency */}
                    <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block">Frequency</span>
                        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Recurrence Frequency">
                            {(['daily', 'weekly'] as const).map(f => (
                                <button
                                    key={f}
                                    type="button"
                                    aria-pressed={frequency === f}
                                    onClick={() => setFrequency(f)}
                                    className={cn(
                                        "px-3 py-2 rounded-lg border text-xs font-bold uppercase tracking-wider transition-colors",
                                        frequency === f
                                            ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                                            : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                                    )}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Time */}
                    <div className="space-y-2">
                        <label htmlFor={`recurrence-time-${taskId}`} className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block">Time</label>
                        <input
                            id={`recurrence-time-${taskId}`}
                            type="time"
                            className="w-full p-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900 font-mono text-base"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                        />
                    </div>

                    {/* Action */}
                    <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-400 block">When Triggered</span>
                        <div className="grid grid-cols-1 gap-2" role="group" aria-label="Recurrence Action">
                            <button
                                type="button"
                                aria-pressed={action === 'reset'}
                                onClick={() => setAction('reset')}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs transition-colors text-left",
                                    action === 'reset'
                                        ? "bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300"
                                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                                )}
                            >
                                <RotateCcw size={15} className="shrink-0" />
                                <div className="flex flex-col">
                                    <span className="font-bold">Reset</span>
                                    <span className="text-[10px] opacity-75">Uncheck existing task</span>
                                </div>
                            </button>

                            <button
                                type="button"
                                aria-pressed={action === 'clone'}
                                onClick={() => setAction('clone')}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs transition-colors text-left",
                                    action === 'clone'
                                        ? "bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300"
                                        : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                                )}
                            >
                                <Copy size={15} className="shrink-0" />
                                <div className="flex flex-col">
                                    <span className="font-bold">Clone</span>
                                    <span className="text-[10px] opacity-75">Create a fresh copy</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
                    {task.recurrence && (
                        <Button type="button" variant="ghost" className="flex-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-bold" onClick={handleClear}>
                            Disable
                        </Button>
                    )}
                    <Button type="button" className="flex-1 gap-2 bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold" onClick={handleSave}>
                        <Check size={14} />
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
