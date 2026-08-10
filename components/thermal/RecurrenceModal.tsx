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
                        className={cn(
                            "opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/5 absolute top-2 right-8 text-black/40 hover:text-black",
                            (task.recurrence || isSelected) && "opacity-100",
                            task.recurrence && "text-blue-600 hover:text-blue-700 bg-blue-50"
                        )}
                        onClick={(e) => e.stopPropagation()}
                        title="Repeat Task"
                    >
                        <Repeat size={14} />
                    </button>
                )}
            </DialogTrigger>
            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-xs bg-white dark:bg-zinc-950 p-0 overflow-hidden gap-0 border-zinc-200 dark:border-zinc-800">
                <DialogTitle className="sr-only">Configure Recurrence</DialogTitle>

                {/* Header */}
                <div className="bg-zinc-100 dark:bg-zinc-900 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <h2 className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <CalendarClock size={16} />
                        Repeat Task
                    </h2>
                    <DialogClose className="opacity-70 hover:opacity-100">
                        <X size={16} />
                    </DialogClose>
                </div>

                <div className="p-4 space-y-6">
                    {/* Frequency */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase text-zinc-400">Frequency</label>
                        <div className="grid grid-cols-2 gap-2">
                            {(['daily', 'weekly'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFrequency(f)}
                                    className={cn(
                                        "px-3 py-2 rounded border text-sm capitalize transition-all",
                                        frequency === f
                                            ? "bg-black text-white border-black dark:bg-white dark:text-black"
                                            : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300"
                                    )}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Time */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase text-zinc-400">Time</label>
                        <input
                            type="time"
                            className="w-full p-2 border border-zinc-200 dark:border-zinc-800 rounded bg-transparent font-mono text-lg"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                        />
                    </div>

                    {/* Action */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase text-zinc-400">When Completed</label>
                        <div className="grid grid-cols-1 gap-2">
                            <button
                                onClick={() => setAction('reset')}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2 rounded border text-sm transition-all text-left",
                                    action === 'reset'
                                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300"
                                        : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                                )}
                            >
                                <RotateCcw size={16} className="shrink-0" />
                                <div className="flex flex-col">
                                    <span className="font-bold">Reset</span>
                                    <span className="text-[10px] opacity-70">Uncheck and move to top</span>
                                </div>
                            </button>

                            <button
                                onClick={() => setAction('clone')}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-2 rounded border text-sm transition-all text-left",
                                    action === 'clone'
                                        ? "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300"
                                        : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
                                )}
                            >
                                <Copy size={16} className="shrink-0" />
                                <div className="flex flex-col">
                                    <span className="font-bold">Clone</span>
                                    <span className="text-[10px] opacity-70">Create a new copy</span>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
                    {task.recurrence && (
                        <Button variant="ghost" className="flex-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={handleClear}>
                            Disable
                        </Button>
                    )}
                    <Button className="flex-1 gap-2" onClick={handleSave}>
                        <Check size={16} />
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
