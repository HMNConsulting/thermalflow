'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useTaskStore, Task, isGroceryList } from '@/lib/store';
import { Search, Printer, Volume2, VolumeX, Sparkles, CheckCircle2, LayoutGrid, Columns, ArrowRight, CornerDownLeft, QrCode, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DecomposeModal } from './DecomposeModal';

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isDecomposeOpen, setIsDecomposeOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const tasks = useTaskStore((state) => state.tasks);
    const selectedTaskId = useTaskStore((state) => state.selectedTaskId);
    const selectTask = useTaskStore((state) => state.selectTask);
    const toggleTask = useTaskStore((state) => state.toggleTask);
    const addTask = useTaskStore((state) => state.addTask);

    const viewMode = useTaskStore((state) => state.viewMode);
    const setViewMode = useTaskStore((state) => state.setViewMode);
    const autoPrintEnabled = useTaskStore((state) => state.autoPrintEnabled);
    const toggleAutoPrint = useTaskStore((state) => state.toggleAutoPrint);
    const soundEnabled = useTaskStore((state) => state.soundEnabled);
    const toggleSound = useTaskStore((state) => state.toggleSound);
    const qrOnChits = useTaskStore((state) => state.qrOnChits);
    const toggleQrOnChits = useTaskStore((state) => state.toggleQrOnChits);
    const toggleCompletedColumn = useTaskStore((state) => state.toggleCompletedColumn);

    // Reset query & selection on open
    useEffect(() => {
        if (open) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Build task items with breadcrumb path
    const taskResults = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];

        const allTasks = Object.values(tasks).filter(t => t.id !== 'root');
        const matched = allTasks.filter(t => t.title.toLowerCase().includes(q));

        return matched.slice(0, 8).map(task => {
            // Build path breadcrumbs
            const crumbs: string[] = [];
            let curr: Task | undefined = task;
            while (curr && curr.parentId && curr.parentId !== 'root') {
                curr = tasks[curr.parentId];
                if (curr && curr.id !== 'root') {
                    crumbs.unshift(curr.title);
                }
            }
            return {
                type: 'task' as const,
                task,
                breadcrumb: crumbs.join(' > ')
            };
        });
    }, [query, tasks]);

    // Quick Action Commands
    const actionResults = useMemo(() => {
        const q = query.trim().toLowerCase();
        const actions = [
            {
                id: 'create-grocery-list',
                title: 'New Grocery Shopping List (or open active Grocery List)',
                icon: <ShoppingCart size={16} className="text-emerald-500" />,
                run: () => {
                    const rootChildren = tasks['root']?.children || [];
                    const existingId = rootChildren.find(cid => {
                        const t = tasks[cid];
                        return t && !t.completed && isGroceryList(t);
                    });
                    if (existingId) {
                        selectTask(existingId);
                        toast.info(`Opened "${tasks[existingId].title}"`);
                    } else {
                        const newId = addTask('root', 'Grocery List', undefined, 'grocery');
                        if (newId) selectTask(newId);
                        toast.success('Created "Grocery List"!');
                    }
                }
            },
            {
                id: 'toggle-autoprint',
                title: `Auto-Print on Task Add: ${autoPrintEnabled ? 'ENABLED (Click to Turn Off)' : 'DISABLED (Click to Turn On)'}`,
                icon: <Printer size={16} className={autoPrintEnabled ? 'text-green-500' : 'text-zinc-400'} />,
                run: () => {
                    toggleAutoPrint();
                    toast.info(`Auto-print ${!autoPrintEnabled ? 'Enabled' : 'Disabled'}`);
                }
            },
            {
                id: 'toggle-qr',
                title: `Scan-to-Done QR Codes on Chits: ${qrOnChits ? 'ENABLED' : 'DISABLED'}`,
                icon: <QrCode size={16} className={qrOnChits ? 'text-green-500' : 'text-zinc-400'} />,
                run: () => {
                    toggleQrOnChits();
                    toast.info(`QR codes on printed chits ${!qrOnChits ? 'Enabled' : 'Disabled'}`);
                }
            },
            {
                id: 'toggle-sound',
                title: `Sound Effects: ${soundEnabled ? 'ENABLED' : 'MUTED'}`,
                icon: soundEnabled ? <Volume2 size={16} className="text-green-500" /> : <VolumeX size={16} className="text-zinc-400" />,
                run: () => {
                    toggleSound();
                    toast.info(`Sound effects ${!soundEnabled ? 'Enabled' : 'Muted'}`);
                }
            },
            {
                id: 'switch-view',
                title: `Switch View to ${viewMode === 'column' ? 'Sticky Note Grid' : 'Miller Columns'}`,
                icon: viewMode === 'column' ? <LayoutGrid size={16} /> : <Columns size={16} />,
                run: () => {
                    setViewMode(viewMode === 'column' ? 'grid' : 'column');
                }
            },
            {
                id: 'ai-decompose',
                title: selectedTaskId && tasks[selectedTaskId]
                    ? `AI Sparkle: Decompose "${tasks[selectedTaskId].title}" into subtasks`
                    : 'AI Sparkle: Decompose a goal into sequential subtasks',
                icon: <Sparkles size={16} className="text-amber-400" />,
                run: () => {
                    setIsDecomposeOpen(true);
                }
            },
            {
                id: 'toggle-completed',
                title: "Toggle Completed Column Panel",
                icon: <CheckCircle2 size={16} />,
                run: () => {
                    toggleCompletedColumn();
                }
            }
        ];

        if (!q) return actions;
        return actions.filter(a => a.title.toLowerCase().includes(q));
    }, [query, autoPrintEnabled, qrOnChits, soundEnabled, viewMode, selectedTaskId, tasks, toggleAutoPrint, toggleQrOnChits, toggleSound, setViewMode, toggleCompletedColumn]);


    const allItems = useMemo(() => {
        return [...taskResults, ...actionResults.map(a => ({ type: 'action' as const, action: a }))];
    }, [taskResults, actionResults]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const handleSelect = (index: number) => {
        const item = allItems[index];
        if (!item) return;

        if (item.type === 'task') {
            selectTask(item.task.id);
            onOpenChange(false);
        } else if (item.type === 'action') {
            item.action.run();
            onOpenChange(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % (allItems.length || 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + allItems.length) % (allItems.length || 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleSelect(selectedIndex);
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>

            <DialogContent showCloseButton={false} aria-describedby={undefined} className="sm:max-w-xl bg-white dark:bg-zinc-950 p-0 border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl overflow-hidden font-mono top-[30%]">
                <DialogTitle className="sr-only">Command Palette & Quick Search</DialogTitle>

                {/* Search Bar */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                    <Search size={18} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded={true}
                        aria-controls="command-palette-list"
                        aria-autocomplete="list"
                        aria-label="Search tasks, run commands, or toggle printer settings"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search tasks, run commands, or toggle printer settings..."
                        className="flex-1 bg-transparent border-none outline-none text-sm font-mono placeholder:text-zinc-500 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
                    />
                    <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-zinc-600 dark:text-zinc-400">
                        ESC
                    </kbd>
                </div>

                {/* Results List */}
                <div id="command-palette-list" role="listbox" aria-label="Search Results" className="max-h-[340px] overflow-y-auto p-2 space-y-1">
                    {taskResults.length > 0 && (
                        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Tasks ({taskResults.length})
                        </div>
                    )}

                    {taskResults.map((item, idx) => {
                        const isSelected = selectedIndex === idx;
                        return (
                            <button
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                key={item.task.id}
                                onClick={() => handleSelect(idx)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                                className={cn(
                                    "w-full text-left flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors focus-visible:outline-none",
                                    isSelected ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                                )}
                            >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <input
                                        type="checkbox"
                                        aria-label={item.task.title}
                                        tabIndex={-1}
                                        checked={item.task.completed}
                                        readOnly
                                        className="rounded border-zinc-400 pointer-events-none"
                                    />
                                    <span className={cn("truncate font-medium", item.task.completed && "line-through opacity-50")}>
                                        {item.task.title}
                                    </span>
                                    {item.breadcrumb && (
                                        <span className={cn("text-[10px] truncate opacity-70 ml-1", isSelected ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500 dark:text-zinc-400")}>
                                            in {item.breadcrumb}
                                        </span>
                                    )}
                                </div>
                                <CornerDownLeft size={12} className={cn("shrink-0 ml-2 opacity-50", isSelected ? "opacity-100" : "hidden")} />
                            </button>
                        );
                    })}

                    {actionResults.length > 0 && (
                        <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                            Commands & Preferences
                        </div>
                    )}

                    {actionResults.map((action, actionIdx) => {
                        const overallIdx = taskResults.length + actionIdx;
                        const isSelected = selectedIndex === overallIdx;
                        return (
                            <button
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                key={action.id}
                                onClick={() => handleSelect(overallIdx)}
                                onMouseEnter={() => setSelectedIndex(overallIdx)}
                                className={cn(
                                    "w-full text-left flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-xs transition-colors focus-visible:outline-none",
                                    isSelected ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                                )}
                            >
                                <div className="flex items-center gap-2.5">
                                    {action.icon}
                                    <span className="font-medium">{action.title}</span>
                                </div>
                                <ArrowRight size={12} className={cn("opacity-50", isSelected ? "opacity-100" : "hidden")} />
                            </button>
                        );
                    })}

                    {allItems.length === 0 && (
                        <div className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                            No matching tasks or commands found
                        </div>
                    )}
                </div>

                {/* Footer hints */}
                <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                    <div className="flex items-center gap-3">
                        <span><kbd className="font-bold">↑↓</kbd> Navigate</span>
                        <span><kbd className="font-bold">↵</kbd> Select</span>
                        <span><kbd className="font-bold">ESC</kbd> Close</span>
                    </div>
                    <span className="font-bold text-zinc-500">THERMALFLOW SPOTLIGHT</span>
                </div>
            </DialogContent>
        </Dialog>

        {isDecomposeOpen && (
            <DecomposeModal
                open={isDecomposeOpen}
                onOpenChange={setIsDecomposeOpen}
                taskId={selectedTaskId}
                initialTitle={selectedTaskId && tasks[selectedTaskId] ? tasks[selectedTaskId].title : ''}
            />
        )}
        </>
    );
}

