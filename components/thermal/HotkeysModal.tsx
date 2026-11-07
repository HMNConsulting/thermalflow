'use client';

import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogClose,
} from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Keyboard, X } from "lucide-react";

interface HotkeysModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function HotkeysModal({ open, onOpenChange }: HotkeysModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="sm:max-w-md bg-card text-foreground p-0 overflow-hidden gap-0 border border-zinc-200 dark:border-zinc-800 font-mono rounded-2xl shadow-2xl">
                <div className="bg-zinc-100/70 dark:bg-zinc-900/50 p-4 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <DialogTitle className="font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                        <Keyboard size={16} className="text-amber-600 dark:text-amber-400" />
                        Keyboard Shortcuts
                    </DialogTitle>
                    <DialogClose aria-label="Close keyboard shortcuts" className="opacity-70 hover:opacity-100 p-1">
                        <X size={16} />
                    </DialogClose>
                </div>
                <DialogDescription className="sr-only">
                    Navigate and manage tasks efficiently using keyboard shortcuts.
                </DialogDescription>
                <div className="grid gap-3 p-5 text-xs">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Command Palette & Search</span>
                        <div className="flex gap-1">
                            <Kbd>Ctrl</Kbd>
                            <Kbd>K</Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Navigate Selection</span>
                        <div className="flex gap-1">
                            <Kbd><ArrowUp size={12} /></Kbd>
                            <Kbd><ArrowDown size={12} /></Kbd>
                            <Kbd><ArrowLeft size={12} /></Kbd>
                            <Kbd><ArrowRight size={12} /></Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Complete / Reopen Task</span>
                        <Kbd>Enter</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Delete Selected Task</span>
                        <Kbd>Del</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Undo / Redo</span>
                        <div className="flex items-center gap-1">
                            <Kbd>Ctrl+Z</Kbd>
                            <span className="text-[10px] text-zinc-400">/</span>
                            <Kbd>Ctrl+Y</Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Quick Add Task</span>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Type anywhere</span>
                            <Kbd>A-Z</Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Add Subtask</span>
                        <div className="flex items-center gap-1">
                            <Kbd>-</Kbd>
                            <span className="text-[10px] text-zinc-400">or</span>
                            <Kbd><ArrowRight size={12} /></Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Toggle Completed Column</span>
                        <Kbd>[</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Deselect / Close</span>
                        <Kbd>Esc</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4">
                        <span className="text-zinc-600 dark:text-zinc-400">Toggle Help</span>
                        <Kbd>?</Kbd>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Kbd({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[10px] font-medium text-zinc-900 shadow-[0px_1px_1px_0px_rgba(0,0,0,0.05)] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
            {children}
        </kbd>
    );
}
