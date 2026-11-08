'use client';

import { useTaskStore } from "@/lib/store";
import { LayoutGrid, Columns, PanelRightClose, PanelRightOpen, Sun, Moon, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { DrawingModal } from "./DrawingModal";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function HeaderInfo() {
    const lastModified = useTaskStore(state => state.lastModified);
    const stateVersion = useTaskStore(state => state.version);
    const viewMode = useTaskStore(state => state.viewMode);
    const setViewMode = useTaskStore(state => state.setViewMode);
    const showCompleted = useTaskStore(state => state.showCompleted);
    const toggleCompletedColumn = useTaskStore(state => state.toggleCompletedColumn);

    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
    const commitHash = process.env.NEXT_PUBLIC_COMMIT_HASH || '';

    // Format: "LAST UPDATE // JAN 27 16:20"
    const dateStr = lastModified ? new Date(lastModified).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).toUpperCase() : 'UNKNOWN';

    return (
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
            <div className="flex items-center gap-2.5">
                <DrawingModal>
                    <button
                        type="button"
                        aria-label={`ThermalFlow Studio (v${appVersion})`}
                        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 rounded-md"
                        title={`ThermalFlow Studio • Build v${appVersion}${commitHash ? ` (${commitHash})` : ''} • State rev #${stateVersion}`}
                    >
                        <div className="bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 p-1.5 rounded-md shrink-0">
                            <CircleDashed size={17} className="animate-spin-slow" />
                        </div>
                        <div className="hidden sm:block text-left">
                            <div className="font-bold text-sm tracking-widest uppercase flex items-center gap-2 whitespace-nowrap leading-none">
                                <span>ThermalFlow</span>
                                <span className="text-[9px] font-normal text-zinc-600 dark:text-zinc-400 tracking-normal lowercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                                    v{appVersion}
                                </span>
                            </div>
                            <p suppressHydrationWarning className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-none hidden md:block mt-1">
                                UPDATE // {dateStr} <span className="opacity-75">· r{stateVersion}</span>
                            </p>
                        </div>
                    </button>
                </DrawingModal>
            </div>

            <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 sm:p-1 border border-zinc-200 dark:border-zinc-800 gap-0.5" role="group" aria-label="Workspace View Controls">
                <button
                    type="button"
                    onClick={() => setViewMode('column')}
                    aria-label="Miller Column View"
                    aria-pressed={viewMode === 'column'}
                    className={cn(
                        "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                        viewMode === 'column'
                            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                    title="Miller Column View"
                >
                    <Columns size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    aria-label="Sticky Note Grid View"
                    aria-pressed={viewMode === 'grid'}
                    className={cn(
                        "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                        viewMode === 'grid'
                            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                    title="Sticky Note Grid View"
                >
                    <LayoutGrid size={14} />
                </button>

                <div className="w-[1px] h-4 bg-zinc-200 dark:bg-zinc-800 mx-0.5" />

                <button
                    type="button"
                    onClick={toggleCompletedColumn}
                    aria-label={showCompleted ? "Hide Completed Column" : "Show Completed Column"}
                    aria-pressed={showCompleted}
                    className={cn(
                        "p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
                        showCompleted
                            ? "bg-white dark:bg-zinc-800 shadow-sm text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    )}
                    title={showCompleted ? "Hide Completed Column ([)" : "Show Completed Column ([)"}
                >
                    {showCompleted ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                </button>

                {mounted && (
                    <button
                        type="button"
                        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                        aria-label="Toggle Light/Dark Theme"
                        className="p-1.5 rounded-md transition-colors text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
                        title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
                    >
                        {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                    </button>
                )}
            </div>
        </div>
    );
}
