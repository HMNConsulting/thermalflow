'use client';

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Command, CornerDownLeft, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Keyboard } from "lucide-react";

interface HotkeysModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function HotkeysModal({ open, onOpenChange }: HotkeysModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Keyboard className="w-5 h-5" />
                        Keyboard Shortcuts
                    </DialogTitle>
                    <DialogDescription>
                        Navigate and manage tasks efficiently.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Navigate Selection</span>
                        <div className="flex gap-1">
                            <Kbd><ArrowUp size={14} /></Kbd>
                            <Kbd><ArrowDown size={14} /></Kbd>
                            <Kbd><ArrowLeft size={14} /></Kbd>
                            <Kbd><ArrowRight size={14} /></Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Toggle Task</span>
                        <Kbd>Enter</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Delete Task</span>
                        <Kbd>Del</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Add Task</span>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400">Type anywhere</span>
                            <Kbd>A-Z</Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Add Child Task</span>
                        <div className="flex gap-1">
                            <Kbd>-</Kbd>
                            <span className="text-xs text-zinc-400">or</span>
                            <Kbd><ArrowRight size={14} /></Kbd>
                        </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Completed Column</span>
                        <Kbd>[</Kbd>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] items-center gap-4 text-sm">
                        <span className="text-zinc-500">Show Help</span>
                        <Kbd>/</Kbd>
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
