'use client';

import { useTaskStore } from "@/lib/store";
import { LayoutGrid, Columns } from "lucide-react";
import { cn } from "@/lib/utils";
import { DrawingModal } from "./DrawingModal";

export function HeaderInfo() {
    const lastModified = useTaskStore(state => state.lastModified);
    const viewMode = useTaskStore(state => state.viewMode);
    const setViewMode = useTaskStore(state => state.setViewMode);


    // Format: "LAST UPDATE // JAN 27 16:20"
    const dateStr = lastModified ? new Date(lastModified).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).toUpperCase() : 'UNKNOWN';

    return (
        <div className="flex items-center gap-2 md:gap-6">
            <div className="hidden sm:block">
                <DrawingModal>
                    <h1 className="font-bold text-sm tracking-widest uppercase flex items-center gap-2 whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity">
                        ThermalFlow
                    </h1>
                </DrawingModal>
                <p suppressHydrationWarning className="text-[10px] text-zinc-400 leading-none hidden md:block mt-1">UPDATE // {dateStr}</p>
            </div>

            <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1 border border-zinc-200 dark:border-zinc-800">
                <button
                    onClick={() => setViewMode('column')}
                    className={cn(
                        "p-1.5 rounded-md transition-all",
                        viewMode === 'column'
                            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-600"
                    )}
                    title="Column View"
                >
                    <Columns size={14} />
                </button>
                <button
                    onClick={() => setViewMode('grid')}
                    className={cn(
                        "p-1.5 rounded-md transition-all",
                        viewMode === 'grid'
                            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-600"
                    )}
                    title="Sticky Note Grid"
                >
                    <LayoutGrid size={14} />
                </button>
            </div>
        </div>
    );
}
